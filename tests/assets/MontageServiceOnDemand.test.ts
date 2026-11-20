/**
 * Unit tests for the montage service's worker started on demand. A montage nothing reads from holds no thread, so the
 * service records what it is set up with and gives it to a worker started by the first request; that request has to
 * be answered by a processor already set up, and a worker started again after a release has to be set up as before,
 * filters included, or it derives unfiltered signals with no error anywhere.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import EventBus from '../../src/events/EventBus'
import GenericAsset from '../../src/assets/GenericAsset'

vi.mock('scoped-event-log', () => ({
    Log: {
        debug: vi.fn(),
        error: vi.fn(),
        registerWorker: vi.fn(),
        warn: vi.fn(),
    },
}))

vi.mock('../../src/events/EventBus')

vi.mock('../../src/assets/biosignal/service/BiosignalMutex', () => ({
    default: class {
        static SIGNAL_DATA_POS = 4
        static convertPropertiesForCoupling (props: unknown) {
            return props
        }
    },
}))

/** A worker that answers every commission with success, in order, and records what it was sent. */
const { FakeWorker } = vi.hoisted(() => {
    class FakeWorker {
        static instances: FakeWorker[] = []
        /** Actions a worker takes and never answers. */
        static unanswered = new Set<string>()
        listeners: ((event: { data: unknown }) => void)[] = []
        onerror: unknown = null
        onmessageerror: unknown = null
        posted: { action: string, [key: string]: unknown }[] = []
        terminated = false
        constructor () {
            FakeWorker.instances.push(this)
        }
        addEventListener (_type: string, listener: (event: { data: unknown }) => void) {
            this.listeners.push(listener)
        }
        postMessage (message: { action: string, rn?: number }) {
            this.posted.push(message)
            if (message.rn === undefined || FakeWorker.unanswered.has(message.action)) {
                return
            }
            const reply = { action: message.action, rn: message.rn, success: true, range: [0, 1], signals: [] }
            setTimeout(() => {
                for (const listener of this.listeners) {
                    listener({ data: reply })
                }
            }, 0)
        }
        terminate () {
            this.terminated = true
        }
    }
    return { FakeWorker }
})
type FakeWorker = InstanceType<typeof FakeWorker>

vi.mock('../../src/workers/montage.worker.entry.ts?worker&inline', () => ({
    default: FakeWorker,
}))

import MontageService from '../../src/assets/biosignal/service/MontageService'

const actions = (worker: FakeWorker) => worker.posted.map(m => m.action)

describe('MontageService started on demand', () => {
    let modules: Record<string, unknown>
    let montage: any
    const manager = { buffer: {} } as any

    beforeEach(() => {
        ;(GenericAsset as any).USED_IDS.clear()
        FakeWorker.instances.length = 0
        FakeWorker.unanswered.clear()
        modules = { eeg: {} }
        const eventBus = {
            addScopedEventListener: vi.fn(() => () => undefined),
            dispatchScopedEvent: vi.fn().mockReturnValue(true),
            removeAllScopedEventListeners: vi.fn(),
            removeScope: vi.fn(),
        }
        ;(EventBus as any).mockImplementation(function () { return eventBus })
        ;(globalThis as any).window = {
            __EPICURRENTS__: {
                APP: {},
                EVENT_BUS: eventBus,
                RUNTIME: {
                    SETTINGS: { _CLONABLE: {}, modules, removeAllPropertyUpdateHandlersFor: vi.fn() },
                    WORKERS: new Map(),
                },
            },
        }
        montage = {
            channels: [],
            config: {},
            filters: { bandreject: [], highpass: 0.5, lowpass: 70, notch: 50 },
            modality: 'eeg',
            name: 'M',
            recording: { dataDuration: 10, totalDuration: 10 },
            setup: { channels: [] },
        }
    })

    /** A service set up as a montage sets one up: worker, input mutex and interruptions. */
    const setUp = async () => {
        const service = new MontageService(montage, manager)
        service.setupWorker()
        await service.setupMontageWithInputMutex({ input: 'props' } as any)
        service.setInterruptions(new Map([[1, 2]]))
        return service
    }

    /**
     * Start releasing the worker and return once its shutdown is posted and not yet answered. The release is wrapped,
     * since a promise returned from here as it is would be awaited to its end.
     */
    const releaseUntilShutdown = async (service: MontageService) => {
        const release = service.releaseWorker()
        for (let i = 0; i < 5; i++) {
            await Promise.resolve()
        }
        expect(actions(FakeWorker.instances[0])).toContain('shutdown')
        expect(FakeWorker.instances[0].terminated).toBe(false)
        return { release }
    }

    it('starts no worker until a request needs one', async () => {
        await setUp()
        expect(FakeWorker.instances).toHaveLength(0)
    })

    it('sets a new worker up before the request that started it, and answers it', async () => {
        const service = await setUp()
        const response = await service.getSignals([0, 1])
        expect(FakeWorker.instances).toHaveLength(1)
        const worker = FakeWorker.instances[0]
        expect(actions(worker)).toEqual(['setup-worker', 'setup-input-mutex', 'set-interruptions', 'get-signals'])
        expect(worker.posted[1].input).toEqual({ input: 'props' })
        expect(response).toEqual({ signals: [], range: [0, 1] })
    })

    it('starts one worker for requests that arrive together', async () => {
        const service = await setUp()
        await Promise.all([service.setFilters(), service.mapChannels()])
        expect(FakeWorker.instances).toHaveLength(1)
        expect(actions(FakeWorker.instances[0]).filter(a => a === 'setup-input-mutex')).toHaveLength(1)
    })

    it('sends filters once when setting them is what starts the worker', async () => {
        const service = await setUp()
        await service.setFilters()
        expect(actions(FakeWorker.instances[0]).filter(a => a === 'set-filters')).toHaveLength(1)
    })

    it('starts a released worker again set up as before, filters included', async () => {
        const service = await setUp()
        await service.setFilters()
        await service.releaseWorker()
        const first = FakeWorker.instances[0]
        expect(first.terminated).toBe(true)
        expect(actions(first)).toContain('shutdown')
        await service.getSignals([0, 1])
        expect(FakeWorker.instances).toHaveLength(2)
        expect(actions(FakeWorker.instances[1])).toEqual([
            'setup-worker', 'setup-input-mutex', 'set-interruptions', 'set-filters', 'get-signals',
        ])
    })

    it('shuts the worker down when unloaded and sets the next one up with the newest input', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        await service.unload(false)
        expect(FakeWorker.instances[0].terminated).toBe(true)
        // The resource commissions its montages again against the cache it sets up on reactivation.
        await service.setupMontageWithInputMutex({ input: 'new props' } as any)
        expect(FakeWorker.instances).toHaveLength(1)
        await service.getSignals([0, 1])
        expect(FakeWorker.instances[1].posted.find(m => m.action === 'setup-input-mutex')?.input)
            .toEqual({ input: 'new props' })
    })

    it('keeps the worker when a request arrives while it is being released', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        const release = service.releaseWorker()
        const read = service.getSignals([0, 1])
        await Promise.all([release, read])
        expect(FakeWorker.instances).toHaveLength(1)
        expect(FakeWorker.instances[0].terminated).toBe(false)
        expect(actions(FakeWorker.instances[0]).filter(a => a === 'get-signals')).toHaveLength(2)
    })

    it('lets a read in flight finish before shutting the worker down', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        const read = service.getSignals([2, 3])
        await service.releaseWorker()
        // The read was answered rather than rejected by the shutdown.
        expect(await read).toEqual({ signals: [], range: [0, 1] })
        expect(FakeWorker.instances[0].terminated).toBe(true)
    })

    it('sets a starting worker up before a read that arrives during the start', async () => {
        const service = await setUp()
        await Promise.all([service.setFilters(), service.getSignals([0, 1])])
        expect(actions(FakeWorker.instances[0])).toEqual([
            'setup-worker', 'setup-input-mutex', 'set-interruptions', 'set-filters', 'get-signals',
        ])
    })

    it('gives a worker started again the interruptions set while the last one ran', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        service.setInterruptions(new Map([[5, 6]]))
        expect(FakeWorker.instances[0].posted.filter(m => m.action === 'set-interruptions')).toHaveLength(2)
        await service.releaseWorker()
        await service.getSignals([0, 1])
        const replayed = FakeWorker.instances[1].posted.filter(m => m.action === 'set-interruptions')
        expect(replayed).toEqual([{ action: 'set-interruptions', interruptions: [{ start: 5, duration: 6 }] }])
    })

    it('takes a setup that arrives while the worker is being released', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        const { release } = await releaseUntilShutdown(service)
        // Sent to a worker that is shutting down, the commission would be rejected with it.
        await service.setupMontageWithInputMutex({ input: 'new props' } as any)
        await release
        await service.getSignals([0, 1])
        const worker = FakeWorker.instances[FakeWorker.instances.length - 1]
        expect(worker.terminated).toBe(false)
        const inputs = worker.posted.filter(m => m.action === 'setup-input-mutex')
        expect(inputs[inputs.length - 1].input).toEqual({ input: 'new props' })
    })

    it('drops a read waiting behind the one in flight when the worker is released', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        const inFlight = service.getSignals([2, 3])
        const waiting = service.getSignals([4, 5])
        await service.releaseWorker()
        expect(await inFlight).toEqual({ signals: [], range: [0, 1] })
        expect(await waiting).toEqual({ success: false })
        expect(FakeWorker.instances).toHaveLength(1)
        expect(FakeWorker.instances[0].terminated).toBe(true)
        expect(actions(FakeWorker.instances[0]).filter(a => a === 'get-signals')).toHaveLength(2)
    })

    it('is destroyed while its worker is being released', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        const { release } = await releaseUntilShutdown(service)
        await expect(service.destroy()).resolves.toBeUndefined()
        await release
        expect(FakeWorker.instances[0].terminated).toBe(true)
        expect(actions(FakeWorker.instances[0]).filter(a => a === 'shutdown')).toHaveLength(1)
        expect((service as any)._manager).toBeNull()
        await service.getSignals([0, 1])
        expect(FakeWorker.instances).toHaveLength(1)
    })

    it('unloads when a release shuts the worker down before it answers', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        FakeWorker.unanswered.add('release-cache')
        vi.useFakeTimers()
        try {
            const unload = service.unload(false)
            const release = service.releaseWorker()
            await vi.advanceTimersByTimeAsync(1500)
            await expect(unload).resolves.toBeUndefined()
            await release
        } finally {
            vi.useRealTimers()
        }
        expect(FakeWorker.instances[0].terminated).toBe(true)
    })

    it('starts a new worker for a request that arrives after the release', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        await service.releaseWorker()
        await service.getSignals([0, 1])
        expect(FakeWorker.instances).toHaveLength(2)
        expect(actions(FakeWorker.instances[1])).toContain('get-signals')
    })

    it('keeps no entry for a commission once it is answered', async () => {
        const service = await setUp()
        await service.setFilters()
        await service.getSignals([0, 1])
        await service.mapChannels()
        const maps = [...(service as any)._commissions.values()] as Map<number, unknown>[]
        const pending = maps.reduce((n, m) => n + m.size, 0)
        expect(pending).toBe(0)
    })

    it('starts no worker for a request that reaches it after it is destroyed', async () => {
        const service = await setUp()
        await service.getSignals([0, 1])
        await service.destroy()
        expect(FakeWorker.instances[0].terminated).toBe(true)
        await service.setFilters().catch(() => undefined)
        expect(FakeWorker.instances).toHaveLength(1)
    })

    it('has nothing to invalidate before it starts', async () => {
        const service = await setUp()
        await service.invalidateCache()
        expect(FakeWorker.instances).toHaveLength(0)
    })

    it('starts its worker at once when montages are precached', async () => {
        modules.eeg = { precacheMontages: 1 }
        new MontageService(montage, manager)
        expect(FakeWorker.instances).toHaveLength(1)
    })

    it('uses the worker the runtime registers for montages', async () => {
        const registered = vi.fn(() => new FakeWorker() as unknown as Worker)
        ;(globalThis as any).window.__EPICURRENTS__.RUNTIME.WORKERS.set('montage', registered)
        const service = await setUp()
        expect(registered).not.toHaveBeenCalled()
        await service.getSignals([0, 1])
        expect(registered).toHaveBeenCalledTimes(1)
    })
})
