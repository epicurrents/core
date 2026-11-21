/**
 * Which filters montage derivation applies to a channel, exercised against the real signal utilities.
 *
 * A recording's default filters reach a channel only for the filter types its modality is configured to take, and the
 * filters applied are the ones that decided whether to filter at all, so switching one default on never brings the
 * others with it.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import MontageProcessor from '../../src/assets/biosignal/service/MontageProcessor'
import { filterSignal } from '../../src/util/signal'
import type { MontageChannel } from '../../src/types/biosignal'
import type { CommonBiosignalSettings } from '../../src/types/config'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../src/util/signal', async importOriginal => {
    const original = await importOriginal<typeof import('../../src/util/signal')>()
    // The filter itself is not under test, only what it is asked to apply.
    return { ...original, filterSignal: vi.fn((signal: Float32Array) => signal.slice()) }
})

const SAMPLING_RATE = 200
const DATA_SECONDS = 10

const settings = (ekg: string[]) => ({
    filterPaddingSeconds: 0,
    filterChannelTypes: { eeg: ['highpass', 'lowpass', 'notch'], ekg },
    showHiddenChannels: true,
    showMissingChannels: true,
} as unknown as CommonBiosignalSettings)

/** One visible channel of `modality` with no filters of its own, so it takes whatever defaults apply to it. */
const channel = (modality: string): MontageChannel => ({
    active: 0,
    amplification: 1,
    averaged: false,
    displayPolarity: 1,
    filters: { bandreject: [], highpass: null, lowpass: null, notch: null },
    height: 1,
    highpassFilter: null,
    label: 'ch',
    laterality: '',
    lowpassFilter: null,
    markers: [],
    modality,
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
    derive (signals: Float32Array[]) {
        return this._derivePartFromInput(0, DATA_SECONDS, 0, DATA_SECONDS, signals)
    }
    setRecordingExtent () {
        this._totalDataLength = DATA_SECONDS
        this._totalRecordingLength = DATA_SECONDS
    }
}

/** A processor deriving one `modality` channel, under the recording defaults `filters`. */
const derive = (modality: string, ekg: string[], filters: { highpass: number, lowpass: number, notch: number }) => {
    const proc = new TestMontageProcessor(settings(ekg), () => undefined)
    proc.channels = [channel(modality)]
    proc.setRecordingExtent()
    proc.setHighpassFilter(filters.highpass)
    proc.setLowpassFilter(filters.lowpass)
    proc.setNotchFilter(filters.notch)
    proc.derive([new Float32Array(SAMPLING_RATE * DATA_SECONDS)])
}

describe('the filters a derived channel takes', () => {
    beforeEach(() => {
        vi.mocked(filterSignal).mockClear()
    })

    it('leaves a channel unfiltered when no default it takes is on', () => {
        derive('ekg', ['notch'], { highpass: 1, lowpass: 70, notch: 0 })
        expect(filterSignal).not.toHaveBeenCalled()
    })

    it('applies only the defaults the channel takes once one of them is on', () => {
        derive('ekg', ['notch'], { highpass: 1, lowpass: 70, notch: 50 })
        expect(filterSignal).toHaveBeenCalledTimes(1)
        expect(vi.mocked(filterSignal).mock.calls[0].slice(1)).toEqual([SAMPLING_RATE, 0, 0, 50])
    })

    it('applies every default a channel takes, with the notch off', () => {
        derive('ekg', ['highpass', 'lowpass', 'notch'], { highpass: 1, lowpass: 70, notch: 0 })
        expect(vi.mocked(filterSignal).mock.calls[0].slice(1)).toEqual([SAMPLING_RATE, 1, 70, 0])
    })

    it('applies no default to a modality that takes none', () => {
        derive('emg', ['notch'], { highpass: 1, lowpass: 70, notch: 50 })
        expect(filterSignal).not.toHaveBeenCalled()
    })
})
