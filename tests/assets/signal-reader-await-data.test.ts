/**
 * Concurrent reads waiting on the caching loop.
 *
 * `getSignals` parks a caller whose range is not cached yet until the loop covers it. More than one
 * read can be parked at a time — reader packages dispatch `handleMessage` without awaiting it, and
 * the rolling-window path calls `getSignals` while a direct commission is already running — so the
 * parking has to survive being entered twice.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GenericSignalReader from '../../src/assets/reader/GenericSignalReader'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../src/util', () => ({
    combineSignalParts: vi.fn().mockReturnValue(true),
    MB_BYTES: 1048576,
    NUMERIC_ERROR_VALUE: -1,
    partsNotCached: vi.fn().mockReturnValue([]),
    sleep: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/util/constants', () => ({ NUMERIC_ERROR_VALUE: -1 }))

vi.mock('asymmetric-io-mutex', () => ({
    __esModule: true,
    default: { EMPTY_FIELD: -1 },
    IOMutex: vi.fn(),
    MutexExportProperties: {},
}))

vi.mock('../../src/config/Settings', () => ({
    __esModule: true,
    default: { app: { dataChunkSize: 1048576, maxLoadCacheSize: 104857600 } },
}))

const RECORDING_LENGTH = 100

/**
 * A reader whose cache reports a valid range but whose committed span never reaches the requested
 * one, so every `getSignals` call parks. A cache process is present so the parking branch is taken
 * rather than the "no load running" early return.
 */
class ParkingSignalReader extends GenericSignalReader {
    constructor () {
        super(Float32Array)
        this._totalDataLength = RECORDING_LENGTH
        this._totalRecordingLength = RECORDING_LENGTH
        this._fileTypeHeader = {}
        this._cacheProcesses = [{} as never]
        this._fallbackCache = {
            asCachePart: () => Promise.resolve({ start: 0, end: RECORDING_LENGTH, signals: [] }),
        } as never
    }
    protected _getSignalCacheRange () {
        return Promise.resolve({ start: 0, end: RECORDING_LENGTH })
    }
    // Committed span stops well short of either requested range, so both callers park.
    async getSignalUpdatedRange () {
        return { start: 0, end: 5 }
    }
    notifyWaiters (start: number, end: number) {
        this._notifyDataWaiters(start, end)
    }
    get waiterCount () {
        return this._awaitData.length
    }
}

/** Resolves to `'pending'` if the promise has not settled by the time the queue drains. */
const settledOr = async <T>(promise: Promise<T>) => {
    return Promise.race([promise, Promise.resolve().then(() => 'pending' as const)])
}

describe('GenericSignalReader concurrent awaited reads', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
    })

    it('parks each concurrent read separately', async () => {
        const reader = new ParkingSignalReader()
        void reader.getSignals([10, 20])
        await vi.advanceTimersByTimeAsync(0)
        void reader.getSignals([30, 40])
        await vi.advanceTimersByTimeAsync(0)
        expect(reader.waiterCount).toBe(2)
    })

    it('resolves every parked read whose range the loop has covered', async () => {
        const reader = new ParkingSignalReader()
        const first = reader.getSignals([10, 20])
        const second = reader.getSignals([30, 40])
        await vi.advanceTimersByTimeAsync(0)
        expect(reader.waiterCount).toBe(2)
        reader.notifyWaiters(0, RECORDING_LENGTH)
        await vi.advanceTimersByTimeAsync(0)
        expect(await settledOr(first)).not.toBe('pending')
        expect(await settledOr(second)).not.toBe('pending')
        expect(reader.waiterCount).toBe(0)
    })

    it('lets a later read settle after an earlier one has timed out', async () => {
        // With a single waiter slot the second read overwrote the first one's resolver, and the
        // first, on timing out, cleared whatever the slot then held — the second read's timeout —
        // and emptied the slot. The second was left with no resolver anything could reach and no
        // timeout to fall back on, so its commission never settled.
        const reader = new ParkingSignalReader()
        const first = reader.getSignals([10, 20])
        await vi.advanceTimersByTimeAsync(1_000)
        const second = reader.getSignals([30, 40])
        // The second read's timeout is a second behind the first's, so stopping short of it leaves
        // exactly one read parked.
        await vi.advanceTimersByTimeAsync(GenericSignalReader.AWAIT_DATA_TIMEOUT - 500)
        expect(await settledOr(first)).not.toBe('pending')
        expect(reader.waiterCount).toBe(1)
        // The loop now covers the second read's range.
        reader.notifyWaiters(0, RECORDING_LENGTH)
        await vi.advanceTimersByTimeAsync(0)
        expect(await settledOr(second)).not.toBe('pending')
        expect(reader.waiterCount).toBe(0)
    })

    it('settles a parked read on its own timeout when the loop never covers it', async () => {
        const reader = new ParkingSignalReader()
        const parked = reader.getSignals([10, 20])
        await vi.advanceTimersByTimeAsync(GenericSignalReader.AWAIT_DATA_TIMEOUT + 1)
        expect(await settledOr(parked)).not.toBe('pending')
        expect(reader.waiterCount).toBe(0)
    })
})
