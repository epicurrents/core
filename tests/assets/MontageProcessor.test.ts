/**
 * Unit tests for MontageProcessor class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import MontageProcessor from '../../src/assets/biosignal/service/MontageProcessor'

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

jest.mock('../../src/util', () => ({
    deepClone: jest.fn((obj) => {
        if (obj === null || obj === undefined) return obj
        try { return JSON.parse(JSON.stringify(obj)) } catch { return null }
    }),
    safeObjectFrom: jest.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
    INDEX_NOT_ASSIGNED: -1,
    NUMERIC_ERROR_VALUE: -1,
    MB_BYTES: 1048576,
    combineSignalParts: jest.fn().mockReturnValue(true),
    partsNotCached: jest.fn().mockReturnValue([]),
    sleep: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../src/util/constants', () => ({
    INDEX_NOT_ASSIGNED: -1,
    NUMERIC_ERROR_VALUE: -1,
}))

jest.mock('../../src/util/signal', () => ({
    calculateSignalOffsets: jest.fn(),
    combineAllSignalParts: jest.fn(),
    combineSignalParts: jest.fn().mockReturnValue(false),
    concatTypedNumberArrays: jest.fn(),
    floatsAreEqual: jest.fn().mockReturnValue(true),
    isContinuousSignal: jest.fn().mockReturnValue(false),
    mapMontageChannels: jest.fn().mockReturnValue([]),
    mapSignalsToSamplingRates: jest.fn().mockReturnValue([]),
    shouldDisplayChannel: jest.fn().mockReturnValue(true),
}))

jest.mock('../../src/events/EventBus')

jest.mock('@stdlib/constants-float32', () => ({
    EPS: 1.1920928955078125e-07,
}))

jest.mock('asymmetric-io-mutex', () => ({
    __esModule: true,
    default: { EMPTY_FIELD: -1 },
    IOMutex: jest.fn(),
    MutexExportProperties: {},
}))

jest.mock('../../src/assets/biosignal/service/BiosignalCache')
jest.mock('../../src/assets/biosignal/service/BiosignalMutex')
jest.mock('../../src/assets/biosignal/service/MontageService', () => jest.fn())
jest.mock('../../src/assets/biosignal/service/SharedWorkerCache')

jest.mock('../../src/util/general', () => ({
    getOrSetValue: jest.fn((map, key, defaultValue) => {
        if (map.has(key)) return map.get(key)
        map.set(key, defaultValue)
        return defaultValue
    }),
    nullPromise: Promise.resolve(null),
    safeObjectFrom: jest.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

jest.mock('../../src/config/Settings', () => ({
    __esModule: true,
    default: {
        app: { dataChunkSize: 1048576, maxLoadCacheSize: 104857600 },
    },
}))

const mockSettings = {
    filters: { highpass: 0, lowpass: 0, notch: 0 },
} as any

describe('MontageProcessor', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('constructor', () => {
        it('should create a montage processor with settings', () => {
            const proc = new MontageProcessor(mockSettings)
            expect(proc.channels).toEqual([])
            expect(proc.settings).toBe(mockSettings)
        })
    })

    describe('channels getter/setter', () => {
        it('should get and set channels', () => {
            const proc = new MontageProcessor(mockSettings)
            expect(proc.channels).toEqual([])
            const channels = [{ name: 'Ch1' }] as any
            proc.channels = channels
            expect(proc.channels).toBe(channels)
        })
    })

    describe('filters', () => {
        it('should return filters from settings', () => {
            const proc = new MontageProcessor(mockSettings)
            expect(proc.filters).toEqual({ highpass: 0, lowpass: 0, notch: 0 })
        })
    })

    describe('settings getter/setter', () => {
        it('should update settings', () => {
            const proc = new MontageProcessor(mockSettings)
            const newSettings = { filters: { highpass: 1, lowpass: 100, notch: 50 } } as any
            proc.settings = newSettings
            expect(proc.settings).toBe(newSettings)
        })
    })

    describe('setHighpassFilter', () => {
        it('should set global highpass filter', () => {
            const proc = new MontageProcessor(mockSettings)
            proc.setHighpassFilter(1.0)
            expect(proc.filters.highpass).toBe(1.0)
        })
    })

    describe('setLowpassFilter', () => {
        it('should set global lowpass filter', () => {
            const proc = new MontageProcessor(mockSettings)
            proc.setLowpassFilter(100.0)
            expect(proc.filters.lowpass).toBe(100.0)
        })
    })

    describe('setNotchFilter', () => {
        it('should set global notch filter', () => {
            const proc = new MontageProcessor(mockSettings)
            proc.setNotchFilter(50.0)
            expect(proc.filters.notch).toBe(50.0)
        })
    })

    describe('getSignals', () => {
        it('should return null when cache not set up', async () => {
            const proc = new MontageProcessor(mockSettings)
            const result = await proc.getSignals([0, 10])
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('destroy', () => {
        it('should clean up processor', async () => {
            const proc = new MontageProcessor(mockSettings)
            await proc.destroy()
        })
    })
})
