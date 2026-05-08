/**
 * Unit tests for DatabaseAPIConnector class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import DatabaseAPIConnector from '../../src/assets/connector/DatabaseAPIConnector'
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

vi.mock('../../src/util/conversions', () => ({
    modifyStudyContext: vi.fn((data) => data),
}))

describe('DatabaseAPIConnector', () => {
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
        vi.restoreAllMocks()
    })

    describe('constructor', () => {
        it('should create connector with name and source', () => {
            const connector = new DatabaseAPIConnector('Test API', 'https://api.example.com')
            expect(connector.name).toBe('Test API')
            expect(connector.source).toBe('https://api.example.com')
            expect(connector.modality).toBe('connector')
        })

        it('should create basic auth header from web credentials', () => {
            const connector = new DatabaseAPIConnector(
                'Test API',
                'https://api.example.com',
                undefined,
                { username: 'user', password: 'pass' },
            )
            expect(connector.authHeader).toBe(`Basic ${btoa('user:pass')}`)
        })

        it('should not create auth header without credentials', () => {
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            expect(connector.authHeader).toBe('')
        })
    })

    describe('type', () => {
        it('should return database', () => {
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            expect(connector.type).toBe('database')
        })
    })

    describe('mode', () => {
        it('should return rw', () => {
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            expect(connector.mode).toBe('rw')
        })
    })

    describe('source', () => {
        it('should set and get source', () => {
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            connector.source = 'https://new-api.example.com'
            expect(connector.source).toBe('https://new-api.example.com')
        })
    })

    describe('authHeader', () => {
        it('should set and get auth header', () => {
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            connector.authHeader = 'Bearer token123'
            expect(connector.authHeader).toBe('Bearer token123')
        })
    })

    describe('authenticate', () => {
        it('should authenticate successfully', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => null },
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.authenticate()
            expect(result.success).toBe(true)
        })

        it('should return failure on bad response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                headers: { get: () => null },
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.authenticate()
            expect(result.success).toBe(false)
            expect(result.message).toContain('401')
        })

        it('should handle network errors', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.authenticate()
            expect(result.success).toBe(false)
        })

        it('should use custom auth path', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => null },
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            await connector.authenticate('login/')
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('login'),
                expect.any(Object)
            )
        })
    })

    describe('listContents', () => {
        it('should list contents from API', async () => {
            const mockData = [{ name: 'study1' }, { name: 'study2' }]
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => 'application/json' },
                json: () => Promise.resolve(mockData),
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.listContents()
            expect(result).toEqual(mockData)
        })

        it('should return null on error', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Server Error',
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.listContents()
            expect(result).toBeNull()
        })

        it('should handle network errors', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network')) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.listContents()
            expect(result).toBeNull()
        })
    })

    describe('query', () => {
        it('should execute GET query by default', async () => {
            const mockData = [{ id: 1 }]
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockData),
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.query('/items')
            expect(result.success).toBe(true)
            expect(result.data).toEqual(mockData)
        })

        it('should include params as query parameters by default', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            await connector.query('/items', { page: 1, limit: 10 })
            const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
            expect(calledUrl).toContain('page=1')
            expect(calledUrl).toContain('limit=10')
        })

        it('should use POST method when paramMethod is post', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            await connector.query('/items', { key: 'val' }, { paramMethod: 'post' })
            const fetchOptions = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
            expect(fetchOptions.method).toBe('POST')
            expect(fetchOptions.body).toBe(JSON.stringify({ key: 'val' }))
        })

        it('should inject params into URL when paramMethod is inject', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            await connector.query('/items/{id}', { id: 42 }, { paramMethod: 'inject' })
            const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
            expect(calledUrl).toContain('/items/42')
        })

        it('should handle query failure', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.query('/items')
            expect(result.success).toBe(false)
        })

        it('should handle network errors in query', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network')) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.query('/items')
            expect(result.success).toBe(false)
        })

        it('should support CSV format', async () => {
            const mockData = [{ name: 'item1', value: 10 }, { name: 'item2', value: 20 }]
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockData),
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.query('/items', undefined, { format: 'csv' })
            expect(result.success).toBe(true)
            expect(typeof result.data).toBe('string')
            expect(result.data).toContain('name')
        })

        it('should support XML format', async () => {
            const mockData = [{ name: 'item1' }]
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockData),
            }) as any
            const connector = new DatabaseAPIConnector('Test', 'https://api.example.com')
            const result = await connector.query('/items', undefined, { format: 'xml' })
            expect(result.success).toBe(true)
            expect(typeof result.data).toBe('string')
            expect(result.data).toContain('<root>')
        })
    })
})
