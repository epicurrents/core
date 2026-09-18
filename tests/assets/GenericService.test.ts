/**
 * Unit tests for GenericService class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericService from '../../src/assets/service/GenericService'
import GenericAsset from '../../src/assets/GenericAsset'

// Mock dependencies
vi.mock('scoped-event-log', () => ({
    Log: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        registerWorker: vi.fn(),
    }
}))

vi.mock('../../src/events/EventBus')

vi.mock('../../src/util', () => ({
    deepClone: vi.fn((obj) => {
        if (obj === null || obj === undefined) return obj
        try {
            return JSON.parse(JSON.stringify(obj))
        } catch {
            return null
        }
    }),
    safeObjectFrom: vi.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

vi.mock('../../src/util/general', () => ({
    getOrSetValue: vi.fn((map, key, defaultValue) => {
        if (map.has(key)) return map.get(key)
        map.set(key, defaultValue)
        return defaultValue
    }),
    nullPromise: Promise.resolve(null),
    safeObjectFrom: vi.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

vi.mock('../../src/util/constants', () => ({
    NUMERIC_ERROR_VALUE: -1,
}))

vi.mock('asymmetric-io-mutex', () => ({
    MutexExportProperties: {},
}))

// Concrete subclass for testing abstract GenericService
class TestService extends GenericService {
    constructor(name: string, worker?: Worker | MessagePort, shared?: boolean, manager?: any) {
        super(name, worker, shared, manager)
    }
    // Expose protected methods for testing
    public commissionWorker(
        action: string,
        props?: Map<string, unknown>,
        callbacks?: { resolve: (value?: unknown) => void, reject: (reason?: string) => void },
        options?: any,
    ) {
        return this._commissionWorker(action, props, callbacks, options)
    }
    public handleWorkerCommission(message: any) {
        return this._handleWorkerCommission(message)
    }
    public handleWorkerUpdate(message: any) {
        return this._handleWorkerUpdate(message)
    }
    public getCommissionForMessage(message: any) {
        return this._getCommissionForMessage(message)
    }
    public commissionCount(action: string) {
        return ((this as any)._commissions.get(action)?.size ?? 0) as number
    }
}

describe('GenericService', () => {
    let mockEventBus: any
    let mockApp: any
    let originalWindow: any

    beforeEach(() => {
        if (Log.debug) (Log.debug as ReturnType<typeof vi.fn>).mockClear()
        if (Log.error) (Log.error as ReturnType<typeof vi.fn>).mockClear()
        if (Log.warn) (Log.warn as ReturnType<typeof vi.fn>).mockClear()

        ;(GenericAsset as any).USED_IDS.clear()

        mockEventBus = {
            addScopedEventListener: vi.fn(),
            dispatchScopedEvent: vi.fn().mockReturnValue(true),
            getEventHooks: vi.fn(),
            removeAllScopedEventListeners: vi.fn(),
            removeScopedEventListener: vi.fn(),
            removeScope: vi.fn(),
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
            unsubscribeAll: vi.fn(),
        }

        mockApp = {}

        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: {
                __EPICURRENTS__: {
                    APP: mockApp,
                    EVENT_BUS: mockEventBus,
                    RUNTIME: null,
                }
            } as any,
            writable: true,
        })

        ;(EventBus as MockedClass<typeof EventBus>).mockImplementation(function() { return mockEventBus as any })
    })

    afterEach(() => {
        global.window = originalWindow
        vi.useRealTimers()
    })

    describe('constructor', () => {
        it('should create a service with a name', () => {
            const service = new TestService('Test Service')
            expect(service.name).toBe('Test Service')
            expect(service.modality).toBe('service')
        })

        it('should accept a dedicated worker', () => {
            const mockWorker = {
                postMessage: vi.fn(),
                terminate: vi.fn(),
                onmessage: null,
                onerror: null,
            }
            const service = new TestService('Test', mockWorker as any)
            expect(Log.registerWorker).toHaveBeenCalledWith(mockWorker)
        })

        it('should accept a shared worker port', () => {
            const mockPort = { postMessage: vi.fn(), onmessage: null }
            const service = new TestService('Test', mockPort as any, true)
            expect(service.port).toBe(mockPort)
        })
    })

    describe('isReady', () => {
        it('should be false initially', () => {
            const service = new TestService('Test')
            expect(service.isReady).toBe(false)
        })

        it('should be false when only worker is setup', () => {
            const service = new TestService('Test')
            ;(service as any)._isWorkerSetup = true
            expect(service.isReady).toBe(false)
        })

        it('should be true when worker and cache are setup and no manager', () => {
            const service = new TestService('Test')
            ;(service as any)._isWorkerSetup = true
            ;(service as any)._isCacheSetup = true
            expect(service.isReady).toBe(true)
        })

        it('should be false when manager exists but no memory range', () => {
            const service = new TestService('Test', undefined, undefined, { allocate: vi.fn() })
            ;(service as any)._isWorkerSetup = true
            ;(service as any)._isCacheSetup = true
            expect(service.isReady).toBe(false)
        })
    })

    describe('bufferRangeStart', () => {
        it('should return -1 when no memory range', () => {
            const service = new TestService('Test')
            expect(service.bufferRangeStart).toBe(-1)
        })

        it('should return start of memory range', () => {
            const service = new TestService('Test')
            ;(service as any)._memoryRange = { start: 100, end: 200 }
            expect(service.bufferRangeStart).toBe(100)
        })
    })

    describe('memoryConsumption', () => {
        it('should return 0 when no memory range', () => {
            const service = new TestService('Test')
            expect(service.memoryConsumption).toBe(0)
        })

        it('should return memory range size', () => {
            const service = new TestService('Test')
            ;(service as any)._memoryRange = { start: 100, end: 300 }
            expect(service.memoryConsumption).toBe(200)
        })
    })

    describe('initialSetup', () => {
        it('should resolve to true when worker is setup', async () => {
            const service = new TestService('Test')
            ;(service as any)._isWorkerSetup = true
            const result = await service.initialSetup
            expect(result).toBe(true)
        })

        it('should resolve to undefined when no waiters exist', async () => {
            const service = new TestService('Test')
            const result = await service.initialSetup
            expect(result).toBeUndefined()
        })
    })

    describe('addActionWatcher', () => {
        it('should add an action watcher', () => {
            const service = new TestService('Test')
            const handler = vi.fn()
            service.addActionWatcher('test-action', handler, 'caller')
            expect((service as any)._actionWatchers).toHaveLength(1)
            expect((service as any)._actionWatchers[0].actions).toContain('test-action')
        })

        it('should add action to existing watcher with same handler', () => {
            const service = new TestService('Test')
            const handler = vi.fn()
            service.addActionWatcher('action1', handler)
            service.addActionWatcher('action2', handler)
            expect((service as any)._actionWatchers).toHaveLength(1)
            expect((service as any)._actionWatchers[0].actions).toEqual(['action1', 'action2'])
        })

        it('should not duplicate action for same handler', () => {
            const service = new TestService('Test')
            const handler = vi.fn()
            service.addActionWatcher('action1', handler)
            service.addActionWatcher('action1', handler)
            expect((service as any)._actionWatchers[0].actions).toEqual(['action1'])
        })
    })

    describe('removeActionWatcher', () => {
        it('should remove an action watcher by handler', () => {
            const service = new TestService('Test')
            const handler = vi.fn()
            service.addActionWatcher('action', handler)
            service.removeActionWatcher(handler)
            expect((service as any)._actionWatchers).toHaveLength(0)
        })
    })

    describe('removeAllActionWatchersFor', () => {
        it('should remove all watchers for a caller', () => {
            const service = new TestService('Test')
            service.addActionWatcher('action1', vi.fn(), 'caller-a')
            service.addActionWatcher('action2', vi.fn(), 'caller-b')
            service.removeAllActionWatchersFor('caller-a')
            expect((service as any)._actionWatchers).toHaveLength(1)
            expect((service as any)._actionWatchers[0].caller).toBe('caller-b')
        })
    })

    describe('removeAllActionWatchers', () => {
        it('should remove all action watchers', () => {
            const service = new TestService('Test')
            service.addActionWatcher('action1', vi.fn())
            service.addActionWatcher('action2', vi.fn())
            service.removeAllActionWatchers()
            expect((service as any)._actionWatchers).toHaveLength(0)
        })
    })

    describe('awaitAction', () => {
        it('should resolve undefined when no waiters for action', async () => {
            const service = new TestService('Test')
            const result = await service.awaitAction('nonexistent')
            expect(result).toBeUndefined()
        })
    })

    describe('requestMemory', () => {
        it('should return false when manager is not set', async () => {
            const service = new TestService('Test')
            const result = await service.requestMemory(100)
            expect(result).toBe(false)
        })

        it('should return false when manager has no free memory', async () => {
            const manager = { freeMemory: 0, allocate: vi.fn() }
            const service = new TestService('Test', undefined, undefined, manager)
            const result = await service.requestMemory(100)
            expect(result).toBe(false)
        })

        it('should allocate memory from manager', async () => {
            const manager = {
                freeMemory: 1000,
                allocate: vi.fn().mockResolvedValue({ start: 0, end: 100 }),
            }
            const service = new TestService('Test', undefined, undefined, manager)
            const result = await service.requestMemory(100)
            expect(result).toBe(true)
            expect(manager.allocate).toHaveBeenCalledWith(100, service)
        })
    })

    describe('destroy', () => {
        it('should clear commissions, waiters, and watchers', async () => {
            const service = new TestService('Test')
            service.addActionWatcher('action', vi.fn())
            ;(service as any)._commissions.set('test', new Map())
            ;(service as any)._waiters.set('test', [])
            // shutdown will fail without __EPICURRENTS__.RUNTIME
            ;(global.window as any).__EPICURRENTS__.RUNTIME = {
                SETTINGS: {
                    removeAllPropertyUpdateHandlersFor: vi.fn(),
                },
            }
            // Mock _commissionWorker for shutdown
            ;(service as any)._worker = null
            await service.destroy()
            expect((service as any)._commissions.size).toBe(0)
            expect((service as any)._waiters.size).toBe(0)
            expect((service as any)._actionWatchers).toHaveLength(0)
            expect(service.state).toBe('destroyed')
        })
    })
    describe('commission lifecycle', () => {
        const makeService = () => {
            const worker = { postMessage: vi.fn(), addEventListener: vi.fn(), terminate: vi.fn() }
            return { service: new TestService('Test', worker as any), worker }
        }

        it('resolves a commission when its response arrives', async () => {
            const { service } = makeService()
            const commission = service.commissionWorker('do-thing')
            void service.handleWorkerCommission({
                data: { action: 'do-thing', rn: commission.rn, success: true, result: 42 },
            })
            await expect(commission.promise).resolves.toBe(42)
        })

        it('drops a settled commission from the map', async () => {
            // Nothing else removed them, so the map kept a resolve/reject closure pair for every
            // commission the service had ever sent — one or more per view scroll — for as long as
            // the service lived.
            const { service } = makeService()
            const commission = service.commissionWorker('do-thing')
            expect(service.commissionCount('do-thing')).toBe(1)
            void service.handleWorkerCommission({
                data: { action: 'do-thing', rn: commission.rn, success: true, result: 1 },
            })
            await commission.promise
            expect(service.commissionCount('do-thing')).toBe(0)
        })

        it('does not accumulate entries across many commissions', async () => {
            const { service } = makeService()
            for (let i = 0; i < 25; i++) {
                const commission = service.commissionWorker('do-thing')
                void service.handleWorkerCommission({
                    data: { action: 'do-thing', rn: commission.rn, success: true, result: i },
                })
                await commission.promise
            }
            expect(service.commissionCount('do-thing')).toBe(0)
        })

        it('leaves an unrelated request number untouched', async () => {
            const { service } = makeService()
            const first = service.commissionWorker('do-thing')
            const second = service.commissionWorker('do-thing')
            void service.handleWorkerCommission({
                data: { action: 'do-thing', rn: second.rn, success: true, result: 'second' },
            })
            await expect(second.promise).resolves.toBe('second')
            expect(service.commissionCount('do-thing')).toBe(1)
            void service.handleWorkerCommission({
                data: { action: 'do-thing', rn: first.rn, success: true, result: 'first' },
            })
            await expect(first.promise).resolves.toBe('first')
            expect(service.commissionCount('do-thing')).toBe(0)
        })

        it('settles superseded commissions instead of dropping them silently', async () => {
            // Their messages are already with the worker, and its replies arrive under request
            // numbers that no longer map to anything, so a caller still awaiting one of these
            // promises would have waited for the life of the service.
            const { service } = makeService()
            const superseded = service.commissionWorker('do-thing')
            const replacement = service.commissionWorker('do-thing', undefined, undefined, {
                overwriteRequest: true,
            })
            await expect(superseded.promise).rejects.toBeDefined()
            expect(service.commissionCount('do-thing')).toBe(1)
            void service.handleWorkerCommission({
                data: { action: 'do-thing', rn: replacement.rn, success: true, result: 'ok' },
            })
            await expect(replacement.promise).resolves.toBe('ok')
        })
    })
})
