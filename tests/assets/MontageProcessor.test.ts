/**
 * Unit tests for MontageProcessor class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import MontageProcessor from '../../src/assets/biosignal/service/MontageProcessor'

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
    // Trend math: don't run the real filter chain in this test file (it would pull in Fili.js
    // and require longer signals to be meaningful). Return a deterministic pair we can assert on.
    computeAmplitudeIntegratedEpoch: vi.fn().mockReturnValue([1.5, 7.5]),
    filterSignal: vi.fn(),
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
vi.mock('../../src/assets/biosignal/service/SharedWorkerCache')

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

const mockSettings = {
    filters: { highpass: 0, lowpass: 0, notch: 0 },
} as any

describe('MontageProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks()
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

    describe('Trend computation', () => {
        /**
         * Build a processor that knows about two channels (P3 + P4) and has a working
         * `getSignals` stub returning per-channel data based on the requested range. The amplitude
         * math itself is mocked at module level — these tests verify wiring + dispatch, not math.
         */
        const buildProcessor = (totalDuration: number, samplingRate = 256, sampleCount = totalDuration*samplingRate) => {
            const proc = new MontageProcessor(mockSettings)
            // Inject channels and total-duration state directly to avoid the full setup pathway.
            proc.channels = [
                { name: 'P3', samplingRate, sampleCount, modality: 'eeg' } as any,
                { name: 'P4', samplingRate, sampleCount, modality: 'eeg' } as any,
            ]
            ;(proc as any)._totalRecordingLength = totalDuration
            // Per-channel stub: each epoch returns a flat Float32Array of the right length.
            ;(proc as any).getSignals = vi.fn(async (range: number[], config?: any) => {
                const len = Math.round((range[1] - range[0])*samplingRate)
                const channels = (config?.include as number[]) || [0, 1]
                return {
                    start: range[0],
                    end: range[1],
                    signals: channels.map((idx: number) => ({
                        data: new Float32Array(len).fill(idx === 0 ? 1 : 0.5),
                        samplingRate,
                    })),
                }
            })
            return proc
        }

        const baseDerivation = {
            sourceChannels: [0],
            referenceChannels: [1],
            type: 'amplitude' as const,
        }

        describe('setupTrend', () => {
            it('should register a trend when source and reference channels are compatible', async () => {
                const proc = buildProcessor(60)
                const ok = await proc.setupTrend(
                    'aeeg-test', baseDerivation, 2/15, 15, 'average'
                )
                expect(ok).toBe(true)
            })

            it('should reject when source channels disagree on sampling rate', async () => {
                const proc = buildProcessor(60)
                // Force the source pair to have a divergent rate.
                proc.channels = [
                    { name: 'P3', samplingRate: 256, sampleCount: 256*60, modality: 'eeg' } as any,
                    { name: 'P3b', samplingRate: 512, sampleCount: 512*60, modality: 'eeg' } as any,
                    { name: 'P4', samplingRate: 256, sampleCount: 256*60, modality: 'eeg' } as any,
                ]
                const ok = await proc.setupTrend(
                    'aeeg-bad-sr',
                    { sourceChannels: [0, 1], referenceChannels: [2], type: 'amplitude' },
                    2/15, 15, 'average'
                )
                expect(ok).toBe(false)
                expect(Log.error).toHaveBeenCalled()
            })

            it('should reject when source and reference channels disagree on sampling rate', async () => {
                const proc = buildProcessor(60)
                proc.channels = [
                    { name: 'P3', samplingRate: 256, sampleCount: 256*60, modality: 'eeg' } as any,
                    { name: 'P4', samplingRate: 128, sampleCount: 128*60, modality: 'eeg' } as any,
                ]
                const ok = await proc.setupTrend(
                    'aeeg-bad-ref',
                    { sourceChannels: [0], referenceChannels: [1], type: 'amplitude' },
                    2/15, 15, 'average'
                )
                expect(ok).toBe(false)
            })

            it('should reject when source channel does not exist', async () => {
                const proc = buildProcessor(60)
                proc.channels = []
                const ok = await proc.setupTrend(
                    'aeeg-no-channels',
                    { sourceChannels: [0], referenceChannels: [1], type: 'amplitude' },
                    2/15, 15, 'average'
                )
                expect(ok).toBe(false)
            })

            it('should succeed even when channels have no sampleCount set', async () => {
                // Regression for a bug where the auto-aEEG setup failed against newly-mapped
                // montages: derived montage channels expose `samplingRate` but have `sampleCount`
                // unset until the first signal fetch. Setup must validate sampling rates only.
                const proc = new MontageProcessor(mockSettings)
                proc.channels = [
                    { name: 'P3', samplingRate: 256, modality: 'eeg' } as any,
                    { name: 'P4', samplingRate: 256, modality: 'eeg' } as any,
                ]
                ;(proc as any)._totalRecordingLength = 60
                const ok = await proc.setupTrend(
                    'aeeg-no-samplecount',
                    { sourceChannels: [0], referenceChannels: [1], type: 'amplitude' },
                    2/15, 15, 'average'
                )
                expect(ok).toBe(true)
            })
        })

        describe('computeTrendEpoch', () => {
            it('should return null when the trend has not been set up', async () => {
                const proc = buildProcessor(60)
                const result = await proc.computeTrendEpoch('missing', 0)
                expect(result).toBeNull()
                expect(Log.error).toHaveBeenCalled()
            })

            it('should return null for a negative epoch index', async () => {
                const proc = buildProcessor(60)
                await proc.setupTrend('aeeg-test', baseDerivation, 2/15, 15, 'average')
                const result = await proc.computeTrendEpoch('aeeg-test', -1)
                expect(result).toBeNull()
            })

            it('should return null for an out-of-range epoch index', async () => {
                const proc = buildProcessor(60)
                await proc.setupTrend('aeeg-test', baseDerivation, 2/15, 15, 'average')
                // totalDuration = 60 s, epochLength = 15 s → max epochIndex = 3 (covering 45–60).
                const result = await proc.computeTrendEpoch('aeeg-test', 10)
                expect(result).toBeNull()
            })

            it('should dispatch on derivation type and return the amplitude [min, max] pair', async () => {
                const proc = buildProcessor(60)
                await proc.setupTrend('aeeg-test', baseDerivation, 2/15, 15, 'average')
                const result = await proc.computeTrendEpoch('aeeg-test', 1)
                // Module-mocked computeAmplitudeIntegratedEpoch returns [1.5, 7.5].
                expect(result).toEqual([1.5, 7.5])
            })

            it('should return null when getSignals yields nothing for the source range', async () => {
                const proc = buildProcessor(60)
                await proc.setupTrend('aeeg-test', baseDerivation, 2/15, 15, 'average')
                ;(proc as any).getSignals = vi.fn().mockResolvedValue({
                    start: 0, end: 15, signals: [],
                })
                const result = await proc.computeTrendEpoch('aeeg-test', 0)
                expect(result).toBeNull()
            })
        })

        describe('computeTrend / cancelTrendComputation', () => {
            it('should post a trend-epoch message per epoch and finish with trend-complete', async () => {
                const proc = buildProcessor(45) // 3 epochs of 15 s
                await proc.setupTrend('aeeg-test', baseDerivation, 2/15, 15, 'average')
                const posted: any[] = []
                const originalPostMessage = (globalThis as any).postMessage
                ;(globalThis as any).postMessage = vi.fn((msg) => posted.push(msg))
                try {
                    const ok = await proc.computeTrend('aeeg-test')
                    expect(ok).toBe(true)
                } finally {
                    ;(globalThis as any).postMessage = originalPostMessage
                }
                const epochMessages = posted.filter(m => m.action === 'trend-epoch')
                expect(epochMessages.length).toBe(3)
                expect(epochMessages[0].signal).toEqual([1.5, 7.5])
                expect(epochMessages.map(m => m.epochIndex)).toEqual([0, 1, 2])
                expect(posted.some(m => m.action === 'trend-complete' && m.name === 'aeeg-test')).toBe(true)
            })

            it('should post a trend-error message when the trend has not been set up', async () => {
                const proc = buildProcessor(45)
                const posted: any[] = []
                const originalPostMessage = (globalThis as any).postMessage
                ;(globalThis as any).postMessage = vi.fn((msg) => posted.push(msg))
                try {
                    const ok = await proc.computeTrend('not-registered')
                    expect(ok).toBe(false)
                } finally {
                    ;(globalThis as any).postMessage = originalPostMessage
                }
                expect(posted.some(m => m.action === 'trend-error')).toBe(true)
            })

            it('should respect a cancellation requested before the next epoch', async () => {
                const proc = buildProcessor(60) // 4 epochs
                await proc.setupTrend('aeeg-test', baseDerivation, 2/15, 15, 'average')
                const posted: any[] = []
                const originalPostMessage = (globalThis as any).postMessage
                ;(globalThis as any).postMessage = vi.fn((msg) => {
                    posted.push(msg)
                    // Request cancellation after the first epoch is delivered.
                    if (msg.action === 'trend-epoch' && msg.epochIndex === 0) {
                        proc.cancelTrendComputation('aeeg-test')
                    }
                })
                try {
                    const ok = await proc.computeTrend('aeeg-test')
                    expect(ok).toBe(false)
                } finally {
                    ;(globalThis as any).postMessage = originalPostMessage
                }
                const epochMessages = posted.filter(m => m.action === 'trend-epoch')
                expect(epochMessages.length).toBeLessThan(4)
                expect(posted.some(m => m.action === 'trend-cancelled' && m.name === 'aeeg-test')).toBe(true)
                // Once cancelled, no trend-complete should be emitted.
                expect(posted.some(m => m.action === 'trend-complete')).toBe(false)
            })

            it('should compute only epochs inside the given range', async () => {
                const proc = buildProcessor(60)
                await proc.setupTrend('aeeg-test', baseDerivation, 2/15, 15, 'average')
                const posted: any[] = []
                const originalPostMessage = (globalThis as any).postMessage
                ;(globalThis as any).postMessage = vi.fn((msg) => posted.push(msg))
                try {
                    await proc.computeTrend('aeeg-test', [15, 45]) // epochs 1 + 2
                } finally {
                    ;(globalThis as any).postMessage = originalPostMessage
                }
                const epochMessages = posted.filter(m => m.action === 'trend-epoch')
                expect(epochMessages.length).toBe(2)
                expect(epochMessages.map(m => m.epochIndex).sort()).toEqual([1, 2])
            })

            it('cancelTrendComputation should be a no-op for unknown trend names', () => {
                const proc = buildProcessor(60)
                // Should not throw.
                expect(() => proc.cancelTrendComputation('nope')).not.toThrow()
            })
        })
    })
})
