/**
 * Unit tests for MontageWorkerSubstitute — the main-thread stand-in that runs the montage worker's
 * own commission handlers.
 *
 * The property under test is the vocabulary. A substitute answering a subset of it is not a
 * degraded fallback: an unregistered action is answered with a failure, and the service reads a
 * failed `shutdown` as a refusal and skips the teardown it guards.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import MontageWorkerSubstitute from '../../src/assets/biosignal/service/MontageWorkerSubstitute'
import MontageProcessor from '../../src/assets/biosignal/service/MontageProcessor'
import type { WorkerMessage } from '../../src/types/service'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), registerWorker: vi.fn() },
}))

/** Settings the application holds, as distinct from any snapshot a commission carries. */
const LIVE_MODULE_SETTINGS = { source: 'live' }

const processors = [] as MockProcessor[]

type MockProcessor = {
    channels: unknown[]
    destroy: ReturnType<typeof vi.fn>
    filters: { highpass: number, lowpass: number, notch: number }
    getSignals: ReturnType<typeof vi.fn>
    invalidateOutputCache: ReturnType<typeof vi.fn>
    mapChannels: ReturnType<typeof vi.fn>
    releaseCache: ReturnType<typeof vi.fn>
    releaseSignalArrays: ReturnType<typeof vi.fn>
    settings: unknown
    setBufferRange: ReturnType<typeof vi.fn>
    setHighpassFilter: ReturnType<typeof vi.fn>
    setInterruptions: ReturnType<typeof vi.fn>
    setLowpassFilter: ReturnType<typeof vi.fn>
    setNotchFilter: ReturnType<typeof vi.fn>
    setupCacheWithInput: ReturnType<typeof vi.fn>
    setupChannels: ReturnType<typeof vi.fn>
    setupMutexWithInput: ReturnType<typeof vi.fn>
    setupSharedWorkerWithInput: ReturnType<typeof vi.fn>
}

vi.mock('../../src/assets/biosignal/service/MontageProcessor', () => ({
    __esModule: true,
    default: vi.fn(function (settings: unknown) {
        const processor: MockProcessor = {
            channels: [],
            destroy: vi.fn().mockResolvedValue(undefined),
            filters: { highpass: 0, lowpass: 0, notch: 0 },
            getSignals: vi.fn().mockResolvedValue({ start: 0, end: 1, signals: [] }),
            invalidateOutputCache: vi.fn().mockResolvedValue(undefined),
            mapChannels: vi.fn(),
            releaseCache: vi.fn().mockResolvedValue(undefined),
            releaseSignalArrays: vi.fn().mockResolvedValue(undefined),
            settings: settings,
            setBufferRange: vi.fn().mockReturnValue(true),
            setHighpassFilter: vi.fn(),
            setInterruptions: vi.fn(),
            setLowpassFilter: vi.fn(),
            setNotchFilter: vi.fn(),
            setupCacheWithInput: vi.fn().mockReturnValue(true),
            setupChannels: vi.fn(),
            setupMutexWithInput: vi.fn().mockResolvedValue({ start: 0 }),
            setupSharedWorkerWithInput: vi.fn().mockResolvedValue(true),
        }
        processors.push(processor)
        return processor
    }),
}))

/** A cache the way `validateCommissionProps` recognises one: by its constructor name. */
class BiosignalCache {}

/**
 * Every commission the montage vocabulary answers on this side, with a valid payload for each.
 * `setup-worker` is not listed because the fixture posts it to reach the state the rest require.
 */
const COMMISSIONS: { action: string, payload?: Record<string, unknown> }[] = [
    { action: 'get-signals', payload: { range: [0, 1] } },
    { action: 'invalidate-cache' },
    { action: 'map-channels', payload: { config: {} } },
    { action: 'release-cache' },
    { action: 'release-signal-arrays' },
    { action: 'set-filters', payload: { filters: '{}', name: 'test-montage' } },
    { action: 'set-interruptions', payload: { interruptions: [] } },
    {
        action: 'setup-cache',
        payload: { cache: new BiosignalCache(), dataDuration: 10, recordingDuration: 10 },
    },
    { action: 'shutdown' },
    { action: 'update-settings', payload: { settings: { app: {}, modules: {} } } },
]

/**
 * Commissions a worker answers and this side refuses, because each needs memory or a thread the
 * environment using a substitute does not have. They are refused with a reason rather than left
 * out: an absent handler and a refusal reach the service as the same failure, but only one of them
 * says why.
 */
const REFUSALS: { action: string, payload?: Record<string, unknown> }[] = [
    { action: 'set-buffer-range', payload: { range: [0, 10] } },
    {
        action: 'setup-input-cache',
        payload: { dataDuration: 10, port: {}, recordingDuration: 10 },
    },
    {
        action: 'setup-input-mutex',
        payload: { bufferStart: 0, dataDuration: 10, input: {}, recordingDuration: 10 },
    },
]

const SETUP_WORKER = {
    action: 'setup-worker',
    config: {},
    montage: 'test-montage',
    namespace: 'eeg',
    settings: { app: {}, modules: { eeg: { source: 'snapshot' } } },
    setupChannels: [],
}

/** Construct a substitute, collecting every reply it delivers. Optionally sets the worker up. */
const makeSubstitute = async (setup = true) => {
    const substitute = new MontageWorkerSubstitute()
    const replies = [] as WorkerMessage['data'][]
    substitute.onmessage = (message) => replies.push(message.data)
    if (setup) {
        await substitute.postMessage({ ...SETUP_WORKER, rn: 0 })
        replies.length = 0
    }
    return { substitute, replies }
}

const lastProcessor = () => processors[processors.length - 1]

describe('MontageWorkerSubstitute', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        processors.length = 0
        window.__EPICURRENTS__ = {
            RUNTIME: { SETTINGS: { modules: { eeg: LIVE_MODULE_SETTINGS } } },
        } as unknown as typeof window.__EPICURRENTS__
    })

    describe('commission vocabulary', () => {
        it.each(COMMISSIONS)('answers $action', async ({ action, payload }) => {
            const { substitute, replies } = await makeSubstitute()
            await substitute.postMessage({ action, rn: 1, ...payload })
            expect(replies.length).toBeGreaterThan(0)
            for (const reply of replies) {
                expect(reply.action).toBe(action)
                expect(reply.rn).toBe(1)
                expect(reply.success).toBe(true)
            }
        })

        it.each(REFUSALS)('refuses $action with a reason', async ({ action, payload }) => {
            const { substitute, replies } = await makeSubstitute()
            await substitute.postMessage({ action, rn: 2, ...payload })
            expect(replies).toHaveLength(1)
            expect(replies[0].success).toBe(false)
            expect(replies[0].rn).toBe(2)
            expect(replies[0].error).toBeTruthy()
        })

        it('accepts reset-network, which every service posts and this worker has no use for', async () => {
            // Posted to every worker after re-authentication, without a request number. A worker
            // that fetches nothing still has to answer it, or every session restore warns about
            // an action nothing was ever going to act on.
            const { substitute, replies } = await makeSubstitute()
            await substitute.postMessage({ action: 'reset-network', origin: 'test' })
            expect(replies).toHaveLength(0)
            expect(Log.warn).not.toHaveBeenCalled()
        })

        it('reports an action outside the vocabulary as a failure rather than ignoring it', async () => {
            const { substitute, replies } = await makeSubstitute()
            await substitute.postMessage({ action: 'no-such-action', rn: 3 })
            expect(replies).toHaveLength(1)
            expect(replies[0].success).toBe(false)
            expect(replies[0].rn).toBe(3)
            // A caller that posted without waiting for a reply has only the log to go on.
            expect(Log.warn).toHaveBeenCalled()
        })

        it('delivers a validation failure to the caller rather than to the window', async () => {
            const { substitute, replies } = await makeSubstitute()
            // The commission is missing its required config. The worker validates through the
            // transport hook; left on the utility default, the refusal would go to the global
            // postMessage, which on this thread is the window, and the commission would never
            // settle. Assert the destination rather than the arrival: a refusal that reaches the
            // window still arrives here by way of the dispatcher catching the throw jsdom raises,
            // which a browser does not.
            const posted = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
            await substitute.postMessage({ action: 'map-channels', rn: 4 })
            expect(posted).not.toHaveBeenCalled()
            posted.mockRestore()
            expect(replies).toHaveLength(1)
            expect(replies[0].success).toBe(false)
            expect(replies[0].rn).toBe(4)
            expect(replies[0].error).toContain(`required 'config'`)
        })

        it('answers a commission arriving before setup exactly once', async () => {
            const { substitute, replies } = await makeSubstitute(false)
            await substitute.postMessage({ action: 'map-channels', rn: 5, config: {} })
            expect(replies).toHaveLength(1)
            expect(replies[0].success).toBe(false)
        })
    })

    describe('commissions that differ on the main thread', () => {
        it('hands the processor the application settings rather than the snapshot', async () => {
            await makeSubstitute()
            expect(MontageProcessor).toHaveBeenCalledWith(LIVE_MODULE_SETTINGS, expect.any(Function))
        })

        it('refuses setup-worker when the application has no settings for the namespace', async () => {
            window.__EPICURRENTS__ = {
                RUNTIME: { SETTINGS: { modules: {} } },
            } as unknown as typeof window.__EPICURRENTS__
            const { substitute, replies } = await makeSubstitute(false)
            await substitute.postMessage({ ...SETUP_WORKER, rn: 6 })
            expect(MontageProcessor).not.toHaveBeenCalled()
            expect(replies[0].success).toBe(false)
        })

        it('takes over a cache handed to it', async () => {
            const { substitute, replies } = await makeSubstitute()
            const cache = new BiosignalCache()
            await substitute.postMessage({
                action: 'setup-cache', rn: 7, cache, dataDuration: 10, recordingDuration: 20,
            })
            expect(lastProcessor().setupCacheWithInput).toHaveBeenCalledWith(cache, 10, 20)
            expect(replies[0].success).toBe(true)
        })

        it('reports a cache the processor refused to take over as a failure', async () => {
            const { substitute, replies } = await makeSubstitute()
            lastProcessor().setupCacheWithInput.mockReturnValue(false)
            await substitute.postMessage({
                action: 'setup-cache', rn: 8,
                cache: new BiosignalCache(), dataDuration: 10, recordingDuration: 20,
            })
            expect(replies[0].success).toBe(false)
        })

        it('destroys the processor on shutdown and answers before the service terminates it', async () => {
            const { substitute, replies } = await makeSubstitute()
            const processor = lastProcessor()
            await substitute.postMessage({ action: 'shutdown', rn: 9 })
            expect(processor.destroy).toHaveBeenCalled()
            expect(replies[0]).toMatchObject({ action: 'shutdown', rn: 9, success: true })
        })

        it('delivers the shutdown reply to a listener registered the way the service registers one', async () => {
            // The service subscribes with addEventListener, and the substitute's own teardown
            // clears those listeners. A shutdown that tore itself down before replying would
            // settle nothing, and the service awaits that reply before terminating anything.
            const substitute = new MontageWorkerSubstitute()
            await substitute.postMessage({ ...SETUP_WORKER, rn: 0 })
            const listener = vi.fn()
            substitute.addEventListener('message', listener as unknown as (ev: MessageEvent) => void)
            await substitute.postMessage({ action: 'shutdown', rn: 10 })
            const reply = listener.mock.calls.find(([ev]) => (ev as MessageEvent).data?.rn === 10)
            expect(reply).toBeDefined()
            expect((reply?.[0] as MessageEvent).data.success).toBe(true)
        })

        it('leaves the document alone on shutdown', async () => {
            const { substitute } = await makeSubstitute()
            const close = vi.spyOn(window, 'close').mockImplementation(() => {})
            await substitute.postMessage({ action: 'shutdown', rn: 11 })
            expect(close).not.toHaveBeenCalled()
            close.mockRestore()
        })
    })
})
