/**
 * Spectral-tone audio synthesis: a steady, audible tone resynthesised from a signal window's dominant spectral peaks.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { fftAnalysis } from '#util/signal'
import { AUDIBLE_SAMPLE_RATE, renderGraph } from './renderOffline'
import type { AudioSynthesizer, SpectralToneSynthesisOptions } from '#types/media'

/** A spectral peak: a frequency bin and its magnitude. */
export interface SpectralPeak {
    frequency: number
    magnitude: number
}

/**
 * Pick the strongest spectral peaks from a magnitude spectrum. Peaks are interior local maxima (a bin larger than both
 * neighbours), skipping the DC bin, sorted by magnitude. When the spectrum has no interior turning point the single
 * largest non-DC bin is returned.
 * @param magnitudes - Magnitude per frequency bin, as returned by `fftAnalysis`.
 * @param frequencyBins - Frequency (Hz) of each bin, index-aligned with `magnitudes`.
 * @param peakCount - Maximum number of peaks to return.
 * @returns The selected peaks, strongest first.
 */
export function pickTopPeaks (magnitudes: number[], frequencyBins: number[], peakCount: number): SpectralPeak[] {
    const peaks: SpectralPeak[] = []
    for (let i=1; i<magnitudes.length-1; i++) {
        if (magnitudes[i] > magnitudes[i-1] && magnitudes[i] >= magnitudes[i+1]) {
            peaks.push({ frequency: frequencyBins[i], magnitude: magnitudes[i] })
        }
    }
    if (!peaks.length) {
        let maxIdx = -1
        for (let i=1; i<magnitudes.length; i++) {
            if (maxIdx < 0 || magnitudes[i] > magnitudes[maxIdx]) {
                maxIdx = i
            }
        }
        if (maxIdx >= 0 && frequencyBins[maxIdx] !== undefined) {
            peaks.push({ frequency: frequencyBins[maxIdx], magnitude: magnitudes[maxIdx] })
        }
    }
    return peaks
        .sort((a, b) => b.magnitude - a.magnitude)
        .slice(0, Math.max(0, peakCount))
}

/**
 * Derive the multiplicative speed-up factor that lifts the signal's dominant frequency into the audible band. Scaling
 * every peak by one factor preserves the harmonic ratios (a true sped-up timbre). An explicit factor overrides the
 * target-frequency computation.
 * @param dominantHz - Frequency of the dominant peak in Hz.
 * @param targetFundamentalHz - Frequency the dominant peak should land on.
 * @param explicit - Explicit factor; returned verbatim when given.
 * @returns The speed-up factor.
 */
export function spectralSpeedUp (dominantHz: number, targetFundamentalHz: number, explicit?: number): number {
    if (explicit !== undefined) {
        return explicit
    }
    return dominantHz > 0 ? targetFundamentalHz/dominantHz : 1
}

/**
 * Resynthesises the dominant spectral peaks of the first signal channel as a steady tone, scaled into the audible band
 * by a single multiplicative speed-up factor so harmonic ratios are preserved. The result is a spectral snapshot — it
 * discards the signal's temporal evolution by design.
 */
export default class SpectralToneSynthesizer implements AudioSynthesizer {
    async synthesize (
        signals: Float32Array[],
        sampleRate: number,
        opts: SpectralToneSynthesisOptions = {}
    ): Promise<AudioBuffer> {
        const channel = signals[0] ?? new Float32Array()
        const durationSeconds = opts.durationSeconds ?? 2
        // The tone is synthesised audible audio, so the output renders at the audible rate; the signal's own
        // (sub-audible) rate stays with fftAnalysis for the spectral analysis.
        const length = Math.max(1, Math.floor(AUDIBLE_SAMPLE_RATE*durationSeconds))
        const { frequencyBins, magnitudes } = fftAnalysis(channel, sampleRate)
        const candidates = pickTopPeaks(magnitudes, frequencyBins, opts.peakCount ?? 24)
        // Keep only peaks above a fraction of the dominant: a narrow, stable spectrum collapses to a few clean
        // components, while a distributed, jerky one keeps many — so the tone reflects the spectral character.
        const threshold = (opts.peakThreshold ?? 0.1)*(candidates[0]?.magnitude ?? 0)
        const peaks = candidates.filter(peak => peak.magnitude >= threshold)
        if (!peaks.length) {
            return renderGraph(1, length, AUDIBLE_SAMPLE_RATE, () => {})
        }
        const speedUp = spectralSpeedUp(peaks[0].frequency, opts.targetFundamentalHz ?? 440, opts.speedUp)
        const totalMagnitude = peaks.reduce((sum, peak) => sum + peak.magnitude, 0) || 1
        return renderGraph(1, length, AUDIBLE_SAMPLE_RATE, (context) => {
            const master = context.createGain()
            master.gain.value = 0.8
            master.connect(context.destination)
            for (const peak of peaks) {
                const oscillator = context.createOscillator()
                oscillator.frequency.value = peak.frequency*speedUp
                const gain = context.createGain()
                gain.gain.value = peak.magnitude/totalMagnitude
                oscillator.connect(gain)
                gain.connect(master)
                oscillator.start()
                oscillator.stop(durationSeconds)
            }
        })
    }
}
