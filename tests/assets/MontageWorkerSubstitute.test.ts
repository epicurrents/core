/**
 * Unit tests for MontageWorkerSubstitute class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import MontageWorkerSubstitute from '../../src/assets/biosignal/service/MontageWorkerSubstitute'

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
    validateCommissionProps: jest.fn((message, schema, ready, returnMsg) => {
        if (!ready) {
            returnMsg({ ...message, success: false })
            return null
        }
        return message
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
jest.mock('../../src/assets/biosignal/service/MontageProcessor')
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

describe('MontageWorkerSubstitute', () => {
    let substitute: MontageWorkerSubstitute

    beforeEach(() => {
        jest.clearAllMocks()
        substitute = new MontageWorkerSubstitute()
    })

    describe('constructor', () => {
        it('should create a worker substitute', () => {
            expect(substitute).toBeDefined()
        })
    })

    describe('postMessage', () => {
        it('should ignore messages without action', async () => {
            await substitute.postMessage(null as any)
            await substitute.postMessage({} as any)
            // Should not throw
        })

        it('should handle release-cache action', async () => {
            const listener = jest.fn()
            substitute.addEventListener('message', listener)
            await substitute.postMessage({ action: 'release-cache', rn: 1 } as any)
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('release-cache'),
                expect.any(String)
            )
        })

        it('should handle shutdown action', async () => {
            const listener = jest.fn()
            substitute.addEventListener('message', listener)
            await substitute.postMessage({ action: 'shutdown', rn: 1 } as any)
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('shutdown'),
                expect.any(String)
            )
        })

        it('should handle update-settings action', async () => {
            await substitute.postMessage({ action: 'update-settings', rn: 1 } as any)
            expect(Log.debug).toHaveBeenCalled()
        })

        it('should fail get-signals when montage not ready', async () => {
            const listener = jest.fn()
            substitute.addEventListener('message', listener)
            await substitute.postMessage({ action: 'get-signals', rn: 1, range: [0, 10] } as any)
            // validateCommissionProps returns null when montage not ready
        })
    })
})
