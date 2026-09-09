/**
 * Tests for the shared signal-reader worker vocabulary.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type GenericSignalReader from '#assets/reader/GenericSignalReader'
import type { WorkerMessage } from '#types/service'
import { SignalReaderWorker } from '#workers/signal-reader.worker'

/**
 * Commissions `GenericBiosignalService` and the memory manager can send a reader's worker, minus
 * `setup-worker`, which every format registers for itself.
 *
 * A worker that leaves one of these unregistered does not fail: it replies with nothing, and the
 * service waits on a promise that can no longer settle. That is invisible to a test of the reader
 * and to an end-to-end run of any path that happens not to use the missing commission, which is
 * why the vocabulary is asserted here as a list rather than left to each package to remember.
 */
const READER_COMMISSIONS = [
    'cache-signals',
    'get-signals',
    'release-cache',
    'release-signal-arrays',
    'request-signals',
    'reset-network',
    'set-buffer-range',
    'set-interruptions',
    'set-signal-polarity',
    'setup-cache',
    'shutdown',
    'update-settings',
]

const posted: Record<string, unknown>[] = []

/** Minimal reader standing in for a real one; each test stubs only what it reaches. */
const stubReader = () => ({
    cacheReady: true,
    cacheSignals: vi.fn().mockResolvedValue(true),
    destroy: vi.fn().mockResolvedValue(undefined),
    getSignals: vi.fn().mockResolvedValue({ start: 0, end: 1, signals: [] }),
    releaseCache: vi.fn().mockResolvedValue(undefined),
    releaseSignalArrays: vi.fn().mockResolvedValue(undefined),
    requestSignals: vi.fn().mockResolvedValue({ status: 'ready', part: { start: 0, end: 1, signals: [] } }),
    setBufferRange: vi.fn().mockReturnValue(true),
    setInterruptions: vi.fn(),
    setSignalPolarityInverted: vi.fn().mockResolvedValue(true),
    setupCache: vi.fn().mockReturnValue({ cache: true }),
    setupMutex: vi.fn().mockResolvedValue({ mutex: true }),
} as unknown as GenericSignalReader)

class TestWorker extends SignalReaderWorker {}

const message = (data: Record<string, unknown>) => ({ data: { rn: 1, ...data } } as unknown as WorkerMessage)

describe('SignalReaderWorker', () => {
    let worker: TestWorker

    beforeEach(() => {
        posted.length = 0
        // The class posts through the worker global; jsdom has no such scope.
        vi.stubGlobal('postMessage', (msg: Record<string, unknown>) => { posted.push(msg) })
        vi.stubGlobal('close', () => {})
        worker = new TestWorker(stubReader())
    })

    it.each(READER_COMMISSIONS)('answers %s', async (action) => {
        await worker.handleMessage(message({
            action,
            indices: [],
            interruptions: [],
            inverted: true,
            range: [0, 1],
            settings: {},
        }))
        // `reset-network` is fire-and-forget and deliberately posts nothing; every other commission
        // has a caller awaiting a reply.
        if (action !== 'reset-network') {
            expect(posted, `no reply was posted for '${action}'`).not.toHaveLength(0)
            expect(posted[0].action).toBe(action)
        }
    })

    it('answers an unregistered action with a failure rather than silence', async () => {
        await worker.handleMessage(message({ action: 'no-such-action' }))
        expect(posted).toHaveLength(1)
        expect(posted[0].success).toBe(false)
    })

    it('posts the shutdown reply before closing the worker', async () => {
        const order: string[] = []
        vi.stubGlobal('postMessage', (msg: Record<string, unknown>) => {
            posted.push(msg)
            order.push('post')
        })
        vi.stubGlobal('close', () => { order.push('close') })
        await worker.handleMessage(message({ action: 'shutdown' }))
        // The service terminates the worker only after this reply lands; posting after the close
        // would leave that teardown waiting on a message the worker is no longer able to send.
        expect(order).toEqual(['post', 'close'])
    })
})
