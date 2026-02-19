/**
 * Unit tests for GenericTextReader class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import GenericTextReader from '../../src/assets/reader/GenericTextReader'

import { TextDecoder } from 'util'
;(global as any).TextDecoder = TextDecoder

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

jest.mock('../../src/util', () => ({
    NUMERIC_ERROR_VALUE: -1,
}))

jest.mock('asymmetric-io-mutex', () => ({
    __esModule: true,
    default: { EMPTY_FIELD: -1 },
    MutexExportProperties: {},
}))

class TestTextReader extends GenericTextReader {
    constructor(dataEncoding: any = Uint8Array) {
        super(dataEncoding)
    }
    // Expose protected for testing
    get testEncodingLabel() { return this._encodingLabel }
    get testContinue() { return this._continue }
}

describe('GenericTextReader', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('constructor', () => {
        it('should default to utf-8 encoding for Uint8Array', () => {
            const reader = new TestTextReader(Uint8Array)
            expect(reader.testEncodingLabel).toBe('utf-8')
        })

        it('should use utf-16 encoding for Uint16Array', () => {
            const reader = new TestTextReader(Uint16Array)
            expect(reader.testEncodingLabel).toBe('utf-16')
        })

        it('should use utf-32 encoding for Uint32Array', () => {
            const reader = new TestTextReader(Uint32Array)
            expect(reader.testEncodingLabel).toBe('utf-32')
        })
    })

    describe('file getter/setter', () => {
        it('should get and set file', () => {
            const reader = new TestTextReader()
            expect(reader.file).toBeNull()
            const file = new File(['hello'], 'test.txt')
            reader.file = file
            expect(reader.file).toBe(file)
        })
    })

    describe('url getter/setter', () => {
        it('should get and set url', () => {
            const reader = new TestTextReader()
            expect(reader.url).toBe('')
            reader.url = 'https://example.com/data.txt'
            expect(reader.url).toBe('https://example.com/data.txt')
        })
    })

    describe('readPartFromFile', () => {
        it('should return null when no source available', async () => {
            const reader = new TestTextReader()
            const result = await reader.readPartFromFile(0, 100)
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })

        it('should reject invalid startFrom offset', async () => {
            const reader = new TestTextReader(Uint16Array)
            reader.file = new File(['hello'], 'test.txt')
            const result = await reader.readPartFromFile(3, 100)
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })

        it('should warn and round down for non-aligned dataLength', async () => {
            const reader = new TestTextReader(Uint16Array)
            // Mock file with arrayBuffer on slice
            const mockSlice = { arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(4)) }
            const mockFile = { slice: jest.fn().mockReturnValue(mockSlice) } as any
            reader.file = mockFile
            await reader.readPartFromFile(0, 5)
            expect(Log.warn).toHaveBeenCalled()
        })

        it('should read text from cached file', async () => {
            const reader = new TestTextReader()
            const encoder = new (require('util').TextEncoder)()
            const encoded = encoder.encode('hello')
            const mockSlice = { arrayBuffer: jest.fn().mockResolvedValue(encoded.buffer) }
            const mockFile = { slice: jest.fn().mockReturnValue(mockSlice) } as any
            reader.file = mockFile
            const result = await reader.readPartFromFile(0, 5)
            expect(result).toBe('hello')
        })
    })

    describe('destroy', () => {
        it('should clean up file and url', async () => {
            const reader = new TestTextReader()
            reader.file = new File(['test'], 'test.txt')
            reader.url = 'https://example.com'
            await reader.destroy()
            expect(reader.file).toBeNull()
            expect(reader.url).toBe('')
        })
    })
})
