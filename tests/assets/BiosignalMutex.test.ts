/**
 * Unit tests for BiosignalMutex class.
 * Note: BiosignalMutex extends IOMutex from asymmetric-io-mutex which requires
 * SharedArrayBuffer. Testing is limited to static properties and the
 * convertPropertiesForCoupling static method.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

vi.mock('../../src/util/signal', () => ({
    concatTypedNumberArrays: vi.fn(),
    floatsAreEqual: vi.fn().mockReturnValue(true),
}))

vi.mock('../../src/util/constants', () => ({
    NUMERIC_ERROR_VALUE: -1,
}))

// Need to mock IOMutex properly since BiosignalMutex extends it
vi.mock('asymmetric-io-mutex', () => {
    class MockIOMutex {
        static EMPTY_FIELD = -1
        static UNASSIGNED_VALUE = -2
        static MUTEX_SCOPE = { INPUT: 'input', OUTPUT: 'output' }
        static OPERATION_MODE = { READ: 'read', WRITE: 'write' }
        _inputDataViews: any[] = []
        _inputDataFields: any[] = []
        _outputData: any = null
        _outputMeta: any = { view: null }
        _outputDataFieldsLen = 3
        propertiesForCoupling = { meta: { fields: [] }, data: null }
        constructor(..._args: any[]) {}
        executeWithLock(_scope: any, _mode: any, fn: any) { return fn() }
        initialize() {}
        setDataArrays() {}
        setDataFieldValue() {}
        setData() {}
        _getMetaFieldValue() { return Promise.resolve(null) }
        _getMetaFieldProperties() { return null }
        _setOutputMetaFieldValue() {}
        _setOutputDataFieldValue() {}
        _getDataFieldValue() { return Promise.resolve(null) }
        get outputDataViews() { return [] }
        releaseBuffers() {}
    }
    return {
        __esModule: true,
        IOMutex: MockIOMutex,
        default: MockIOMutex,
        MutexExportProperties: {},
    }
})

import BiosignalMutex from '../../src/assets/biosignal/service/BiosignalMutex'

describe('BiosignalMutex', () => {
    describe('static properties', () => {
        it('should have master lock constants', () => {
            expect(BiosignalMutex.MASTER_LOCK_POS).toBe(0)
            expect(BiosignalMutex.MASTER_LOCK_TIMEOUT).toBe(5000)
            expect(BiosignalMutex.MASTER_LOCK_VALUE).toBe(1)
        })

        it('should have range meta field constants', () => {
            expect(BiosignalMutex.RANGE_ALLOCATED_NAME).toBe('allocated')
            expect(BiosignalMutex.RANGE_END_NAME).toBe('end')
            expect(BiosignalMutex.RANGE_START_NAME).toBe('start')
        })

        it('should have data_unit_duration meta field constants at position 3', () => {
            expect(BiosignalMutex.DATA_UNIT_DURATION_NAME).toBe('data_unit_duration')
            expect(BiosignalMutex.DATA_UNIT_DURATION_POS).toBe(3)
            expect(BiosignalMutex.DATA_UNIT_DURATION_LENGTH).toBe(1)
        })

        it('should have signal data field constants', () => {
            expect(BiosignalMutex.SIGNAL_DATA_NAME).toBe('data')
            expect(BiosignalMutex.SIGNAL_SAMPLING_RATE_NAME).toBe('sampling_rate')
            expect(BiosignalMutex.SIGNAL_UPDATED_START_NAME).toBe('updated_start')
            expect(BiosignalMutex.SIGNAL_UPDATED_END_NAME).toBe('updated_end')
        })
    })

    describe('convertPropertiesForCoupling', () => {
        it('should convert typed array constructors to strings', () => {
            const props = {
                meta: {
                    fields: [
                        { constructor: Float32Array, name: 'test', length: 1, position: 0 },
                    ],
                },
                data: {
                    arrays: [
                        { constructor: Float32Array, length: 100, view: null },
                    ],
                    fields: [
                        { constructor: Float32Array, name: 'sr', length: 1, position: 0 },
                    ],
                },
            } as any
            const result = BiosignalMutex.convertPropertiesForCoupling(props)
            expect(result.meta.fields[0].constructor).toBe('Float32Array')
            expect(result.data!.arrays[0].constructor).toBe('Float32Array')
            expect(result.data!.fields[0].constructor).toBe('Float32Array')
        })

        it('should not convert already-string constructors', () => {
            const props = {
                meta: {
                    fields: [
                        { constructor: 'Float32Array', name: 'test', length: 1, position: 0 },
                    ],
                },
                data: null,
            } as any
            const result = BiosignalMutex.convertPropertiesForCoupling(props)
            expect(result.meta.fields[0].constructor).toBe('Float32Array')
        })
    })

    describe('constructor', () => {
        it('should create a mutex without parameters', () => {
            const mutex = new BiosignalMutex()
            expect(mutex).toBeDefined()
        })
    })

    describe('input-only mode (precacheMontages = false)', () => {
        it('hasOutputBuffer should be false when _outputData is null', () => {
            const mutex = new BiosignalMutex()
            expect(mutex.hasOutputBuffer).toBe(false)
        })

        it('outputRangeStart should resolve to null when no output buffer', async () => {
            const mutex = new BiosignalMutex()
            await expect(mutex.outputRangeStart).resolves.toBeNull()
        })

        it('outputRangeEnd should resolve to null when no output buffer', async () => {
            const mutex = new BiosignalMutex()
            await expect(mutex.outputRangeEnd).resolves.toBeNull()
        })

        it('outputRangeAllocated should resolve to null when no output buffer', async () => {
            const mutex = new BiosignalMutex()
            await expect(mutex.outputRangeAllocated).resolves.toBeNull()
        })

        it('dataUnitDurationMs should resolve to null when no output buffer', async () => {
            const mutex = new BiosignalMutex()
            await expect(mutex.dataUnitDurationMs).resolves.toBeNull()
        })

        it('insertSignals should be a no-op when no output buffer', async () => {
            const mutex = new BiosignalMutex()
            const part = { start: 0, end: 1, signals: [{ data: new Float32Array(256), samplingRate: 256 }] }
            await expect(mutex.insertSignals(part)).resolves.toBeUndefined()
        })

        it('invalidateOutputSignals should be a no-op when no output buffer', async () => {
            const mutex = new BiosignalMutex()
            await expect(mutex.invalidateOutputSignals()).resolves.toBeUndefined()
        })
    })

    describe('destroy', () => {
        it('should release buffers', () => {
            const mutex = new BiosignalMutex()
            mutex.destroy()
        })
    })

    describe('insertSignals — buffer-overshoot path', () => {
        // When the cache loop asks to insert a part whose `end × samplingRate`
        // exceeds the allocated buffer by less than one sample (a routine
        // outcome whenever `samplingRate × dataLength` has fractional part
        // ≥ 0.5), the truncation path runs. Two things must hold:
        //   1. `setData` is given exactly the prefix that fits between
        //      `startPos` and the end of the buffer — not the difference
        //      between requested and allocated lengths.
        //   2. `SIGNAL_UPDATED_END` is stored clamped to `dataPartLen`, so the
        //      read-back via `range.end / samplingRate` cannot overshoot
        //      `_totalDataLength` downstream.
        const setupOvershootMutex = (dataPartLen: number, samplingRate: number) => {
            const mutex = new BiosignalMutex()
            const view = new Float32Array(dataPartLen + 3) // +3 for the three field slots
            view[BiosignalMutex.SIGNAL_SAMPLING_RATE_POS] = samplingRate
            view[BiosignalMutex.SIGNAL_UPDATED_START_POS] = -1 // EMPTY_FIELD
            view[BiosignalMutex.SIGNAL_UPDATED_END_POS] = -1 // EMPTY_FIELD
            ;(mutex as unknown as { _outputData: unknown })._outputData = {
                arrays: [{ view }],
                fields: [],
            }
            // outputRangeStart / outputRangeEnd are async getters bound to the
            // mocked IOMutex meta layer. Stub them to a known buffer range.
            Object.defineProperty(mutex, 'outputRangeStart', {
                get: () => Promise.resolve(0),
                configurable: true,
            })
            Object.defineProperty(mutex, 'outputRangeEnd', {
                get: () => Promise.resolve(32),
                configurable: true,
            })
            return { mutex, view }
        }

        it('truncates the inserted data to the buffer remainder, not the overshoot', async () => {
            const dataPartLen = 3199
            const samplingRate = 99.9977
            const { mutex } = setupOvershootMutex(dataPartLen, samplingRate)
            const setDataSpy = vi.spyOn(mutex, 'setData')
            const part = {
                start: 0,
                end: 32,
                signals: [{ data: new Float32Array(3200), samplingRate }],
            }
            await mutex.insertSignals(part)
            // setData was called with the buffer-remainder prefix
            // (dataPartLen - startPos = 3199 - 0 = 3199), not the overshoot
            // count (endPos - dataPartLen = 1).
            expect(setDataSpy).toHaveBeenCalledTimes(1)
            const [channelIdx, writtenData, atStartPos] = setDataSpy.mock.calls[0]
            expect(channelIdx).toBe(0)
            expect(atStartPos).toBe(0)
            expect((writtenData as Float32Array).length).toBe(3199)
        })

        it('clamps SIGNAL_UPDATED_END to the buffer size on overshoot', async () => {
            const dataPartLen = 3199
            const samplingRate = 99.9977
            const { mutex } = setupOvershootMutex(dataPartLen, samplingRate)
            const setFieldSpy = vi.spyOn(mutex, 'setDataFieldValue')
            const part = {
                start: 0,
                end: 32,
                signals: [{ data: new Float32Array(3200), samplingRate }],
            }
            await mutex.insertSignals(part)
            const endCalls = setFieldSpy.mock.calls.filter(
                (call) => call[0] === BiosignalMutex.SIGNAL_UPDATED_END_NAME
            )
            expect(endCalls).toHaveLength(1)
            // Round((32 − 0) × 99.9977) = 3200 — the unclamped value the bug
            // used to store. The clamp pins the stored end to dataPartLen so
            // `range.end / samplingRate = 3199 / 99.9977 ≈ 31.9976 ≤ 32`.
            const [, storedEnd] = endCalls[0]
            expect(storedEnd).toBe(dataPartLen)
        })

        it('stores the unclamped endPos when the data fits without truncation', async () => {
            // The clamp must not regress the in-bounds path: when nothing was
            // truncated, the stored end is the same `round(end × sr)` value
            // that downstream code converts back to seconds.
            const dataPartLen = 3200
            const samplingRate = 100
            const { mutex } = setupOvershootMutex(dataPartLen, samplingRate)
            const setFieldSpy = vi.spyOn(mutex, 'setDataFieldValue')
            const part = {
                start: 0,
                end: 32,
                signals: [{ data: new Float32Array(3200), samplingRate }],
            }
            await mutex.insertSignals(part)
            const endCalls = setFieldSpy.mock.calls.filter(
                (call) => call[0] === BiosignalMutex.SIGNAL_UPDATED_END_NAME
            )
            expect(endCalls).toHaveLength(1)
            expect(endCalls[0][1]).toBe(3200)
        })
    })
})
