/**
 * Unit tests for GenericBiosignalService class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericBiosignalService from '../../src/assets/biosignal/service/GenericBiosignalService'
import GenericAsset from '../../src/assets/GenericAsset'

vi.mock('scoped-event-log', () => {
    // The subject imports Log as a default import, so the mock has to expose both bindings from a
    // shared reference; a named-only mock throws as soon as a logging branch is reached.
    const log = {
        add: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        registerWorker: vi.fn(),
        LEVELS: {},
    }
    return {
        __esModule: true,
        default: log,
        Log: log,
    }
})

vi.mock('../../src/events/EventBus')

vi.mock('../../src/util', () => ({
    deepClone: vi.fn((obj) => {
        if (obj === null || obj === undefined) return obj
        try { return JSON.parse(JSON.stringify(obj)) } catch { return null }
    }),
    safeObjectFrom: vi.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

vi.mock('../../src/util/constants', () => ({
    INDEX_NOT_ASSIGNED: -1,
    NUMERIC_ERROR_VALUE: -1,
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

vi.mock('asymmetric-io-mutex', () => ({
    MutexExportProperties: {},
}))

class TestBiosignalService extends GenericBiosignalService {
    constructor(recording: any, worker?: any, manager?: any) {
        super(recording, worker, manager)
    }
}

describe('GenericBiosignalService', () => {
    let mockEventBus: any
    let mockRecording: any
    let originalWindow: any

    beforeEach(() => {
        vi.clearAllMocks()
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

        mockRecording = {
            signalCacheStatus: [0, 0],
            addEventsFromTemplates: vi.fn(),
            setInterruptions: vi.fn(),
        }

        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: {
                __EPICURRENTS__: {
                    APP: {},
                    EVENT_BUS: mockEventBus,
                    RUNTIME: {
                        SETTINGS: {
                            addPropertyUpdateHandler: vi.fn(),
                            removeAllPropertyUpdateHandlersFor: vi.fn(),
                            getFieldValue: vi.fn(),
                        },
                    },
                },
            } as any,
            writable: true,
        })

        ;(EventBus as MockedClass<typeof EventBus>).mockImplementation(function() { return mockEventBus as any })
    })

    afterEach(() => {
        global.window = originalWindow
    })

    describe('constructor', () => {
        it('should create a service with recording', () => {
            const service = new TestBiosignalService(mockRecording)
            expect(service.signalBufferStart).toBe(-1)
            expect(service.worker).toBeNull()
        })

        it('should accept a worker', () => {
            const mockWorker = { postMessage: vi.fn(), terminate: vi.fn(), onerror: null } as any
            const service = new TestBiosignalService(mockRecording, mockWorker)
            expect(service.worker).toBe(mockWorker)
        })
    })

    describe('signalBufferStart', () => {
        it('should default to INDEX_NOT_ASSIGNED (-1)', () => {
            const service = new TestBiosignalService(mockRecording)
            expect(service.signalBufferStart).toBe(-1)
        })
    })

    describe('isReady', () => {
        it('should return false when worker not set up', () => {
            const service = new TestBiosignalService(mockRecording)
            expect(service.isReady).toBe(false)
        })
    })

    describe('handleMessage', () => {
        it('should return false for empty data', async () => {
            const service = new TestBiosignalService(mockRecording)
            const result = await service.handleMessage({ data: null } as any)
            expect(result).toBe(false)
        })

        it('should handle cache-signals action with range', async () => {
            const service = new TestBiosignalService(mockRecording)
            const result = await service.handleMessage({
                data: { action: 'cache-signals', range: [0, 50] },
            } as any)
            expect(result).toBe(true)
            expect(mockRecording.signalCacheStatus).toEqual([0, 50])
        })

        it('should handle cache-signals with events', async () => {
            const service = new TestBiosignalService(mockRecording)
            const events = [{ start: 1, duration: 1, label: 'Test' }]
            await service.handleMessage({
                data: { action: 'cache-signals', range: [0, 50], events },
            } as any)
            expect(mockRecording.addEventsFromTemplates).toHaveBeenCalledWith({ source: 'system' }, ...events)
        })

        it('should handle cache-signals with interruptions', async () => {
            const service = new TestBiosignalService(mockRecording)
            const interruptions = [{ start: 10, duration: 5 }]
            await service.handleMessage({
                data: { action: 'cache-signals', range: [0, 50], interruptions },
            } as any)
            expect(mockRecording.setInterruptions).toHaveBeenCalled()
        })

        it('should resolve a single-stage terminal request-signals response', async () => {
            const service = new TestBiosignalService(mockRecording)
            let resolved: any = null
            ;(service as any)._commissions.set(
                'request-signals',
                new Map([[5, { rn: 5, resolve: (value: any) => { resolved = value }, reject: vi.fn() }]])
            )
            const result = await service.handleMessage({
                data: {
                    action: 'request-signals', rn: 5, success: true,
                    status: 'ready', final: true, start: 0, end: 10, signals: [],
                },
            } as any)
            expect(result).toBe(true)
            expect(resolved.status).toBe('ready')
            expect(resolved.part.end).toBe(10)
        })

        it('should reconstruct a two-stage request-signals response through the ready promise', async () => {
            const service = new TestBiosignalService(mockRecording)
            let resolved: any = null
            ;(service as any)._commissions.set(
                'request-signals',
                new Map([[6, { rn: 6, resolve: (value: any) => { resolved = value }, reject: vi.fn() }]])
            )
            await service.handleMessage({
                data: { action: 'request-signals', rn: 6, success: true, status: 'pending', final: false },
            } as any)
            expect(resolved.status).toBe('pending')
            expect(resolved.ready).toBeInstanceOf(Promise)
            await service.handleMessage({
                data: {
                    action: 'request-signals', rn: 6, success: true,
                    status: 'ready', final: true, start: 5, end: 15, signals: [],
                },
            } as any)
            const terminal = await resolved.ready
            expect(terminal.status).toBe('ready')
            expect(terminal.part.start).toBe(5)
            expect((service as any)._pendingSignalRequests.size).toBe(0)
        })

        it('should settle a pending request-signals handle as superseded', async () => {
            const service = new TestBiosignalService(mockRecording)
            let resolved: any = null
            ;(service as any)._commissions.set(
                'request-signals',
                new Map([[7, { rn: 7, resolve: (value: any) => { resolved = value }, reject: vi.fn() }]])
            )
            await service.handleMessage({
                data: { action: 'request-signals', rn: 7, success: true, status: 'pending', final: false },
            } as any)
            await service.handleMessage({
                data: { action: 'request-signals', rn: 7, success: true, status: 'superseded', final: true },
            } as any)
            const terminal = await resolved.ready
            expect(terminal.status).toBe('superseded')
        })

        it('should map a request-signals worker failure to an error result', async () => {
            const service = new TestBiosignalService(mockRecording)
            let resolved: any = null
            ;(service as any)._commissions.set(
                'request-signals',
                new Map([[8, { rn: 8, resolve: (value: any) => { resolved = value }, reject: vi.fn() }]])
            )
            const result = await service.handleMessage({
                data: { action: 'request-signals', rn: 8, success: false, error: 'boom' },
            } as any)
            expect(result).toBe(true)
            expect(resolved.status).toBe('error')
            expect(resolved.reason).toBe('boom')
        })

        it('should ignore a cache-signals progress message without a range', async () => {
            // Regression: a worker progress message that lacks `range` (or
            // carries a non-array value) must not crash the spread into
            // `signalCacheStatus`. Previously this threw "undefined is not
            // iterable" and masked the underlying failure with a confusing
            // TypeError that left the UI stuck on "Loading data".
            const service = new TestBiosignalService(mockRecording)
            const prior = mockRecording.signalCacheStatus
            const result = await service.handleMessage({
                data: { action: 'cache-signals' },
            } as any)
            expect(result).toBe(false)
            // signalCacheStatus stays at whatever it was — no partial update.
            expect(mockRecording.signalCacheStatus).toBe(prior)
        })
    })

    describe('addActionWatcher', () => {
        it('should add an action watcher', () => {
            const service = new TestBiosignalService(mockRecording)
            const handler = vi.fn()
            service.addActionWatcher('test-action', handler)
            // Should not throw
        })

        it('should add action to existing watcher handler', () => {
            const service = new TestBiosignalService(mockRecording)
            const handler = vi.fn()
            service.addActionWatcher('action1', handler)
            service.addActionWatcher('action2', handler)
            // Same handler should have both actions
        })
    })

    describe('removeActionWatcher', () => {
        it('should remove an action watcher', () => {
            const service = new TestBiosignalService(mockRecording)
            const handler = vi.fn()
            service.addActionWatcher('test', handler)
            service.removeActionWatcher(handler)
        })
    })

    describe('removeAllActionWatchers', () => {
        it('should remove all action watchers', () => {
            const service = new TestBiosignalService(mockRecording)
            service.addActionWatcher('a', vi.fn())
            service.addActionWatcher('b', vi.fn())
            service.removeAllActionWatchers()
        })
    })

    describe('removeAllActionWatchersFor', () => {
        it('should remove watchers for specific caller', () => {
            const service = new TestBiosignalService(mockRecording)
            service.addActionWatcher('a', vi.fn(), 'caller1')
            service.addActionWatcher('b', vi.fn(), 'caller2')
            service.removeAllActionWatchersFor('caller1')
        })
    })

    describe('bufferRangeStart', () => {
        it('should return -1 when no memory range', () => {
            const service = new TestBiosignalService(mockRecording)
            expect(service.bufferRangeStart).toBe(-1)
        })
    })

    describe('memoryConsumption', () => {
        it('should return 0 when no memory range', () => {
            const service = new TestBiosignalService(mockRecording)
            expect(service.memoryConsumption).toBe(0)
        })
    })

    describe('requestMemory', () => {
        it('should return false when no manager', async () => {
            const service = new TestBiosignalService(mockRecording)
            const result = await service.requestMemory(1000)
            expect(result).toBe(false)
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('destroy', () => {
        it('should clean up service', async () => {
            const service = new TestBiosignalService(mockRecording)
            await service.destroy()
            expect(service.state).toBe('destroyed')
        })
    })
})
