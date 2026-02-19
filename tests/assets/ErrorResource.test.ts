/**
 * Unit tests for ErrorResource class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import ErrorResource from '../../src/assets/error/ErrorResource'
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

describe('ErrorResource', () => {
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
        it('should set state to error', () => {
            const error = new ErrorResource('Failed Resource', 'test')
            expect(error.state).toBe('error')
        })

        it('should have default reason', () => {
            const error = new ErrorResource('Failed Resource', 'test')
            expect(error.reason).toBe('Unknown error')
        })
    })

    describe('reason', () => {
        it('should get and set reason', () => {
            const error = new ErrorResource('Failed', 'test')
            error.reason = 'File not found'
            expect(error.reason).toBe('File not found')
        })
    })

    describe('getMainProperties', () => {
        it('should include error title in properties', () => {
            const error = new ErrorResource('Failed', 'test')
            error.reason = 'Network timeout'
            const props = error.getMainProperties()
            expect(props.has('error')).toBe(true)
            expect(props.get('error')).toEqual({ title: 'Network timeout' })
        })
    })

    describe('removeResource', () => {
        it('should call runtime removeResource when available', () => {
            const mockRuntime = { removeResource: jest.fn() }
            ;(global.window as any).__EPICURRENTS__.RUNTIME = mockRuntime

            const error = new ErrorResource('Failed', 'test')
            error.removeResource()

            expect(mockRuntime.removeResource).toHaveBeenCalledWith(error)
        })

        it('should not throw when runtime is not available', () => {
            ;(global.window as any).__EPICURRENTS__.RUNTIME = null

            const error = new ErrorResource('Failed', 'test')
            expect(() => error.removeResource()).not.toThrow()
        })
    })
})
