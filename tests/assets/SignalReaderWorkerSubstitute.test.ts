/**
 * Unit tests for SignalReaderWorkerSubstitute — the main-thread stand-in that runs the signal
 * reader worker's own commission handlers.
 *
 * The property under test is the vocabulary. A substitute answering a subset of it is not a
 * degraded fallback: an unanswered commission is reported as a failure, a failed commission
 * rejects, and the service awaits a commission before tearing a study down.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import SignalReaderWorkerSubstitute from '../../src/assets/service/SignalReaderWorkerSubstitute'
import type { WorkerMessage } from '../../src/types/service'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), registerWorker: vi.fn() },
}))

/**
 * Every commission in the signal reader vocabulary that is answered, with a valid payload for
 * each. `reset-network` is the one that is not: the service posts it without a request number and
 * waits for nothing, so a reply would have nobody to reach.
 */
const COMMISSIONS: { action: string, payload?: Record<string, unknown> }[] = [
    { action: 'cache-signals' },
    { action: 'get-signals', payload: { range: [0, 1] } },
    { action: 'release-cache' },
    { action: 'release-signal-arrays' },
    { action: 'request-signals', payload: { range: [0, 1] } },
    { action: 'set-buffer-range', payload: { range: [0, 10] } },
    { action: 'set-interruptions', payload: { interruptions: [] } },
    { action: 'set-signal-polarity', payload: { indices: [0], inverted: true } },
    { action: 'setup-cache', payload: { dataDuration: 10 } },
    { action: 'shutdown' },
    { action: 'update-settings', payload: { settings: { app: {}, modules: {} } } },
]

const makeReader = () => ({
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
    setupCache: vi.fn().mockReturnValue({ start: 0, end: 10 }),
    setupMutex: vi.fn().mockResolvedValue(null),
})

type MockReader = ReturnType<typeof makeReader>

/** Construct a substitute over a stub reader, collecting every reply it delivers. */
const makeSubstitute = (reader: MockReader = makeReader()) => {
    const substitute = new SignalReaderWorkerSubstitute(
        reader as unknown as ConstructorParameters<typeof SignalReaderWorkerSubstitute>[0]
    )
    const replies = [] as WorkerMessage['data'][]
    substitute.onmessage = (message) => replies.push(message.data)
    return { substitute, reader, replies }
}

describe('SignalReaderWorkerSubstitute', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('commission vocabulary', () => {
        it.each(COMMISSIONS)('answers $action', async ({ action, payload }) => {
            const { substitute, replies } = makeSubstitute()
            await substitute.postMessage({ action, rn: 1, ...payload })
            expect(replies.length).toBeGreaterThan(0)
            for (const reply of replies) {
                expect(reply.action).toBe(action)
                expect(reply.rn).toBe(1)
                expect(reply.success).toBe(true)
            }
        })

        it('accepts reset-network, which is posted without a reply to wait for', async () => {
            const { substitute, replies } = makeSubstitute()
            await substitute.postMessage({ action: 'reset-network', origin: 'test' })
            expect(replies).toHaveLength(0)
        })

        it('reports an action outside the vocabulary as a failure rather than ignoring it', async () => {
            const { substitute, replies } = makeSubstitute()
            await substitute.postMessage({ action: 'no-such-action', rn: 2 })
            expect(replies).toHaveLength(1)
            expect(replies[0].success).toBe(false)
            expect(replies[0].rn).toBe(2)
            // A caller that posted without waiting for a reply has only the log to go on.
            expect(Log.warn).toHaveBeenCalled()
        })

        it('delivers a validation failure to the caller rather than to the window', async () => {
            const { substitute, replies } = makeSubstitute()
            // The commission is missing its required range. The worker validates through the
            // transport hook; left on the utility default, the refusal would go to the global
            // postMessage, which on this thread is the window, and the commission would never
            // settle. Assert the destination rather than the arrival: a refusal that reaches the
            // window still arrives here by way of the dispatcher catching the throw jsdom raises,
            // which a browser does not.
            const posted = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
            await substitute.postMessage({ action: 'get-signals', rn: 3 })
            expect(posted).not.toHaveBeenCalled()
            posted.mockRestore()
            expect(replies).toHaveLength(1)
            expect(replies[0].success).toBe(false)
            expect(replies[0].rn).toBe(3)
            expect(replies[0].error).toContain(`required 'range'`)
        })
    })

    describe('commissions that differ on the main thread', () => {
        it('answers setup-cache with the cache itself', async () => {
            const { substitute, reader, replies } = makeSubstitute()
            await substitute.postMessage({ action: 'setup-cache', rn: 4, dataDuration: 10 })
            expect(reader.setupCache).toHaveBeenCalledWith(10, [])
            expect(replies[0].cacheProperties).toEqual({ start: 0, end: 10 })
        })

        it('refuses a setup-cache that asks for shared memory', async () => {
            const { substitute, reader, replies } = makeSubstitute()
            await substitute.postMessage({ action: 'setup-cache', rn: 5, useMemoryManager: true })
            expect(reader.setupMutex).not.toHaveBeenCalled()
            expect(replies[0].success).toBe(false)
        })

        it('reports a cache the reader refused to set up as a failure', async () => {
            const reader = makeReader()
            reader.setupCache.mockReturnValue(null)
            const { substitute, replies } = makeSubstitute(reader)
            await substitute.postMessage({ action: 'setup-cache', rn: 6, dataDuration: 10 })
            expect(replies[0].success).toBe(false)
        })

        it('acknowledges a settings snapshot without applying it to the application settings', async () => {
            const { substitute, replies } = makeSubstitute()
            const settings = { app: { dataChunkSize: 1 }, modules: {} }
            await substitute.postMessage({ action: 'update-settings', rn: 7, settings })
            expect(replies[0].success).toBe(true)
        })

        it('destroys the reader on shutdown and answers before the service terminates it', async () => {
            const { substitute, reader, replies } = makeSubstitute()
            await substitute.postMessage({ action: 'shutdown', rn: 8 })
            expect(reader.destroy).toHaveBeenCalled()
            expect(replies[0].success).toBe(true)
        })

        it('leaves the document alone on shutdown', async () => {
            const { substitute } = makeSubstitute()
            const close = vi.spyOn(window, 'close').mockImplementation(() => {})
            await substitute.postMessage({ action: 'shutdown', rn: 9 })
            expect(close).not.toHaveBeenCalled()
            close.mockRestore()
        })
    })

    describe('extendActionMap', () => {
        it('runs an added handler with the substitute as its context', async () => {
            const { substitute, replies } = makeSubstitute()
            class WithSetup extends SignalReaderWorkerSubstitute {
                async setupWorker (msgData: WorkerMessage['data']) {
                    return this._success(msgData, { opened: true })
                }
            }
            const extended = new WithSetup(
                makeReader() as unknown as ConstructorParameters<typeof SignalReaderWorkerSubstitute>[0]
            )
            const extendedReplies = [] as WorkerMessage['data'][]
            extended.onmessage = (message) => extendedReplies.push(message.data)
            extended.extendActionMap([['setup-worker', extended.setupWorker]])
            await extended.postMessage({ action: 'setup-worker', rn: 10 })
            expect(extendedReplies[0]).toMatchObject({ action: 'setup-worker', rn: 10, success: true, opened: true })
            // The shared vocabulary is unaffected by the addition.
            await substitute.postMessage({ action: 'release-cache', rn: 11 })
            expect(replies[0].success).toBe(true)
        })
    })
})
