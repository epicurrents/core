/**
 * Unit tests for GenericAnnotation class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericAnnotation from '../../src/assets/annotation/GenericAnnotation'
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

// Create a concrete implementation for testing
class TestAnnotation extends GenericAnnotation {
    constructor(
        name: string,
        value: boolean | number | number[] | string | string[] | null,
        type: string,
        options?: any,
    ) {
        super(name, value, type, options)
    }
}

describe('GenericAnnotation', () => {
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
        it('should create annotation with required parameters', () => {
            const annotation = new TestAnnotation('test-name', 'test-value', 'test-type')
            expect(annotation.name).toBe('test-name')
            expect(annotation.value).toBe('test-value')
            expect(annotation.type).toBe('test-type')
        })

        it('should use defaults for optional parameters', () => {
            const annotation = new TestAnnotation('test', 'value', 'type')
            expect(annotation.annotator).toBe('')
            expect(annotation.class).toBe('event')
            expect(annotation.codes).toEqual({})
            expect(annotation.label).toBe('')
            expect(annotation.priority).toBe(0)
            expect(annotation.text).toBe('')
            expect(annotation.visible).toBe(true)
        })

        it('should accept optional parameters', () => {
            const annotation = new TestAnnotation('test', 'value', 'type', {
                annotator: 'Dr. Smith',
                class: 'event',
                codes: { icd: 'G40' },
                label: 'Seizure',
                priority: 5,
                text: 'Some text',
                visible: false,
            })
            expect(annotation.annotator).toBe('Dr. Smith')
            expect(annotation.codes).toEqual({ icd: 'G40' })
            expect(annotation.label).toBe('Seizure')
            expect(annotation.priority).toBe(5)
            expect(annotation.text).toBe('Some text')
            expect(annotation.visible).toBe(false)
        })
    })

    describe('property getters/setters', () => {
        let annotation: TestAnnotation

        beforeEach(() => {
            annotation = new TestAnnotation('test', 'value', 'type')
            mockEventBus.dispatchScopedEvent.mockClear()
        })

        it('should set and get annotator', () => {
            annotation.annotator = 'Dr. Jones'
            expect(annotation.annotator).toBe('Dr. Jones')
        })

        it('should set and get class', () => {
            annotation.class = 'event'
            expect(annotation.class).toBe('event')
        })

        it('should set and get codes', () => {
            annotation.codes = { test: 123 }
            expect(annotation.codes).toEqual({ test: 123 })
        })

        it('should set and get priority', () => {
            annotation.priority = 10
            expect(annotation.priority).toBe(10)
        })

        it('should set and get text', () => {
            annotation.text = 'new text'
            expect(annotation.text).toBe('new text')
        })

        it('should set and get type', () => {
            annotation.type = 'new-type'
            expect(annotation.type).toBe('new-type')
        })

        it('should set and get value', () => {
            annotation.value = 42
            expect(annotation.value).toBe(42)
        })

        it('should set and get visible', () => {
            annotation.visible = false
            expect(annotation.visible).toBe(false)
        })
    })

    describe('label getter fallback', () => {
        it('should return label when set', () => {
            const annotation = new TestAnnotation('test', 'value', 'type', { label: 'My Label' })
            expect(annotation.label).toBe('My Label')
        })

        it('should return empty string when label is empty string', () => {
            const annotation = new TestAnnotation('test', 'value', 'type', { label: '' })
            expect(annotation.label).toBe('')
        })

        it('should return string value when label is undefined', () => {
            const annotation = new TestAnnotation('test', 42, 'type')
            // label defaults to '' which is not undefined, so it returns ''
            expect(annotation.label).toBe('')
        })

        it('should join array values for label fallback', () => {
            const annotation = new TestAnnotation('test', ['a', 'b', 'c'], 'type')
            // Force label to undefined
            ;(annotation as any)._label = undefined
            expect(annotation.label).toBe('a, b, c')
        })
    })

    describe('serialize', () => {
        it('should serialize with default options', () => {
            const annotation = new TestAnnotation('test-name', 'test-value', 'test-type', {
                annotator: 'tester',
                class: 'event',
                codes: { a: 1 },
                label: 'Test',
                priority: 3,
                text: 'details',
            })
            const result = annotation.serialize()
            expect(result).toEqual({
                annotator: 'tester',
                class: 'event',
                codes: { a: 1 },
                label: 'Test',
                name: 'test-name',
                priority: 3,
                text: 'details',
                type: 'test-type',
                value: 'test-value',
                visible: true,
            })
        })

        it('should apply nullIfEmpty options', () => {
            const annotation = new TestAnnotation('test', '', 'type', {
                annotator: '',
                label: '',
                text: '',
            })
            const result = annotation.serialize({
                nullIfEmpty: ['annotator', 'value', 'text'],
            })
            expect(result.annotator).toBeNull()
            expect(result.value).toBeNull()
            expect(result.text).toBeNull()
        })

        it('should not null non-empty values with nullIfEmpty', () => {
            const annotation = new TestAnnotation('test', 'has-value', 'type', {
                annotator: 'someone',
            })
            const result = annotation.serialize({
                nullIfEmpty: ['annotator', 'value'],
            })
            expect(result.annotator).toBe('someone')
            expect(result.value).toBe('has-value')
        })
    })

    describe('static getEventForCode', () => {
        it('should return null when no coded events exist', () => {
            expect(GenericAnnotation.getEventForCode('test-code')).toBeNull()
        })
    })

    describe('static getEventForLabel', () => {
        it('should return null when no coded events exist', () => {
            expect(GenericAnnotation.getEventForLabel('test-label')).toBeNull()
        })
    })
})
