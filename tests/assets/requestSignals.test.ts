/**
 * Contract tests for the reader's view-anchored request protocol.
 *
 * `requestSignals` is the coordinated entry point of the rolling cache: it resolves `ready`
 * when the window is resident, returns a `pending` handle whose `ready` promise settles when
 * a slide completes, supersedes older view-stream requests (newest target wins, in-flight
 * loads aborted), reports hung loads as `error` without wedging the queue, and never moves
 * the window for a non-view stream.
 *
 * The reader under test is a minimal concrete subclass with a controllable block loader and
 * a canned read, so the tests exercise the queue/protocol layer, not the decode math.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericSignalReader from '../../src/assets/reader/GenericSignalReader'
import BiosignalMutex from '../../src/assets/biosignal/service/BiosignalMutex'
import type { ConfigChannelFilter, SignalCachePart, SignalRequest } from '../../src/types'

/** Wait until `cond` returns true, polling every few milliseconds. */
const until = async (cond: () => boolean) => {
    const deadline = Date.now() + 2000
    while (!cond()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out waiting for condition.')
        }
        await new Promise(resolve => setTimeout(resolve, 2))
    }
}

type PendingLoad = {
    idx: number
    signal?: AbortSignal
    resolve: (ok: boolean) => void
}

class TestReader extends GenericSignalReader {
    /** When true, block loads succeed immediately instead of gating on `blockLoads`. */
    autoLoad = false
    /** Gated block loads in arrival order; resolve one to let the queue proceed. */
    blockLoads: PendingLoad[] = []

    constructor () {
        super(Float32Array)
    }

    protected _recordingTimeToCacheTime (time: number): number {
        return time
    }

    protected async _loadBlock (idx: number, signal?: AbortSignal): Promise<boolean> {
        const blocks = (this as unknown as { _dataBlocks: { loaded: boolean }[] })._dataBlocks
        if (this.autoLoad) {
            blocks[idx].loaded = true
            return true
        }
        return new Promise<boolean>((resolve) => {
            let settled = false
            const finish = (ok: boolean) => {
                if (settled) {
                    return
                }
                settled = true
                if (ok) {
                    blocks[idx].loaded = true
                }
                resolve(ok)
            }
            this.blockLoads.push({ idx, signal, resolve: finish })
            signal?.addEventListener('abort', () => finish(false))
        })
    }

    async getSignals (range: number[], _config?: ConfigChannelFilter): Promise<SignalCachePart> {
        return { start: range[0], end: range[1], signals: [] }
    }
}

const setupReader = async (blockCount = 5) => {
    const reader = new TestReader()
    const sab = new SharedArrayBuffer(4096*4)
    const mutex = new BiosignalMutex()
    await mutex.initSignalBuffers(
        { start: 0, end: 0, signals: [{ data: new Float32Array(), samplingRate: 1 }] },
        30,
        sab,
        1
    )
    const raw = reader as unknown as Record<string, unknown>
    raw._mutex = mutex
    raw._isMutexReady = true
    raw._fileTypeHeader = {}
    raw._useRolling = true
    raw._maxDataBlocks = 3
    raw._totalDataLength = blockCount*10
    raw._totalRecordingLength = blockCount*10
    raw._dataBlocks = Array.from({ length: blockCount }, (_, i) => ({
        startRecord: i*10,
        endRecord: (i + 1)*10,
        startTime: i*10,
        endTime: (i + 1)*10,
        startBytePos: 0,
        endBytePos: 0,
        data: null,
        loaded: false,
    }))
    return { reader, mutex, blocks: raw._dataBlocks as { loaded: boolean }[] }
}

describe('requestSignals on the rolling path', () => {
    test('resolves ready without sliding when the window is resident', async () => {
        const { reader, blocks } = await setupReader()
        blocks[0].loaded = true
        blocks[1].loaded = true
        blocks[2].loaded = true
        const result = await reader.requestSignals([5, 15])
        expect(result.status).toBe('ready')
        expect((result as { part: SignalCachePart }).part.start).toBe(5)
        expect(reader.blockLoads.length).toBe(0)
    })
    test('returns pending and resolves ready once the slide completes', async () => {
        const { reader } = await setupReader()
        const request = await reader.requestSignals([5, 15])
        expect(request.status).toBe('pending')
        const ready = (request as { ready: Promise<SignalRequest> }).ready
        // The window [0,2] needs three loads; the queue runs them one at a time.
        for (let i = 0; i < 3; i++) {
            await until(() => reader.blockLoads.length === i + 1)
            reader.blockLoads[i].resolve(true)
        }
        const result = await ready
        expect(result.status).toBe('ready')
        expect((result as { part: SignalCachePart }).part.end).toBe(15)
    })
    test('a newer view request supersedes an older one and aborts its in-flight load', async () => {
        const { reader } = await setupReader()
        const first = await reader.requestSignals([5, 15])
        expect(first.status).toBe('pending')
        await until(() => reader.blockLoads.length === 1)
        const second = await reader.requestSignals([35, 45])
        const firstResult = await (first as { ready: Promise<SignalRequest> }).ready
        expect(firstResult.status).toBe('superseded')
        expect(reader.blockLoads[0].signal?.aborted).toBe(true)
        // The second request proceeds normally: its window is [2,4].
        expect(second.status).toBe('pending')
        for (let i = 1; i < 4; i++) {
            await until(() => reader.blockLoads.length === i + 1)
            reader.blockLoads[i].resolve(true)
        }
        const secondResult = await (second as { ready: Promise<SignalRequest> }).ready
        expect(secondResult.status).toBe('ready')
        expect(reader.blockLoads.slice(1).map(l => l.idx).sort()).toStrictEqual([2, 3, 4])
    })
    test('a hung load times out to error and the queue keeps working', async () => {
        const originalTimeout = GenericSignalReader.LOAD_BLOCK_TIMEOUT
        GenericSignalReader.LOAD_BLOCK_TIMEOUT = 20
        try {
            const { reader } = await setupReader()
            const request = await reader.requestSignals([5, 15])
            expect(request.status).toBe('pending')
            // Never resolve any load: each one times out via the merged abort signal.
            const result = await (request as { ready: Promise<SignalRequest> }).ready
            expect(result.status).toBe('error')
            // The queue is not wedged: a subsequent request with instant loads succeeds.
            reader.autoLoad = true
            const retry = await reader.requestSignals([5, 15])
            if (retry.status === 'pending') {
                const retryResult = await retry.ready
                expect(retryResult.status).toBe('ready')
            } else {
                expect(retry.status).toBe('ready')
            }
        } finally {
            GenericSignalReader.LOAD_BLOCK_TIMEOUT = originalTimeout
        }
    })
    test('a non-view stream never slides the window', async () => {
        const { reader, mutex } = await setupReader()
        const rangeBefore = [await mutex.outputRangeStart, await mutex.outputRangeEnd]
        const result = await reader.requestSignals([35, 45], undefined, 'trend')
        expect(result.status).toBe('ready')
        expect(reader.blockLoads.length).toBe(0)
        const rangeAfter = [await mutex.outputRangeStart, await mutex.outputRangeEnd]
        expect(rangeAfter).toStrictEqual(rangeBefore)
    })
})

describe('requestSignals outside the rolling path', () => {
    test('delegates to the plain read on the full-load path', async () => {
        const { reader } = await setupReader()
        ;(reader as unknown as Record<string, unknown>)._useRolling = false
        const result = await reader.requestSignals([5, 15])
        expect(result.status).toBe('ready')
    })
    test('rejects an empty range', async () => {
        const { reader } = await setupReader()
        const result = await reader.requestSignals([5, 5])
        expect(result.status).toBe('error')
    })
})
