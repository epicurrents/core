/**
 * Unit tests for GenericBiosignalChannel class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericBiosignalChannel from '../../src/assets/biosignal/components/GenericBiosignalChannel'
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
}))

// Concrete subclass for testing
class TestChannel extends GenericBiosignalChannel {
    constructor(
        name: string, label: string, modality: string,
        averaged: boolean, samplingRate: number, unit: string,
        visible: boolean, extra: any = {},
    ) {
        super(name, label, modality, averaged, samplingRate, unit, visible, extra)
    }
}

describe('GenericBiosignalChannel', () => {
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
        jest.useRealTimers()
    })

    describe('constructor', () => {
        it('should create a channel with basic properties', () => {
            const ch = new TestChannel('EEG Fp1', 'Fp1', 'eeg', false, 256, 'µV', true)
            expect(ch.name).toBe('EEG Fp1')
            expect(ch.label).toBe('Fp1')
            expect(ch.modality).toBe('eeg')
            expect(ch.averaged).toBe(false)
            expect(ch.samplingRate).toBe(256)
            expect(ch.unit).toBe('µV')
            expect(ch.visible).toBe(true)
        })

        it('should default scale to 0', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            expect(ch.scale).toBe(0)
        })

        it('should default sensitivity to 0', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            expect(ch.sensitivity).toBe(0)
        })

        it('should set offset from number', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true, {
                offset: 0.3,
            })
            expect(ch.offset.baseline).toBe(0.3)
            expect(ch.offset.bottom).toBe(0)
            expect(ch.offset.top).toBe(1)
        })

        it('should set offset from object', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true, {
                offset: { baseline: 0.5, bottom: 0.1, top: 0.9 },
            })
            expect(ch.offset.baseline).toBe(0.5)
            expect(ch.offset.bottom).toBe(0.1)
            expect(ch.offset.top).toBe(0.9)
        })

        it('should set extra properties', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true, {
                laterality: 'left',
                scale: 2,
                sensitivity: 10,
                displayPolarity: -1,
                sampleCount: 1000,
            })
            expect(ch.laterality).toBe('left')
            expect(ch.scale).toBe(2)
            expect(ch.sensitivity).toBe(10)
            expect(ch.displayPolarity).toBe(-1)
            expect(ch.sampleCount).toBe(1000)
        })

        it('should set filter properties', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true, {
                highpassFilter: 0.5,
                lowpassFilter: 70,
                notchFilter: 50,
            })
            expect(ch.highpassFilter).toBe(0.5)
            expect(ch.lowpassFilter).toBe(70)
            expect(ch.notchFilter).toBe(50)
        })

        it('should default to empty signal', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            expect(ch.signal).toBeInstanceOf(Float32Array)
            expect(ch.signal.length).toBe(0)
        })
    })

    describe('property setters', () => {
        it('should set averaged', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.averaged = true
            expect(ch.averaged).toBe(true)
        })

        it('should set label', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.label = 'Fp2'
            expect(ch.label).toBe('Fp2')
        })

        it('should set visible', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.visible = false
            expect(ch.visible).toBe(false)
        })

        it('should set unit', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.unit = 'mV'
            expect(ch.unit).toBe('mV')
        })

        it('should set scale', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.scale = 1.5
            expect(ch.scale).toBe(1.5)
        })

        it('should reject negative sampling rate', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.samplingRate = -1
            expect(ch.samplingRate).toBe(256)
            expect(Log.error).toHaveBeenCalled()
        })

        it('should reject negative sample count', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.sampleCount = -5
            expect(ch.sampleCount).toBe(0)
            expect(Log.error).toHaveBeenCalled()
        })

        it('should reject negative sensitivity', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.sensitivity = -1
            expect(ch.sensitivity).toBe(0)
            expect(Log.error).toHaveBeenCalled()
        })

        it('should reject negative filter values', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.filters = { highpass: -1, lowpass: null, notch: null, bandreject: [] }
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setSignal', () => {
        it('should set signal and update sample count', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            const signal = new Float32Array([1, 2, 3, 4, 5])
            ch.setSignal(signal)
            expect(ch.signal).toBe(signal)
            expect(ch.sampleCount).toBe(5)
        })
    })

    describe('filter setters', () => {
        it('should set highpass filter', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.setHighpassFilter(0.5)
            expect(ch.highpassFilter).toBe(0.5)
        })

        it('should reject negative highpass filter', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.setHighpassFilter(-1)
            expect(Log.error).toHaveBeenCalled()
        })

        it('should set lowpass filter', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.setLowpassFilter(70)
            expect(ch.lowpassFilter).toBe(70)
        })

        it('should set notch filter', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.setNotchFilter(50)
            expect(ch.notchFilter).toBe(50)
        })
    })

    describe('markers', () => {
        it('should add markers and activate first two', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            const m1 = { isActive: false } as any
            const m2 = { isActive: false } as any
            const m3 = { isActive: false } as any
            ch.addMarkers(m1, m2, m3)
            expect(ch.markers).toHaveLength(3)
            expect(m1.isActive).toBe(true)
            expect(m2.isActive).toBe(true)
            expect(m3.isActive).toBe(false)
        })
    })

    describe('trigger points', () => {
        it('should add trigger points in sorted order', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.addTriggerPoints(5, 2, 8, 1)
            expect(ch.triggerPoints).toEqual([1, 2, 5, 8])
        })

        it('should not add duplicate trigger points', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.addTriggerPoints(3, 3, 5, 5)
            expect(ch.triggerPoints).toEqual([3, 5])
        })

        it('should clear trigger points', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.addTriggerPoints(1, 2, 3)
            ch.clearTriggerPoints()
            expect(ch.triggerPoints).toEqual([])
        })

        it('should find trigger points in signal', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            const signal = new Float32Array([0, 1, 2, 3, 2, 1, 0])
            ch.setSignal(signal)
            const points = ch.findTriggerPoints(2)
            expect(points).toContain(2)
        })

        it('should return empty for window when no trigger points', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            expect(ch.getTriggerPointsForWindow(1000)).toEqual([])
        })

        it('should cache window trigger points', () => {
            const ch = new TestChannel('Ch', 'Ch', 'eeg', false, 256, 'µV', true)
            ch.addTriggerPoints(10, 500, 1000)
            const result1 = ch.getTriggerPointsForWindow(2000)
            const result2 = ch.getTriggerPointsForWindow(2000)
            expect(result1).toEqual(result2)
        })
    })
})
