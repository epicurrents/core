/**
 * Unit tests for GenericAsset class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import { AssetEvents } from '../../src/events/EventTypes'
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
class TestAsset extends GenericAsset {
    constructor(name: string, modality: string) {
        super(name, modality)
    }
}

describe('GenericAsset', () => {
    let mockEventBus: any
    let mockApp: any
    let originalWindow: any

    beforeEach(() => {
        // Reset mocks manually
        if (Log.debug) (Log.debug as jest.Mock).mockClear()
        if (Log.error) (Log.error as jest.Mock).mockClear()
        if (Log.warn) (Log.warn as jest.Mock).mockClear()
        
        // Reset the static USED_IDS set
        (GenericAsset as any).USED_IDS.clear()

        // Mock the EventBus
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

        // Mock the app
        mockApp = {}

        // Setup global window mock
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

        // Mock EventBus constructor
        ;(EventBus as jest.MockedClass<typeof EventBus>).mockImplementation(() => mockEventBus as any)
    })

    afterEach(() => {
        // Restore original window
        global.window = originalWindow
        jest.useRealTimers()
    })

    describe('constructor', () => {
        it('should create an asset with valid name and modality', () => {
            const asset = new TestAsset('Test Asset', 'test')
            
            expect(asset.name).toBe('Test Asset')
            expect(asset.modality).toBe('test')
            expect(asset.id).toBeDefined()
            expect(asset.isActive).toBe(false)
        })

        it('should create unique IDs for different assets', () => {
            const asset1 = new TestAsset('Asset 1', 'test')
            const asset2 = new TestAsset('Asset 2', 'test')
            
            expect(asset1.id).not.toBe(asset2.id)
        })

        it('should dispatch CREATE event after construction', (done) => {
            jest.useFakeTimers()
            
            const asset = new TestAsset('Test Asset', 'test')
            
            setTimeout(() => {
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    AssetEvents.CREATE,
                    asset.id,
                    'after',
                    expect.objectContaining({ origin: asset })
                )
                done()
            }, 10)
            
            jest.advanceTimersByTime(10)
        })

        it('should handle missing global __EPICURRENTS__ object', () => {
            // Remove the global object
            delete (global.window as any).__EPICURRENTS__
            
            new TestAsset('Test Asset', 'test')
            
            expect(Log.error).toHaveBeenCalledWith(
                expect.stringContaining('Reference to global __EPICURRENTS__ object was not found'),
                'GenericAsset'
            )
        })

        it('should handle undefined window object', () => {
            // Remove window entirely
            const originalWindow = global.window
            delete (global as any).window
            
            new TestAsset('Test Asset', 'test')
            
            expect(Log.error).toHaveBeenCalledWith(
                expect.stringContaining('Tried to create an asset outside of a browser environment'),
                'GenericAsset'
            )
            
            // Restore window
            global.window = originalWindow
        })

        it('should handle missing APP or EVENT_BUS in global object', () => {
            (global.window as any).__EPICURRENTS__.APP = null;
            (global.window as any).__EPICURRENTS__.EVENT_BUS = null
            
            new TestAsset('Test Asset', 'test')
            
            expect(Log.error).toHaveBeenCalledWith(
                expect.stringContaining('An Epicurrents application must be instantiated before creating assets'),
                'GenericAsset'
            )
        })
    })

    describe('CreateUniqueId', () => {
        it('should create unique identifiers', () => {
            const id1 = GenericAsset.CreateUniqueId()
            const id2 = GenericAsset.CreateUniqueId()
            
            expect(id1).not.toBe(id2)
            expect(typeof id1).toBe('string')
            expect(typeof id2).toBe('string')
        })

        it('should handle retry limit gracefully', () => {
            // Fill up the USED_IDS set to force retries
            const usedIds = (GenericAsset as any).USED_IDS
            
            // Mock Date.now and Math.random to always return the same value
            const originalDateNow = Date.now
            const originalMathRandom = Math.random
            Date.now = jest.fn(() => 1000)
            Math.random = jest.fn(() => 0.5)
            
            // Pre-fill the expected ID
            const expectedId = (1000 + 0.5).toString(36)
            usedIds.add(expectedId)
            
            const id = GenericAsset.CreateUniqueId()
            
            expect(Log.warn).toHaveBeenCalledWith(
                expect.stringContaining('Reached retry limit while creating a unique ID'),
                'GenericAsset'
            )
            expect(id).toMatch(/^id-error-\d+$/)
            
            // Restore original functions
            Date.now = originalDateNow
            Math.random = originalMathRandom
        })
    })

    describe('property setters and getters', () => {
        let asset: TestAsset

        beforeEach(() => {
            asset = new TestAsset('Test Asset', 'test')
            // Clear constructor calls
            mockEventBus.dispatchScopedEvent.mockClear()
        })

        describe('isActive', () => {
            it('should set active state and dispatch events', () => {
                asset.isActive = true
                
                expect(asset.isActive).toBe(true)
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    AssetEvents.ACTIVATE,
                    asset.id,
                    'before',
                    expect.objectContaining({ origin: asset })
                )
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    AssetEvents.ACTIVATE,
                    asset.id,
                    'after',
                    expect.objectContaining({ origin: asset })
                )
            })

            it('should dispatch deactivate events when set to false', () => {
                asset.isActive = true
                mockEventBus.dispatchScopedEvent.mockClear(); mockEventBus.addScopedEventListener.mockClear()
                
                asset.isActive = false
                
                expect(asset.isActive).toBe(false)
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    AssetEvents.DEACTIVATE,
                    asset.id,
                    'before',
                    expect.objectContaining({ origin: asset })
                )
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    AssetEvents.DEACTIVATE,
                    asset.id,
                    'after',
                    expect.objectContaining({ origin: asset })
                )
            })
        })

        describe('modality', () => {
            it('should set and get modality', () => {
                asset.modality = 'new-modality'
                expect(asset.modality).toBe('new-modality')
            })
        })

        describe('name', () => {
            it('should set and get name', () => {
                asset.name = 'New Name'
                expect(asset.name).toBe('New Name')
            })

            it('should ignore empty name', () => {
                const originalName = asset.name
                asset.name = ''
                expect(asset.name).toBe(originalName)
            })
        })
    })

    describe('event handling methods', () => {
        let asset: TestAsset

        beforeEach(() => {
            asset = new TestAsset('Test Asset', 'test')
            mockEventBus.dispatchScopedEvent.mockClear(); mockEventBus.addScopedEventListener.mockClear()
        })

        describe('addEventListener', () => {
            it('should add event listener to event bus', () => {
                const callback = jest.fn()
                const subscriber = 'test-subscriber'
                
                asset.addEventListener('test-event', callback, subscriber)
                
                expect(mockEventBus.addScopedEventListener).toHaveBeenCalledWith(
                    'test-event',
                    callback,
                    subscriber,
                    asset.id,
                    'after'
                )
            })

            it('should support custom phase', () => {
                const callback = jest.fn()
                const subscriber = 'test-subscriber'
                
                asset.addEventListener('test-event', callback, subscriber, 'before')
                
                expect(mockEventBus.addScopedEventListener).toHaveBeenCalledWith(
                    'test-event',
                    callback,
                    subscriber,
                    asset.id,
                    'before'
                )
            })
        })

        describe('dispatchEvent', () => {
            it('should dispatch event with correct parameters', () => {
                const result = asset.dispatchEvent('test-event')
                
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    'test-event',
                    asset.id,
                    'after',
                    expect.objectContaining({ origin: asset })
                )
                expect(result).toBe(true)
            })

            it('should support custom phase and detail', () => {
                const detail = { customData: 'value' }
                asset.dispatchEvent('test-event', 'before', detail)
                
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    'test-event',
                    asset.id,
                    'before',
                    expect.objectContaining({ 
                        origin: asset,
                        customData: 'value'
                    })
                )
            })
        })

        describe('dispatchPayloadEvent', () => {
            it('should dispatch event with payload', () => {
                const payload = { data: 'test' }
                asset.dispatchPayloadEvent('test-event', payload)
                
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    'test-event',
                    asset.id,
                    'after',
                    expect.objectContaining({
                        origin: asset,
                        payload: payload
                    })
                )
            })
        })

        describe('dispatchPropertyChangeEvent', () => {
            it('should dispatch property change event', () => {
                asset.dispatchPropertyChangeEvent('name', 'new-value', 'old-value')
                
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    'property-change:name',
                    asset.id,
                    'after',
                    expect.objectContaining({
                        origin: asset,
                        property: 'name',
                        newValue: 'new-value',
                        oldValue: 'old-value'
                    })
                )
            })

            it('should use current property value when values not provided', () => {
                asset.dispatchPropertyChangeEvent('name')
                
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    'property-change:name',
                    asset.id,
                    'after',
                    expect.objectContaining({
                        origin: asset,
                        property: 'name',
                        newValue: asset.name,
                        oldValue: asset.name
                    })
                )
            })

            it('should support custom event name', () => {
                asset.dispatchPropertyChangeEvent('name', 'new', 'old', 'after', 'custom-event')
                
                expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                    'custom-event',
                    asset.id,
                    'after',
                    expect.objectContaining({
                        origin: asset,
                        property: 'name',
                        newValue: 'new',
                        oldValue: 'old'
                    })
                )
            })
        })

        describe('onPropertyChange', () => {
            it('should add property change listener for single property', () => {
                const handler = jest.fn()
                const subscriber = 'test-subscriber'
                
                asset.onPropertyChange('name', handler, subscriber)
                
                expect(mockEventBus.addScopedEventListener).toHaveBeenCalledWith(
                    'property-change:name',
                    expect.any(Function),
                    subscriber,
                    asset.id,
                    'after'
                )
            })

            it('should add property change listeners for multiple properties', () => {
                const handler = jest.fn()
                const subscriber = 'test-subscriber'
                
                asset.onPropertyChange(['name', 'modality'], handler, subscriber)
                
                expect(mockEventBus.addScopedEventListener).toHaveBeenCalledTimes(2)
                expect(mockEventBus.addScopedEventListener).toHaveBeenCalledWith(
                    'property-change:name',
                    expect.any(Function),
                    subscriber,
                    asset.id,
                    'after'
                )
                expect(mockEventBus.addScopedEventListener).toHaveBeenCalledWith(
                    'property-change:modality',
                    expect.any(Function),
                    subscriber,
                    asset.id,
                    'after'
                )
            })
        })

        describe('removeEventListener', () => {
            it('should remove event listener from event bus', () => {
                const callback = jest.fn()
                const subscriber = 'test-subscriber'
                
                asset.removeEventListener('test-event', callback, subscriber)
                
                expect(mockEventBus.removeScopedEventListener).toHaveBeenCalledWith(
                    'test-event',
                    callback,
                    subscriber,
                    asset.id,
                    undefined
                )
            })
        })

        describe('removeAllEventListeners', () => {
            it('should remove all listeners for specific subscriber', () => {
                const subscriber = 'test-subscriber'
                
                asset.removeAllEventListeners(subscriber)
                
                expect(mockEventBus.removeAllScopedEventListeners).toHaveBeenCalledWith(
                    subscriber,
                    asset.id
                )
            })

            it('should remove entire scope when no subscriber specified', () => {
                asset.removeAllEventListeners()
                
                expect(mockEventBus.removeScope).toHaveBeenCalledWith(asset.id)
            })
        })
    })

    describe('serialize', () => {
        it('should return serialized asset data', () => {
            const asset = new TestAsset('Test Asset', 'test')
            
            const serialized = asset.serialize()
            
            expect(serialized).toEqual({
                id: asset.id,
                modality: 'test',
                name: 'Test Asset'
            })
        })
    })

    describe('subscription methods', () => {
        let asset: TestAsset

        beforeEach(() => {
            asset = new TestAsset('Test Asset', 'test')
            mockEventBus.dispatchScopedEvent.mockClear(); mockEventBus.addScopedEventListener.mockClear()
        })

        describe('subscribe', () => {
            it('should call event bus subscribe method', () => {
                const callback = jest.fn()
                const subscriber = 'test-subscriber'
                
                asset.subscribe('test-event', callback, subscriber)
                
                expect(mockEventBus.subscribe).toHaveBeenCalledWith(
                    'test-event',
                    callback,
                    subscriber,
                    asset.id,
                    'after'
                )
            })
        })

        describe('unsubscribe', () => {
            it('should call event bus unsubscribe method', () => {
                const callback = jest.fn()
                const subscriber = 'test-subscriber'
                
                asset.unsubscribe('test-event', callback, subscriber)
                
                expect(mockEventBus.unsubscribe).toHaveBeenCalledWith(
                    'test-event',
                    callback,
                    subscriber,
                    asset.id,
                    undefined
                )
            })
        })

        describe('unsubscribeAll', () => {
            it('should call event bus unsubscribeAll method', () => {
                const subscriber = 'test-subscriber'
                
                asset.unsubscribeAll(subscriber)
                
                expect(mockEventBus.unsubscribeAll).toHaveBeenCalledWith(
                    subscriber,
                    asset.id
                )
            })
        })
    })

    describe('getEventHooks', () => {
        it('should call event bus getEventHooks method', () => {
            const asset = new TestAsset('Test Asset', 'test')
            const subscriber = 'test-subscriber'
            
            asset.getEventHooks('test-event', subscriber)
            
            expect(mockEventBus.getEventHooks).toHaveBeenCalledWith(
                'test-event',
                subscriber,
                asset.id
            )
        })
    })

    describe('destroy', () => {
        let asset: TestAsset

        beforeEach(() => {
            asset = new TestAsset('Test Asset', 'test')
            mockEventBus.dispatchScopedEvent.mockClear(); mockEventBus.addScopedEventListener.mockClear()
        })

        it('should deactivate asset and remove listeners', () => {
            asset.isActive = true
            mockEventBus.dispatchScopedEvent.mockClear(); mockEventBus.addScopedEventListener.mockClear()
            
            asset.destroy()
            
            expect(asset.isActive).toBe(false)
            expect(mockEventBus.removeScope).toHaveBeenCalledWith(asset.id)
            expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                AssetEvents.DESTROY,
                asset.id,
                'after',
                expect.objectContaining({ origin: asset })
            )
        })

        it('should handle already inactive asset', () => {
            expect(asset.isActive).toBe(false)
            
            asset.destroy()
            
            expect(mockEventBus.removeScope).toHaveBeenCalledWith(asset.id)
            expect(mockEventBus.dispatchScopedEvent).toHaveBeenCalledWith(
                AssetEvents.DESTROY,
                asset.id,
                'after',
                expect.objectContaining({ origin: asset })
            )
        })
    })

    describe('static properties', () => {
        it('should expose EVENTS constant', () => {
            expect(GenericAsset.EVENTS).toBe(AssetEvents)
        })
    })
})
