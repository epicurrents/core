/**
 * Unit tests for GenericBiosignalHeader class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import GenericBiosignalHeader from '../../src/assets/biosignal/components/GenericBiosignalHeader'

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() }
}))

const makeSignal = (label: string, sampleCount: number, physicalUnit = 'µV') => ({
    label,
    sampleCount,
    physicalUnit,
    prefiltering: { highpass: null, lowpass: null, notch: null },
}) as any

describe('GenericBiosignalHeader', () => {
    beforeEach(() => {
        (Log.warn as jest.Mock).mockClear()
    })

    describe('constructor', () => {
        it('should create a header with basic properties', () => {
            const header = new GenericBiosignalHeader(
                'edf', 'rec-001', 'pat-001',
                100, 1, 512, 2,
                [makeSignal('Fp1', 256), makeSignal('Fp2', 256)],
            )
            expect(header.fileType).toBe('edf')
            expect(header.recordingId).toBe('rec-001')
            expect(header.patientId).toBe('pat-001')
            expect(header.dataUnitCount).toBe(100)
            expect(header.dataUnitDuration).toBe(1)
            expect(header.dataUnitSize).toBe(512)
            expect(header.signalCount).toBe(2)
        })

        it('should calculate dataDuration', () => {
            const header = new GenericBiosignalHeader(
                'edf', '', '', 60, 2, 0, 1, [makeSignal('Ch', 256)],
            )
            expect(header.dataDuration).toBe(120) // 60 * 2
        })

        it('should calculate duration including interruptions', () => {
            const interruptions = new Map([[10, 5], [50, 3]]) as any
            const header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 1, [makeSignal('Ch', 256)],
                null, false, [], [], interruptions,
            )
            expect(header.dataDuration).toBe(100)
            expect(header.duration).toBe(108) // 100 + 5 + 3
        })

        it('should accept recording start time', () => {
            const startTime = new Date('2024-01-01T08:00:00')
            const header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 1, [],
                startTime,
            )
            expect(header.recordingStartTime).toBe(startTime)
        })

        it('should default to not discontinuous', () => {
            const header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 1, [],
            )
            expect(header.discontinuous).toBe(false)
        })
    })

    describe('discontinuous setter', () => {
        it('should set discontinuous', () => {
            const header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 1, [],
            )
            header.discontinuous = true
            expect(header.discontinuous).toBe(true)
        })
    })

    describe('totalDuration', () => {
        it('should return dataUnitCount * dataUnitDuration', () => {
            const header = new GenericBiosignalHeader(
                'edf', '', '', 50, 2, 0, 1, [],
            )
            expect(header.totalDuration).toBe(100)
        })
    })

    describe('signalCount', () => {
        it('should fallback to signal properties length', () => {
            const header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 0,
                [makeSignal('Ch1', 256), makeSignal('Ch2', 256)],
            )
            expect(header.signalCount).toBe(2)
        })
    })

    describe('addEvents', () => {
        it('should add events', () => {
            const header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 0, [],
            )
            header.addEvents({ name: 'spike', start: 10, duration: 0.1 } as any)
            expect(header.events).toHaveLength(1)
        })
    })

    describe('addLabels', () => {
        it('should add labels', () => {
            const header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 0, [],
            )
            header.addLabels({ name: 'artifact', value: 'EMG' } as any)
            expect(header.labels).toHaveLength(1)
        })
    })

    describe('addInterruptions', () => {
        it('should add interruptions', () => {
            const header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 0, [],
            )
            const newIntr = new Map([[20, 2]]) as any
            header.addInterruptions(newIntr)
            expect(header.interruptions.get(20)).toBe(2)
        })
    })

    describe('signal property getters', () => {
        let header: GenericBiosignalHeader

        beforeEach(() => {
            header = new GenericBiosignalHeader(
                'edf', '', '', 100, 1, 0, 2,
                [
                    makeSignal('Fp1', 256, 'µV'),
                    makeSignal('Fp2', 512, 'mV'),
                ],
            )
        })

        it('should get signal label', () => {
            expect(header.getSignalLabel(0)).toBe('Fp1')
            expect(header.getSignalLabel(1)).toBe('Fp2')
        })

        it('should return null for out-of-range label', () => {
            expect(header.getSignalLabel(-1)).toBeNull()
            expect(header.getSignalLabel(5)).toBeNull()
            expect(Log.warn).toHaveBeenCalled()
        })

        it('should get sample count per record', () => {
            expect(header.getSignalNumberOfSamplesPerRecord(0)).toBe(256)
            expect(header.getSignalNumberOfSamplesPerRecord(1)).toBe(512)
        })

        it('should get physical unit', () => {
            expect(header.getSignalPhysicalUnit(0)).toBe('µV')
            expect(header.getSignalPhysicalUnit(1)).toBe('mV')
        })

        it('should get prefiltering', () => {
            const pf = header.getSignalPrefiltering(0)
            expect(pf).toHaveProperty('highpass')
        })

        it('should get sampling frequency', () => {
            expect(header.getSignalSamplingFrequency(0)).toBe(256) // 256 / 1
            expect(header.getSignalSamplingFrequency(1)).toBe(512)
        })

        it('should return null for zero dataUnitDuration', () => {
            const h = new GenericBiosignalHeader(
                'edf', '', '', 100, 0, 0, 1,
                [makeSignal('Ch', 256)],
            )
            expect(h.getSignalSamplingFrequency(0)).toBeNull()
            expect(Log.warn).toHaveBeenCalled()
        })
    })

    describe('serializable', () => {
        it('should return serializable representation', () => {
            const header = new GenericBiosignalHeader(
                'edf', 'rec', 'pat', 100, 1, 512, 2,
                [makeSignal('Fp1', 256)],
            )
            const s = header.serializable
            expect(s.fileType).toBe('edf')
            expect(s.recordingId).toBe('rec')
            expect(s.patientId).toBe('pat')
            expect(s.dataUnitCount).toBe(100)
            expect(s.signalCount).toBe(2)
            expect(s.signals).toHaveLength(1)
            expect(s.interruptions).toEqual([])
        })
    })
})
