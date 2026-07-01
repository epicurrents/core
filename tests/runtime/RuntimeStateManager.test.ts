/**
 * Unit tests for the RuntimeStateManager dataset-deactivation cascade.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type MockedClass } from 'vitest'
import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericAsset from '../../src/assets/GenericAsset'
import RuntimeStateManager, { state } from '../../src/runtime'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
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

/** Minimal resource stub with a settable `isActive` flag. */
const makeResource = (id: string, isActive: boolean) => ({ id, isActive })

/**
 * Minimal dataset stub. `activeResources` mirrors `GenericDataset` — it returns
 * only the resources whose `isActive` is currently true.
 */
const makeDataset = (id: string, resources: ReturnType<typeof makeResource>[]) => ({
    id,
    isActive: false,
    get activeResources () {
        return resources.filter(r => r.isActive)
    },
})

describe('RuntimeStateManager.setActiveDataset', () => {
    let manager: RuntimeStateManager

    beforeEach(() => {
        ;(Log.debug as ReturnType<typeof vi.fn>).mockClear()
        ;(Log.warn as ReturnType<typeof vi.fn>).mockClear()
        ;(GenericAsset as any).USED_IDS.clear()

        const mockEventBus = {
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
        Object.defineProperty(global, 'window', {
            value: { __EPICURRENTS__: { APP: {}, EVENT_BUS: mockEventBus, RUNTIME: null } } as any,
            writable: true,
        })
        ;(EventBus as MockedClass<typeof EventBus>).mockImplementation(function () {
            return mockEventBus as any
        })

        // `state` is a module-level singleton shared across tests; reset the
        // active dataset so each case starts from a known empty state.
        state.APP.activeDataset = null
        manager = new RuntimeStateManager()
    })

    it('deactivates the outgoing dataset and its active resources on switch', () => {
        const res1 = makeResource('r1', true)
        const res2 = makeResource('r2', true)
        const outgoing = makeDataset('d1', [res1, res2])
        const incoming = makeDataset('d2', [])

        manager.setActiveDataset(outgoing as any)
        expect(outgoing.isActive).toBe(true)

        manager.setActiveDataset(incoming as any)

        // The resource layer is only torn down by setActiveResource, so the
        // dataset switch must cascade deactivation to the outgoing resources.
        expect(res1.isActive).toBe(false)
        expect(res2.isActive).toBe(false)
        expect(outgoing.isActive).toBe(false)
        expect(incoming.isActive).toBe(true)
        expect(state.APP.activeDataset).toBe(incoming)
    })

    it('deactivates the outgoing dataset resources when clearing the active dataset', () => {
        const res = makeResource('r1', true)
        const outgoing = makeDataset('d1', [res])

        manager.setActiveDataset(outgoing as any)
        manager.setActiveDataset(null)

        expect(res.isActive).toBe(false)
        expect(outgoing.isActive).toBe(false)
        expect(state.APP.activeDataset).toBeNull()
    })

    it('only touches active resources and tolerates an empty active set', () => {
        const active = makeResource('r1', true)
        const alreadyInactive = makeResource('r2', false)
        const outgoing = makeDataset('d1', [active, alreadyInactive])

        manager.setActiveDataset(outgoing as any)
        expect(() => manager.setActiveDataset(makeDataset('d2', []) as any)).not.toThrow()

        expect(active.isActive).toBe(false)
        // The already-inactive resource is never in activeResources, so it is
        // left untouched rather than re-processed.
        expect(alreadyInactive.isActive).toBe(false)
    })

    it('does nothing to resources when there is no previously active dataset', () => {
        const res = makeResource('r1', true)
        const incoming = makeDataset('d1', [res])

        expect(() => manager.setActiveDataset(incoming as any)).not.toThrow()
        expect(res.isActive).toBe(true)
        expect(incoming.isActive).toBe(true)
    })
})

/** Resource stub carrying a `modality` so property routing can be exercised. */
const makeModalResource = (id: string, modality: string) => ({ id, modality, isActive: true })

/** Module runtime stub with a spyable `setPropertyValue`. */
const makeModule = () => ({ setPropertyValue: vi.fn() })

describe('RuntimeStateManager.setModulePropertyValue', () => {
    let manager: RuntimeStateManager

    beforeEach(() => {
        ;(Log.error as ReturnType<typeof vi.fn>).mockClear()

        const mockEventBus = {
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
        Object.defineProperty(global, 'window', {
            value: { __EPICURRENTS__: { APP: {}, EVENT_BUS: mockEventBus, RUNTIME: null } } as any,
            writable: true,
        })
        ;(EventBus as MockedClass<typeof EventBus>).mockImplementation(function () {
            return mockEventBus as any
        })

        state.APP.activeDataset = null
        state.MODULES.clear()
        manager = new RuntimeStateManager()
    })

    it('routes to the active resource matching the module, not the first active resource', () => {
        // ACC is first in the active set — the positional `activeResources[0]`
        // fallback would land an EEG mutation on the ACC resource (the leak).
        const accRes = makeModalResource('acc1', 'acc')
        const eegRes = makeModalResource('eeg1', 'eeg')
        state.APP.activeDataset = makeDataset('d1', [accRes, eegRes]) as any
        const eegMod = makeModule()
        state.MODULES.set('eeg', eegMod as any)

        manager.setModulePropertyValue('eeg', 'sensitivity', 5)

        expect(eegMod.setPropertyValue).toHaveBeenCalledWith('sensitivity', 5, eegRes, manager)
    })

    it('is a no-op when no active resource of the addressed modality exists', () => {
        state.APP.activeDataset = makeDataset('d1', [makeModalResource('acc1', 'acc')]) as any
        const eegMod = makeModule()
        state.MODULES.set('eeg', eegMod as any)

        manager.setModulePropertyValue('eeg', 'timebase-unit', 'cmPerSec')

        expect(eegMod.setPropertyValue).not.toHaveBeenCalled()
    })

    it('honours an explicitly passed resource over the active-set lookup', () => {
        const explicitRes = makeModalResource('eeg-off', 'eeg')
        state.APP.activeDataset = makeDataset('d1', [makeModalResource('acc1', 'acc')]) as any
        const eegMod = makeModule()
        state.MODULES.set('eeg', eegMod as any)

        manager.setModulePropertyValue('eeg', 'timebase', 3, explicitRes as any)

        expect(eegMod.setPropertyValue).toHaveBeenCalledWith('timebase', 3, explicitRes, manager)
    })

    it('logs an error and does not throw when the module is not loaded', () => {
        expect(() => manager.setModulePropertyValue('nope', 'sensitivity', 5)).not.toThrow()
        expect(Log.error).toHaveBeenCalled()
    })
})
