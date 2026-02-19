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

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

jest.mock('../../src/util/signal', () => ({
    concatTypedNumberArrays: jest.fn(),
    floatsAreEqual: jest.fn().mockReturnValue(true),
}))

jest.mock('../../src/util/constants', () => ({
    NUMERIC_ERROR_VALUE: -1,
}))

// Need to mock IOMutex properly since BiosignalMutex extends it
jest.mock('asymmetric-io-mutex', () => {
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

    describe('destroy', () => {
        it('should release buffers', () => {
            const mutex = new BiosignalMutex()
            mutex.destroy()
        })
    })
})
