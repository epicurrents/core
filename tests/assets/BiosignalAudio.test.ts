/**
 * Unit tests for BiosignalAudio class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import BiosignalAudio from '../../src/assets/media/BiosignalAudio'
import GenericAsset from '../../src/assets/GenericAsset'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() }
}))

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

describe('BiosignalAudio', () => {
    let mockEventBus: any
    let originalWindow: any

    beforeEach(() => {
        (Log.debug as ReturnType<typeof vi.fn>).mockClear()
        ;(Log.warn as ReturnType<typeof vi.fn>).mockClear()
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

        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: {
                __EPICURRENTS__: { APP: {}, EVENT_BUS: mockEventBus, RUNTIME: null }
            } as any,
            writable: true,
        })

        ;(EventBus as MockedClass<typeof EventBus>).mockImplementation(function() { return mockEventBus as any })
    })

    afterEach(() => {
        global.window = originalWindow
    })

    describe('constructor', () => {
        it('should create an audio asset with name', () => {
            const audio = new BiosignalAudio('Test Audio')
            expect(audio.name).toBe('Test Audio')
            expect(audio.modality).toBe('audio')
            expect(audio.duration).toBe(0)
            expect(audio.sampleCount).toBe(0)
            expect(audio.samplingRate).toBe(0)
            expect(audio.signals).toEqual([])
        })

        it('should set default sampleMaxAbsValue', () => {
            const audio = new BiosignalAudio('Test')
            expect(audio.sampleMaxAbsValue).toBe(32768)
        })

        it('should accept custom sampleMaxAbsValue', () => {
            const audio = new BiosignalAudio('Test', undefined, 1000)
            expect(audio.sampleMaxAbsValue).toBe(1000)
        })
    })

    describe('currentTime', () => {
        it('should return 0 when not started', () => {
            const audio = new BiosignalAudio('Test')
            expect(audio.currentTime).toBe(0)
        })
    })

    describe('hasStarted', () => {
        it('should be false initially', () => {
            const audio = new BiosignalAudio('Test')
            expect(audio.hasStarted).toBe(false)
        })
    })

    describe('isPlaying', () => {
        it('should be false initially', () => {
            const audio = new BiosignalAudio('Test')
            expect(audio.isPlaying).toBe(false)
        })
    })

    describe('buffer', () => {
        it('should return null when no buffer loaded', () => {
            const audio = new BiosignalAudio('Test')
            expect(audio.buffer).toBeNull()
        })
    })

    describe('setBuffer', () => {
        it('should load a buffer and mirror its duration, sample count and sampling rate', () => {
            const audio = new BiosignalAudio('Test')
            const buffer = { length: 8, sampleRate: 4, duration: 2 } as unknown as AudioBuffer
            audio.setBuffer(buffer)
            expect(audio.buffer).toBe(buffer)
            expect(audio.sampleCount).toBe(8)
            expect(audio.samplingRate).toBe(4)
            expect(audio.duration).toBe(2)
        })
    })

    describe('playbackRate', () => {
        it('should return null when no source', () => {
            const audio = new BiosignalAudio('Test')
            expect(audio.playbackRate).toBeNull()
        })
    })

    describe('sampleMaxAbsValue setter', () => {
        it('should set the value', () => {
            const audio = new BiosignalAudio('Test')
            audio.sampleMaxAbsValue = 5000
            expect(audio.sampleMaxAbsValue).toBe(5000)
        })
    })

    describe('callbacks', () => {
        it('should add and remove play ended callback', () => {
            const audio = new BiosignalAudio('Test')
            const cb = vi.fn()
            audio.addPlayEndedCallback(cb)
            // Adding duplicate should not add again
            audio.addPlayEndedCallback(cb)
            audio.removePlayEndedCallback(cb)
        })

        it('should add and remove play started callback', () => {
            const audio = new BiosignalAudio('Test')
            const cb = vi.fn()
            audio.addPlayStartedCallback(cb)
            audio.addPlayStartedCallback(cb)
            audio.removePlayStartedCallback(cb)
        })

        it('should handle removing non-existent callback', () => {
            const audio = new BiosignalAudio('Test')
            const cb = vi.fn()
            // Should not throw
            audio.removePlayEndedCallback(cb)
            audio.removePlayStartedCallback(cb)
        })
    })

    describe('setGain', () => {
        it('should do nothing when no volume node', () => {
            const audio = new BiosignalAudio('Test')
            // Should not throw
            audio.setGain(0.5)
        })
    })

    describe('pause', () => {
        it('should do nothing when no audio context', () => {
            const audio = new BiosignalAudio('Test')
            // Should not throw
            audio.pause()
        })
    })

    describe('stop', () => {
        it('should do nothing when no source', () => {
            const audio = new BiosignalAudio('Test')
            audio.stop()
        })

        it('should warn when stop called without start', () => {
            const audio = new BiosignalAudio('Test')
            // Set _source but not _hasStarted
            ;(audio as any)._source = { stop: vi.fn() }
            audio.stop()
            expect(Log.warn).toHaveBeenCalled()
        })
    })

    describe('destroy', () => {
        it('should clean up all audio resources', () => {
            const audio = new BiosignalAudio('Test')
            audio.destroy()
            expect(audio.duration).toBe(0)
            expect(audio.signals).toEqual([])
            expect(audio.state).toBe('destroyed')
        })
    })
})
