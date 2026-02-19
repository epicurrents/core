/**
 * Unit tests for GenericSignalWriter class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import GenericSignalWriter from '../../src/assets/reader/GenericSignalWriter'

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

jest.mock('../../src/util', () => ({
    NUMERIC_ERROR_VALUE: -1,
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
    GenericBiosignalHeader: jest.fn(),
}))

const mockEncoder = {
    dataEncoding: Float32Array,
    encodeData: jest.fn(),
}

class TestSignalWriter extends GenericSignalWriter {
    constructor(encoder: any = mockEncoder) {
        super(encoder)
    }
}

describe('GenericSignalWriter', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('constructor', () => {
        it('should create with encoder', () => {
            const writer = new TestSignalWriter()
            expect(writer.encoder).toBe(mockEncoder)
        })
    })

    describe('encoder getter/setter', () => {
        it('should get and set encoder', () => {
            const writer = new TestSignalWriter()
            const newEncoder = { dataEncoding: Int16Array, encodeData: jest.fn() } as any
            writer.encoder = newEncoder
            expect(writer.encoder).toBe(newEncoder)
        })
    })

    describe('setBiosignalHeader', () => {
        it('should set the header', () => {
            const writer = new TestSignalWriter()
            const header = { signals: [] } as any
            writer.setBiosignalHeader(header)
            // Should not throw
        })
    })

    describe('setFileTypeHeader', () => {
        it('should set file type header', () => {
            const writer = new TestSignalWriter()
            writer.setFileTypeHeader({ version: '1.0' })
        })
    })

    describe('setInterruptions', () => {
        it('should set interruptions', () => {
            const writer = new TestSignalWriter()
            const intrs = new Map([[5, 1]]) as any
            writer.setInterruptions(intrs)
        })
    })

    describe('setSourceArrayBuffer', () => {
        it('should set source buffer', () => {
            const writer = new TestSignalWriter()
            const buffer = new ArrayBuffer(100)
            writer.setSourceArrayBuffer(buffer)
        })
    })

    describe('setSourceDigitalSignals', () => {
        it('should set source signals', () => {
            const writer = new TestSignalWriter()
            const signals = [new Int16Array(10)] as any
            writer.setSourceDigitalSignals(signals)
        })
    })

    describe('writeRecordingToArrayBuffer (base)', () => {
        it('should log error and return null', async () => {
            const writer = new TestSignalWriter()
            const result = await writer.writeRecordingToArrayBuffer()
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('writeRecordingToFile (base)', () => {
        it('should log error and return null', async () => {
            const writer = new TestSignalWriter()
            const result = await writer.writeRecordingToFile('test.edf')
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('writeRecordingToStream (base)', () => {
        it('should log error and return null', () => {
            const writer = new TestSignalWriter()
            const result = writer.writeRecordingToStream()
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('destroy', () => {
        it('should clean up properties', async () => {
            const writer = new TestSignalWriter()
            writer.setSourceArrayBuffer(new ArrayBuffer(10))
            writer.setSourceDigitalSignals([new Int16Array(10)] as any)
            await writer.destroy()
        })
    })
})
