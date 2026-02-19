/**
 * Unit tests for GenericSignalReader class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import GenericSignalReader from '../../src/assets/reader/GenericSignalReader'

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

jest.mock('../../src/util', () => ({
    combineSignalParts: jest.fn().mockReturnValue(true),
    MB_BYTES: 1048576,
    NUMERIC_ERROR_VALUE: -1,
    partsNotCached: jest.fn().mockReturnValue([]),
    sleep: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../src/util/constants', () => ({
    NUMERIC_ERROR_VALUE: -1,
}))

jest.mock('@stdlib/constants-float32', () => ({
    EPS: 1.1920928955078125e-07,
}))

jest.mock('asymmetric-io-mutex', () => ({
    __esModule: true,
    default: { EMPTY_FIELD: -1 },
    MutexExportProperties: {},
}))

jest.mock('../../src/assets/biosignal', () => ({
    BiosignalCache: jest.fn().mockImplementation(() => ({
        outputRangeStart: Promise.resolve(0),
        outputRangeEnd: Promise.resolve(100),
        outputSignalUpdatedRanges: [],
        outputSignalSamplingRates: [],
        insertSignals: jest.fn().mockResolvedValue(undefined),
        asCachePart: jest.fn().mockResolvedValue({ start: 0, end: 100, signals: [] }),
        releaseBuffers: jest.fn(),
    })),
    BiosignalMutex: jest.fn().mockImplementation(() => ({
        propertiesForCoupling: {},
        initSignalBuffers: jest.fn(),
        outputRangeStart: Promise.resolve(0),
        outputRangeEnd: Promise.resolve(100),
        outputSignalUpdatedRanges: [],
        outputSignalSamplingRates: [],
        releaseBuffers: jest.fn(),
    })),
    GenericBiosignalHeader: jest.fn(),
}))

jest.mock('../../src/config/Settings', () => ({
    __esModule: true,
    default: {
        app: {
            dataChunkSize: 1048576,
            maxLoadCacheSize: 104857600,
        }
    },
}))

class TestSignalReader extends GenericSignalReader {
    constructor(dataEncoding: any = Float32Array, settings?: any) {
        super(dataEncoding, settings)
    }
    // Expose protected properties for testing
    get testFile() { return this._file }
    set testFile(v: any) { this._file = v }
    get testUrl() { return this._url }
    get testFilePos() { return this._filePos }
    get testIsMutexReady() { return this._isMutexReady }
    set testIsMutexReady(v: boolean) { this._isMutexReady = v }
    get testDataOffset() { return this._dataOffset }
    set testDataOffset(v: number) { this._dataOffset = v }
    set testDataUnitDuration(v: number) { this._dataUnitDuration = v }
    set testDataUnitCount(v: number) { this._dataUnitCount = v }
    set testDataUnitSize(v: number) { this._dataUnitSize = v }
    set testTotalRecordingLength(v: number) { this._totalRecordingLength = v }
    set testTotalDataLength(v: number) { this._totalDataLength = v }
    set testHeader(v: any) { this._header = v }
    set testFileTypeHeader(v: any) { this._fileTypeHeader = v }
    set testDecoder(v: any) { this._decoder = v }
}

describe('GenericSignalReader', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('static properties', () => {
        it('should have read direction constants', () => {
            expect(GenericSignalReader.READ_DIRECTION_ALTERNATING).toBe('alternate')
            expect(GenericSignalReader.READ_DIRECTION_BACKWARD).toBe('backward')
            expect(GenericSignalReader.READ_DIRECTION_FORWARD).toBe('forward')
        })

        it('should have default await timeout', () => {
            expect(GenericSignalReader.AWAIT_DATA_TIMEOUT).toBe(5000)
        })
    })

    describe('constructor', () => {
        it('should use default SETTINGS if none provided', () => {
            const reader = new TestSignalReader()
            expect(reader.SETTINGS).toBeDefined()
            expect(reader.SETTINGS.app.dataChunkSize).toBe(1048576)
        })

        it('should use provided settings', () => {
            const settings = { app: { dataChunkSize: 500, maxLoadCacheSize: 1000 } }
            const reader = new TestSignalReader(Float32Array, settings as any)
            expect(reader.SETTINGS.app.dataChunkSize).toBe(500)
        })
    })

    describe('url getter/setter', () => {
        it('should get and set url', () => {
            const reader = new TestSignalReader()
            expect(reader.url).toBe('')
            reader.url = 'https://example.com/file.edf'
            expect(reader.url).toBe('https://example.com/file.edf')
        })
    })

    describe('setUpdateCallback', () => {
        it('should set callback', () => {
            const reader = new TestSignalReader()
            const cb = jest.fn()
            reader.setUpdateCallback(cb)
            // No public getter, should not throw
        })

        it('should accept null', () => {
            const reader = new TestSignalReader()
            reader.setUpdateCallback(null)
        })
    })

    describe('setupCache', () => {
        it('should create a BiosignalCache', () => {
            const reader = new TestSignalReader()
            const cache = reader.setupCache(100)
            expect(cache).toBeDefined()
            expect(reader.cacheReady).toBe(true)
        })

        it('should warn if already initialized', () => {
            const reader = new TestSignalReader()
            reader.setupCache(100)
            reader.setupCache(100)
            expect(Log.warn).toHaveBeenCalled()
        })
    })

    describe('destroy', () => {
        it('should clean up resources', async () => {
            const reader = new TestSignalReader()
            reader.url = 'https://example.com'
            await reader.destroy()
            expect(reader.url).toBe('')
        })
    })

    describe('_readAndCachePart', () => {
        it('should return error when not set up', async () => {
            const reader = new TestSignalReader()
            const result = await reader._readAndCachePart(0)
            expect(result).toBe(-1)
            expect(Log.warn).toHaveBeenCalled()
        })

        it('should return error for out of range start', async () => {
            const reader = new TestSignalReader()
            reader.testDataUnitDuration = 1
            reader.testDataUnitCount = 100
            reader.testDataUnitSize = 256
            reader.testTotalRecordingLength = 100
            reader.setupCache(100)
            const result = await reader._readAndCachePart(200)
            expect(result).toBe(-1)
        })
    })

    describe('_readPartFromFile', () => {
        it('should return null when no URL', async () => {
            const reader = new TestSignalReader()
            const result = await reader._readPartFromFile(0, 10)
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })

        it('should return null when data unit size not set', async () => {
            const reader = new TestSignalReader()
            reader.url = 'https://example.com/file.edf'
            const result = await reader._readPartFromFile(0, 10)
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('getSignals', () => {
        it('should return null when cache not set up', async () => {
            const reader = new TestSignalReader()
            const result = await reader.getSignals([0, 10])
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })

        it('should return null for empty range', async () => {
            const reader = new TestSignalReader()
            reader.testFileTypeHeader = { version: '1.0' }
            reader.setupCache(100)
            const result = await reader.getSignals([5, 5])
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })
})
