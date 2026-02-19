/**
 * Unit tests for WebDAVConnector class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import WebDAVConnector from '../../src/assets/connector/WebDAVConnector'
import GenericAsset from '../../src/assets/GenericAsset'

// Mock webdav
const mockClient = {
    exists: jest.fn(),
    stat: jest.fn(),
    getFileContents: jest.fn(),
    getDirectoryContents: jest.fn(),
    putFileContents: jest.fn(),
    createDirectory: jest.fn(),
    moveFile: jest.fn(),
}

jest.mock('webdav', () => ({
    AuthType: {
        Auto: 'auto',
        Digest: 'digest',
        Password: 'password',
        Token: 'token',
    },
    createClient: jest.fn(() => mockClient),
}))

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

describe('WebDAVConnector', () => {
    let mockEventBus: any
    let mockApp: any
    let originalWindow: any

    beforeEach(() => {
        if (Log.debug) (Log.debug as jest.Mock).mockClear()
        if (Log.error) (Log.error as jest.Mock).mockClear()
        if (Log.warn) (Log.warn as jest.Mock).mockClear()

        ;(GenericAsset as any).USED_IDS.clear()

        mockClient.exists.mockReset()
        mockClient.stat.mockReset()
        mockClient.getFileContents.mockReset()
        mockClient.getDirectoryContents.mockReset()
        mockClient.putFileContents.mockReset()
        mockClient.createDirectory.mockReset()
        mockClient.moveFile.mockReset()

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
        it('should create a connector with name and source', () => {
            const connector = new WebDAVConnector(
                'Test WebDAV',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            expect(connector.name).toBe('Test WebDAV')
            expect(connector.source).toBe('https://webdav.example.com')
            expect(connector.modality).toBe('connector')
        })

        it('should strip trailing slash from source', () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com/',
                { username: 'user', password: 'pass' },
            )
            expect(connector.source).toBe('https://webdav.example.com')
        })

        it('should default to read mode', () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            expect(connector.mode).toBe('r')
        })

        it('should accept custom mode', () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
                { mode: 'rw' as any },
            )
            expect(connector.mode).toBe('rw')
        })

        it('should set basic auth header for password credentials', () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            expect(connector.authHeader).toBe(`Basic ${btoa('user:pass')}`)
        })
    })

    describe('type', () => {
        it('should return filesystem', () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            expect(connector.type).toBe('filesystem')
        })
    })

    describe('path', () => {
        it('should set and get path', () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            connector.path = '/data/recordings'
            expect(connector.path).toBe('/data/recordings')
        })

        it('should strip trailing slash from path', () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            connector.path = '/data/recordings/'
            expect(connector.path).toBe('/data/recordings')
        })
    })

    describe('mode', () => {
        it('should set and get mode', () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            connector.mode = 'rw' as any
            expect(connector.mode).toBe('rw')
        })
    })

    describe('authenticate', () => {
        it('should authenticate successfully', async () => {
            mockClient.exists.mockResolvedValue(true)
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            const result = await connector.authenticate()
            expect(result.success).toBe(true)
        })

        it('should handle authentication failure', async () => {
            mockClient.exists.mockRejectedValue(new Error('Auth failed'))
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'wrong' },
            )
            const result = await connector.authenticate()
            expect(result.success).toBe(false)
        })
    })

    describe('createDirectory', () => {
        it('should create a directory in write mode', async () => {
            mockClient.exists.mockResolvedValue(false)
            mockClient.createDirectory.mockResolvedValue(undefined)
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
                { mode: 'rw' as any },
            )
            const result = await connector.createDirectory('/new-dir')
            expect(result.success).toBe(true)
        })

        it('should fail in read-only mode', async () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            const result = await connector.createDirectory('/new-dir')
            expect(result.success).toBe(false)
        })

        it('should fail if directory already exists', async () => {
            mockClient.exists.mockResolvedValue(true)
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
                { mode: 'rw' as any },
            )
            const result = await connector.createDirectory('/existing-dir')
            expect(result.success).toBe(false)
        })
    })

    describe('getFileContents', () => {
        it('should return file contents', async () => {
            const mockBlob = new Blob(['test data'])
            mockClient.exists.mockResolvedValue(true)
            mockClient.stat.mockResolvedValue({ type: 'file' })
            mockClient.getFileContents.mockResolvedValue(mockBlob)
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            const result = await connector.getFileContents('/test.txt')
            expect(result).toBe(mockBlob)
        })

        it('should return null in write-only mode', async () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
                { mode: 'w' as any },
            )
            const result = await connector.getFileContents('/test.txt')
            expect(result).toBeNull()
        })

        it('should return null when file not found', async () => {
            mockClient.exists.mockResolvedValue(false)
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            const result = await connector.getFileContents('/nonexistent.txt')
            expect(result).toBeNull()
        })

        it('should parse JSON when asJson option is set', async () => {
            const jsonData = { key: 'value' }
            mockClient.exists.mockResolvedValue(true)
            mockClient.stat.mockResolvedValue({ type: 'file', mime: 'text/plain' })
            mockClient.getFileContents.mockResolvedValue(JSON.stringify(jsonData))
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            const result = await connector.getFileContents('/data.json', { asJson: true })
            expect(result).toEqual(jsonData)
        })

        it('should return string for text response', async () => {
            mockClient.exists.mockResolvedValue(true)
            mockClient.stat.mockResolvedValue({ type: 'file', mime: 'text/plain' })
            mockClient.getFileContents.mockResolvedValue('plain text')
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            const result = await connector.getFileContents('/readme.txt', { asText: true })
            expect(result).toBe('plain text')
        })
    })

    describe('listContents', () => {
        it('should list directory contents', async () => {
            mockClient.getDirectoryContents.mockResolvedValue([
                { basename: 'file1.txt', filename: '/file1.txt', type: 'file', size: 100, mime: 'text/plain' },
            ])
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            const result = await connector.listContents('/')
            expect(result).toHaveProperty('files')
            expect(result.files).toHaveLength(1)
        })
    })

    describe('writeFile', () => {
        it('should write file in write mode', async () => {
            mockClient.exists.mockResolvedValue(false)
            mockClient.putFileContents.mockResolvedValue(undefined)
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
                { mode: 'rw' as any },
            )
            const result = await connector.writeFile('/test.txt', 'content')
            expect(result.success).toBe(true)
        })

        it('should fail in read-only mode', async () => {
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
            )
            const result = await connector.writeFile('/test.txt', 'content')
            expect(result.success).toBe(false)
        })

        it('should fail when file exists and overwrite is not set', async () => {
            mockClient.exists.mockResolvedValue(true)
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
                { mode: 'w' as any },
            )
            const result = await connector.writeFile('/test.txt', 'content', { overwrite: false })
            expect(result.success).toBe(false)
        })

        it('should overwrite existing file when overwrite is true', async () => {
            mockClient.exists.mockResolvedValue(true)
            mockClient.putFileContents.mockResolvedValue(undefined)
            const connector = new WebDAVConnector(
                'Test',
                'https://webdav.example.com',
                { username: 'user', password: 'pass' },
                { mode: 'w' as any },
            )
            const result = await connector.writeFile('/test.txt', 'content', { overwrite: true })
            expect(result.success).toBe(true)
        })
    })
})
