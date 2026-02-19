/**
 * Unit tests for GenericDataset class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericDataset from '../../src/assets/dataset/GenericDataset'
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

// Concrete subclass for testing abstract GenericDataset
class TestDataset extends GenericDataset {
    constructor(
        name: string,
        connectors?: { input?: any, output?: any },
        sortingScheme?: any,
        modality?: string,
    ) {
        super(name, connectors, sortingScheme, modality)
    }
    getMainProperties() {
        return new Map<string, { [key: string]: string | number } | null>()
    }
    async prepare() {
        this.state = 'ready'
        return true
    }
}

describe('GenericDataset', () => {
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
        it('should create a dataset with a name and default modality', () => {
            const dataset = new TestDataset('Test Dataset')
            expect(dataset.name).toBe('Test Dataset')
            expect(dataset.modality).toBe('dataset')
        })

        it('should accept custom modality', () => {
            const dataset = new TestDataset('Test', undefined, undefined, 'custom')
            expect(dataset.modality).toBe('custom')
        })

        it('should store connectors', () => {
            const inputConnector = {
                type: 'filesystem',
                mode: 'r',
                listContents: jest.fn().mockResolvedValue({ files: [] }),
            }
            const dataset = new TestDataset('Test', { input: inputConnector as any })
            expect(dataset.hasInputSource).toBe(true)
            expect(dataset.hasOutputSource).toBe(false)
        })

        it('should default to id sorting scheme', () => {
            const dataset = new TestDataset('Test')
            expect(dataset.resourceSorting.scheme).toBe('id')
            expect(dataset.resourceSorting.order).toEqual([])
        })

        it('should accept custom sorting scheme', () => {
            const dataset = new TestDataset('Test', undefined, 'alphabetical')
            expect(dataset.resourceSorting.scheme).toBe('alphabetical')
        })

        it('should warn when app is not available', () => {
            ;(global.window as any).__EPICURRENTS__.APP = null
            const dataset = new TestDataset('Test')
            expect(Log.warn).toHaveBeenCalledWith(
                expect.stringContaining('Application instance not available'),
                'GenericDataset'
            )
        })
    })

    describe('hasInputSource / hasOutputSource', () => {
        it('should return false when no connectors', () => {
            const dataset = new TestDataset('Test')
            expect(dataset.hasInputSource).toBe(false)
            expect(dataset.hasOutputSource).toBe(false)
        })

        it('should return true when output connector is set', () => {
            const dataset = new TestDataset('Test', { output: { type: 'filesystem' } })
            expect(dataset.hasOutputSource).toBe(true)
        })
    })

    describe('resources', () => {
        it('should start with empty resources', () => {
            const dataset = new TestDataset('Test')
            expect(dataset.resources).toEqual([])
        })

        it('should get active resources (empty by default)', () => {
            const dataset = new TestDataset('Test')
            expect(dataset.activeResources).toEqual([])
        })
    })

    describe('addResource', () => {
        it('should add a resource context', () => {
            const dataset = new TestDataset('Test')
            const mockResource = {
                id: 'res-1',
                name: 'Resource 1',
                modality: 'test',
                isActive: false,
                onPropertyChange: jest.fn(),
                removeAllEventListeners: jest.fn(),
            }
            const context = { resource: mockResource } as any
            dataset.addResource(context)
            expect(dataset.resources).toHaveLength(1)
            expect(dataset.resources[0].resource.id).toBe('res-1')
        })

        it('should not add duplicate resource', () => {
            const dataset = new TestDataset('Test')
            const mockResource = {
                id: 'res-1',
                name: 'Resource 1',
                onPropertyChange: jest.fn(),
                removeAllEventListeners: jest.fn(),
            }
            const context = { resource: mockResource } as any
            dataset.addResource(context)
            dataset.addResource(context)
            expect(dataset.resources).toHaveLength(1)
        })

        it('should update sorting order for id scheme', () => {
            const dataset = new TestDataset('Test')
            const mockResource = {
                id: 'res-1',
                name: 'Resource 1',
                onPropertyChange: jest.fn(),
                removeAllEventListeners: jest.fn(),
            }
            dataset.addResource({ resource: mockResource } as any)
            expect(dataset.resourceSorting.order).toContain('res-1')
        })
    })

    describe('removeResource', () => {
        it('should remove resource by index', () => {
            // removeResource checks this._app?.runtime.APP.datasets
            mockApp.runtime = { APP: { datasets: [] } }
            const dataset = new TestDataset('Test')
            const mockResource = {
                id: 'res-1',
                name: 'Resource 1',
                onPropertyChange: jest.fn(),
                removeAllEventListeners: jest.fn(),
                unload: jest.fn(),
            }
            dataset.addResource({ resource: mockResource } as any)
            const removed = dataset.removeResource(0)
            expect(removed).not.toBeNull()
            expect(removed!.resource.id).toBe('res-1')
            expect(dataset.resources).toHaveLength(0)
        })

        it('should remove resource by object reference', () => {
            mockApp.runtime = { APP: { datasets: [] } }
            const dataset = new TestDataset('Test')
            const mockResource = {
                id: 'res-1',
                name: 'Resource 1',
                onPropertyChange: jest.fn(),
                removeAllEventListeners: jest.fn(),
                unload: jest.fn(),
            }
            dataset.addResource({ resource: mockResource } as any)
            const removed = dataset.removeResource(mockResource as any)
            expect(removed).not.toBeNull()
            expect(dataset.resources).toHaveLength(0)
        })

        it('should return null when resource not found', () => {
            const dataset = new TestDataset('Test')
            const result = dataset.removeResource('nonexistent')
            expect(result).toBeNull()
        })
    })

    describe('getResourcesByModality', () => {
        it('should return resources matching the given modality', () => {
            const dataset = new TestDataset('Test')
            const res1 = {
                id: 'res-1', name: 'R1', modality: 'eeg',
                onPropertyChange: jest.fn(), removeAllEventListeners: jest.fn(),
            }
            const res2 = {
                id: 'res-2', name: 'R2', modality: 'ecg',
                onPropertyChange: jest.fn(), removeAllEventListeners: jest.fn(),
            }
            dataset.addResource({ resource: res1 } as any)
            dataset.addResource({ resource: res2 } as any)
            const eegResources = dataset.getResourcesByModality('eeg')
            expect(eegResources).toHaveLength(1)
            expect(eegResources[0].id).toBe('res-1')
        })

        it('should return empty array when no match', () => {
            const dataset = new TestDataset('Test')
            expect(dataset.getResourcesByModality('nonexistent')).toEqual([])
        })
    })

    describe('setResourceSortingScheme', () => {
        it('should change sorting scheme', () => {
            const dataset = new TestDataset('Test')
            dataset.setResourceSortingScheme('alphabetical')
            expect(dataset.resourceSorting.scheme).toBe('alphabetical')
            expect(dataset.resourceSorting.order).toEqual([])
        })

        it('should not change if same scheme', () => {
            const dataset = new TestDataset('Test')
            mockEventBus.dispatchScopedEvent.mockClear()
            dataset.setResourceSortingScheme('id')
            // Should log debug and not dispatch property change
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('identical'),
                'GenericDataset'
            )
        })
    })

    describe('setResourceSortingOrder', () => {
        it('should set custom order for id scheme', () => {
            const dataset = new TestDataset('Test')
            dataset.setResourceSortingOrder(['res-2', 'res-1'])
            expect(dataset.resourceSorting.order).toEqual(['res-2', 'res-1'])
        })

        it('should warn when scheme is alphabetical', () => {
            const dataset = new TestDataset('Test', undefined, 'alphabetical')
            dataset.setResourceSortingOrder(['a', 'b'])
            expect(Log.warn).toHaveBeenCalledWith(
                expect.stringContaining('alphabetical'),
                'GenericDataset'
            )
        })
    })

    describe('setOutputConflictResolution', () => {
        it('should store output conflict resolution options', () => {
            const dataset = new TestDataset('Test')
            dataset.setOutputConflictResolution({ overwrite: false })
            // No direct getter, but verify no error thrown
        })
    })

    describe('sortedResources', () => {
        it('should return map of resources sorted by id', () => {
            const dataset = new TestDataset('Test')
            const res1 = {
                id: 'res-1', name: 'B Resource', modality: 'test',
                onPropertyChange: jest.fn(), removeAllEventListeners: jest.fn(),
            }
            const res2 = {
                id: 'res-2', name: 'A Resource', modality: 'test',
                onPropertyChange: jest.fn(), removeAllEventListeners: jest.fn(),
            }
            dataset.addResource({ resource: res1 } as any)
            dataset.addResource({ resource: res2 } as any)
            const sorted = dataset.sortedResources
            expect(sorted).toBeInstanceOf(Map)
            expect(sorted.size).toBe(2)
        })
    })

    describe('unload', () => {
        it('should remove and destroy all resources', async () => {
            mockApp.runtime = { APP: { datasets: [] } }
            const dataset = new TestDataset('Test')
            const mockResource = {
                id: 'res-1',
                name: 'Resource 1',
                onPropertyChange: jest.fn(),
                removeAllEventListeners: jest.fn(),
                unload: jest.fn(),
                destroy: jest.fn().mockResolvedValue(undefined),
            }
            dataset.addResource({ resource: mockResource } as any)
            await dataset.unload()
            expect(dataset.resources).toHaveLength(0)
        })
    })

    describe('destroy', () => {
        it('should unload and call super destroy', async () => {
            const dataset = new TestDataset('Test')
            await dataset.destroy()
            expect(dataset.state).toBe('destroyed')
        })
    })

    describe('writeToOutputDataSource', () => {
        it('should return error when no writable connector', async () => {
            const dataset = new TestDataset('Test')
            const result = await dataset.writeToOutputDataSource('/test.txt', 'data')
            expect(result.success).toBe(false)
        })

        it('should write string data to filesystem connector', async () => {
            const mockWriteFile = jest.fn().mockResolvedValue({ success: true })
            const connector = {
                type: 'filesystem',
                mode: 'rw',
                writeFile: mockWriteFile,
            }
            const dataset = new TestDataset('Test', { output: connector })
            const result = await dataset.writeToOutputDataSource('/test.txt', 'data')
            expect(result.success).toBe(true)
            expect(mockWriteFile).toHaveBeenCalledWith('/test.txt', 'data', { overwrite: true })
        })
    })
})
