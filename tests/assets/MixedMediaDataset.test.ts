/**
 * Unit tests for MixedMediaDataset class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import MixedMediaDataset from '../../src/assets/dataset/MixedMediaDataset'
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

describe('MixedMediaDataset', () => {
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
        it('should create a dataset with a name', () => {
            const dataset = new MixedMediaDataset('Test Dataset')
            expect(dataset.name).toBe('Test Dataset')
            expect(dataset.modality).toBe('dataset')
        })

        it('should accept connectors', () => {
            const connector = {
                type: 'filesystem',
                mode: 'r',
                listContents: jest.fn().mockResolvedValue({ files: [] }),
            }
            const dataset = new MixedMediaDataset('Test', { input: connector as any })
            expect(dataset.hasInputSource).toBe(true)
        })
    })

    describe('source', () => {
        it('should default to null', () => {
            const dataset = new MixedMediaDataset('Test')
            expect(dataset.source).toBeNull()
        })

        it('should set and get source', () => {
            const dataset = new MixedMediaDataset('Test')
            const source = { name: 'test-study' } as any
            dataset.source = source
            expect(dataset.source).toBe(source)
        })

        it('should accept null', () => {
            const dataset = new MixedMediaDataset('Test')
            dataset.source = { name: 'study' } as any
            dataset.source = null
            expect(dataset.source).toBeNull()
        })
    })

    describe('getMainProperties', () => {
        it('should return resource count', () => {
            const dataset = new MixedMediaDataset('Test')
            const props = dataset.getMainProperties()
            expect(props.size).toBe(1)
            const entry = props.values().next().value
            expect(entry).toEqual({
                icon: 'number',
                n: 0,
                title: '{n} resources',
            })
        })
    })

    describe('prepare', () => {
        it('should set state to ready', async () => {
            const dataset = new MixedMediaDataset('Test')
            const result = await dataset.prepare()
            expect(result).toBe(true)
            expect(dataset.state).toBe('ready')
        })
    })

    describe('destroy', () => {
        it('should set source to null and state to destroyed', async () => {
            const dataset = new MixedMediaDataset('Test')
            dataset.source = { name: 'study' } as any
            await dataset.destroy()
            expect(dataset.source).toBeNull()
            expect(dataset.state).toBe('destroyed')
        })
    })
})
