/**
 * Gap splicing in montage derivation, exercised against the real signal utilities.
 *
 * The sibling MontageProcessor suite mocks `filterSignal` and `concatTypedNumberArrays` away, so it
 * cannot see this path at all. These cases run the arithmetic for real.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest'
import MontageProcessor from '../../src/assets/biosignal/service/MontageProcessor'
import type { MontageChannel } from '../../src/types/biosignal'
import type { CommonBiosignalSettings } from '../../src/types/config'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

const SAMPLING_RATE = 10
const DATA_SECONDS = 20

const SETTINGS = {
    filterPaddingSeconds: 0,
    filterChannelTypes: { eeg: ['lowpass'] },
    showHiddenChannels: true,
    showMissingChannels: true,
} as unknown as CommonBiosignalSettings

/** One visible EEG channel referenced to nothing, so the derived signal follows the source. */
const channel = (): MontageChannel => ({
    active: 0,
    amplification: 1,
    averaged: false,
    displayPolarity: 1,
    filters: { bandreject: [], highpass: null, lowpass: null, notch: null },
    height: 1,
    highpassFilter: null,
    label: 'ch',
    laterality: '',
    lowpassFilter: 4,
    markers: [],
    modality: 'eeg',
    name: 'ch',
    notchFilter: null,
    offset: { baseline: 0, bottom: 0, top: 1 },
    reference: [],
    sampleCount: 0,
    samplingRate: SAMPLING_RATE,
    scale: 1,
    sensitivity: 0,
    signal: new Float32Array(),
    unit: 'uV',
    visible: true,
} as unknown as MontageChannel)

class TestMontageProcessor extends MontageProcessor {
    derive (start: number, end: number, rangeStart: number, rangeEnd: number, signals: Float32Array[]) {
        return this._derivePartFromInput(start, end, rangeStart, rangeEnd, signals)
    }
    setRecordingExtent (dataLength: number, recordingLength: number) {
        this._totalDataLength = dataLength
        this._totalRecordingLength = recordingLength
    }
    setInterruptionMap (interruptions: Map<number, number>) {
        this._interruptions = interruptions
    }
}

const makeProcessor = (interruptions: Map<number, number>) => {
    const proc = new TestMontageProcessor(SETTINGS, () => undefined)
    proc.channels = [channel()]
    let gapTotal = 0
    for (const duration of interruptions.values()) {
        gapTotal += duration
    }
    proc.setRecordingExtent(DATA_SECONDS, DATA_SECONDS + gapTotal)
    proc.setInterruptionMap(interruptions)
    return proc
}

/**
 * A ramp whose value equals its own index, so a duplicated or displaced region shows up directly:
 * every returned sample must still match the position it is handed back at.
 */
const ramp = (samples: number) => Float32Array.from({ length: samples }, (_, i) => i)

/**
 * Splicing zeroed gaps in before filtering makes the filter ring either side of each one, so a
 * sample near a gap lands about half a unit off its own index. A displaced region misses by a whole
 * gap length — twenty units here — so the two are never in danger of being confused.
 */
const GAP_RINGING_TOLERANCE = 2

describe('Montage gap splicing', () => {
    it('should track the source signal with one interruption', () => {
        const proc = makeProcessor(new Map([[5, 2]]))
        const derived = proc.derive(0, 12, 0, DATA_SECONDS, [ramp(DATA_SECONDS * SAMPLING_RATE)])
        const data = derived.signals[0].data
        expect(data.length).toBe((derived.end - derived.start) * SAMPLING_RATE)
        for (let i = 5; i < data.length - 5; i += 10) {
            expect(Math.abs(data[i] - i)).toBeLessThan(GAP_RINGING_TOLERANCE)
        }
    })

    it('should track the source signal with two interruptions', () => {
        // The spliced parts were accumulated across iterations, so every earlier part was
        // concatenated again on the second pass and everything past the first gap came back
        // displaced by that gap's length. One interruption cannot show it — the duplication only
        // begins on the second.
        const proc = makeProcessor(new Map([[3, 2], [8, 2]]))
        const derived = proc.derive(0, 14, 0, DATA_SECONDS, [ramp(DATA_SECONDS * SAMPLING_RATE)])
        const data = derived.signals[0].data
        expect(data.length).toBe((derived.end - derived.start) * SAMPLING_RATE)
        for (const index of [65, 75, 85, 95]) {
            expect(Math.abs(data[index] - index)).toBeLessThan(GAP_RINGING_TOLERANCE)
        }
    })

    it('should track the source signal with three interruptions', () => {
        const proc = makeProcessor(new Map([[3, 2], [8, 2], [15, 2]]))
        const derived = proc.derive(0, 20, 0, DATA_SECONDS, [ramp(DATA_SECONDS * SAMPLING_RATE)])
        const data = derived.signals[0].data
        expect(data.length).toBe((derived.end - derived.start) * SAMPLING_RATE)
        for (const index of [65, 95, 125]) {
            expect(Math.abs(data[index] - index)).toBeLessThan(GAP_RINGING_TOLERANCE)
        }
    })
})
