/**
 * Unit tests for GenericDocumentResource class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericDocumentResource from '../../src/assets/document/GenericDocumentResource'
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

vi.mock('../../src/util/general', () => ({
    nullPromise: Promise.resolve(null),
}))

// Concrete subclass for testing abstract GenericDocumentResource
class TestDocumentResource extends GenericDocumentResource {
    constructor(name: string, modality: string, format: string, source: any) {
        super(name, modality, format, source)
    }
    getMainProperties() {
        return new Map<string, { [key: string]: string | number } | null>()
    }
    async prepare() {
        this.state = 'ready'
        return true
    }
}

describe('GenericDocumentResource', () => {
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
        it('should create a document resource with name, modality, format, and source', () => {
            const source = { name: 'doc-source' }
            const doc = new TestDocumentResource('Test Doc', 'document', 'pdf', source)
            expect(doc.name).toBe('Test Doc')
            expect(doc.modality).toBe('document')
            expect(doc.sourceFormat).toBe('pdf')
        })

        it('should extract scale from source meta', () => {
            const source = { name: 'doc', meta: { scale: 2.5 } }
            const doc = new TestDocumentResource('Test', 'document', 'pdf', source)
            expect(doc.scale).toBe(2.5)
        })

        it('should default scale to 1', () => {
            const source = { name: 'doc' }
            const doc = new TestDocumentResource('Test', 'document', 'pdf', source)
            expect(doc.scale).toBe(1)
        })
    })

    describe('scale', () => {
        it('should set and get scale', () => {
            const doc = new TestDocumentResource('Test', 'document', 'pdf', { name: 'doc' })
            doc.scale = 3
            expect(doc.scale).toBe(3)
        })
    })

    describe('sourceFormat', () => {
        it('should return the format string', () => {
            const doc = new TestDocumentResource('Test', 'document', 'html', { name: 'doc' })
            expect(doc.sourceFormat).toBe('html')
        })
    })

    describe('content', () => {
        it('should return null promise', async () => {
            const doc = new TestDocumentResource('Test', 'document', 'pdf', { name: 'doc' })
            const content = await doc.content
            expect(content).toBeNull()
        })
    })
})
