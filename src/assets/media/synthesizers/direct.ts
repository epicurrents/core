/**
 * Direct audio synthesis: normalised playback of the signal with optional EQ.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { renderOffline } from './renderOffline'
import type { AudioEqBand, AudioSynthesizer, DirectSynthesisOptions } from '#types/media'

/**
 * Normalise signal channels into the [-1, 1] playback range. Each output sample is the source sample divided by
 * `sampleMaxAbsValue` (when truthy) and clipped to [-1, 1]. When `outSampleCount` differs from a channel's length the
 * channel is resampled by nearest-neighbour pick.
 * @param signals - One continuous Float32Array per channel, in physical units.
 * @param outSampleCount - Number of samples per output channel.
 * @param sampleMaxAbsValue - Value the signal is normalised against; a falsy value leaves the signal unscaled.
 * @returns One normalised Float32Array per input channel.
 */
export function normalizeChannels (
    signals: Float32Array[],
    outSampleCount: number,
    sampleMaxAbsValue: number
): Float32Array[] {
    return signals.map((channel) => {
        const out = new Float32Array(outSampleCount)
        const dsFactor = channel.length/outSampleCount
        for (let j=0; j<outSampleCount; j++) {
            const raw = channel[Math.floor(j*dsFactor)]
            const value = sampleMaxAbsValue ? raw/sampleMaxAbsValue : raw
            out[j] = Math.max(-1, Math.min(1, value))
        }
        return out
    })
}

/**
 * Build the normalised, un-filtered playback buffer for the `direct` method. Synchronous so the back-compatible
 * `setSignals` path can stay synchronous; the EQ branch of {@link DirectSynthesizer.synthesize} renders this buffer
 * through an offline graph.
 * @param signals - One continuous Float32Array per channel, in physical units.
 * @param sampleRate - Sampling rate of the signals in Hz.
 * @param opts - Direct synthesis options.
 * @returns The normalised audio buffer.
 */
export function mintDirectBuffer (
    signals: Float32Array[],
    sampleRate: number,
    opts: DirectSynthesisOptions = {}
): AudioBuffer {
    const durationSeconds = opts.durationSeconds ?? (signals[0]?.length ?? 0)/sampleRate
    const outSampleCount = Math.max(1, Math.floor(sampleRate*durationSeconds))
    const normalized = normalizeChannels(signals, outSampleCount, opts.sampleMaxAbsValue ?? 0)
    const buffer = new AudioBuffer({
        length: outSampleCount,
        numberOfChannels: Math.max(1, signals.length),
        sampleRate,
    })
    for (let i=0; i<normalized.length; i++) {
        buffer.getChannelData(i).set(normalized[i])
    }
    return buffer
}

/**
 * Chain a biquad filter per EQ band between the input node and the node returned (the chain tail).
 */
function buildEqChain (context: OfflineAudioContext, input: AudioNode, bands: AudioEqBand[]): AudioNode {
    let node = input
    for (const band of bands) {
        const filter = context.createBiquadFilter()
        filter.type = band.type
        filter.frequency.value = band.frequency
        if (band.q !== undefined) {
            filter.Q.value = band.q
        }
        if (band.gain !== undefined) {
            filter.gain.value = band.gain
        }
        node.connect(filter)
        node = filter
    }
    return node
}

/**
 * Reproduces direct playback of a biosignal: the signal is normalised against a maximum absolute value and clipped,
 * matching what the EMG module plays. An optional EQ band chain shapes the sound through an offline render.
 */
export default class DirectSynthesizer implements AudioSynthesizer {
    async synthesize (
        signals: Float32Array[],
        sampleRate: number,
        opts: DirectSynthesisOptions = {}
    ): Promise<AudioBuffer> {
        const dry = mintDirectBuffer(signals, sampleRate, opts)
        if (!opts.eq?.length) {
            return dry
        }
        const eq = opts.eq
        return renderOffline(dry, (context, input) => buildEqChain(context, input, eq))
    }
}
