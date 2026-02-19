/**
 * Unit tests for ResourceCollection class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import ResourceCollection from '../../src/assets/ResourceCollection'
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
class TestCollection extends ResourceCollection {
    constructor(name: string, source?: any, date?: Date) {
        super(name, source, date)
    }
}

// Helper to create mock resources
function createMockResource(name: string): any {
    return {
        name,
        destroy: jest.fn(),
        unload: jest.fn(),
        isActive: false,
        id: `mock-${name}`,
    }
}

describe('ResourceCollection', () => {
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

    describe('addResource', () => {
        it('should add a resource to the collection', () => {
            const collection = new TestCollection('Test')
            const resource = createMockResource('res1')
            collection.addResource(resource)
            expect(collection.resources.length).toBe(1)
            expect(collection.resources[0]).toBe(resource)
        })

        it('should set as default when flag is true', () => {
            const collection = new TestCollection('Test')
            collection.addResource(createMockResource('res1'))
            collection.addResource(createMockResource('res2'), true)
            expect(collection.defaultResource).toBe(1)
        })
    })

    describe('getResource', () => {
        it('should get resource by index', () => {
            const collection = new TestCollection('Test')
            const res1 = createMockResource('res1')
            const res2 = createMockResource('res2')
            collection.addResource(res1)
            collection.addResource(res2)
            expect(collection.getResource(0)).toBe(res1)
            expect(collection.getResource(1)).toBe(res2)
        })

        it('should get resource by name', () => {
            const collection = new TestCollection('Test')
            const res = createMockResource('my-resource')
            collection.addResource(res)
            expect(collection.getResource('my-resource')).toBe(res)
        })

        it('should return null for invalid index', () => {
            const collection = new TestCollection('Test')
            expect(collection.getResource(5)).toBeNull()
        })

        it('should return null for non-existent name', () => {
            const collection = new TestCollection('Test')
            expect(collection.getResource('nonexistent')).toBeNull()
        })
    })

    describe('removeResource', () => {
        it('should remove resource by index', () => {
            const collection = new TestCollection('Test')
            const res = createMockResource('res1')
            collection.addResource(res)
            collection.removeResource(0)
            expect(collection.resources.length).toBe(0)
            expect(res.destroy).toHaveBeenCalled()
        })

        it('should remove resource by name', () => {
            const collection = new TestCollection('Test')
            const res = createMockResource('res1')
            collection.addResource(res)
            collection.removeResource('res1')
            expect(collection.resources.length).toBe(0)
            expect(res.destroy).toHaveBeenCalled()
        })

        it('should remove resource by object reference', () => {
            const collection = new TestCollection('Test')
            const res = createMockResource('res1')
            collection.addResource(res)
            collection.removeResource(res)
            expect(collection.resources.length).toBe(0)
        })

        it('should warn when resource not found', () => {
            const collection = new TestCollection('Test')
            collection.removeResource('nonexistent')
            expect(Log.warn).toHaveBeenCalledWith(
                expect.stringContaining('nonexistent'),
                'ResourceCollection'
            )
        })
    })

    describe('defaultResource setter', () => {
        it('should reject out of bounds index', () => {
            const collection = new TestCollection('Test')
            collection.addResource(createMockResource('res1'))
            collection.defaultResource = 5
            expect(collection.defaultResource).toBe(0) // unchanged
            expect(Log.error).toHaveBeenCalled()
        })

        it('should reject negative index', () => {
            const collection = new TestCollection('Test')
            collection.addResource(createMockResource('res1'))
            collection.defaultResource = -1
            expect(collection.defaultResource).toBe(0) // unchanged
        })
    })

    describe('getMainProperties', () => {
        it('should return resource count', () => {
            const collection = new TestCollection('Test')
            collection.addResource(createMockResource('res1'))
            collection.addResource(createMockResource('res2'))
            const props = collection.getMainProperties()
            expect(props.has('{n} resources')).toBe(true)
            expect(props.get('{n} resources')).toEqual({ n: 2 })
        })
    })

    describe('unload', () => {
        it('should call unload on all resources', async () => {
            const collection = new TestCollection('Test')
            const res1 = createMockResource('res1')
            const res2 = createMockResource('res2')
            collection.addResource(res1)
            collection.addResource(res2)
            await collection.unload()
            expect(res1.unload).toHaveBeenCalled()
            expect(res2.unload).toHaveBeenCalled()
        })
    })
})
