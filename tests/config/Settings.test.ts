/**
 * Unit tests for Settings.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'

// Mock dependencies
jest.mock('scoped-event-log', () => ({
    Log: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }
}))

// We need to import SETTINGS after mocking
import SETTINGS from '../../src/config/Settings'

describe('Settings', () => {
    beforeEach(() => {
        if (Log.debug) (Log.debug as jest.Mock).mockClear()
        if (Log.error) (Log.error as jest.Mock).mockClear()
        if (Log.warn) (Log.warn as jest.Mock).mockClear()
        // Unregister any test modules
        SETTINGS.unregisterModule('test-module')
        // Remove all property update handlers
        SETTINGS.removeAllPropertyUpdateHandlers()
    })

    describe('getFieldValue', () => {
        it('should traverse dot-notation path', () => {
            const value = SETTINGS.getFieldValue('app.dataChunkSize')
            expect(typeof value).toBe('number')
            expect(value).toBeGreaterThan(0)
        })

        it('should return undefined for invalid field', () => {
            const value = SETTINGS.getFieldValue('app.nonExistentField')
            expect(value).toBeUndefined()
            expect(Log.warn).toHaveBeenCalled()
        })

        it('should look up module field values', () => {
            SETTINGS.registerModule('test-module', { testProp: 42 } as any)
            const value = SETTINGS.getFieldValue('test-module.testProp')
            expect(value).toBe(42)
        })
    })

    describe('setFieldValue', () => {
        it('should set a valid field value', () => {
            const original = SETTINGS.getFieldValue('app.useMemoryManager')
            const result = SETTINGS.setFieldValue('app.useMemoryManager', !original)
            expect(result).toBe(true)
            expect(SETTINGS.getFieldValue('app.useMemoryManager')).toBe(!original)
            // Restore
            SETTINGS.setFieldValue('app.useMemoryManager', original)
        })

        it('should reject type mismatch', () => {
            const result = SETTINGS.setFieldValue('app.useMemoryManager', 'not-a-boolean')
            expect(result).toBe(false)
        })

        it('should reject __proto__ fields', () => {
            const result = SETTINGS.setFieldValue('__proto__.polluted', true)
            expect(result).toBe(false)
            expect(Log.warn).toHaveBeenCalledWith(
                expect.stringContaining('__proto__'),
                'Settings'
            )
        })

        it('should parse color strings', () => {
            // Register a module with a color field to test parsing
            SETTINGS.registerModule('test-module', { color: [1, 0, 0, 1] } as any)
            // Setting a hex color string should attempt conversion
            const result = SETTINGS.setFieldValue('test-module.color', 'rgba(255,0,0,1)')
            // The rgba parser should convert this to [1, 0, 0, 1]
            // The type check should pass since both are arrays
            expect(result).toBe(true)
        })

        it('should return false for non-existent field on existing parent', () => {
            const result = SETTINGS.setFieldValue('app.nonExistentField', 'value')
            expect(result).toBe(false)
            expect(Log.warn).toHaveBeenCalled()
        })
    })

    describe('addPropertyUpdateHandler', () => {
        it('should register a handler', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('app.dataChunkSize'),
                'Settings'
            )
        })

        it('should reject invalid field', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('', handler)
            expect(Log.error).toHaveBeenCalledWith(
                expect.stringContaining('Invalid field'),
                'Settings'
            )
        })

        it('should deduplicate same handler for same field', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            ;(Log.debug as jest.Mock).mockClear()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('already existed'),
                'Settings'
            )
        })

        it('should detect parent field handler', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app', handler, 'test')
            ;(Log.debug as jest.Mock).mockClear()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('parent'),
                'Settings'
            )
        })

        it('should replace child field handler with parent', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            ;(Log.debug as jest.Mock).mockClear()
            SETTINGS.addPropertyUpdateHandler('app', handler, 'test')
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('child'),
                'Settings'
            )
        })
    })

    describe('removePropertyUpdateHandler', () => {
        it('should remove a registered handler', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            ;(Log.debug as jest.Mock).mockClear()
            SETTINGS.removePropertyUpdateHandler('app.dataChunkSize', handler)
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('Removed'),
                'Settings'
            )
        })

        it('should handle removing non-existent handler', () => {
            const handler = jest.fn()
            SETTINGS.removePropertyUpdateHandler('app.dataChunkSize', handler)
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('Could not locate'),
                'Settings'
            )
        })
    })

    describe('onPropertyUpdate', () => {
        it('should trigger matching handlers', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            SETTINGS.onPropertyUpdate('app.dataChunkSize', 100, 200)
            expect(handler).toHaveBeenCalledWith(100, 200)
        })

        it('should trigger parent handlers for child field updates', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app', handler, 'test')
            SETTINGS.onPropertyUpdate('app.dataChunkSize', 100, 200)
            expect(handler).toHaveBeenCalledWith(100, 200)
        })

        it('should not trigger unrelated handlers', () => {
            const handler = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            SETTINGS.onPropertyUpdate('app.useMemoryManager', true, false)
            expect(handler).not.toHaveBeenCalled()
        })
    })

    describe('registerModule / unregisterModule', () => {
        it('should register a module and make its settings accessible', () => {
            SETTINGS.registerModule('test-module', { foo: 'bar', count: 42 } as any)
            expect(SETTINGS.getFieldValue('test-module.foo')).toBe('bar')
            expect(SETTINGS.getFieldValue('test-module.count')).toBe(42)
        })

        it('should unregister a module', () => {
            SETTINGS.registerModule('test-module', { foo: 'bar' } as any)
            SETTINGS.unregisterModule('test-module')
            const value = SETTINGS.getFieldValue('test-module.foo')
            expect(value).toBeUndefined()
        })
    })

    describe('removeAllPropertyUpdateHandlers', () => {
        it('should remove all handlers', () => {
            const handler1 = jest.fn()
            const handler2 = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler1, 'test1')
            SETTINGS.addPropertyUpdateHandler('app.useMemoryManager', handler2, 'test2')
            SETTINGS.removeAllPropertyUpdateHandlers()
            // Handlers should no longer be triggered
            SETTINGS.onPropertyUpdate('app.dataChunkSize', 100, 200)
            SETTINGS.onPropertyUpdate('app.useMemoryManager', true, false)
            expect(handler1).not.toHaveBeenCalled()
            expect(handler2).not.toHaveBeenCalled()
        })
    })

    describe('removeAllPropertyUpdateHandlersFor', () => {
        it('should remove handlers for a specific caller', () => {
            const handler1 = jest.fn()
            const handler2 = jest.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler1, 'caller-a')
            SETTINGS.addPropertyUpdateHandler('app.useMemoryManager', handler2, 'caller-b')
            SETTINGS.removeAllPropertyUpdateHandlersFor('caller-a')
            SETTINGS.onPropertyUpdate('app.dataChunkSize', 100, 200)
            SETTINGS.onPropertyUpdate('app.useMemoryManager', true, false)
            expect(handler1).not.toHaveBeenCalled()
            expect(handler2).toHaveBeenCalledWith(true, false)
        })
    })
})
