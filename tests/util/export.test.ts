import { describe, it, expect } from 'vitest'
import { downsampleSignal } from '../../src/util/dsp'
import {
    applyExportSelection,
    checkExportSelection,
    resolveExportRange,
    type ExportSelectionResult,
    type ExportSourceData,
    type ExportSourceSignalChannel,
} from '../../src/util/export'
import type { AnnotationEventTemplate } from '../../src/types/biosignal'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A sine of the given frequency and amplitude. */
const sine = (freq: number, rate: number, seconds: number, amplitude = 1) => {
    return Float32Array.from({ length: Math.round(rate*seconds) }, (_, i) => amplitude*Math.sin(2*Math.PI*freq*i/rate))
}

/** A ramp whose every sample holds its own data time in seconds, so a slice shows where it was cut. */
const ramp = (rate: number, seconds: number) => {
    return Float32Array.from({ length: Math.round(rate*seconds) }, (_, i) => i/rate)
}

/** Peak absolute value over the interior of a signal, skipping `edge` samples at each end. */
const interiorPeak = (signal: Float32Array, edge: number) => {
    let peak = 0
    for (let i = edge; i < signal.length - edge; i++) {
        peak = Math.max(peak, Math.abs(signal[i]))
    }
    return peak
}

const channel = (label: string, rate: number, signal: Float32Array, extra = {}): ExportSourceSignalChannel => ({
    label,
    sampleCount: signal.length,
    samplingRate: rate,
    signal,
    unit: 'uV',
    ...extra,
})

const event = (start: number, duration: number, channels?: (number | string)[]): AnnotationEventTemplate => ({
    channels,
    class: 'event',
    duration,
    priority: 400,
    start,
} as AnnotationEventTemplate)

const applied = (source: ExportSourceData, selection: Parameters<typeof applyExportSelection>[1]) => {
    const result = applyExportSelection(source, selection)
    if ('violations' in result) {
        throw new Error(result.violations.map(v => v.message).join(' '))
    }
    return result as ExportSelectionResult
}

// ── downsampleSignal ──────────────────────────────────────────────────────────

describe('downsampleSignal', () => {
    it('keeps an in-band component at an integer ratio', () => {
        const out = downsampleSignal(sine(10, 512, 10), 512, 256)
        expect(out.length).toBe(2560)
        expect(interiorPeak(out, 256)).toBeCloseTo(1, 2)
    })
    it('keeps an in-band component at a non-integer ratio', () => {
        const out = downsampleSignal(sine(10, 500, 10), 500, 256)
        expect(out.length).toBe(2560)
        expect(interiorPeak(out, 256)).toBeCloseTo(1, 2)
    })
    it('removes a component that would alias into the output band', () => {
        // 200 Hz sampled at 128 Hz would fold to 56 Hz, inside the output band; it must not survive.
        const out = downsampleSignal(sine(200, 512, 10), 512, 128)
        expect(interiorPeak(out, 128)).toBeLessThan(1e-3)
    })
    it('attenuates content just past the output Nyquist frequency by at least 40 dB', () => {
        // 0.6 × the output rate folds to 0.4 × it, the upper edge of the passband.
        const out = downsampleSignal(sine(0.6*256, 1024, 10), 1024, 256)
        expect(interiorPeak(out, 256)).toBeLessThan(1e-2)
    })
    it('returns a copy at equal rates', () => {
        const signal = ramp(100, 1)
        const out = downsampleSignal(signal, 100, 100)
        expect(Array.from(out)).toEqual(Array.from(signal))
        expect(out).not.toBe(signal)
    })
    it('refuses to upsample', () => {
        expect(() => downsampleSignal(ramp(100, 1), 100, 200)).toThrow()
        expect(() => downsampleSignal(ramp(100, 1), 0, 100)).toThrow()
        expect(() => downsampleSignal(ramp(100, 1), 100, 50, 10, -1)).toThrow()
    })
    it('repeats the last sample when asked for more than the source holds', () => {
        expect(Array.from(downsampleSignal(Float32Array.from([1, 2, 3]), 100, 100, 5))).toEqual([1, 2, 3, 3, 3])
    })
    it('starts the output at the given offset, using the samples before it as filter context', () => {
        const signal = sine(5, 500, 10)
        const whole = downsampleSignal(signal, 500, 256)
        // Output sample 1000 sits at source position 1000 × 500 / 256.
        const offset = 1000*500/256
        const part = downsampleSignal(signal, 500, 256, 256, offset)
        for (let i = 0; i < 256; i++) {
            expect(part[i]).toBeCloseTo(whole[1000 + i], 4)
        }
    })
})

// ── resolveExportRange ────────────────────────────────────────────────────────

describe('resolveExportRange', () => {
    const channels = [channel('A', 100, ramp(100, 60))]
    it('covers the whole recording when no range is given', () => {
        expect(resolveExportRange(channels, [])).toEqual({ data: [0, 60], recording: [0, 60] })
    })
    it('maps recording time to data time across an interruption', () => {
        // 10 s gap at recording time 20: the recording is 70 s long.
        const range = resolveExportRange(channels, [[20, 10]], [25, 50])!
        expect(range.recording).toEqual([30, 50])
        expect(range.data).toEqual([20, 40])
    })
    it('moves an end inside an interruption to the edge of the data', () => {
        const range = resolveExportRange(channels, [[20, 10]], [10, 25])!
        expect(range.recording).toEqual([10, 20])
        expect(range.data).toEqual([10, 20])
    })
    it('refuses a range outside the recording or inside a gap', () => {
        expect(resolveExportRange(channels, [], [50, 61])).toBeNull()
        expect(resolveExportRange(channels, [[20, 10]], [21, 29])).toBeNull()
    })
})

// ── checkExportSelection ──────────────────────────────────────────────────────

describe('checkExportSelection', () => {
    const channels = [
        channel('EEG Fp1-Ref', 512, ramp(512, 60)),
        channel('EEG Fp2-Ref', 512, ramp(512, 60)),
        channel('ECG', 128, ramp(128, 60)),
        channel('EDF Annotations', 60, new Float32Array(3600), { modality: 'meta' }),
    ]
    const codes = (...args: Parameters<typeof checkExportSelection>) => checkExportSelection(...args).map(v => v.code)

    it('accepts the default selection and leaves out meta channels', () => {
        expect(codes(channels, [], {})).toEqual([])
        const result = applied({ channels, events: [], interruptions: [] }, {})
        expect(result.channels.map(c => c.label)).toEqual(['EEG Fp1-Ref', 'EEG Fp2-Ref', 'ECG'])
    })
    it('reports unknown, duplicate and signal-less channels', () => {
        expect(codes(channels, [], { channels: [{ source: 9 }, { source: 0 }, { source: 0 }, { source: 3 }] }))
            .toEqual(['unknown_channel', 'duplicate_channel', 'no_signal'])
    })
    it('refuses to upsample a slower channel', () => {
        expect(codes(channels, [], { channels: [{ source: 2 }], samplingRate: 256 })).toEqual(['upsampling'])
    })
    it('checks the destination constraints', () => {
        const constraints = {
            amplitudeRange: [-500, 500] as [number, number],
            channels: ['Fp1', 'Fp2'],
            durations: [10, 20],
            samplingRate: 256,
            unit: 'uV',
        }
        const good = {
            amplitudeRange: [-500, 500] as [number, number],
            channels: [{ label: 'Fp1', source: 0 }, { label: 'Fp2', source: 1 }],
            range: [5, 25] as [number, number],
            samplingRate: 256,
        }
        expect(codes(channels, [], good, constraints)).toEqual([])
        expect(codes(channels, [], { ...good, channels: [...good.channels].reverse() }, constraints))
            .toEqual(['channel_template'])
        expect(codes(channels, [], { ...good, range: [5, 20] }, constraints)).toEqual(['duration'])
        expect(codes(channels, [], { ...good, samplingRate: 512 }, constraints))
            .toEqual(['sampling_rate', 'sampling_rate'])
        expect(codes(channels, [], { ...good, amplitudeRange: undefined }, constraints))
            .toEqual(['amplitude_range', 'amplitude_range'])
        expect(codes(channels, [], good, { unit: 'mV' })).toEqual(['unit', 'unit'])
    })
    it('measures the duration in data time, without the interruptions', () => {
        expect(codes(channels, [[10, 5]], { range: [0, 25] }, { durations: [20] })).toEqual([])
    })
    it('refuses an inverted range', () => {
        expect(codes(channels, [], { range: [10, 5] })).toEqual(['invalid_range'])
    })
})

// ── applyExportSelection ──────────────────────────────────────────────────────

describe('applyExportSelection', () => {
    const channels = [
        channel('A', 100, ramp(100, 60)),
        channel('B', 100, ramp(100, 60)),
        channel('C', 100, ramp(100, 60)),
    ]

    it('cuts the range, reorders and renames the channels', () => {
        const result = applied(
            { channels, events: [], interruptions: [] },
            { channels: [{ label: 'third', source: 2 }, { source: 0 }], range: [10, 20] }
        )
        expect(result.channels.map(c => [c.label, c.source])).toEqual([['third', 2], ['A', 0]])
        expect(result.channels[0].signal.length).toBe(1000)
        expect(result.channels[0].signal[0]).toBeCloseTo(10, 5)
        expect(result.channels[0].signal[999]).toBeCloseTo(19.99, 5)
        expect(result.dataDuration).toBe(10)
    })
    it('reads a partial signal at its data offset exactly as the whole one', () => {
        const range: [number, number] = [20, 30]
        const whole = applied({ channels, events: [], interruptions: [] }, { range, samplingRate: 64 })
        const partial = applied({
            channels: channels.map(c => ({ ...c, signal: c.signal!.slice(1800, 3200) })),
            dataOffset: 18,
            events: [],
            interruptions: [],
        }, { range, samplingRate: 64 })
        expect(partial.channels[0].signal.length).toBe(640)
        for (let i = 0; i < 640; i++) {
            expect(partial.channels[0].signal[i]).toBeCloseTo(whole.channels[0].signal[i], 4)
        }
    })
    it('clips samples to the amplitude range', () => {
        const result = applied({ channels, events: [], interruptions: [] }, { amplitudeRange: [0, 5], range: [0, 10] })
        expect(Math.max(...result.channels[0].signal)).toBe(5)
    })
    it('clips and re-bases events and drops those outside the range', () => {
        const result = applied({
            channels,
            events: [event(5, 10), event(12, 0), event(18, 0), event(30, 2), event(20, 0)],
            interruptions: [],
        }, { range: [10, 20] })
        expect(result.events.map(e => [e.start, e.duration])).toEqual([[0, 5], [2, 0], [8, 0]])
    })
    it('drops events on dropped channels and prunes references to them', () => {
        const result = applied({
            channels,
            events: [
                event(1, 0, [1]),         // only a dropped channel, by index
                event(2, 0, ['B']),       // only a dropped channel, by label
                event(3, 0, [0, 1, 2]),   // kept and dropped, by index
                event(4, 0, ['C', 'B']),  // kept and dropped, by label
                event(5, 0, []),          // whole recording
                event(6, 0),              // whole recording
            ],
            interruptions: [],
        }, { channels: [{ label: 'third', source: 2 }, { source: 0 }] })
        expect(result.events.map(e => [e.start, e.channels])).toEqual([
            [3, [1, 0]],
            [4, ['third']],
            [5, []],
            [6, undefined],
        ])
    })
    it('matches channel names case-insensitively and keeps every match', () => {
        const named = [
            channel('Fp1 left', 100, ramp(100, 60), { name: 'fp1' }),
            channel('Fp1 again', 100, ramp(100, 60), { name: 'FP1' }),
            channel('Fp2', 100, ramp(100, 60), { name: 'fp2' }),
        ]
        const result = applied({
            channels: named,
            events: [event(1, 0, ['Fp1']), event(2, 0, ['FP2']), event(3, 0, ['Fp1 left'])],
            interruptions: [],
        }, { channels: [{ label: 'A', source: 0 }, { label: 'B', source: 1 }] })
        // The last event names a label, not a name, so it refers to no channel and is dropped.
        expect(result.events.map(e => e.channels)).toEqual([['A', 'B']])
    })
    it('clips interruptions to the range and re-bases them', () => {
        // Gaps at recording time 5 (2 s) and 30 (4 s); the recording is 66 s long.
        const result = applied(
            { channels, events: [], interruptions: [[30, 4], [5, 2]] },
            { range: [4, 40] }
        )
        expect(result.interruptions).toEqual([[1, 2], [26, 4]])
        expect(result.recordingDuration).toBe(36)
        expect(result.dataDuration).toBe(30)
        expect(result.channels[0].signal[0]).toBeCloseTo(4, 5)
    })
    it('returns the violations instead of a result', () => {
        const result = applyExportSelection({ channels, events: [], interruptions: [] }, { channels: [{ source: 5 }] })
        expect('violations' in result && result.violations[0].code).toBe('unknown_channel')
    })
})
