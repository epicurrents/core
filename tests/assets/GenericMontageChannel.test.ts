/**
 * Unit tests for GenericMontageChannel class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericMontageChannel from '../../src/assets/biosignal/components/GenericMontageChannel'
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

class TestMontageChannel extends GenericMontageChannel {
    constructor(
        montage: any, name: string, label: string, type: string,
        active: any, reference: any, averaged: boolean,
        samplingRate: number, unit: string, visible: boolean,
        extra: any = {},
    ) {
        super(montage, name, label, type, active, reference, averaged, samplingRate, unit, visible, extra)
    }
}

describe('GenericMontageChannel', () => {
    let mockEventBus: any
    let mockMontage: any
    let originalWindow: any

    beforeEach(() => {
        (Log.debug as jest.Mock).mockClear()
        ;(Log.warn as jest.Mock).mockClear()
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

        mockMontage = {
            hasCommonReference: true,
            channels: [],
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
        it('should create a montage channel', () => {
            const ch = new TestMontageChannel(
                mockMontage, 'Fp1-Fp2', 'Fp1-Fp2', 'eeg',
                0, [1, [1]],
                false, 256, 'µV', true,
            )
            expect(ch.name).toBe('Fp1-Fp2')
            expect(ch.active).toBe(0)
            expect(ch.reference).toEqual([1, [1]])
        })

        it('should save contralateral channel name from extra properties', () => {
            const ch = new TestMontageChannel(
                mockMontage, 'Fp1', 'Fp1', 'eeg',
                0, [],
                false, 256, 'µV', true,
                { contralateralChannel: 'Fp2' },
            )
            // Access contralateralChannel to trigger lookup
            mockMontage.channels = [{ name: 'Fp2' }]
            const contra = ch.contralateralChannel
            expect(contra).toEqual({ name: 'Fp2' })
        })
    })

    describe('active setter', () => {
        it('should set active', () => {
            const ch = new TestMontageChannel(
                mockMontage, 'Ch', 'Ch', 'eeg',
                0, [],
                false, 256, 'µV', true,
            )
            ch.active = 5
            expect(ch.active).toBe(5)
        })
    })

    describe('reference setter', () => {
        it('should set reference', () => {
            const ch = new TestMontageChannel(
                mockMontage, 'Ch', 'Ch', 'eeg',
                0, [],
                false, 256, 'µV', true,
            )
            const newRef = [2, [0.5, 0.5]] as (number | number[])[]
            ch.reference = newRef
            expect(ch.reference).toEqual(newRef)
        })
    })

    describe('contralateralChannel', () => {
        it('should return null for non-eeg modality', () => {
            const ch = new TestMontageChannel(
                mockMontage, 'EMG1', 'EMG1', 'emg',
                0, [],
                false, 256, 'µV', true,
            )
            expect(ch.contralateralChannel).toBeNull()
        })

        it('should return null for midline channels', () => {
            const ch = new TestMontageChannel(
                mockMontage, 'Cz', 'Cz', 'eeg',
                0, [],
                false, 256, 'µV', true,
                { laterality: 'z' },
            )
            expect(ch.contralateralChannel).toBeNull()
        })

        it('should find contralateral channel by exact name', () => {
            const contraChannel = { name: 'Fp2' }
            mockMontage.channels = [contraChannel]
            const ch = new TestMontageChannel(
                mockMontage, 'Fp1', 'Fp1', 'eeg',
                0, [],
                false, 256, 'µV', true,
                { contralateralChannel: 'Fp2' },
            )
            expect(ch.contralateralChannel).toBe(contraChannel)
        })

        it('should deduce contralateral name for standard EEG channels', () => {
            const contraChannel = { name: 'Fp2' }
            mockMontage.channels = [contraChannel]
            const ch = new TestMontageChannel(
                mockMontage, 'Fp1', 'Fp1', 'eeg',
                0, [],
                false, 256, 'µV', true,
            )
            expect(ch.contralateralChannel).toBe(contraChannel)
        })

        it('should warn for non-standard channel names', () => {
            const ch = new TestMontageChannel(
                mockMontage, 'Custom_Ch', 'Custom_Ch', 'eeg',
                0, [],
                false, 256, 'µV', true,
            )
            expect(ch.contralateralChannel).toBeNull()
            expect(Log.warn).toHaveBeenCalled()
        })

        it('should cache contralateral channel', () => {
            const contraChannel = { name: 'Fp2' }
            mockMontage.channels = [contraChannel]
            const ch = new TestMontageChannel(
                mockMontage, 'Fp1', 'Fp1', 'eeg',
                0, [],
                false, 256, 'µV', true,
                { contralateralChannel: 'Fp2' },
            )
            const first = ch.contralateralChannel
            const second = ch.contralateralChannel
            expect(first).toBe(second)
        })
    })
})
