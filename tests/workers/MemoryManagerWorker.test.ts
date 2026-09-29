/**
 * Tests for the memory manager worker's teardown.
 *
 * The manager's shared buffer is the one every registered service's mutex views are cut from, so
 * the worker holding it is the last thing to go. These tests pin the two properties that made the
 * montage worker leak a thread before it had a `shutdown` of its own: the action is reachable
 * through the commission dispatch at all, and the reply goes out before the thread closes.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerMessage } from '#types/service'
import { MemoryManagerWorker } from '#workers/memory-manager.worker'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

/** Every reply and close, in the order they happened. */
let events: string[] = []
/** Replies the worker posted back to its service. */
let posted: Record<string, unknown>[] = []

/** A worker with a buffer attached and its transport captured in place of a real thread. */
const buildWorker = () => {
    const worker = new MemoryManagerWorker()
    const buffer = new SharedArrayBuffer(40*4)
    ;(worker as unknown as { _buffer: SharedArrayBuffer })._buffer = buffer
    ;(worker as unknown as { _view: Int32Array })._view = new Int32Array(buffer)
    ;(worker as unknown as { _postMessage: (m: Record<string, unknown>) => void })._postMessage = (msg) => {
        posted.push(msg)
        events.push(`reply:${msg.action}`)
    }
    ;(worker as unknown as { _close: () => void })._close = () => {
        events.push('close')
    }
    return worker
}

const message = (action: string, rn: number) => ({ data: { action, rn } }) as WorkerMessage

describe('MemoryManagerWorker shutdown', () => {
    beforeEach(() => {
        events = []
        posted = []
    })
    it('is reachable through the commission dispatch', async () => {
        const worker = buildWorker()
        await worker.handleMessage(message('shutdown', 7))
        // An unregistered action is answered by BaseWorker with a failure naming it, so a success
        // here is what distinguishes a registered handler from the dispatch's refusal.
        expect(posted).toHaveLength(1)
        expect(posted[0]).toMatchObject({ action: 'shutdown', rn: 7, success: true })
    })
    it('answers before closing the thread', async () => {
        // The ordering is the whole defect: `close()` stops the thread, so a reply posted after it
        // never leaves and the commission awaiting it is never settled.
        const worker = buildWorker()
        await worker.shutdown({ action: 'shutdown', rn: 1 } as WorkerMessage['data'])
        expect(events).toStrictEqual(['reply:shutdown', 'close'])
    })
    it('drops the buffer and its view', async () => {
        const worker = buildWorker()
        await worker.shutdown({ action: 'shutdown', rn: 1 } as WorkerMessage['data'])
        expect((worker as unknown as { _buffer: SharedArrayBuffer | null })._buffer).toBeNull()
        expect((worker as unknown as { _view: Int32Array | null })._view).toBeNull()
    })
    it('reports a rearrange commissioned after shutdown instead of throwing', async () => {
        // Nothing should arrive after the teardown, but a reply in flight when the manager decided
        // to shut down would land here — the handler must fail the commission, not throw.
        const worker = buildWorker()
        await worker.shutdown({ action: 'shutdown', rn: 1 } as WorkerMessage['data'])
        await worker.handleMessage({
            data: {
                action: 'release-and-rearrange',
                rn: 2,
                rearrange: [{ id: 'a', range: [1, 5] }],
                release: [[5, 9]],
            },
        } as unknown as WorkerMessage)
        expect(posted[1]).toMatchObject({ action: 'release-and-rearrange', rn: 2, success: false })
    })
})
