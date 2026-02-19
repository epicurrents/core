/**
 * Unit tests for BiosignalCache class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import BiosignalCache from '../../src/assets/biosignal/service/BiosignalCache'
import GenericAsset from '../../src/assets/GenericAsset'

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

jest.mock('../../src/events/EventBus')

jest.mock('../../src/util', () => ({
    combineSignalParts: jest.fn((target, source) => {
        if (target.end === source.start) {
            target.end = source.end
            for (let i = 0; i < source.signals.length; i++) {
                const combined = new Float32Array(target.signals[i].data.length + source.signals[i].data.length)
                combined.set(target.signals[i].data, 0)
                combined.set(source.signals[i].data, target.signals[i].data.length)
                target.signals[i].data = combined
            }
            return true
        }
        return false
    }),
    deepClone: jest.fn((obj) => {
        if (obj === null || obj === undefined) return obj
        try { return JSON.parse(JSON.stringify(obj)) } catch { return null }
    }),
    safeObjectFrom: jest.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

describe('BiosignalCache', () => {
    let mockEventBus: any
    let originalWindow: any

    beforeEach(() => {
        jest.clearAllMocks()
        ;(GenericAsset as any).USED_IDS.clear()

        mockEventBus = {
            addScopedEventListener: jest.fn(),
            dispatchScopedEvent: jest.fn().mockReturnValue(true),
            getEventHooks: jest.fn(),
            removeAllScopedEventListeners: jest.fn(),
            removeScopedEventListener: jest.fn(),
            removeScope: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
            unsubscribeAll: jest.fn(),
        }

        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: {
                __EPICURRENTS__: { APP: {}, EVENT_BUS: mockEventBus, RUNTIME: null }
            } as any,
            writable: true,
        })

        ;(EventBus as jest.MockedClass<typeof EventBus>).mockImplementation(() => mockEventBus as any)
    })

    afterEach(() => {
        global.window = originalWindow
    })

    describe('constructor', () => {
        it('should create a cache with data duration', () => {
            const cache = new BiosignalCache(100)
            expect(cache.outputRangeStart).toBe(0)
            expect(cache.outputRangeEnd).toBe(100)
        })

        it('should accept an input cache', () => {
            const inputCache = {
                outputRangeStart: 0,
                outputRangeEnd: 50,
                asCachePart: jest.fn().mockReturnValue({ signals: [] }),
            } as any
            const cache = new BiosignalCache(100, inputCache)
            expect(cache.outputRangeEnd).toBe(100)
        })
    })

    describe('inputRangeStart/End', () => {
        it('should return 0 when no input', async () => {
            const cache = new BiosignalCache(100)
            expect(await cache.inputRangeStart).toBe(0)
            expect(await cache.inputRangeEnd).toBe(0)
        })

        it('should delegate to input cache', async () => {
            const inputCache = {
                outputRangeStart: 10,
                outputRangeEnd: 50,
                asCachePart: jest.fn().mockReturnValue({ signals: [] }),
            } as any
            const cache = new BiosignalCache(100, inputCache)
            expect(await cache.inputRangeStart).toBe(10)
            expect(await cache.inputRangeEnd).toBe(50)
        })
    })

    describe('outputSignalSamplingRates', () => {
        it('should return sampling rates of cached signals', () => {
            const cache = new BiosignalCache(100)
            // Empty cache has no signals
            expect(cache.outputSignalSamplingRates).toEqual([])
        })
    })

    describe('asCachePart', () => {
        it('should return a copy of signal cache', () => {
            const cache = new BiosignalCache(100)
            const part = cache.asCachePart()
            expect(part.start).toBe(0)
            expect(part.end).toBe(0)
            expect(part.signals).toEqual([])
        })
    })

    describe('insertSignals', () => {
        it('should replace empty cache with first signal part', async () => {
            const cache = new BiosignalCache(100)
            const signalPart = {
                start: 0,
                end: 10,
                signals: [{ data: new Float32Array(256), samplingRate: 256 }],
            }
            await cache.insertSignals(signalPart)
            const part = cache.asCachePart()
            expect(part.start).toBe(0)
            expect(part.end).toBe(10)
            expect(part.signals.length).toBe(1)
        })

        it('should combine consecutive signal parts', async () => {
            const cache = new BiosignalCache(100)
            await cache.insertSignals({
                start: 0, end: 5,
                signals: [{ data: new Float32Array(128), samplingRate: 256 }],
            })
            await cache.insertSignals({
                start: 5, end: 10,
                signals: [{ data: new Float32Array(128), samplingRate: 256 }],
            })
            const part = cache.asCachePart()
            expect(part.end).toBe(10)
        })
    })

    describe('releaseBuffers', () => {
        it('should reset cache state', () => {
            const cache = new BiosignalCache(100)
            cache.releaseBuffers()
            expect(cache.outputRangeEnd).toBe(0)
            expect(cache.asCachePart().signals).toEqual([])
        })
    })

    describe('invalidateOutputSignals', () => {
        it('should release buffers', () => {
            const cache = new BiosignalCache(100)
            cache.invalidateOutputSignals()
            expect(cache.outputRangeEnd).toBe(0)
        })
    })

    describe('destroy', () => {
        it('should clean up cache', () => {
            const cache = new BiosignalCache(100)
            cache.destroy()
            expect(cache.state).toBe('destroyed')
        })
    })
})
