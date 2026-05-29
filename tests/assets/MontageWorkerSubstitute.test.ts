/**
 * Unit tests for MontageWorkerSubstitute class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import MontageWorkerSubstitute from '../../src/assets/biosignal/service/MontageWorkerSubstitute'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

vi.mock('../../src/util', () => ({
    deepClone: vi.fn((obj) => {
        if (obj === null || obj === undefined) return obj
        try { return JSON.parse(JSON.stringify(obj)) } catch { return null }
    }),
    safeObjectFrom: vi.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
    validateCommissionProps: vi.fn((message, schema, ready, returnMsg) => {
        if (!ready) {
            returnMsg({ ...message, success: false })
            return null
        }
        return message
    }),
    INDEX_NOT_ASSIGNED: -1,
    NUMERIC_ERROR_VALUE: -1,
    MB_BYTES: 1048576,
    combineSignalParts: vi.fn().mockReturnValue(true),
    partsNotCached: vi.fn().mockReturnValue([]),
    sleep: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/util/constants', () => ({
    INDEX_NOT_ASSIGNED: -1,
    NUMERIC_ERROR_VALUE: -1,
}))

vi.mock('../../src/util/signal', () => ({
    calculateSignalOffsets: vi.fn(),
    combineAllSignalParts: vi.fn(),
    combineSignalParts: vi.fn().mockReturnValue(false),
    concatTypedNumberArrays: vi.fn(),
    floatsAreEqual: vi.fn().mockReturnValue(true),
    isContinuousSignal: vi.fn().mockReturnValue(false),
    mapMontageChannels: vi.fn().mockReturnValue([]),
    mapSignalsToSamplingRates: vi.fn().mockReturnValue([]),
    shouldDisplayChannel: vi.fn().mockReturnValue(true),
}))

vi.mock('../../src/events/EventBus')

vi.mock('@stdlib/constants-float32', () => ({
    EPS: 1.1920928955078125e-07,
}))

vi.mock('asymmetric-io-mutex', () => ({
    __esModule: true,
    default: { EMPTY_FIELD: -1 },
    IOMutex: vi.fn(),
    MutexExportProperties: {},
}))

vi.mock('../../src/assets/biosignal/service/BiosignalCache')
vi.mock('../../src/assets/biosignal/service/BiosignalMutex')
vi.mock('../../src/assets/biosignal/service/MontageService', () => ({ default: vi.fn() }))
vi.mock('../../src/assets/biosignal/service/MontageProcessor')
vi.mock('../../src/util/general', () => ({
    getOrSetValue: vi.fn((map, key, defaultValue) => {
        if (map.has(key)) return map.get(key)
        map.set(key, defaultValue)
        return defaultValue
    }),
    nullPromise: Promise.resolve(null),
    safeObjectFrom: vi.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

vi.mock('../../src/config/Settings', () => ({
    __esModule: true,
    default: {
        app: { dataChunkSize: 1048576, maxLoadCacheSize: 104857600 },
    },
}))

describe('MontageWorkerSubstitute', () => {
    let substitute: MontageWorkerSubstitute

    beforeEach(() => {
        vi.clearAllMocks()
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
            const listener = vi.fn()
            substitute.addEventListener('message', listener)
            await substitute.postMessage({ action: 'release-cache', rn: 1 } as any)
            expect(Log.debug).toHaveBeenCalledWith(
                expect.stringContaining('release-cache'),
                expect.any(String)
            )
        })

        it('should handle shutdown action', async () => {
            const listener = vi.fn()
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
            const listener = vi.fn()
            substitute.addEventListener('message', listener)
            await substitute.postMessage({ action: 'get-signals', rn: 1, range: [0, 10] } as any)
            // validateCommissionProps returns null when montage not ready
        })

        // The 'release-signal-arrays' commission (Level 1 of the cache lifecycle —
        // see CLAUDE.md "Worker commission design — three places to keep in sync")
        // was added in 2026-05 alongside the real montage worker. The substitute
        // dispatch is hand-maintained separately from the real worker's action
        // map, so this regression pins the contract: when the substitute receives
        // the action, it forwards to the processor and returns success. Forgetting
        // to mirror new actions across the worker/substitute split is the
        // documented hazard that bit the initial aEEG landing.
        it('should handle release-signal-arrays action', async () => {
            const release = vi.fn().mockResolvedValue(undefined)
            ;(substitute as any)._montage = { releaseSignalArrays: release }
            const listener = vi.fn()
            substitute.addEventListener('message', listener)
            await substitute.postMessage({ action: 'release-signal-arrays', rn: 7 } as any)
            expect(release).toHaveBeenCalledTimes(1)
            // The success reply carries the original rn so the caller can correlate.
            const reply = listener.mock.calls.find(
                ([ev]) => (ev as MessageEvent).data?.rn === 7
            )?.[0] as MessageEvent | undefined
            expect(reply).toBeDefined()
            expect(reply!.data.success).toBe(true)
        })

        it('release-signal-arrays still returns success when no montage exists', async () => {
            // Pre-setup posting must not throw — the substitute uses `?.` and
            // returns success regardless. Without this, an early or stray
            // release-signal-arrays during setup would crash the harness.
            const listener = vi.fn()
            substitute.addEventListener('message', listener)
            await substitute.postMessage({ action: 'release-signal-arrays', rn: 8 } as any)
            const reply = listener.mock.calls.find(
                ([ev]) => (ev as MessageEvent).data?.rn === 8
            )?.[0] as MessageEvent | undefined
            expect(reply).toBeDefined()
            expect(reply!.data.success).toBe(true)
        })
    })
})
