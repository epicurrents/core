/**
 * Memory-manager rearrange contract tests.
 *
 * The release-and-rearrange operation underpins every buffer reallocation: freed regions are
 * compacted away by shifting the surviving allocations down, after which each surviving service
 * repositions its mutex views to the new indices. These tests pin the three properties a
 * rearrange must uphold: the shifted bytes land at the correct buffer positions, the range
 * bookkeeping returned to the manager matches where the bytes actually went, and a mutex freshly
 * initialised over a previously used (dirty) region never reports residue as valid state.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { MemoryManagerWorker } from '../../src/workers/memory-manager.worker'
import BiosignalMutex from '../../src/assets/biosignal/service/BiosignalMutex'
import type { SignalCachePart } from '../../src/types/biosignal'

/** Build a worker with a directly-assigned buffer of `elements` 32-bit cells. */
const buildWorker = (elements: number) => {
    const worker = new MemoryManagerWorker()
    const buffer = new SharedArrayBuffer(elements*4)
    const view = new Int32Array(buffer)
    ;(worker as any)._buffer = buffer
    ;(worker as any)._view = view
    return { worker, buffer, view }
}

/** Fill every cell above the master-lock cell with a value derived from its index. */
const fillPattern = (view: Int32Array) => {
    for (let i=1; i<view.length; i++) {
        view[i] = i*10
    }
}

const rearrange = (worker: MemoryManagerWorker, remove: number[][], retain: { id: string, range: number[] }[]) => {
    return (worker as any)._removeAndRearrange(remove, retain) as boolean
}

describe('Release-and-rearrange byte placement and bookkeeping', () => {
    test('Single removed region: survivor shifts down, bytes and range agree', () => {
        const { worker, view } = buildWorker(40)
        fillPattern(view)
        const retained = [{ id: 'b', range: [10, 20] }]
        expect(rearrange(worker, [[4, 10]], retained)).toBe(true)
        expect(retained[0].range).toStrictEqual([4, 14])
        for (let i=0; i<10; i++) {
            expect(view[4 + i]).toBe((10 + i)*10)
        }
        expect(view[0]).toBe(0)
    })
    test('Multiple removed regions: shifts accumulate over every preceding removal', () => {
        // Regression: the shift amount only subtracted the nearest removed region's size, so with
        // two or more removed regions the recorded range diverged from where the bytes were
        // actually copied and every later rebind pointed the service at the wrong place.
        const { worker, view } = buildWorker(40)
        fillPattern(view)
        const retained = [
            { id: 'c', range: [8, 12] },
            { id: 'd', range: [16, 24] },
        ]
        expect(rearrange(worker, [[4, 8], [12, 16]], retained)).toBe(true)
        expect(retained[0].range).toStrictEqual([4, 8])
        expect(retained[1].range).toStrictEqual([8, 16])
        for (let i=0; i<4; i++) {
            expect(view[4 + i]).toBe((8 + i)*10)
        }
        for (let i=0; i<8; i++) {
            expect(view[8 + i]).toBe((16 + i)*10)
        }
        expect(view[0]).toBe(0)
    })
    test('A survivor below every removed region stays untouched', () => {
        const { worker, view } = buildWorker(40)
        fillPattern(view)
        const retained = [
            { id: 'e', range: [2, 4] },
            { id: 'f', range: [12, 14] },
        ]
        expect(rearrange(worker, [[10, 12]], retained)).toBe(true)
        expect(retained[0].range).toStrictEqual([2, 4])
        expect(view[2]).toBe(20)
        expect(view[3]).toBe(30)
        expect(retained[1].range).toStrictEqual([10, 12])
    })
    test('Unsorted input regions are handled', () => {
        const { worker, view } = buildWorker(40)
        fillPattern(view)
        const retained = [
            { id: 'd', range: [16, 24] },
            { id: 'c', range: [8, 12] },
        ]
        expect(rearrange(worker, [[12, 16], [4, 8]], retained)).toBe(true)
        // The method sorts in place; find entries by id.
        const c = retained.find(r => r.id === 'c')
        const d = retained.find(r => r.id === 'd')
        expect(c?.range).toStrictEqual([4, 8])
        expect(d?.range).toStrictEqual([8, 16])
    })
    test('A locked master buffer refuses the operation and moves nothing', () => {
        const { worker, view } = buildWorker(40)
        fillPattern(view)
        view[0] = 1
        const retained = [{ id: 'b', range: [10, 20] }]
        expect(rearrange(worker, [[4, 10]], retained)).toBe(false)
        expect(retained[0].range).toStrictEqual([10, 20])
        expect(view[10]).toBe(100)
    })
    test('An empty rearrange list is refused without leaking the master lock', () => {
        // Regression: the empty-list check ran after the master lock was acquired and returned
        // without releasing it, permanently wedging every subsequent buffer operation.
        const { worker, view } = buildWorker(40)
        expect(rearrange(worker, [[4, 10]], [])).toBe(false)
        expect(view[0]).toBe(0)
        expect(rearrange(worker, [[4, 10]], [{ id: 'b', range: [10, 20] }])).toBe(true)
    })
})

describe('Fresh mutex initialisation over a dirty region', () => {
    const SIGNAL_PROPS: SignalCachePart = {
        start: 0,
        end: 0,
        signals: [
            { data: new Float32Array(), samplingRate: 10 },
            { data: new Float32Array(), samplingRate: 5 },
        ],
    }
    const DATA_LENGTH = 30
    test('Residue from a previous tenant is never reported as valid state', async () => {
        const sab = new SharedArrayBuffer(2048*4)
        // First tenant writes recognisable state at region start 1.
        const first = new BiosignalMutex()
        await first.initSignalBuffers(structuredClone(SIGNAL_PROPS), DATA_LENGTH, sab, 1)
        await first.setMetaFieldValue(BiosignalMutex.RANGE_START_NAME, 500)
        await first.setMetaFieldValue(BiosignalMutex.RANGE_END_NAME, 530)
        await first.setDataFieldValue(BiosignalMutex.SIGNAL_UPDATED_START_NAME, 123)
        await first.setDataFieldValue(BiosignalMutex.SIGNAL_UPDATED_END_NAME, 456)
        // Simulate a reopen: a new mutex initialises over the same region without any clearing
        // of the buffer in between. Every metadata field must reflect the fresh initialisation,
        // not the previous tenant's values.
        const second = new BiosignalMutex()
        await second.initSignalBuffers(structuredClone(SIGNAL_PROPS), DATA_LENGTH, sab, 1)
        expect(await second.getMetaFieldValue(BiosignalMutex.RANGE_START_NAME)).toBe(0)
        expect(await second.getMetaFieldValue(BiosignalMutex.RANGE_END_NAME)).toBe(DATA_LENGTH)
        expect(await second.getMetaFieldValue(BiosignalMutex.RANGE_ALLOCATED_NAME)).toBe(DATA_LENGTH)
        const updatedStarts = await second.getDataFieldValue(BiosignalMutex.SIGNAL_UPDATED_START_NAME)
        const updatedEnds = await second.getDataFieldValue(BiosignalMutex.SIGNAL_UPDATED_END_NAME)
        for (const value of updatedStarts) {
            expect(value).toBe(second.EMPTY_FIELD)
        }
        for (const value of updatedEnds) {
            expect(value).toBe(second.EMPTY_FIELD)
        }
    })
})
