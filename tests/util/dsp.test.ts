import { describe, it, expect } from 'vitest'
import {
    FFT,
    butterLowpass,
    butterHighpass,
    butterBandpass,
    butterBandstop,
    SOSFilter,
    type Biquad,
} from '../../src/util/dsp'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Evaluate SOS transfer-function magnitude at `freqHz`. */
function sosGain (sos: Biquad[], freqHz: number, fs: number): number {
    const ω = 2 * Math.PI * freqHz / fs
    const cr = Math.cos(ω), ci = Math.sin(ω)
    let re = 1, im = 0
    for (const [b0, b1, b2, a1, a2] of sos) {
        const nr = b0 + b1*cr + b2*(cr*cr - ci*ci)
        const ni = b1*ci + b2*(2*cr*ci)
        const dr = 1  + a1*cr + a2*(cr*cr - ci*ci)
        const di = a1*ci + a2*(2*cr*ci)
        const dd = dr*dr + di*di
        const sr = (nr*dr + ni*di) / dd, si = (ni*dr - nr*di) / dd
        ;[re, im] = [re*sr - im*si, re*si + im*sr]
    }
    return Math.sqrt(re*re + im*im)
}

/** Generate a real sinusoid: A·cos(2π·f·n/fs) for n = 0..length−1. */
function sine (f: number, fs: number, length: number, amp = 1): Float32Array {
    const s = new Float32Array(length)
    const ω = 2 * Math.PI * f / fs
    for (let n = 0; n < length; n++) s[n] = amp * Math.cos(ω * n)
    return s
}

/** RMS amplitude of a Float32Array. */
function rms (s: Float32Array): number {
    return Math.sqrt(s.reduce((acc, v) => acc + v*v, 0) / s.length)
}

// ── FFT ───────────────────────────────────────────────────────────────────────

describe('FFT', () => {

    it('rejects non-power-of-two sizes', () => {
        expect(() => new FFT(3)).toThrow()
        expect(() => new FFT(0)).toThrow()
    })

    it('accepts powers of two', () => {
        for (const n of [2, 4, 8, 16, 256, 1024]) {
            expect(() => new FFT(n)).not.toThrow()
        }
    })

    describe('forward()', () => {
        it('DC signal: bin 0 = N, all others ≈ 0', () => {
            const N = 8
            const fft = new FFT(N)
            const out = new Float64Array(2 * N)
            fft.forward(new Float32Array(N).fill(1), out)
            expect(out[0]).toBeCloseTo(N, 8)   // re[0]
            expect(out[1]).toBeCloseTo(0, 8)   // im[0]
            for (let k = 1; k < N; k++) {
                expect(Math.abs(out[k*2])).toBeLessThan(1e-7)
                expect(Math.abs(out[k*2+1])).toBeLessThan(1e-7)
            }
        })

        it('single cosine at k=1: bins 1 and N−1 have magnitude N/2', () => {
            const N = 16
            const fft = new FFT(N)
            const input = new Float32Array(N)
            for (let n = 0; n < N; n++) input[n] = Math.cos(2 * Math.PI * n / N)
            const out = new Float64Array(2 * N)
            fft.forward(input, out)
            const mag = (k: number) => Math.sqrt(out[k*2]**2 + out[k*2+1]**2)
            expect(mag(1)).toBeCloseTo(N/2, 6)
            expect(mag(N-1)).toBeCloseTo(N/2, 6)
            for (const k of [0, 2, 3, 4, 5, 6, 7]) {
                expect(mag(k)).toBeLessThan(1e-7)
            }
        })

        it('single cosine at k=3 (N=32)', () => {
            const N = 32, k0 = 3
            const fft = new FFT(N)
            const input = new Float32Array(N)
            for (let n = 0; n < N; n++) input[n] = Math.cos(2 * Math.PI * k0 * n / N)
            const out = new Float64Array(2 * N)
            fft.forward(input, out)
            const mag = (k: number) => Math.sqrt(out[k*2]**2 + out[k*2+1]**2)
            expect(mag(k0)).toBeCloseTo(N/2, 6)
            expect(mag(N-k0)).toBeCloseTo(N/2, 6)
            for (let k = 0; k < N/2+1; k++) {
                if (k !== k0) expect(mag(k)).toBeLessThan(1e-6)
            }
        })

        it('zeros input gives zeros output', () => {
            const N = 64
            const fft = new FFT(N)
            const out = new Float64Array(2 * N)
            fft.forward(new Float32Array(N), out)
            for (let i = 0; i < 2*N; i++) expect(out[i]).toBe(0)
        })

        it("Parseval's theorem: sum|X[k]|² = N · sum|x[n]|²", () => {
            const N = 64
            const fft = new FFT(N)
            const input = new Float32Array(N)
            for (let n = 0; n < N; n++) input[n] = Math.random()
            const out = new Float64Array(2 * N)
            fft.forward(input, out)
            const timePower = input.reduce((a, v) => a + v*v, 0) * N
            let freqPower = 0
            for (let k = 0; k < N; k++) freqPower += out[k*2]**2 + out[k*2+1]**2
            expect(freqPower).toBeCloseTo(timePower, 4)
        })

        it('linearity: FFT(a·x + b·y) = a·FFT(x) + b·FFT(y)', () => {
            const N = 16, a = 3, b = -1.5
            const fft = new FFT(N)
            const x = Float32Array.from({ length: N }, (_, i) => Math.sin(2*Math.PI*i/N))
            const y = Float32Array.from({ length: N }, (_, i) => Math.cos(2*Math.PI*2*i/N))
            const xy = new Float32Array(N)
            for (let i = 0; i < N; i++) xy[i] = a*x[i] + b*y[i]
            const ox = new Float64Array(2*N), oy = new Float64Array(2*N), oxy = new Float64Array(2*N)
            fft.forward(x, ox); fft.forward(y, oy); fft.forward(xy, oxy)
            for (let k = 0; k < N; k++) {
                expect(oxy[k*2]).toBeCloseTo(a*ox[k*2] + b*oy[k*2], 5)
                expect(oxy[k*2+1]).toBeCloseTo(a*ox[k*2+1] + b*oy[k*2+1], 5)
            }
        })

        it('Hann windowed cosine: spectral leak suppressed vs rectangular', () => {
            const N = 512
            const fft = new FFT(N)
            // Frequency not aligned to a bin — causes spectral leakage without windowing.
            const input = new Float32Array(N)
            for (let n = 0; n < N; n++) input[n] = Math.cos(2 * Math.PI * 2.3 * n / N)
            const noWin = new Float64Array(2*N), withWin = new Float64Array(2*N)
            fft.forward(input, noWin)
            fft.forward(input, withWin, FFT.hann(N))
            // Measure energy at bin k=10 (far from the signal bin).
            const leak = (out: Float64Array) => Math.sqrt(out[10*2]**2 + out[10*2+1]**2)
            expect(leak(withWin)).toBeLessThan(leak(noWin))
        })
    })

    describe('powerSpectrum()', () => {
        it('bin k power = magnitude squared', () => {
            const N = 32
            const fft = new FFT(N)
            const out = new Float64Array(2*N)
            const input = Float32Array.from({ length: N }, (_, i) => Math.cos(2*Math.PI*4*i/N))
            fft.forward(input, out)
            const ps = new Float64Array(N/2 + 1)
            fft.powerSpectrum(out, ps)
            for (let k = 0; k <= N/2; k++) {
                const re = out[k*2], im = out[k*2+1]
                expect(ps[k]).toBeCloseTo(re*re + im*im, 10)
            }
        })
    })

    describe('window functions', () => {
        it('Hann: starts and ends at 0, peaks at 1 near centre', () => {
            const w = FFT.hann(256)
            expect(w[0]).toBeCloseTo(0, 10)
            expect(w[255]).toBeCloseTo(0, 4)
            expect(Math.max(...w)).toBeCloseTo(1, 4)
        })

        it('Hamming: starts ≈ 0.08, never reaches 0', () => {
            const w = FFT.hamming(256)
            expect(w[0]).toBeCloseTo(0.08, 4)
            expect(Math.min(...w)).toBeGreaterThan(0)
        })

        it('Blackman: symmetric', () => {
            const w = FFT.blackman(64)
            for (let i = 0; i < 32; i++) {
                expect(w[i]).toBeCloseTo(w[63-i], 10)
            }
        })
    })
})

// ── Butterworth filter design ─────────────────────────────────────────────────

const FS = 250   // common sampling rate for all filter tests

describe('Butterworth filter design', () => {

    describe('butterLowpass', () => {
        const lp = butterLowpass(4, 15, FS)

        it('returns the right number of biquad sections', () => {
            expect(lp).toHaveLength(2)   // order 4 → 2 biquads
        })

        it('unity gain at DC', () => {
            expect(sosGain(lp, 0, FS)).toBeCloseTo(1, 3)
        })

        it('−3 dB (gain ≈ 0.707) at cutoff', () => {
            expect(sosGain(lp, 15, FS)).toBeCloseTo(1 / Math.SQRT2, 2)
        })

        it('strong attenuation at 3× cutoff', () => {
            // 4th-order Butterworth: |H(3fc)| = 1/√(1 + 3^8) ≈ 0.012
            expect(sosGain(lp, 45, FS)).toBeLessThan(0.02)
        })

        it('near-zero gain at Nyquist', () => {
            expect(sosGain(lp, FS/2, FS)).toBeLessThan(1e-4)
        })
    })

    describe('butterHighpass', () => {
        const hp = butterHighpass(4, 2, FS)

        it('returns the right number of biquads', () => {
            expect(hp).toHaveLength(2)
        })

        it('unity gain at Nyquist', () => {
            expect(sosGain(hp, FS/2 - 0.1, FS)).toBeCloseTo(1, 3)
        })

        it('−3 dB at cutoff', () => {
            expect(sosGain(hp, 2, FS)).toBeCloseTo(1 / Math.SQRT2, 2)
        })

        it('strong attenuation at 1/3 cutoff', () => {
            expect(sosGain(hp, 2/3, FS)).toBeLessThan(0.02)
        })

        it('near-zero gain at DC', () => {
            expect(sosGain(hp, 0.01, FS)).toBeLessThan(0.01)
        })
    })

    describe('butterBandpass', () => {
        const bp = butterBandpass(4, 2, 15, FS)

        it('returns 2×order biquads', () => {
            expect(bp).toHaveLength(4)   // order 4 → 8 poles → 4 biquads
        })

        it('near-unity gain at geometric centre', () => {
            const fc = Math.sqrt(2 * 15)
            expect(sosGain(bp, fc, FS)).toBeCloseTo(1, 2)
        })

        it('attenuates below lower cutoff', () => {
            expect(sosGain(bp, 0.5, FS)).toBeLessThan(0.1)
        })

        it('attenuates above upper cutoff', () => {
            expect(sosGain(bp, 50, FS)).toBeLessThan(0.1)
        })

        it('−3 dB at lower cutoff', () => {
            expect(sosGain(bp, 2, FS)).toBeCloseTo(1 / Math.SQRT2, 1)
        })

        it('−3 dB at upper cutoff', () => {
            expect(sosGain(bp, 15, FS)).toBeCloseTo(1 / Math.SQRT2, 1)
        })
    })

    describe('butterBandstop', () => {
        const bs = butterBandstop(4, 49, 51, FS)

        it('returns 2×order biquads', () => {
            expect(bs).toHaveLength(4)
        })

        it('near-unity gain at DC', () => {
            expect(sosGain(bs, 0, FS)).toBeCloseTo(1, 3)
        })

        it('near-unity gain at high frequency (away from notch)', () => {
            expect(sosGain(bs, 100, FS)).toBeCloseTo(1, 2)
        })

        it('deep attenuation at notch centre (50 Hz)', () => {
            expect(sosGain(bs, 50, FS)).toBeLessThan(0.01)
        })

        it('−3 dB at lower edge of stopband', () => {
            const g = sosGain(bs, 49, FS)
            expect(g).toBeGreaterThan(0.5)
            expect(g).toBeLessThan(0.85)
        })

        it('−3 dB at upper edge of stopband', () => {
            const g = sosGain(bs, 51, FS)
            expect(g).toBeGreaterThan(0.5)
            expect(g).toBeLessThan(0.85)
        })
    })

    describe('order scaling', () => {
        it('higher-order LP rolls off faster', () => {
            const lp2 = butterLowpass(2, 10, FS)
            const lp8 = butterLowpass(8, 10, FS)
            // At 2× cutoff, 8th-order should attenuate much more than 2nd-order.
            expect(sosGain(lp8, 20, FS)).toBeLessThan(sosGain(lp2, 20, FS))
        })

        it('LP order 1 returns 1 biquad', () => {
            expect(butterLowpass(1, 10, FS)).toHaveLength(1)
        })

        it('LP odd order 3 returns 2 biquads', () => {
            // 3 poles = 1 real + 1 conjugate pair → 2 sections
            expect(butterLowpass(3, 10, FS)).toHaveLength(2)
        })
    })

    describe('edge cases', () => {
        it('very low cutoff LP still has valid gain at DC', () => {
            const lp = butterLowpass(4, 0.5, FS)
            expect(sosGain(lp, 0, FS)).toBeCloseTo(1, 2)
        })

        it('wide-band BP near Nyquist does not NaN', () => {
            const bp = butterBandpass(2, 1, 100, FS)
            for (const f of [0, 1, 10, 50, 100, 124]) {
                expect(Number.isFinite(sosGain(bp, f, FS))).toBe(true)
            }
        })
    })
})

// ── SOSFilter ─────────────────────────────────────────────────────────────────

describe('SOSFilter', () => {

    describe('filtfilt() — LP', () => {
        const lp = new SOSFilter(butterLowpass(4, 15, FS))
        const LEN = 1024

        it('preserves DC component', () => {
            const dc = new Float32Array(LEN).fill(1)
            const out = lp.filtfilt(dc)
            // Mean should still be ≈ 1 after LP filtering.
            const mean = out.reduce((a, v) => a + v, 0) / LEN
            expect(mean).toBeCloseTo(1, 2)
        })

        it('passes in-band sine (5 Hz << 15 Hz cutoff) with gain ≈ 1', () => {
            const s = sine(5, FS, LEN)
            const out = lp.filtfilt(s)
            // Ignore first and last 50 samples (transient).
            const inRms  = rms(s.slice(50, LEN-50))
            const outRms = rms(out.slice(50, LEN-50))
            expect(outRms / inRms).toBeCloseTo(1, 1)
        })

        it('attenuates out-of-band sine (60 Hz >> 15 Hz cutoff)', () => {
            const s = sine(60, FS, LEN)
            const out = lp.filtfilt(s)
            const inRms  = rms(s.slice(50, LEN-50))
            const outRms = rms(out.slice(50, LEN-50))
            expect(outRms / inRms).toBeLessThan(0.01)
        })

        it('output length equals input length', () => {
            for (const len of [100, 512, 1000]) {
                expect(lp.filtfilt(new Float32Array(len).fill(0))).toHaveLength(len)
            }
        })
    })

    describe('filtfilt() — HP', () => {
        const hp = new SOSFilter(butterHighpass(4, 2, FS))
        const LEN = 1024

        it('blocks DC', () => {
            const dc = new Float32Array(LEN).fill(1)
            const out = hp.filtfilt(dc)
            const mean = Math.abs(out.slice(50, LEN-50).reduce((a, v) => a + v, 0) / (LEN-100))
            expect(mean).toBeLessThan(0.05)
        })

        it('passes high-frequency sine (50 Hz >> 2 Hz cutoff)', () => {
            const s = sine(50, FS, LEN)
            const out = hp.filtfilt(s)
            const inRms  = rms(s.slice(50, LEN-50))
            const outRms = rms(out.slice(50, LEN-50))
            expect(outRms / inRms).toBeGreaterThan(0.9)
            expect(outRms / inRms).toBeLessThan(1.1)
        })
    })

    describe('filtfilt() — BP replaces sequential HP + LP', () => {
        const LEN = 2048
        const bpFilter  = new SOSFilter(butterBandpass(4, 2, 15, FS))
        const hpFilter  = new SOSFilter(butterHighpass(4, 2, FS))
        const lpFilter  = new SOSFilter(butterLowpass(4, 15, FS))

        it('isolates in-band component and rejects out-of-band', () => {
            // Signal: 8 Hz (in-band) + 40 Hz (out-of-band)
            const sig = new Float32Array(LEN)
            for (let n = 0; n < LEN; n++) {
                sig[n] = Math.cos(2*Math.PI*8*n/FS) + Math.cos(2*Math.PI*40*n/FS)
            }
            const bpOut = bpFilter.filtfilt(sig)
            const slice = bpOut.slice(100, LEN-100)
            // 8 Hz component should survive; 40 Hz should be gone.
            // Check RMS is close to single-sine RMS ≈ 1/√2.
            expect(rms(slice)).toBeCloseTo(1 / Math.SQRT2, 1)
        })

        it('BP and sequential HP+LP give the same peak gain in the passband', () => {
            // Both should pass an 8 Hz sine with gain ≈ 1.
            const s = sine(8, FS, LEN)
            const bpRms  = rms(bpFilter.filtfilt(s).slice(100, LEN-100))
            const seqOut = lpFilter.filtfilt(hpFilter.filtfilt(s))
            const seqRms = rms(seqOut.slice(100, LEN-100))
            // Both should be close to the input RMS (gain ≈ 1 at 8 Hz).
            expect(bpRms).toBeCloseTo(seqRms, 1)
        })
    })

    describe('filtfilt() — BS (notch)', () => {
        const bs = new SOSFilter(butterBandstop(4, 49, 51, FS))
        const LEN = 2048

        it('passes in-band sine at 10 Hz', () => {
            const s = sine(10, FS, LEN)
            const out = bs.filtfilt(s)
            const ratio = rms(out.slice(100, LEN-100)) / rms(s.slice(100, LEN-100))
            expect(ratio).toBeCloseTo(1, 1)
        })

        it('removes 50 Hz notch frequency', () => {
            const s = sine(50, FS, LEN)
            const out = bs.filtfilt(s)
            const ratio = rms(out.slice(100, LEN-100)) / rms(s.slice(100, LEN-100))
            expect(ratio).toBeLessThan(0.05)
        })
    })

    describe('simulate()', () => {
        it('output length equals input length', () => {
            const f = new SOSFilter(butterLowpass(4, 15, FS))
            expect(f.simulate(new Float32Array(500))).toHaveLength(500)
        })

        it('passes DC with gain ≈ 1', () => {
            const f = new SOSFilter(butterLowpass(4, 15, FS))
            const out = f.simulate(new Float32Array(512).fill(1))
            // After initial transient the output settles to ≈ 1.
            expect(out[511]).toBeCloseTo(1, 2)
        })
    })
})
