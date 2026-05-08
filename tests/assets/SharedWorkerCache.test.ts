/**
 * Unit tests for SharedWorkerCache class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import SharedWorkerCache from '../../src/assets/biosignal/service/SharedWorkerCache'
import GenericAsset from '../../src/assets/GenericAsset'

vi.mock('scoped-event-log', () => ({
    Log: {
        add: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        registerWorker: vi.fn(),
        LEVELS: {},
    }
}))

vi.mock('../../src/events/EventBus')

vi.mock('../../src/util', () => ({
    combineSignalParts: vi.fn((target, source) => {
        if (target.end === source.start) {
            target.end = source.end
            return true
        }
        return false
    }),
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

describe('SharedWorkerCache', () => {
    let mockEventBus: any
    let mockPort: any
    let mockPost: any
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

        mockPort = {
            addEventListener: vi.fn(),
            postMessage: vi.fn(),
            removeEventListener: vi.fn(),
            start: vi.fn(),
        }

        mockPost = vi.fn()

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
        it('should create a shared worker cache', () => {
            const cache = new SharedWorkerCache(mockPort, mockPost)
            expect(cache).toBeDefined()
            expect(cache.outputRangeStart).toBe(0)
            expect(cache.outputRangeEnd).toBe(0)
            expect(mockPort.addEventListener).toHaveBeenCalledWith('message', expect.any(Function))
        })
    })

    describe('output getters', () => {
        it('should return default signal properties', () => {
            const cache = new SharedWorkerCache(mockPort, mockPost)
            expect(cache.outputSignalSamplingRates).toEqual([])
            expect(cache.outputSignalUpdatedRanges).toEqual([])
        })
    })

    describe('asCachePart', () => {
        it('should return internal signal cache', () => {
            const cache = new SharedWorkerCache(mockPort, mockPost)
            const part = cache.asCachePart()
            expect(part.start).toBe(0)
            expect(part.end).toBe(0)
            expect(part.signals).toEqual([])
        })
    })

    describe('insertSignals', () => {
        it('should replace empty cache with first signal part', async () => {
            const cache = new SharedWorkerCache(mockPort, mockPost)
            const signalPart = {
                start: 0, end: 10,
                signals: [{ data: new Float32Array(256), samplingRate: 256 }],
            }
            await cache.insertSignals(signalPart)
            expect(cache.asCachePart().end).toBe(10)
        })
    })

    describe('releaseBuffers', () => {
        it('should reset cache', () => {
            const cache = new SharedWorkerCache(mockPort, mockPost)
            cache.releaseBuffers()
            expect(cache.asCachePart().start).toBe(0)
            expect(cache.asCachePart().end).toBe(0)
        })
    })

    describe('invalidateOutputSignals', () => {
        it('should call releaseBuffers', () => {
            const cache = new SharedWorkerCache(mockPort, mockPost)
            cache.invalidateOutputSignals()
            expect(cache.asCachePart().signals).toEqual([])
        })
    })

    describe('handleWorkerMessage', () => {
        it('should ignore messages not addressed to this cache', () => {
            const cache = new SharedWorkerCache(mockPort, mockPost)
            cache.handleWorkerMessage({ data: { caller: 'other-id', action: 'get-range-end' } } as any)
            // Should not throw
        })
    })

    describe('destroy', () => {
        it('should clean up', async () => {
            const cache = new SharedWorkerCache(mockPort, mockPost)
            await cache.destroy()
            expect(cache.state).toBe('destroyed')
        })
    })
})
