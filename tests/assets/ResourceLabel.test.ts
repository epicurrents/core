/**
 * Unit tests for ResourceLabel class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import ResourceLabel from '../../src/assets/annotation/ResourceLabel'
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
        try {
            return JSON.parse(JSON.stringify(obj))
        } catch {
            return null
        }
    }),
    safeObjectFrom: jest.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

describe('ResourceLabel', () => {
    let mockEventBus: any
    let mockApp: any
    let originalWindow: any

    beforeEach(() => {
        if (Log.debug) (Log.debug as jest.Mock).mockClear()
        if (Log.error) (Log.error as jest.Mock).mockClear()
        if (Log.warn) (Log.warn as jest.Mock).mockClear()

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

        ;(EventBus as jest.MockedClass<typeof EventBus>).mockImplementation(() => mockEventBus as any)
    })

    afterEach(() => {
        global.window = originalWindow
        jest.useRealTimers()
    })

    describe('constructor', () => {
        it('should create a label with name and value', () => {
            const label = new ResourceLabel('Test Label', 'test-value')
            expect(label.name).toBe('Test Label')
            expect(label.value).toBe('test-value')
            expect(label.type).toBe('label')
        })

        it('should accept null value', () => {
            const label = new ResourceLabel('Empty', null)
            expect(label.value).toBeNull()
        })

        it('should accept number value', () => {
            const label = new ResourceLabel('Count', 42)
            expect(label.value).toBe(42)
        })

        it('should accept boolean value', () => {
            const label = new ResourceLabel('Flag', true)
            expect(label.value).toBe(true)
        })

        it('should accept array value', () => {
            const label = new ResourceLabel('Tags', ['a', 'b', 'c'])
            expect(label.value).toEqual(['a', 'b', 'c'])
        })

        it('should accept optional annotation options', () => {
            const label = new ResourceLabel('Test', 'val', {
                annotator: 'user1',
                priority: 5,
                text: 'description',
            })
            expect(label.annotator).toBe('user1')
            expect(label.priority).toBe(5)
            expect(label.text).toBe('description')
        })
    })

    describe('class property', () => {
        it('should default to label', () => {
            const label = new ResourceLabel('Test', 'val')
            expect(label.class).toBe('label')
        })

        it('should set and get class', () => {
            const label = new ResourceLabel('Test', 'val')
            label.class = 'marker' as any
            expect(label.class).toBe('marker')
        })
    })

    describe('serialize', () => {
        it('should include class in serialized output', () => {
            const label = new ResourceLabel('Test', 'val')
            const serialized = label.serialize()
            expect(serialized).toHaveProperty('class', 'label')
            expect(serialized).toHaveProperty('name', 'Test')
        })

        it('should apply nullIfEmpty for class', () => {
            const label = new ResourceLabel('Test', 'val')
            label.class = '' as any
            const serialized = label.serialize({ nullIfEmpty: ['class'] })
            expect(serialized.class).toBeNull()
        })

        it('should not null non-empty class with nullIfEmpty', () => {
            const label = new ResourceLabel('Test', 'val')
            const serialized = label.serialize({ nullIfEmpty: ['class'] })
            expect(serialized.class).toBe('label')
        })
    })
})
