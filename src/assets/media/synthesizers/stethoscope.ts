/**
 * Stethoscope audio synthesis: maps a sub-audible signal onto an audible carrier, brain-stethoscope style.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { calculateAmplitudeEnvelope } from '#util/signal'
import { AUDIBLE_SAMPLE_RATE, renderGraph } from './renderOffline'
import type { AudioSynthesizer, StethoscopeSynthesisOptions } from '#types/media'

/**
 * Derive a normalised amplitude (loudness) control curve from a signal. Each control sample is the peak absolute
 * amplitude of a window of `sampleRate / controlRateHz` samples; the curve is normalised to [0, 1] against its peak.
 * @param signal - Signal data in physical units.
 * @param sampleRate - Sampling rate of the signal in Hz.
 * @param controlRateHz - Number of control samples per second.
 * @returns Normalised loudness curve, one value per control sample.
 */
export function envelopeCurve (signal: Float32Array, sampleRate: number, controlRateHz: number): Float32Array {
    const windowSize = Math.max(1, Math.round(sampleRate/controlRateHz))
    const envelope = calculateAmplitudeEnvelope(signal, windowSize)
    const out = new Float32Array(envelope.length)
    let peak = 0
    for (let i=0; i<envelope.length; i++) {
        const value = Math.max(Math.abs(envelope[i].min.value), Math.abs(envelope[i].max.value))
        out[i] = value
        if (value > peak) {
            peak = value
        }
    }
    if (peak > 0) {
        for (let i=0; i<out.length; i++) {
            out[i] /= peak
        }
    }
    return out
}

/**
 * Estimate the signal's instantaneous frequency over time by counting zero crossings per window. Two crossings make
 * one cycle, so the per-window frequency is `(crossings / 2) / windowDurationSeconds`.
 * @param signal - Signal data in physical units.
 * @param sampleRate - Sampling rate of the signal in Hz.
 * @param controlRateHz - Number of control samples per second.
 * @returns Estimated frequency (Hz) per control sample.
 */
export function zeroCrossingFrequencyCurve (
    signal: Float32Array,
    sampleRate: number,
    controlRateHz: number
): Float32Array {
    const windowSize = Math.max(2, Math.round(sampleRate/controlRateHz))
    const windows = Math.max(1, Math.ceil(signal.length/windowSize))
    const out = new Float32Array(windows)
    for (let w=0; w<windows; w++) {
        const start = w*windowSize
        const end = Math.min(start + windowSize, signal.length)
        let crossings = 0
        for (let i=start+1; i<end; i++) {
            if ((signal[i-1] <= 0 && signal[i] > 0) || (signal[i-1] >= 0 && signal[i] < 0)) {
                crossings++
            }
        }
        const windowDuration = (end - start)/sampleRate
        out[w] = windowDuration > 0 ? (crossings/2)/windowDuration : 0
    }
    return out
}

/**
 * Map a curve linearly onto a [min, max] band, scaling against the curve's own observed range. A flat curve maps to
 * the band midpoint.
 */
export function mapToBand (curve: Float32Array, band: [number, number]): Float32Array {
    const [min, max] = band
    let lo = Infinity
    let hi = -Infinity
    for (const value of curve) {
        if (value < lo) {
            lo = value
        }
        if (value > hi) {
            hi = value
        }
    }
    const span = hi - lo
    const out = new Float32Array(curve.length)
    for (let i=0; i<curve.length; i++) {
        out[i] = span > 0 ? min + ((curve[i] - lo)/span)*(max - min) : (min + max)/2
    }
    return out
}

/**
 * Subtract the signal's mean, centring it on zero. Biosignals such as accelerometry magnitude carry a large constant
 * baseline (gravity ≈ 1 g); without removing it the amplitude envelope is swamped by the offset and the signal never
 * crosses zero, so neither loudness nor frequency would track the actual movement.
 * @param signal - Signal data in physical units.
 * @returns The mean-centred signal.
 */
export function removeMean (signal: Float32Array): Float32Array {
    if (!signal.length) {
        return new Float32Array()
    }
    let sum = 0
    for (const value of signal) {
        sum += value
    }
    const mean = sum/signal.length
    const out = new Float32Array(signal.length)
    for (let i=0; i<signal.length; i++) {
        out[i] = signal[i] - mean
    }
    return out
}

/** Ensure an automation curve has at least the two points `setValueCurveAtTime` requires. */
function ensureCurve (curve: Float32Array, fallback: number): Float32Array {
    if (curve.length >= 2) {
        return curve
    }
    const value = curve.length === 1 ? curve[0] : fallback
    return Float32Array.of(value, value)
}

/**
 * Maps a sub-audible signal onto an audible carrier in a time-preserving way: the signal's amplitude envelope drives
 * the carrier loudness and, when `trackFrequency` is set, its instantaneous frequency drives the carrier pitch within
 * a band. Unlike `spectral-tone`, this tracks the signal's evolution over time.
 */
export default class StethoscopeSynthesizer implements AudioSynthesizer {
    async synthesize (
        signals: Float32Array[],
        sampleRate: number,
        opts: StethoscopeSynthesisOptions = {}
    ): Promise<AudioBuffer> {
        const channel = signals[0] ?? new Float32Array()
        const controlRateHz = opts.controlRateHz ?? 50
        const durationSeconds = opts.durationSeconds ?? channel.length/sampleRate
        if (!channel.length || durationSeconds <= 0) {
            return renderGraph(1, 1, AUDIBLE_SAMPLE_RATE, () => {})
        }
        // The carrier is synthesised audible audio, so the output renders at the audible rate; the signal's own
        // (sub-audible) rate is used only to derive the control curves below.
        const length = Math.max(1, Math.floor(AUDIBLE_SAMPLE_RATE*durationSeconds))
        // Centre the signal so loudness and frequency track the movement, not the baseline (e.g. gravity).
        const centered = removeMean(channel)
        const gainCurve = ensureCurve(envelopeCurve(centered, sampleRate, controlRateHz), 0)
        const carrierHz = opts.carrierHz ?? 220
        const frequencyCurve = (opts.trackFrequency ?? true)
            ? ensureCurve(
                mapToBand(zeroCrossingFrequencyCurve(centered, sampleRate, controlRateHz), opts.carrierBandHz ?? [110, 880]),
                carrierHz
            )
            : Float32Array.of(carrierHz, carrierHz)
        return renderGraph(1, length, AUDIBLE_SAMPLE_RATE, (context) => {
            const oscillator = context.createOscillator()
            oscillator.frequency.setValueCurveAtTime(frequencyCurve, 0, durationSeconds)
            const gain = context.createGain()
            gain.gain.setValueCurveAtTime(gainCurve, 0, durationSeconds)
            const master = context.createGain()
            master.gain.value = 0.8
            oscillator.connect(gain)
            gain.connect(master)
            master.connect(context.destination)
            oscillator.start()
            oscillator.stop(durationSeconds)
        })
    }
}
