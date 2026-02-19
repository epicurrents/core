/**
 * Unit tests for GenericBiosignalChannelMarker class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericBiosignalMarker from '../../src/assets/biosignal/components/GenericBiosignalChannelMarker'
import GenericAsset from '../../src/assets/GenericAsset'

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() }
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
}))

describe('GenericBiosignalMarker', () => {
    let mockEventBus: any
    let mockChannel: any
    let originalWindow: any

    beforeEach(() => {
        (GenericAsset as any).USED_IDS.clear()

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

        mockChannel = {
            signal: new Float32Array([0, 1, 2, 3, 4]),
            samplingRate: 256,
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
        it('should create a marker with name, channel, and label', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Marker 1')
            expect(marker.name).toBe('M1')
            expect(marker.channel).toBe(mockChannel)
            expect(marker.label).toBe('Marker 1')
            expect(marker.modality).toBe('marker')
            expect(marker.position).toBeNull()
            expect(marker.value).toBeNull()
        })

        it('should accept position and value', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Marker 1', 10, 2.5)
            expect(marker.position).toBe(10)
            expect(marker.value).toBe(2.5)
        })

        it('should call setPosition when only position is given', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Marker 1', 5)
            expect(marker.position).toBe(5)
        })
    })

    describe('property setters', () => {
        it('should set dragging', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Label')
            marker.dragging = true
            expect(marker.dragging).toBe(true)
        })

        it('should set label', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Old')
            marker.label = 'New'
            expect(marker.label).toBe('New')
        })

        it('should set position', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Label', 0, 0)
            marker.position = 42
            expect(marker.position).toBe(42)
        })

        it('should set value', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Label', 0, 0)
            marker.value = 3.14
            expect(marker.value).toBe(3.14)
        })
    })

    describe('setPosition', () => {
        it('should set position via method', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Label', 0, 0)
            marker.setPosition(100)
            expect(marker.position).toBe(100)
        })
    })

    describe('setValue', () => {
        it('should set value via method', () => {
            const marker = new GenericBiosignalMarker('M1', mockChannel, 'Label', 0, 0)
            marker.setValue(1.5)
            expect(marker.value).toBe(1.5)
        })
    })
})
