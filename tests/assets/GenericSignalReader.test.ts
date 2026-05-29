/**
 * Unit tests for GenericSignalReader class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import GenericSignalReader from '../../src/assets/reader/GenericSignalReader'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

vi.mock('../../src/util', () => ({
    combineSignalParts: vi.fn().mockReturnValue(true),
    MB_BYTES: 1048576,
    NUMERIC_ERROR_VALUE: -1,
    partsNotCached: vi.fn().mockReturnValue([]),
    sleep: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/util/constants', () => ({
    NUMERIC_ERROR_VALUE: -1,
}))

vi.mock('@stdlib/constants-float32', () => ({
    EPS: 1.1920928955078125e-07,
}))

vi.mock('asymmetric-io-mutex', () => ({
    __esModule: true,
    default: { EMPTY_FIELD: -1 },
    IOMutex: vi.fn(),
    MutexExportProperties: {},
}))

vi.mock('../../src/assets/biosignal', () => ({
    BiosignalCache: vi.fn().mockImplementation(() => ({
        outputRangeStart: Promise.resolve(0),
        outputRangeEnd: Promise.resolve(100),
        outputSignalUpdatedRanges: [],
        outputSignalSamplingRates: [],
        insertSignals: vi.fn().mockResolvedValue(undefined),
        asCachePart: vi.fn().mockResolvedValue({ start: 0, end: 100, signals: [] }),
        releaseBuffers: vi.fn(),
    })),
    BiosignalMutex: vi.fn().mockImplementation(() => ({
        propertiesForCoupling: {},
        initSignalBuffers: vi.fn(),
        outputRangeStart: Promise.resolve(0),
        outputRangeEnd: Promise.resolve(100),
        outputSignalUpdatedRanges: [],
        outputSignalSamplingRates: [],
        releaseBuffers: vi.fn(),
    })),
    GenericBiosignalHeader: vi.fn(),
}))

vi.mock('../../src/config/Settings', () => ({
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
        vi.clearAllMocks()
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
            const cb = vi.fn()
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

    // Cross-activation race regression tests. The drain in `releaseSignalArrays`
    // and the cascade from `releaseCache` are documented in CLAUDE.md under
    // "Three-level cache lifecycle" — removing or reordering them reintroduces
    // the "stale cache-signals progress message after release ack" race that
    // broke reactivation. These tests pin the observable invariants so a future
    // refactor can't silently undo the fix.
    describe('releaseSignalArrays (Level 1)', () => {
        // Helper: a TestSignalReader with `_cacheProcesses` directly accessible
        // so we can stage in-flight reads without the full cacheSignals harness.
        class CacheTestReader extends TestSignalReader {
            get testCacheProcesses () { return (this as any)._cacheProcesses as any[] }
            pushProc (proc: any) { (this as any)._cacheProcesses.push(proc) }
        }

        it('cancels all in-progress caching loops (sets proc.continue=false)', async () => {
            const reader = new CacheTestReader()
            const procs = [
                { continue: true, inFlightRead: null },
                { continue: true, inFlightRead: null },
                { continue: true, inFlightRead: null },
            ]
            procs.forEach(p => reader.pushProc(p))
            await reader.releaseSignalArrays()
            for (const p of procs) {
                expect(p.continue).toBe(false)
            }
        })

        it('clears _cacheProcesses after release', async () => {
            const reader = new CacheTestReader()
            reader.pushProc({ continue: true, inFlightRead: null })
            reader.pushProc({ continue: true, inFlightRead: null })
            expect(reader.testCacheProcesses.length).toBe(2)
            await reader.releaseSignalArrays()
            expect(reader.testCacheProcesses.length).toBe(0)
        })

        it('awaits any in-flight chunk read before resolving (drain invariant)', async () => {
            const reader = new CacheTestReader()
            // Construct a deferred to act as the currently-running _readAndCachePart chunk.
            let resolveChunk!: (v: number) => void
            const inFlightRead = new Promise<number>(resolve => { resolveChunk = resolve })
            reader.pushProc({ continue: true, inFlightRead })

            // Start the release — should NOT resolve until the in-flight chunk resolves.
            let released = false
            const releasePromise = reader.releaseSignalArrays().then(() => { released = true })

            // Yield enough microtasks that any synchronous resolution would have flipped `released`.
            await Promise.resolve()
            await Promise.resolve()
            expect(released).toBe(false)

            // Resolve the in-flight chunk — release should now complete.
            resolveChunk(42)
            await releasePromise
            expect(released).toBe(true)
            // And the process list should be cleared.
            expect(reader.testCacheProcesses.length).toBe(0)
        })
    })

    describe('releaseCache (Level 2) cascades to Level 1', () => {
        it('calls releaseSignalArrays before tearing down the cache', async () => {
            const reader = new TestSignalReader()
            reader.setupCache(100)
            // Spy on the Level 1 method; releaseCache must invoke it.
            const level1Spy = vi.spyOn(reader, 'releaseSignalArrays')
            await reader.releaseCache()
            expect(level1Spy).toHaveBeenCalled()
            // And the cache is gone afterwards (full Level 2 teardown).
            expect(reader.cacheReady).toBe(false)
        })
    })
})
