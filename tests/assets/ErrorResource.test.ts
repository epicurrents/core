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
vi.mock('scoped-event-log', () => ({
    Log: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }
}))

vi.mock('../../src/events/EventBus')

vi.mock('../../src/util', () => ({
    deepClone: vi.fn((obj) => {
        if (obj === null || obj === undefined) return obj
        try {
            return JSON.parse(JSON.stringify(obj))
        } catch {
            return null
        }
    }),
    safeObjectFrom: vi.fn((obj) => {
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
        if (Log.debug) (Log.debug as ReturnType<typeof vi.fn>).mockClear()
        if (Log.error) (Log.error as ReturnType<typeof vi.fn>).mockClear()
        if (Log.warn) (Log.warn as ReturnType<typeof vi.fn>).mockClear()

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

        ;(EventBus as MockedClass<typeof EventBus>).mockImplementation(function() { return mockEventBus as any })
    })

    afterEach(() => {
        global.window = originalWindow
        vi.useRealTimers()
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
            const mockRuntime = { removeResource: vi.fn() }
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
