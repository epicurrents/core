/**
 * Unit tests for GenericBiosignalTrend.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import EventBus from '../../src/events/EventBus'
import GenericAsset from '../../src/assets/GenericAsset'
import GenericBiosignalTrend from '../../src/assets/biosignal/components/GenericBiosignalTrend'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() }
}))

vi.mock('../../src/events/EventBus')

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
}))

type EpochCallback = (signal: number[], epochIndex: number, totalEpochs: number) => void

const createMockService = () => {
    let captured: EpochCallback | null = null
    const computeProps = {
        cancel: vi.fn(),
        onEpochReady: vi.fn((cb: EpochCallback) => { captured = cb }),
        result: Promise.resolve(undefined),
        deliver (signal: number[], epochIndex: number, totalEpochs: number) {
            captured?.(signal, epochIndex, totalEpochs)
        },
    }
    return {
        setupTrend: vi.fn().mockResolvedValue({ success: true }),
        computeTrend: vi.fn().mockReturnValue(computeProps),
        // Expose handles so tests can drive callbacks / control the promise.
        _props: computeProps,
        _setResult (promise: Promise<unknown>) {
            computeProps.result = promise as Promise<undefined>
        },
    }
}

describe('GenericBiosignalTrend', () => {
    let mockService: ReturnType<typeof createMockService>
    let originalWindow: any

    beforeEach(() => {
        ;(GenericAsset as any).USED_IDS.clear()
        mockService = createMockService()
        originalWindow = global.window
        const mockEventBus = {
            addScopedEventListener: vi.fn(),
            dispatchScopedEvent: vi.fn().mockReturnValue(true),
            getEventHooks: vi.fn(),
            removeAllScopedEventListeners: vi.fn(),
            removeScopedEventListener: vi.fn(),
            removeScope: vi.fn(),
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
            unsubscribeAll: vi.fn(),
        }
        Object.defineProperty(global, 'window', {
            value: { __EPICURRENTS__: { APP: {}, EVENT_BUS: mockEventBus, RUNTIME: null } },
            writable: true,
        })
        ;(EventBus as MockedClass<typeof EventBus>).mockImplementation(function() { return mockEventBus as any })
    })

    afterEach(() => {
        global.window = originalWindow
    })

    const baseDerivation = {
        sourceChannels: [0],
        referenceChannels: [1],
        type: 'amplitude' as const,
    }

    describe('constructor', () => {
        it('should expose derivation, label, sampling rate and epoch length', () => {
            const trend = new GenericBiosignalTrend(
                'aeeg-test', 'aEEG P3-P4', baseDerivation, 0.133, 15, mockService as any
            )
            expect(trend.name).toBe('aeeg-test')
            expect(trend.label).toBe('aEEG P3-P4')
            expect(trend.epochLength).toBe(15)
            expect(trend.samplingRate).toBe(0.133)
            expect(trend.derivation).toBe(baseDerivation)
            expect(trend.signal).toEqual([])
        })

        it('should call service.setupTrend with the right arguments', () => {
            new GenericBiosignalTrend(
                'aeeg-test', 'aEEG', baseDerivation, 0.133, 15, mockService as any
            )
            expect(mockService.setupTrend).toHaveBeenCalledWith(
                'aeeg-test', baseDerivation, 0.133, 15, 'average'
            )
        })

        it('should honour an overridden downsamplingMethod from extraProperties', () => {
            new GenericBiosignalTrend(
                'aeeg-test', 'aEEG', baseDerivation, 0.133, 15, mockService as any,
                { downsamplingMethod: 'maximum' as any }
            )
            expect(mockService.setupTrend).toHaveBeenCalledWith(
                'aeeg-test', baseDerivation, 0.133, 15, 'maximum'
            )
        })
    })

    describe('computeTrend', () => {
        it('should accumulate per-epoch results into the signal buffer at correct slots', async () => {
            const trend = new GenericBiosignalTrend(
                'aeeg-test', 'aEEG', baseDerivation, 0.133, 15, mockService as any
            )
            // Capture the onEpochReady callback by starting (but not yet awaiting) the loop.
            const compute = trend.computeTrend()
            // Deliver three epochs; each contributes 2 samples (min/max pair).
            mockService._props.deliver([10, 20], 0, 3)
            mockService._props.deliver([12, 22], 1, 3)
            mockService._props.deliver([8, 18], 2, 3)
            await compute
            expect(trend.signal).toEqual([10, 20, 12, 22, 8, 18])
        })

        it('should overwrite an epoch slot when delivered again (idempotent re-deliveries)', async () => {
            const trend = new GenericBiosignalTrend(
                'aeeg-test', 'aEEG', baseDerivation, 0.133, 15, mockService as any
            )
            const compute = trend.computeTrend()
            mockService._props.deliver([1, 2], 0, 2)
            mockService._props.deliver([3, 4], 1, 2)
            // Re-deliver epoch 0 with new values; existing slot should be overwritten in place.
            mockService._props.deliver([5, 6], 0, 2)
            await compute
            expect(trend.signal).toEqual([5, 6, 3, 4])
        })

        it('should reset the signal buffer when computeTrend is called again', async () => {
            const trend = new GenericBiosignalTrend(
                'aeeg-test', 'aEEG', baseDerivation, 0.133, 15, mockService as any
            )
            const first = trend.computeTrend()
            mockService._props.deliver([1, 2], 0, 2)
            mockService._props.deliver([3, 4], 1, 2)
            await first
            expect(trend.signal.length).toBe(4)
            // Second run, fewer epochs delivered → signal buffer should not retain stale samples
            // from the previous run at the same slots.
            const second = trend.computeTrend()
            mockService._props.deliver([9, 9], 0, 1)
            await second
            expect(trend.signal).toEqual([9, 9])
        })

        it('should pass a range through to the service when provided', async () => {
            const trend = new GenericBiosignalTrend(
                'aeeg-test', 'aEEG', baseDerivation, 0.133, 15, mockService as any
            )
            const compute = trend.computeTrend([30, 60])
            await compute
            expect(mockService.computeTrend).toHaveBeenCalledWith('aeeg-test', [30, 60])
        })
    })

    describe('cancelTrendComputation', () => {
        it('should call service cancel when a computation is running', () => {
            const trend = new GenericBiosignalTrend(
                'aeeg-test', 'aEEG', baseDerivation, 0.133, 15, mockService as any
            )
            // Make the service compute promise pending so the trend doesn't clean up before we call cancel.
            mockService._setResult(new Promise(() => {}))
            trend.computeTrend().catch(() => {})
            trend.cancelTrendComputation()
            expect(mockService._props.cancel).toHaveBeenCalled()
        })

        it('should be safe to call when no computation is in flight', () => {
            const trend = new GenericBiosignalTrend(
                'aeeg-test', 'aEEG', baseDerivation, 0.133, 15, mockService as any
            )
            expect(() => trend.cancelTrendComputation()).not.toThrow()
        })
    })
})
