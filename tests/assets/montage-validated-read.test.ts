/**
 * Contract tests for the montage's optimistic epoch-validated input read.
 *
 * The montage derives from live window views without taking any lock (a read-lock hold across
 * the derivation would starve the reader's write lock during block loads) and validates the
 * result against the window epoch: an odd epoch at entry, or a changed one after the
 * derivation, means the window mutated and the montage answers with a view-anchored empty
 * part instead of derived-from-torn-state data.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import MontageProcessor from '../../src/assets/biosignal/service/MontageProcessor'
import BiosignalMutex from '../../src/assets/biosignal/service/BiosignalMutex'
import type { SignalCachePart } from '../../src/types/service'

const SR = 10
const DATA_LENGTH = 30

const SETTINGS = {
    filterPaddingSeconds: 0,
    filters: { highpass: 0, lowpass: 0, notch: 0 },
    showHiddenChannels: false,
    showMissingChannels: false,
} as unknown as ConstructorParameters<typeof MontageProcessor>[0]

const buildPair = async () => {
    const sab = new SharedArrayBuffer(4096*4)
    const writer = new BiosignalMutex()
    await writer.initSignalBuffers(
        { start: 0, end: 0, signals: [{ data: new Float32Array(), samplingRate: SR }] },
        DATA_LENGTH,
        sab,
        1
    )
    // Fill the window with a ramp so derived values identify their sample positions.
    const ramp = new Float32Array(DATA_LENGTH*SR)
    for (let i = 0; i < ramp.length; i++) {
        ramp[i] = i
    }
    await writer.insertSignals({ start: 0, end: DATA_LENGTH, signals: [{ data: ramp, samplingRate: SR }] })
    const processor = new MontageProcessor(SETTINGS, () => {})
    const consumer = new BiosignalMutex({ coupledProps: writer.propertiesForCoupling, inputOnly: true })
    const raw = processor as unknown as Record<string, unknown>
    raw._mutex = consumer
    raw._totalRecordingLength = DATA_LENGTH
    raw._totalDataLength = DATA_LENGTH
    raw._recordingTimeToCacheTime = (time: number) => time
    raw._cacheTimeToRecordingTime = (time: number) => time
    processor.channels = [{
        modality: 'eeg',
        visible: true,
        active: 0,
        reference: [],
        averaged: false,
        samplingRate: SR,
        label: 'ch1',
        name: 'ch1',
        highpassFilter: null,
        lowpassFilter: null,
        notchFilter: null,
    } as unknown as typeof processor.channels[0]]
    return { writer, processor }
}

describe('Montage locked input read', () => {
    test('derives correct samples for an in-window range under one lock hold', async () => {
        const { processor } = await buildPair()
        const part = await processor.calculateSignalsForPart(5, 10, false) as SignalCachePart
        expect(part).toBeTruthy()
        expect(part.start).toBe(5)
        expect(part.end).toBe(10)
        expect(part.signals[0].data.length).toBe(5*SR)
        expect(part.signals[0].data[0]).toBe(5*SR)
        expect(part.signals[0].data[5*SR - 1]).toBe(10*SR - 1)
    })
    test('answers an out-of-window range with a view-anchored empty part', async () => {
        const { processor } = await buildPair()
        const part = await processor.calculateSignalsForPart(40, 45, false) as SignalCachePart
        expect(part).toBeTruthy()
        expect(part.start).toBe(40)
        expect(part.end).toBe(45)
        expect(part.signals.length).toBe(1)
        expect(part.signals[0].data.length).toBe(0)
    })
    test('discards the read when the epoch reads as mid-mutation', async () => {
        const { writer, processor } = await buildPair()
        // An odd epoch means a window mutation is (or appears to be) in progress; the montage
        // must answer with an empty part rather than derive from suspect state.
        ;(writer as unknown as { _bumpWindowEpoch: () => void })._bumpWindowEpoch()
        const part = await processor.calculateSignalsForPart(5, 10, false) as SignalCachePart
        expect(part).toBeTruthy()
        expect(part.start).toBe(5)
        expect(part.end).toBe(10)
        expect(part.signals[0].data.length).toBe(0)
    })
})
