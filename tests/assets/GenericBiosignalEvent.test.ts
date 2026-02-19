/**
 * Unit tests for GenericBiosignalEvent class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericBiosignalEvent from '../../src/assets/biosignal/components/GenericBiosignalEvent'
import GenericAsset from '../../src/assets/GenericAsset'

// Mock dependencies
jest.mock('scoped-event-log', () => ({
    Log: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }
}))

jest.mock('../../src/events/EventBus')

jest.mock('../../src/util', () => ({
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
    settingsColorToRgba: jest.fn((color) => {
        if (typeof color === 'string') return color
        if (Array.isArray(color)) return `rgba(${color.join(',')})`
        return ''
    }),
}))

// Concrete subclass for testing
class TestBiosignalEvent extends GenericBiosignalEvent {
    constructor(
        name: string, start: number, duration: number, label: string,
        options: any = {},
    ) {
        super(name, start, duration, label, options)
    }
}

describe('GenericBiosignalEvent', () => {
    let mockEventBus: any
    let originalWindow: any

    beforeEach(() => {
        (Log.debug as jest.Mock).mockClear()
        ;(Log.error as jest.Mock).mockClear()
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
                __EPICURRENTS__: {
                    APP: {},
                    EVENT_BUS: mockEventBus,
                    RUNTIME: null,
                }
            } as any,
            writable: true,
        })

        ;(EventBus as jest.MockedClass<typeof EventBus>).mockImplementation(() => mockEventBus as any)
    })

    afterEach(() => {
        global.window = originalWindow
    })

    describe('constructor', () => {
        it('should create an event with required properties', () => {
            const event = new TestBiosignalEvent('Spike', 10.5, 0.2, 'spike')
            expect(event.name).toBe('Spike')
            expect(event.start).toBe(10.5)
            expect(event.duration).toBe(0.2)
            expect(event.label).toBe('spike')
            expect(event.class).toBe('event')
        })

        it('should default background to false', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            expect(event.background).toBe(false)
        })

        it('should default channels to empty array', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            expect(event.channels).toEqual([])
        })

        it('should accept optional properties', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test', {
                background: true,
                channels: [0, 1, 'EEG'],
                color: [255, 0, 0, 1],
                opacity: 0.5,
            })
            expect(event.background).toBe(true)
            expect(event.channels).toEqual([0, 1, 'EEG'])
            expect(event.color).toEqual([255, 0, 0, 1])
            expect(event.opacity).toBe(0.5)
        })
    })

    describe('property setters', () => {
        it('should set background', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            event.background = true
            expect(event.background).toBe(true)
        })

        it('should set channels', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            event.channels = [0, 2, 4]
            expect(event.channels).toEqual([0, 2, 4])
        })

        it('should set class', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            event.class = 'marker' as any
            expect(event.class).toBe('marker')
        })

        it('should set duration', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            event.duration = 2.5
            expect(event.duration).toBe(2.5)
        })

        it('should set start', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            event.start = 5.0
            expect(event.start).toBe(5.0)
        })

        it('should set color and dispatch appearance-changed', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test', {
                color: [255, 0, 0, 1] as [number, number, number, number],
            })
            event.color = [0, 255, 0, 1]
            expect(event.color).toEqual([0, 255, 0, 1])
            expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalled()
        })

        it('should set opacity and dispatch appearance-changed', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test', {
                opacity: 0.5,
            })
            event.opacity = 0.8
            expect(event.opacity).toBe(0.8)
            expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalled()
        })

        it('should not set color when initially undefined', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            event.color = [0, 255, 0, 1]
            // _setPropertyValue rejects setting undefined properties
            expect(event.color).toBeUndefined()
        })
    })

    describe('serialize', () => {
        it('should serialize all event properties', () => {
            const event = new TestBiosignalEvent('Spike', 10, 0.5, 'spike', {
                background: true,
                channels: [0, 1],
                color: 'red',
                opacity: 0.7,
            })
            const serialized = event.serialize()
            expect(serialized.background).toBe(true)
            expect(serialized.channels).toEqual([0, 1])
            expect(serialized.duration).toBe(0.5)
            expect(serialized.start).toBe(10)
            expect(serialized.opacity).toBe(0.7)
        })

        it('should use nullIfEmpty for channels', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            const serialized = event.serialize({ nullIfEmpty: ['channels'] })
            expect(serialized.channels).toBeNull()
        })

        it('should return empty array for channels without nullIfEmpty', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            const serialized = event.serialize()
            expect(serialized.channels).toEqual([])
        })

        it('should use nullIfEmpty for color', () => {
            const event = new TestBiosignalEvent('Test', 0, 1, 'test')
            const serialized = event.serialize({ nullIfEmpty: ['color'] })
            expect(serialized.color).toBeNull()
        })
    })
})
