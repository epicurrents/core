/**
 * Unit tests for GenericSignalProcessor class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import GenericSignalProcessor from '../../src/assets/reader/GenericSignalProcessor'

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

class TestSignalProcessor extends GenericSignalProcessor {
    constructor(dataEncoding: any = Float32Array) {
        super(dataEncoding)
    }
    // Expose protected properties for testing
    get testInterruptions() { return this._interruptions }
    get testEvents() { return this._events }
    get testLabels() { return this._labels }
    get testTotalDataLength() { return this._totalDataLength }
    set testTotalDataLength(v: number) { this._totalDataLength = v }
    get testTotalRecordingLength() { return this._totalRecordingLength }
    set testTotalRecordingLength(v: number) { this._totalRecordingLength = v }
    set testDataUnitDuration(v: number) { this._dataUnitDuration = v }
    set testDataUnitCount(v: number) { this._dataUnitCount = v }
    set testDiscontinuous(v: boolean) { this._discontinuous = v }
}

describe('GenericSignalProcessor', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('constructor and properties', () => {
        it('should create with default values', () => {
            const proc = new TestSignalProcessor()
            expect(proc.dataUnitSize).toBe(0)
            expect(proc.discontinuous).toBe(false)
            expect(proc.totalLength).toBe(0)
        })
    })

    describe('addNewEvents', () => {
        it('should add events grouped by record', () => {
            const proc = new TestSignalProcessor()
            const event1 = { start: 0, duration: 1, class: 'a', label: 'E1', priority: 0, type: 't' }
            const event2 = { start: 5, duration: 1, class: 'b', label: 'E2', priority: 0, type: 't' }
            proc.addNewEvents(event1 as any, event2 as any)
            const events = proc.getEvents()
            // Events should be accessible (total recording length is 0 so getEvents with defaults may return empty)
            // Set recording length to make getEvents work
            proc.testTotalRecordingLength = 100
            const eventsAfter = proc.getEvents()
            expect(eventsAfter.length).toBe(2)
        })

        it('should skip null/undefined events', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalRecordingLength = 100
            proc.addNewEvents(null as any, undefined as any)
            expect(proc.getEvents().length).toBe(0)
        })

        it('should not duplicate identical events', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalRecordingLength = 100
            const event = { start: 1, duration: 1, class: 'a', label: 'E1', priority: 0, type: 't' }
            proc.addNewEvents(event as any)
            proc.addNewEvents(event as any)
            expect(proc.getEvents().length).toBe(1)
        })
    })

    describe('addNewInterruptions', () => {
        it('should add interruptions sorted by position', () => {
            const proc = new TestSignalProcessor()
            const intrs = new Map<number, number>()
            intrs.set(10, 2)
            intrs.set(5, 1)
            proc.addNewInterruptions(intrs)
            const keys = [...proc.testInterruptions.keys()]
            expect(keys).toEqual([5, 10])
        })

        it('should skip invalid interruptions (zero or negative duration)', () => {
            const proc = new TestSignalProcessor()
            const intrs = new Map<number, number>()
            intrs.set(5, 0)
            intrs.set(10, -1)
            proc.addNewInterruptions(intrs)
            expect(proc.testInterruptions.size).toBe(0)
        })

        it('should not duplicate interruptions at same position', () => {
            const proc = new TestSignalProcessor()
            const intrs1 = new Map<number, number>()
            intrs1.set(5, 1)
            proc.addNewInterruptions(intrs1)
            const intrs2 = new Map<number, number>()
            intrs2.set(5, 2)
            proc.addNewInterruptions(intrs2)
            expect(proc.testInterruptions.get(5)).toBe(1)
        })
    })

    describe('addNewLabels', () => {
        it('should add unique labels', () => {
            const proc = new TestSignalProcessor()
            const label = { name: 'L1', class: 'c', label: 'Label', priority: 0, type: 't' }
            proc.addNewLabels(label as any)
            expect(proc.getLabels().length).toBe(1)
        })

        it('should skip null labels', () => {
            const proc = new TestSignalProcessor()
            proc.addNewLabels(null as any)
            expect(proc.getLabels().length).toBe(0)
        })

        it('should not duplicate identical labels', () => {
            const proc = new TestSignalProcessor()
            const label = { name: 'L1', class: 'c', label: 'Label', priority: 0, type: 't' }
            proc.addNewLabels(label as any)
            proc.addNewLabels(label as any)
            expect(proc.getLabels().length).toBe(1)
        })
    })

    describe('getEvents', () => {
        it('should return events within range', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalRecordingLength = 100
            proc.addNewEvents(
                { start: 5, duration: 1, class: 'a', label: 'E1', priority: 0, type: 't' } as any,
                { start: 50, duration: 1, class: 'b', label: 'E2', priority: 0, type: 't' } as any,
            )
            const events = proc.getEvents([0, 10])
            expect(events.length).toBe(1)
            expect(events[0].label).toBe('E1')
        })

        it('should return error for out of bounds range', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalRecordingLength = 100
            expect(proc.getEvents([200, 300])).toEqual([])
            expect(Log.error).toHaveBeenCalled()
        })

        it('should return error for empty range', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalRecordingLength = 100
            expect(proc.getEvents([50, 50])).toEqual([])
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('getInterruptions', () => {
        it('should return interruptions within range', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalRecordingLength = 100
            proc.testTotalDataLength = 90
            proc.setInterruptions(new Map([[10, 5], [50, 5]]) as any)
            proc.testDiscontinuous = true
            const intrs = proc.getInterruptions([0, 60])
            expect(intrs.length).toBe(2)
        })

        it('should return empty for invalid range', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalRecordingLength = 100
            const intrs = proc.getInterruptions([50, 10])
            expect(intrs).toEqual([])
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setEvents', () => {
        it('should replace all events', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalRecordingLength = 100
            proc.addNewEvents({ start: 1, duration: 1, class: 'a', label: 'old', priority: 0, type: 't' } as any)
            proc.setEvents([
                { start: 10, duration: 1, class: 'a', label: 'new1', priority: 0, type: 't' } as any,
                { start: 10, duration: 2, class: 'b', label: 'new2', priority: 0, type: 't' } as any,
            ])
            const events = proc.getEvents()
            expect(events.length).toBe(2)
            expect(events.every(e => e.label?.startsWith('new'))).toBe(true)
        })

        it('should skip null events', () => {
            const proc = new TestSignalProcessor()
            proc.setEvents([null as any])
            expect(proc.testEvents.size).toBe(0)
        })
    })

    describe('setLabels', () => {
        it('should replace all labels', () => {
            const proc = new TestSignalProcessor()
            proc.addNewLabels({ name: 'old', class: 'c', label: 'Old', priority: 0, type: 't' } as any)
            proc.setLabels([{ name: 'new', class: 'c', label: 'New', priority: 0, type: 't' } as any])
            expect(proc.getLabels().length).toBe(1)
            expect(proc.getLabels()[0].name).toBe('new')
        })
    })

    describe('setBiosignalHeader', () => {
        it('should set the header', () => {
            const proc = new TestSignalProcessor()
            const header = { signals: [] } as any
            proc.setBiosignalHeader(header)
            // No public getter, but should not throw
        })
    })

    describe('setFileTypeHeader', () => {
        it('should set the file type header', () => {
            const proc = new TestSignalProcessor()
            proc.setFileTypeHeader({ version: '1.0' })
            // No public getter, but should not throw
        })
    })

    describe('setInterruptions', () => {
        it('should set interruptions map', () => {
            const proc = new TestSignalProcessor()
            const intrs = new Map([[5, 1], [10, 2]]) as any
            proc.setInterruptions(intrs)
            expect(proc.testInterruptions.size).toBe(2)
        })
    })

    describe('_cacheTimeToRecordingTime', () => {
        it('should return NUMERIC_ERROR_VALUE for error input', () => {
            const proc = new TestSignalProcessor()
            expect(proc._cacheTimeToRecordingTime(-1)).toBe(-1)
        })

        it('should return same time for continuous recording', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalDataLength = 100
            expect(proc._cacheTimeToRecordingTime(50)).toBe(50)
        })

        it('should return 0 for time 0', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalDataLength = 100
            expect(proc._cacheTimeToRecordingTime(0)).toBe(0)
        })

        it('should log error for out of bounds time', () => {
            const proc = new TestSignalProcessor()
            proc.testTotalDataLength = 100
            proc._cacheTimeToRecordingTime(200)
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('_dataUnitIndexToTime', () => {
        it('should convert index to time', () => {
            const proc = new TestSignalProcessor()
            proc.testDataUnitDuration = 1
            proc.testDataUnitCount = 100
            expect(proc._dataUnitIndexToTime(50)).toBe(50)
        })

        it('should include prior interruptions', () => {
            const proc = new TestSignalProcessor()
            proc.testDataUnitDuration = 1
            proc.testDataUnitCount = 100
            proc.setInterruptions(new Map([[10, 5]]) as any)
            expect(proc._dataUnitIndexToTime(50)).toBe(55)
        })

        it('should log error for out of bounds index', () => {
            const proc = new TestSignalProcessor()
            proc.testDataUnitCount = 10
            proc._dataUnitIndexToTime(20)
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('getSignals (base implementation)', () => {
        it('should log error and return null', async () => {
            const proc = new TestSignalProcessor()
            const result = await proc.getSignals([0, 10])
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setupCacheWithInput (base implementation)', () => {
        it('should log error', () => {
            const proc = new TestSignalProcessor()
            proc.setupCacheWithInput({} as any, 0, 0)
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setupMutexWithInput (base implementation)', () => {
        it('should log error and return null', async () => {
            const proc = new TestSignalProcessor()
            const result = await proc.setupMutexWithInput({} as any, 0, 0, 0)
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setupSharedWorkerWithInput (base implementation)', () => {
        it('should log error and return false', async () => {
            const proc = new TestSignalProcessor()
            const result = await proc.setupSharedWorkerWithInput({} as any, 0, 0)
            expect(result).toBe(false)
            expect(Log.error).toHaveBeenCalled()
        })
    })
})
