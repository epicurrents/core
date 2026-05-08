/**
 * Unit tests for GenericSourceChannel class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericSourceChannel from '../../src/assets/biosignal/components/GenericSourceChannel'
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

class TestSourceChannel extends GenericSourceChannel {
    constructor(
        name: string, label: string, modality: string, index: number,
        averaged: boolean, samplingRate: number, unit: string, visible: boolean,
        extra: any = {},
    ) {
        super(name, label, modality, index, averaged, samplingRate, unit, visible, extra)
    }
}

describe('GenericSourceChannel', () => {
    let mockEventBus: any
    let originalWindow: any

    beforeEach(() => {
        (Log.debug as ReturnType<typeof vi.fn>).mockClear()
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
        it('should create a source channel with index', () => {
            const ch = new TestSourceChannel('Fp1', 'Fp1', 'eeg', 0, false, 256, 'µV', true)
            expect(ch.index).toBe(0)
            expect(ch.name).toBe('Fp1')
            expect(ch.label).toBe('Fp1')
            expect(ch.samplingRate).toBe(256)
        })
    })

    describe('index setter', () => {
        it('should set index', () => {
            const ch = new TestSourceChannel('Fp1', 'Fp1', 'eeg', 0, false, 256, 'µV', true)
            ch.index = 5
            expect(ch.index).toBe(5)
        })
    })
})
