/**
 * Unit tests for GenericResource class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericResource from '../../src/assets/GenericResource'
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
class TestResource extends GenericResource {
    constructor(name: string, modality: string, source?: any) {
        super(name, modality, source)
    }
}

describe('GenericResource', () => {
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
        it('should create a resource with name and modality', () => {
            const resource = new TestResource('Test Resource', 'test')
            expect(resource.name).toBe('Test Resource')
            expect(resource.modality).toBe('test')
            expect(resource.state).toBe('added')
            expect(resource.source).toBeNull()
        })

        it('should accept an optional source', () => {
            const source = { name: 'test-source', url: 'http://example.com' }
            const resource = new TestResource('Test Resource', 'test', source)
            expect(resource.source).toBe(source)
        })

        it('should extract datasetId from source meta', () => {
            const source = { name: 'test', meta: { datasetId: 'ds-123' } }
            const resource = new TestResource('Test Resource', 'test', source)
            expect(resource.datasetId).toBe('ds-123')
        })
    })

    describe('addDependencies', () => {
        it('should add dependencies to the missing list', () => {
            const resource = new TestResource('Test', 'test')
            resource.addDependencies('dep1', 'dep2')
            expect(resource.dependenciesMissing).toEqual(['dep1', 'dep2'])
        })

        it('should dispatch isReady change when adding to a ready resource', async () => {
            const resource = new TestResource('Test', 'test')
            await resource.prepare() // sets state to 'ready'
            mockEventBus.dispatchScopedEvent.mockClear()
            resource.addDependencies('dep1')
            expect(resource.isReady).toBe(false)
            expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                'property-change:isReady',
                resource.id,
                'after',
                expect.objectContaining({ property: 'isReady' })
            )
        })
    })

    describe('removeDependencies', () => {
        it('should remove dependencies from the missing list', () => {
            const resource = new TestResource('Test', 'test')
            resource.addDependencies('dep1', 'dep2', 'dep3')
            const removed = resource.removeDependencies('dep2')
            expect(removed).toEqual(['dep2'])
            expect(resource.dependenciesMissing).toEqual(['dep1', 'dep3'])
        })

        it('should warn when dependency not found', () => {
            const resource = new TestResource('Test', 'test')
            resource.removeDependencies('nonexistent')
            expect(Log.warn).toHaveBeenCalledWith(
                expect.stringContaining('nonexistent'),
                'GenericResource'
            )
        })
    })

    describe('setDependenciesReady', () => {
        it('should move dependencies from missing to ready', () => {
            const resource = new TestResource('Test', 'test')
            resource.addDependencies('dep1', 'dep2')
            resource.setDependenciesReady('dep1')
            expect(resource.dependenciesMissing).toEqual(['dep2'])
            expect(resource.dependenciesReady).toEqual(['dep1'])
        })
    })

    describe('isReady', () => {
        it('should be false when state is not ready', () => {
            const resource = new TestResource('Test', 'test')
            expect(resource.isReady).toBe(false)
        })

        it('should be true when state is ready and no missing dependencies', async () => {
            const resource = new TestResource('Test', 'test')
            await resource.prepare()
            expect(resource.isReady).toBe(true)
        })

        it('should be false when ready but dependencies are missing', async () => {
            const resource = new TestResource('Test', 'test')
            resource.addDependencies('dep1')
            await resource.prepare()
            expect(resource.isReady).toBe(false)
        })
    })

    describe('getMainProperties', () => {
        it('should show error reason for error state', () => {
            const resource = new TestResource('Test', 'test')
            resource.state = 'error'
            resource.errorReason = 'Load failed'
            // Set error reason directly on the protected field
            ;(resource as any)._errorReason = 'Load failed'
            const props = resource.getMainProperties()
            expect(props.has('Load failed')).toBe(true)
        })

        it('should show waiting message for added state', () => {
            const resource = new TestResource('Test', 'test')
            const props = resource.getMainProperties()
            expect(props.has('Waiting to load...')).toBe(true)
        })

        it('should show loading message for loading state', () => {
            const resource = new TestResource('Test', 'test')
            resource.state = 'loading'
            const props = resource.getMainProperties()
            expect(props.has('Loading details...')).toBe(true)
        })

        it('should show initializing message for loaded state', () => {
            const resource = new TestResource('Test', 'test')
            resource.state = 'loaded'
            const props = resource.getMainProperties()
            expect(props.has('Initializing...')).toBe(true)
        })

        it('should show dependency loading when ready with missing deps', async () => {
            const resource = new TestResource('Test', 'test')
            resource.addDependencies('dep1', 'dep2')
            await resource.prepare()
            const props = resource.getMainProperties()
            expect(props.has('Loading dependency {n}/{t}...')).toBe(true)
            const depInfo = props.get('Loading dependency {n}/{t}...')
            expect(depInfo.n).toBe(1)
            expect(depInfo.t).toBe(2)
        })
    })

    describe('labels setter', () => {
        it('should auto-generate IDs for labels without them', () => {
            const resource = new TestResource('Test', 'test')
            resource.labels = [
                { id: '', name: 'label1' } as any,
                { id: 'existing-id', name: 'label2' } as any,
            ]
            expect(resource.labels[0].id).toBeTruthy()
            expect(resource.labels[0].id).not.toBe('')
            expect(resource.labels[1].id).toBe('existing-id')
        })
    })

    describe('destroy', () => {
        it('should clean up resource dependencies and state', () => {
            const resource = new TestResource('Test', 'test')
            resource.addDependencies('dep1')
            ;(resource as any)._errorReason = 'test error'
            resource.destroy()
            expect(resource.dependenciesMissing).toEqual([])
            expect(resource.dependenciesReady).toEqual([])
            expect((resource as any)._errorReason).toBe('')
            expect(resource.source).toBeNull()
            expect(resource.state).toBe('destroyed')
        })
    })

    describe('prepare', () => {
        it('should set state to ready', async () => {
            const resource = new TestResource('Test', 'test')
            const result = await resource.prepare()
            expect(result).toBe(true)
            expect(resource.state).toBe('ready')
        })
    })
})
