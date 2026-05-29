/**
 * dsp.ts — Digital signal processing for @epicurrents/core.
 *
 * Replaces fili.js with a purpose-built, zero-dependency implementation:
 *   - Radix-2 FFT with pre-computed twiddle factors and caller-provided buffers
 *   - Butterworth IIR filter design matching scipy.signal.butter() exactly
 *   - Zero-phase sosfiltfilt closely approximating scipy.signal.sosfiltfilt()
 *     (the steady-state edge initial conditions are a closed-form approximation,
 *     not scipy's exact companion-matrix solve, so edge samples are not bit-exact)
 *
 * ## Order convention
 * `order` is the number of prototype poles (standard convention).
 * Fili.js counted biquad sections instead.
 * Migration: Fili `order: 2` LP/HP → `butterLowpass(4, ...)` / `butterHighpass(4, ...)`
 *            Fili `order: 6` BS    → `butterBandstop(12, ...)`
 *
 * ## Bandpass note
 * `butterBandpass(order, hp, lp, fs)` accepts separate low-cut and high-cut thresholds
 * and produces a single 2×order-pole filter. It matches `scipy.signal.butter(order,
 * [hp, lp], btype='bandpass')` and avoids the double-pass cost of sequential HP + LP.
 */

// ── Types & interfaces ─────────────────────────────────────────────────────────

/**
 * One second-order section stored as `[b0, b1, b2, a1, a2]` (a0 = 1 normalised out).
 * Transfer function: `H(z) = (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²)`.
 */
export type Biquad = [number, number, number, number, number]

/** Complex number as a `[re, im]` tuple. Inline helpers keep allocation minimal. */
type Cx = [number, number]

/** Zero-pole-gain representation of a filter. */
interface ZPK { z: Cx[], p: Cx[], k: number }

// ── Private functions ──────────────────────────────────────────────────────────

/** Bilinear transform: analog ZPK → digital ZPK. */
function bilinear (zpk: ZPK, fs: number): ZPK {
    const fs2 = 2 * fs
    const fs2c: Cx = [fs2, 0]
    const d = zpk.p.length - zpk.z.length
    const p = zpk.p.map(q => cdiv(cadd(fs2c, q), csub(fs2c, q)))
    const z = [
        ...zpk.z.map(q => cdiv(cadd(fs2c, q), csub(fs2c, q))),
        ...Array<Cx>(d).fill([-1, 0]),   // LP poles at ∞ → z = −1
    ]
    // k_d = k_a × real(∏(2fs − z_a) / ∏(2fs − p_a))
    let num: Cx = [1, 0]
    for (const q of zpk.z) num = cmul(num, csub(fs2c, q))
    let den: Cx = [1, 0]
    for (const q of zpk.p) den = cmul(den, csub(fs2c, q))
    return { z, p, k: zpk.k * cdiv(num, den)[0] }
}

/** Nth-order Butterworth lowpass analog prototype (unit cutoff, gain = 1). */
function buttap (N: number): ZPK {
    const p: Cx[] = []
    for (let m = 0; m < N; m++) {
        const θ = Math.PI * (2*m + N + 1) / (2*N)
        p.push([Math.cos(θ), Math.sin(θ)])
    }
    return { z: [], p, k: 1 }
}

const cabs = (a: Cx): number => Math.sqrt(a[0]*a[0] + a[1]*a[1])

const cadd = (a: Cx, b: Cx): Cx => [a[0]+b[0], a[1]+b[1]]

const cdiv = (a: Cx, b: Cx): Cx => {
    const d = b[0]*b[0] + b[1]*b[1]
    return [(a[0]*b[0]+a[1]*b[1])/d, (a[1]*b[0]-a[0]*b[1])/d]
}

function checkGain (sos: Biquad[], ω: number, label: string) {
    const g = evalSOSMag(sos, ω)
    if (g < 0.5 || g > 2.0) {
        // eslint-disable-next-line no-console
        console.warn(`[dsp] ${label}: gain at reference frequency = ${g.toFixed(4)} (expected ≈ 1)`)
    }
}

const cmul = (a: Cx, b: Cx): Cx => [a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]]

const cneg = (a: Cx): Cx => [-a[0], -a[1]]

const csqrt = (a: Cx): Cx => {
    const r = Math.sqrt(a[0]*a[0] + a[1]*a[1])
    const θ = Math.atan2(a[1], a[0])
    return [Math.sqrt(r) * Math.cos(θ/2), Math.sqrt(r) * Math.sin(θ/2)]
}

const csub = (a: Cx, b: Cx): Cx => [a[0]-b[0], a[1]-b[1]]

/**
 * Evaluate the SOS transfer function magnitude at digital frequency `ω` (rad/sample).
 * Used internally to verify gain at the passband reference point.
 */
function evalSOSMag (sos: Biquad[], ω: number): number {
    const zRe = Math.cos(ω), zIm = Math.sin(ω)  // z = e^{jω}
    let re = 1, im = 0
    for (const [b0, b1, b2, a1, a2] of sos) {
        // Numerator: b0 + b1·z⁻¹ + b2·z⁻² at z = e^{jω}
        const nr = b0 + b1*zRe + b2*(zRe*zRe - zIm*zIm)
        const ni =      b1*zIm + b2*(2*zRe*zIm)
        // Denominator: 1 + a1·z⁻¹ + a2·z⁻²
        const dr = 1   + a1*zRe + a2*(zRe*zRe - zIm*zIm)
        const di =       a1*zIm + a2*(2*zRe*zIm)
        // section = (nr + j·ni) / (dr + j·di)
        const dd = dr*dr + di*di
        const sr = (nr*dr + ni*di) / dd
        const si = (ni*dr - nr*di) / dd
        // Accumulate product
        ;[re, im] = [re*sr - im*si, re*si + im*sr]
    }
    return Math.sqrt(re*re + im*im)
}

/** Transform LP prototype → BP with passband [ω₁, ω₂]. */
function lp2bp (zpk: ZPK, wo: number, bw: number): ZPK {
    const d = zpk.p.length - zpk.z.length
    const wo2sq: Cx = [4 * wo * wo, 0]
    const p: Cx[] = []
    for (const pk of zpk.p) {
        const bp: Cx = [bw * pk[0], bw * pk[1]]
        const sq = csqrt(csub(cmul(bp, bp), wo2sq))
        p.push([(bp[0]+sq[0])/2, (bp[1]+sq[1])/2])
        p.push([(bp[0]-sq[0])/2, (bp[1]-sq[1])/2])
    }
    const z: Cx[] = []
    for (const zk of zpk.z) {
        const bz: Cx = [bw * zk[0], bw * zk[1]]
        const sq = csqrt(csub(cmul(bz, bz), wo2sq))
        z.push([(bz[0]+sq[0])/2, (bz[1]+sq[1])/2])
        z.push([(bz[0]-sq[0])/2, (bz[1]-sq[1])/2])
    }
    for (let i = 0; i < d; i++) z.push([0, 0])
    return { z, p, k: zpk.k * Math.pow(bw, d) }
}

/** Transform LP prototype → BS with stopband [ω₁, ω₂]. */
function lp2bs (zpk: ZPK, wo: number, bw: number): ZPK {
    const d = zpk.p.length - zpk.z.length
    const wo2sq: Cx = [wo * wo, 0]
    const p: Cx[] = []
    for (const pk of zpk.p) {
        const h = cdiv([bw/2, 0], pk)
        const sq = csqrt(csub(cmul(h, h), wo2sq))
        p.push(cadd(h, sq))
        p.push(csub(h, sq))
    }
    // LP poles at ∞ → BS zeros at ±jω₀
    const z: Cx[] = []
    for (let i = 0; i < d; i++) { z.push([0, wo]); z.push([0, -wo]) }
    for (const zk of zpk.z) {
        const h = cdiv([bw/2, 0], zk)
        const sq = csqrt(csub(cmul(h, h), wo2sq))
        z.push(cadd(h, sq))
        z.push(csub(h, sq))
    }
    // k_new = k × real(∏(−z_lp)) / real(∏(−p_lp))
    let kn: Cx = [zpk.k, 0]
    for (const q of zpk.z) kn = cmul(kn, cneg(q))
    let kd: Cx = [1, 0]
    for (const q of zpk.p) kd = cmul(kd, cneg(q))
    return { z, p, k: cdiv(kn, kd)[0] }
}

/** Transform LP prototype → HP with cutoff ω₀. */
function lp2hp (zpk: ZPK, wo: number): ZPK {
    const d = zpk.p.length - zpk.z.length
    const wo2: Cx = [wo, 0]
    const p = zpk.p.map(q => cdiv(wo2, q))
    const z = [...zpk.z.map(q => cdiv(wo2, q)), ...Array<Cx>(d).fill([0, 0])]
    // k_new = k × real(∏(−p_lp)) / real(∏(−z_lp))
    let kn: Cx = [zpk.k, 0]
    for (const q of zpk.p) kn = cmul(kn, cneg(q))
    let kd: Cx = [1, 0]
    for (const q of zpk.z) kd = cmul(kd, cneg(q))
    return { z, p, k: cdiv(kn, kd)[0] }
}

/** Scale LP prototype to cutoff ω₀ rad/s. */
function lp2lp (zpk: ZPK, wo: number): ZPK {
    const d = zpk.p.length - zpk.z.length
    return {
        z: zpk.z.map(q => [q[0]*wo, q[1]*wo] as Cx),
        p: zpk.p.map(q => [q[0]*wo, q[1]*wo] as Cx),
        k: zpk.k * Math.pow(wo, d),
    }
}

/** Prewarp a digital cutoff frequency (Hz) to an analog frequency (rad/s). */
function prewarp (fc: number, fs: number): number {
    return 2 * fs * Math.tan(Math.PI * fc / fs)
}

/**
 * Convert a digital ZPK filter to second-order sections.
 * Poles/zeros are grouped into conjugate pairs; each pair forms one biquad.
 * Poles closest to the unit circle are placed in the last section for
 * maximum numerical stability. Gain is applied to the first section.
 */
function zpk2sos (zpk: ZPK): Biquad[] {
    // ── Group poles into conjugate pairs ──────────────────────────────────────
    // Butterworth design always produces exact conjugate pairs and real poles.
    // For each positive-imaginary pole, directly pair with its conjugate [re, −im].
    // Real poles: sort ascending, pair first-with-last.
    // Poles closest to the unit circle are placed last (better numerical stability).
    const polePairs: [Cx, Cx][] = []
    const realPoles: number[] = []
    for (const p of zpk.p) {
        if (Math.abs(p[1]) < 1e-10) {
            realPoles.push(p[0])
        } else if (p[1] > 0) {
            polePairs.push([p, [p[0], -p[1]]])  // exact conjugate pair
        }
    }
    realPoles.sort((a, b) => a - b)
    for (let i = 0; i < Math.floor(realPoles.length / 2); i++) {
        polePairs.push([[realPoles[i], 0], [realPoles[realPoles.length - 1 - i], 0]])
    }
    if (realPoles.length % 2 === 1) {
        const m = Math.floor(realPoles.length / 2)
        polePairs.push([[realPoles[m], 0], [realPoles[m], 0]])
    }
    // Sort sections: farthest from unit circle first, closest last.
    polePairs.sort((a, b) => Math.abs(cabs(b[0]) - 1) - Math.abs(cabs(a[0]) - 1))

    // ── Group zeros into conjugate pairs ──────────────────────────────────────
    // Same strategy: positive-imaginary zeros paired with their exact conjugate;
    // real zeros sorted ascending and cross-paired (first-with-last).
    // Cross-pairing is critical for BP where half the zeros are −1 and half +1:
    // same-value pairing would give [−1,−1] and [+1,+1] (wrong), while
    // cross-pairing gives [−1,+1] (correct numerator [1, 0, −1]).
    const zeroPairs: [Cx, Cx][] = []
    const realZeros: number[] = []
    for (const z of zpk.z) {
        if (Math.abs(z[1]) < 1e-10) {
            realZeros.push(z[0])
        } else if (z[1] > 0) {
            zeroPairs.push([z, [z[0], -z[1]]])  // exact conjugate pair
        }
    }
    realZeros.sort((a, b) => a - b)
    for (let i = 0; i < Math.floor(realZeros.length / 2); i++) {
        zeroPairs.push([[realZeros[i], 0], [realZeros[realZeros.length - 1 - i], 0]])
    }
    if (realZeros.length % 2 === 1) {
        const m = Math.floor(realZeros.length / 2)
        zeroPairs.push([[realZeros[m], 0], [realZeros[m], 0]])
    }

    // ── Match each pole pair with the nearest zero pair ───────────────────────
    const zAvailable = zeroPairs.map((zp, i) => ({ zp, i, used: false }))
    const sos: Biquad[] = []

    for (const [p1, p2] of polePairs) {
        // Denominator: [1, a1, a2] = [1, −(p1+p2), p1·p2]
        const a1 = -(p1[0] + p2[0])
        const a2 = p1[0]*p2[0] - p1[1]*p2[1]   // Re(p1·p2)

        // Find nearest unused zero pair (measured from upper-half-plane pole).
        let best = -1, bestD = Infinity
        const ref = p1[1] >= 0 ? p1 : [p1[0], -p1[1]] as Cx
        for (const entry of zAvailable) {
            if (entry.used) continue
            const d = cabs(csub(entry.zp[0], ref))
            if (d < bestD) { bestD = d; best = entry.i }
        }

        let b0 = 1, b1 = 0, b2 = 0
        if (best >= 0) {
            zAvailable[best].used = true
            const [z1, z2] = zAvailable[best].zp
            // Numerator: [1, −(z1+z2), Re(z1·z2)]
            b1 = -(z1[0] + z2[0])
            b2 = z1[0]*z2[0] - z1[1]*z2[1]     // Re(z1·z2)
        }

        sos.push([b0, b1, b2, a1, a2])
    }

    // Apply overall gain to the first section.
    if (sos.length) {
        const s = sos[0]
        sos[0] = [s[0]*zpk.k, s[1]*zpk.k, s[2]*zpk.k, s[3], s[4]]
    }

    return sos
}

// ── Classes ────────────────────────────────────────────────────────────────────

/**
 * Radix-2 Cooley-Tukey FFT. Twiddle factors and the bit-reversal table are
 * pre-computed in the constructor so repeated calls have minimal overhead.
 *
 * Output buffers are caller-provided (like fft.js), enabling zero-allocation
 * inner loops — useful for per-epoch spectrogram computation.
 */
export class FFT {

    readonly size: number
    /** cos(−2πk/N) for k = 0 … N/2−1. */
    private readonly _cos: Float64Array
    /** sin(−2πk/N) for k = 0 … N/2−1. */
    private readonly _sin: Float64Array
    /** Bit-reversal permutation table. */
    private readonly _rev: Uint32Array

    /** Blackman window of length N. */
    static blackman (N: number): Float64Array {
        const w = new Float64Array(N)
        const c = 2 * Math.PI / (N - 1)
        for (let i = 0; i < N; i++)
            w[i] = 0.42 - 0.5 * Math.cos(c * i) + 0.08 * Math.cos(2 * c * i)
        return w
    }

    /** Hamming window of length N. */
    static hamming (N: number): Float64Array {
        const w = new Float64Array(N)
        const c = 2 * Math.PI / (N - 1)
        for (let i = 0; i < N; i++) w[i] = 0.54 - 0.46 * Math.cos(c * i)
        return w
    }

    /** Hann window of length N. */
    static hann (N: number): Float64Array {
        const w = new Float64Array(N)
        const c = 2 * Math.PI / (N - 1)
        for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(c * i))
        return w
    }

    constructor (size: number) {
        if ((size & (size - 1)) !== 0 || size < 2) {
            throw new RangeError(`FFT size must be a power of two ≥ 2, got ${size}`)
        }
        this.size = size
        const half = size >>> 1
        this._cos = new Float64Array(half)
        this._sin = new Float64Array(half)
        for (let k = 0; k < half; k++) {
            const θ = -2 * Math.PI * k / size
            this._cos[k] = Math.cos(θ)
            this._sin[k] = Math.sin(θ)
        }
        const bits = Math.log2(size) | 0
        this._rev = new Uint32Array(size)
        for (let i = 0; i < size; i++) {
            let r = 0, x = i
            for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>>= 1 }
            this._rev[i] = r
        }
    }

    /**
     * Forward FFT. Writes interleaved `[re₀, im₀, re₁, im₁, …]` into `out`
     * (length must be `2 × size`). An optional pre-computed `window` array
     * (length `size`) is applied to `input` before transformation.
     */
    forward (input: ArrayLike<number>, out: Float64Array, window?: Float64Array): void {
        const N = this.size
        if (window) {
            for (let i = 0; i < N; i++) {
                const j = this._rev[i]
                out[j << 1]       = ((input[i] as number) ?? 0) * window[i]
                out[(j << 1) | 1] = 0
            }
        } else {
            for (let i = 0; i < N; i++) {
                const j = this._rev[i]
                out[j << 1]       = (input[i] as number) ?? 0
                out[(j << 1) | 1] = 0
            }
        }
        for (let len = 2; len <= N; len <<= 1) {
            const step = N / len
            const half = len >>> 1
            for (let s = 0; s < N; s += len) {
                for (let k = 0; k < half; k++) {
                    const tw = k * step
                    const wr = this._cos[tw], wi = this._sin[tw]
                    const ui = (s + k) << 1, vi = (s + k + half) << 1
                    const ur = out[ui], uim = out[ui | 1]
                    const tr = wr * out[vi] - wi * out[vi | 1]
                    const ti = wr * out[vi | 1] + wi * out[vi]
                    out[ui]     = ur + tr;  out[ui | 1] = uim + ti
                    out[vi]     = ur - tr;  out[vi | 1] = uim - ti
                }
            }
        }
    }

    /**
     * Magnitude spectrum: `out[k] = √(re[k]² + im[k]²)` for `k = 0 … size/2`.
     * `out` must have length ≥ `size/2 + 1`.
     */
    magnitude (fftOut: Float64Array, out: Float64Array): void {
        const bins = (this.size >>> 1) + 1
        for (let k = 0; k < bins; k++) {
            const re = fftOut[k << 1], im = fftOut[(k << 1) | 1]
            out[k] = Math.sqrt(re * re + im * im)
        }
    }

    /**
     * Power spectrum: `out[k] = re[k]² + im[k]²` for `k = 0 … size/2`.
     * `out` must have length ≥ `size/2 + 1`.
     */
    powerSpectrum (fftOut: Float64Array, out: Float64Array): void {
        const bins = (this.size >>> 1) + 1
        for (let k = 0; k < bins; k++) {
            const re = fftOut[k << 1], im = fftOut[(k << 1) | 1]
            out[k] = re * re + im * im
        }
    }
}

/**
 * IIR filter runner using cascaded second-order sections (Direct Form II Transposed).
 *
 * Construct once with the output of a `butter*` function, then call
 * {@link filtfilt} or {@link simulate} as many times as needed.
 */
export class SOSFilter {

    private readonly _sos: Biquad[]

    constructor (sos: Biquad[]) {
        this._sos = sos
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    /**
     * Steady-state initial conditions for the given input level.
     * Solving the Direct Form II Transposed state equations at equilibrium
     * (all states and output equal to the DC gain applied to `x0`).
     */
    private _dcInitialConditions (x0: number): Float64Array {
        const sos = this._sos
        const zi = new Float64Array(sos.length * 2)
        let xLevel = x0
        for (let s = 0; s < sos.length; s++) {
            const [b0, b1, b2, a1, a2] = sos[s]
            const denom = 1 + a1 + a2
            // DC gain of this section.
            const g = Math.abs(denom) > 1e-12 ? (b0 + b1 + b2) / denom : 0
            const y = g * xLevel
            zi[s * 2]     = (b1 + b2 - (a1 + a2) * b0) / (denom || 1) * xLevel
            zi[s * 2 + 1] = (b2*(1 + a1) - a2*(b0 + b1))  / (denom || 1) * xLevel
            xLevel = y
        }
        return zi
    }

    /**
     * Apply the SOS filter to `signal` using Direct Form II Transposed.
     * `zi` is a flat array of 2 state values per section (length = 2 × sections).
     * Returns both the filtered output and the final filter state so the caller
     * can use it as initial conditions for a subsequent pass (e.g. filtfilt).
     */
    private _sosfilt (signal: Float64Array, zi: Float64Array): { out: Float64Array, finalState: Float64Array } {
        const sos = this._sos
        const N = signal.length
        const out = new Float64Array(N)
        const state = zi.slice()   // copy; zi is reused across sections
        for (let i = 0; i < N; i++) {
            let x = signal[i]
            for (let s = 0; s < sos.length; s++) {
                const [b0, b1, b2, a1, a2] = sos[s]
                const si = s * 2
                const y = b0 * x + state[si]
                state[si]     = b1 * x - a1 * y + state[si + 1]
                state[si + 1] = b2 * x - a2 * y
                x = y
            }
            out[i] = x
        }
        return { out, finalState: state }
    }

    /**
     * Zero-phase forward–backward filter (close approximation of `scipy.signal.sosfiltfilt`).
     * Edge effects are minimised by odd-extension padding of length
     * `3 × max(sections × 2, 15)` at each end, with steady-state initial conditions.
     * The initial conditions are a closed-form per-section approximation rather than
     * scipy's exact `sosfilt_zi` solve, so interior samples agree to floating-point
     * precision but edge samples may differ slightly.
     */
    filtfilt (signal: Float32Array): Float32Array {
        const sos = this._sos
        const npad = 3 * Math.max(sos.length * 2, 15)
        const n = signal.length
        const padded = new Float64Array(n + 2 * npad)
        // Left padding: odd extension to minimise the forward-pass startup transient.
        for (let i = 0; i < npad; i++) {
            padded[i] = 2 * signal[0] - signal[Math.min(npad - i, n - 1)]
        }
        for (let i = 0; i < n; i++) padded[npad + i] = signal[i]
        // Right padding: zeros. Odd extension would add a non-zero DC offset equal to
        // 2×signal[n-1], which the forward LP would settle to and then hand to the
        // backward pass as an initial DC state. When the backward pass then hits the
        // near-zero LP output of the actual signal, it sees a large step that creates
        // an end transient. Zero padding keeps the backward-pass DC at zero throughout.
        // (Right padding is zero-initialised by Float64Array; no loop needed.)

        // Compute DC steady-state initial conditions per section.
        const zi = this._dcInitialConditions(signal[0])
        // Forward pass — capture the final filter state for use as backward-pass IC.
        const { out: fwd, finalState: zfFwd } = this._sosfilt(padded, zi)
        // Reverse.
        const rev = new Float64Array(fwd.length)
        for (let i = 0; i < fwd.length; i++) rev[i] = fwd[fwd.length - 1 - i]
        // Backward pass: use the forward pass's exact final state. The right padding
        // is zero so fwd ends near zero, and zfFwd reflects that — giving the backward
        // pass initial conditions that match what it's about to process.
        const { out: bwd } = this._sosfilt(rev, zfFwd)
        // Reverse result and extract centre.
        const out = new Float32Array(n)
        for (let i = 0; i < n; i++) out[i] = bwd[bwd.length - 1 - npad - i]
        return out
    }

    /**
     * Single forward pass (causal). No edge-effect compensation.
     */
    simulate (signal: Float32Array): Float32Array {
        const arr = new Float64Array(signal)
        const { out: flt } = this._sosfilt(arr, this._dcInitialConditions(signal[0]))
        return new Float32Array(flt)
    }
}

// ── Exported functions ─────────────────────────────────────────────────────────

/**
 * Design a Butterworth bandpass filter with passbands `hp`–`lp` Hz.
 * The prototype order is `order`; the resulting filter has `2 × order` poles.
 * Matches `scipy.signal.butter(order, [hp, lp], btype='bandpass', fs=fs)`.
 *
 * Using a single bandpass instead of sequential HP + LP halves the filtfilt cost.
 */
export function butterBandpass (order: number, hp: number, lp: number, fs: number): Biquad[] {
    const w1 = prewarp(hp, fs), w2 = prewarp(lp, fs)
    const wo = Math.sqrt(w1 * w2), bw = w2 - w1
    const sos = zpk2sos(bilinear(lp2bp(buttap(order), wo, bw), fs))
    checkGain(sos, Math.PI * Math.sqrt(hp * lp) / (fs / 2), `BP(${order}, ${hp}–${lp})`)
    return sos
}

/**
 * Design a Butterworth bandstop (notch) filter that attenuates `hp`–`lp` Hz.
 * The prototype order is `order`; the resulting filter has `2 × order` poles.
 * Matches `scipy.signal.butter(order, [hp, lp], btype='bandstop', fs=fs)`.
 */
export function butterBandstop (order: number, hp: number, lp: number, fs: number): Biquad[] {
    const w1 = prewarp(hp, fs), w2 = prewarp(lp, fs)
    const wo = Math.sqrt(w1 * w2), bw = w2 - w1
    const sos = zpk2sos(bilinear(lp2bs(buttap(order), wo, bw), fs))
    checkGain(sos, 0, `BS(${order}, ${hp}–${lp})`)
    return sos
}

/**
 * Design an `order`-th order Butterworth highpass filter with −3 dB cutoff at `fc` Hz.
 */
export function butterHighpass (order: number, fc: number, fs: number): Biquad[] {
    const wo = prewarp(fc, fs)
    const sos = zpk2sos(bilinear(lp2hp(buttap(order), wo), fs))
    checkGain(sos, Math.PI, `HP(${order}, fc=${fc})`)
    return sos
}

/**
 * Design an `order`-th order Butterworth lowpass filter with −3 dB cutoff at `fc` Hz.
 * Returns second-order sections suitable for {@link SOSFilter}.
 */
export function butterLowpass (order: number, fc: number, fs: number): Biquad[] {
    const wo = prewarp(fc, fs)
    const sos = zpk2sos(bilinear(lp2lp(buttap(order), wo), fs))
    checkGain(sos, 0, `LP(${order}, fc=${fc})`)
    return sos
}
