/**
 * Unit tests for Settings.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach } from 'vitest'
import { Log } from 'scoped-event-log'

// Mock dependencies
vi.mock('scoped-event-log', () => ({
    Log: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }
}))

// We need to import SETTINGS after mocking
import SETTINGS from '../../src/config/Settings'

describe('Settings', () => {
    beforeEach(() => {
        if (Log.debug) (Log.debug as ReturnType<typeof vi.fn>).mockClear()
        if (Log.error) (Log.error as ReturnType<typeof vi.fn>).mockClear()
        if (Log.warn) (Log.warn as ReturnType<typeof vi.fn>).mockClear()
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

        it('should read back the parsed colour it accepted', () => {
            // The case above asserts only that the call returned true, which holds whether or not
            // the parsed value was stored.
            SETTINGS.registerModule('colour-module', { color: [0, 0, 0, 1] } as any)
            expect(SETTINGS.setFieldValue('colour-module.color', 'rgba(255,0,0,1)')).toBe(true)
            expect(SETTINGS.getFieldValue('colour-module.color')).toEqual([1, 0, 0, 1])
        })

        it('should not read a colour out of a string field', () => {
            // The hex pattern is unanchored, so it matches a '#' followed by hex digits anywhere in
            // a string. A URL carrying such a fragment was converted to a colour array, failed the
            // type check and was rejected — with no diagnostic, since that exit logged nothing.
            SETTINGS.registerModule('url-module', { endpoint: '' } as any)
            expect(SETTINGS.setFieldValue('url-module.endpoint', 'https://example.org/api#abc123')).toBe(true)
            expect(SETTINGS.getFieldValue('url-module.endpoint')).toBe('https://example.org/api#abc123')
        })

        it('should refuse a path through a missing intermediate segment', () => {
            // The undefined check ran only on the final segment; an intermediate one was pushed as
            // undefined and dereferenced on the next pass, throwing out of configure() and init()
            // rather than being reported.
            expect(() => SETTINGS.setFieldValue('no-such-module.trace.margin.top', 10)).not.toThrow()
            expect(SETTINGS.setFieldValue('no-such-module.trace.margin.top', 10)).toBe(false)
            expect(() => SETTINGS.setFieldValue('app.nonExistent.deeper.still', 1)).not.toThrow()
            expect(SETTINGS.setFieldValue('app.nonExistent.deeper.still', 1)).toBe(false)
        })

        it('should set a field whose current value is null rather than throwing', () => {
            // Reading `.constructor` off the current value threw for any field declared nullable;
            // the guard above it tested only for undefined, which null passes.
            SETTINGS.registerModule('nullable-module', { maybe: null } as any)
            expect(() => SETTINGS.setFieldValue('nullable-module.maybe', 'now set')).not.toThrow()
            expect(SETTINGS.getFieldValue('nullable-module.maybe')).toBe('now set')
        })
    })

    describe('addPropertyUpdateHandler', () => {
        it('should register a handler', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('app.dataChunkSize'),
                'Settings'
            )
        })

        it('should reject invalid field', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('', handler)
            expect(Log.error).toHaveBeenCalledWith(
                expect.stringContaining('Invalid field'),
                'Settings'
            )
        })

        it('should deduplicate same handler for same field', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            ;(Log.debug as ReturnType<typeof vi.fn>).mockClear()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('already existed'),
                'Settings'
            )
        })

        it('should detect parent field handler', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app', handler, 'test')
            ;(Log.debug as ReturnType<typeof vi.fn>).mockClear()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('parent'),
                'Settings'
            )
        })

        it('should replace child field handler with parent', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            ;(Log.debug as ReturnType<typeof vi.fn>).mockClear()
            SETTINGS.addPropertyUpdateHandler('app', handler, 'test')
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('child'),
                'Settings'
            )
        })
    })

    describe('removePropertyUpdateHandler', () => {
        it('should remove a registered handler', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            ;(Log.debug as ReturnType<typeof vi.fn>).mockClear()
            SETTINGS.removePropertyUpdateHandler('app.dataChunkSize', handler)
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('Removed'),
                'Settings'
            )
        })

        it('should handle removing non-existent handler', () => {
            const handler = vi.fn()
            SETTINGS.removePropertyUpdateHandler('app.dataChunkSize', handler)
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('Could not locate'),
                'Settings'
            )
        })
    })

    describe('onPropertyUpdate', () => {
        it('should trigger matching handlers', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            SETTINGS.onPropertyUpdate('app.dataChunkSize', 100, 200)
            expect(handler).toHaveBeenCalledWith(100, 200)
        })

        it('should trigger parent handlers for child field updates', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app', handler, 'test')
            SETTINGS.onPropertyUpdate('app.dataChunkSize', 100, 200)
            expect(handler).toHaveBeenCalledWith(100, 200)
        })

        it('should not trigger unrelated handlers', () => {
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler, 'test')
            SETTINGS.onPropertyUpdate('app.useMemoryManager', true, false)
            expect(handler).not.toHaveBeenCalled()
        })
    })

    describe('change notification', () => {
        /**
         * A worker learns about settings through the bus, and the interface through the same event
         * on its own scope, so a write that updates the value without dispatching is invisible to
         * both while every property update handler still fires. The two notifications have to stay
         * together, which is why this asserts on each write path rather than on one.
         */
        const withBus = () => {
            const dispatchScopedEvent = vi.fn().mockReturnValue(true)
            vi.stubGlobal('__EPICURRENTS__', { EVENT_BUS: { dispatchScopedEvent } })
            return dispatchScopedEvent
        }

        afterEach(() => {
            vi.unstubAllGlobals()
        })

        it('should dispatch when a typed field changes', () => {
            const dispatch = withBus()
            const original = SETTINGS.getFieldValue('app.dataChunkSize')
            SETTINGS.setFieldValue('app.dataChunkSize', 4321)
            expect(dispatch).toHaveBeenCalledTimes(1)
            expect(dispatch.mock.calls[0][0]).toBe('setting-changed')
            SETTINGS.setFieldValue('app.dataChunkSize', original)
        })

        it('should dispatch when a field changes from null', () => {
            // A nullable field has no constructor to type-check against and takes its value on
            // trust, which used to mean it took a different route out of `setFieldValue` — one that
            // ran the handlers and dispatched nothing.
            SETTINGS.registerModule('test-module', { nullable: null } as any)
            const dispatch = withBus()
            expect(SETTINGS.setFieldValue('test-module.nullable', 'set')).toBe(true)
            expect(dispatch).toHaveBeenCalledTimes(1)
            expect(dispatch.mock.calls[0][0]).toBe('setting-changed')
        })

        it('should run property update handlers on both write paths', () => {
            withBus()
            SETTINGS.registerModule('test-module', { nullable: null, typed: 1 } as any)
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('test-module', handler)
            SETTINGS.setFieldValue('test-module.nullable', 'set')
            SETTINGS.setFieldValue('test-module.typed', 2)
            expect(handler).toHaveBeenCalledTimes(2)
        })

        it('should not dispatch when the write is rejected', () => {
            const dispatch = withBus()
            expect(SETTINGS.setFieldValue('app.dataChunkSize', 'not a number' as any)).toBe(false)
            expect(dispatch).not.toHaveBeenCalled()
        })
    })

    describe('applySnapshot', () => {
        it('should assign app fields from the snapshot', () => {
            const original = SETTINGS.getFieldValue('app.dataChunkSize')
            const applied = SETTINGS.applySnapshot({
                app: { dataChunkSize: 12345 },
                modules: {},
            } as any)
            expect(applied).toBe(true)
            expect(SETTINGS.getFieldValue('app.dataChunkSize')).toBe(12345)
            SETTINGS.setFieldValue('app.dataChunkSize', original)
        })

        it('should not write over an accessor that has no setter', () => {
            // `isSabUsed` is computed from the scope it is read in, so a worker must keep evaluating
            // its own rather than adopt what the main thread evaluated. Assigning to it would throw.
            const before = SETTINGS.app.isSabUsed
            expect(() => SETTINGS.applySnapshot({
                app: { isSabUsed: !before },
                modules: {},
            } as any)).not.toThrow()
            expect(SETTINGS.app.isSabUsed).toBe(before)
        })

        it('should ignore fields a snapshot never carries', () => {
            SETTINGS.applySnapshot({
                app: { _userDefinable: { injected: String } },
                modules: {},
            } as any)
            expect((SETTINGS.app as any)._userDefinable.injected).toBeUndefined()
        })

        it('should register a module the snapshot names and this object does not know', () => {
            expect(SETTINGS.modules['test-module']).toBeUndefined()
            SETTINGS.applySnapshot({
                app: {},
                modules: { 'test-module': { testProp: 42 } },
            } as any)
            expect(SETTINGS.getFieldValue('test-module.testProp')).toBe(42)
        })

        it('should update a module it already knows without replacing it', () => {
            SETTINGS.registerModule('test-module', { testProp: 42, untouched: 'keep' } as any)
            SETTINGS.applySnapshot({
                app: {},
                modules: { 'test-module': { testProp: 7 } },
            } as any)
            expect(SETTINGS.getFieldValue('test-module.testProp')).toBe(7)
            expect(SETTINGS.getFieldValue('test-module.untouched')).toBe('keep')
        })

        it('should not run property update handlers', () => {
            // A snapshot replicates the main thread's state rather than editing this copy, so a
            // handler firing here would report a local change that did not happen.
            const handler = vi.fn()
            SETTINGS.addPropertyUpdateHandler('app.dataChunkSize', handler)
            const original = SETTINGS.getFieldValue('app.dataChunkSize')
            SETTINGS.applySnapshot({ app: { dataChunkSize: 999 }, modules: {} } as any)
            expect(handler).not.toHaveBeenCalled()
            SETTINGS.setFieldValue('app.dataChunkSize', original)
        })

        it('should refuse anything that is not a snapshot', () => {
            expect(SETTINGS.applySnapshot(null as any)).toBe(false)
            expect(SETTINGS.applySnapshot('settings' as any)).toBe(false)
            expect(Log.error).toHaveBeenCalled()
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
            const handler1 = vi.fn()
            const handler2 = vi.fn()
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
            const handler1 = vi.fn()
            const handler2 = vi.fn()
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
