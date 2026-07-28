/**
 * Window-epoch seqlock contract tests.
 *
 * The window epoch is the lock-free coordination point between the reader (which mutates the
 * rolling-window metadata) and cross-worker consumers (montage, trend) that read the window
 * directly from the SAB. These tests pin the counter's contract: it starts even at 0, every
 * metadata mutation bumps it by exactly two (odd while mid-mutation, even when stable), a
 * no-op mutation does not bump it, coupled input-only consumers observe the same value, and
 * the pre-initialisation seed reads as mid-mutation so an unseeded window is never trusted.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { IOMutex } from 'asymmetric-io-mutex'
import BiosignalMutex from '../../src/assets/biosignal/service/BiosignalMutex'
import type { SignalCachePart } from '../../src/types/biosignal'

const SIGNAL_PROPS: SignalCachePart = {
    start: 0,
    end: 0,
    signals: [
        { data: new Float32Array(), samplingRate: 10 },
        { data: new Float32Array(), samplingRate: 5 },
    ],
}
const DATA_LENGTH = 30

const buildWriter = async () => {
    const sab = new SharedArrayBuffer(2048*4)
    const writer = new BiosignalMutex()
    await writer.initSignalBuffers(structuredClone(SIGNAL_PROPS), DATA_LENGTH, sab, 1)
    return writer
}

describe('Window-epoch counter on the writer side', () => {
    test('Fresh initialisation seeds the epoch to 0', async () => {
        const writer = await buildWriter()
        expect(writer.windowEpochSync()).toBe(0)
    })
    test('The pre-initialisation meta seed is an odd value (reads as mid-mutation)', () => {
        // `initialize` seeds every meta cell to EMPTY_FIELD before `initSignalBuffers` writes 0.
        // A consumer that couples in between must see "mid-mutation", never a stable window.
        expect(Math.abs(IOMutex.EMPTY_FIELD) % 2).toBe(1)
    })
    test('A range change bumps the epoch by exactly two', async () => {
        const writer = await buildWriter()
        await writer.setSignalRange(5, 35)
        expect(writer.windowEpochSync()).toBe(2)
    })
    test('An identical-range call is a no-op and does not bump', async () => {
        const writer = await buildWriter()
        await writer.setSignalRange(5, 35)
        await writer.setSignalRange(5, 35)
        expect(writer.windowEpochSync()).toBe(2)
    })
    test('Inserting signals bumps the epoch by exactly two', async () => {
        const writer = await buildWriter()
        await writer.insertSignals({
            start: 0,
            end: 1,
            signals: [
                { data: new Float32Array(10).fill(1), samplingRate: 10 },
                { data: new Float32Array(5).fill(1), samplingRate: 5 },
            ],
        })
        expect(writer.windowEpochSync()).toBe(2)
    })
})

describe('Window-epoch counter on the consumer side', () => {
    test('A coupled input-only mutex reads the same epoch via the INPUT scope', async () => {
        const writer = await buildWriter()
        const consumer = new BiosignalMutex({ coupledProps: writer.propertiesForCoupling, inputOnly: true })
        expect(consumer.windowEpochSync(IOMutex.MUTEX_SCOPE.INPUT)).toBe(0)
        await writer.setSignalRange(5, 35)
        expect(consumer.windowEpochSync(IOMutex.MUTEX_SCOPE.INPUT)).toBe(2)
    })
    test('An input-only mutex has no OUTPUT epoch', async () => {
        const writer = await buildWriter()
        const consumer = new BiosignalMutex({ coupledProps: writer.propertiesForCoupling, inputOnly: true })
        expect(consumer.windowEpochSync()).toBeNull()
    })
    test('A single (unpaired) bump reads as mid-mutation to the consumer', async () => {
        const writer = await buildWriter()
        const consumer = new BiosignalMutex({ coupledProps: writer.propertiesForCoupling, inputOnly: true })
        ;(writer as unknown as { _bumpWindowEpoch: () => void })._bumpWindowEpoch()
        const observed = consumer.windowEpochSync(IOMutex.MUTEX_SCOPE.INPUT)
        expect(observed).not.toBeNull()
        expect(Math.abs(observed as number) % 2).toBe(1)
    })
})
