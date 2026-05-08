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

describe('MixedMediaDataset', () => {
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
        it('should create a dataset with a name', () => {
            const dataset = new MixedMediaDataset('Test Dataset')
            expect(dataset.name).toBe('Test Dataset')
            expect(dataset.modality).toBe('dataset')
        })

        it('should accept connectors', () => {
            const connector = {
                type: 'filesystem',
                mode: 'r',
                listContents: vi.fn().mockResolvedValue({ files: [] }),
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
            expect(props.get('resources')).toBe(0)
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
