/**
 * Unit tests for GenericBiosignalMontage class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericBiosignalMontage from '../../src/assets/biosignal/components/GenericBiosignalMontage'
import GenericAsset from '../../src/assets/GenericAsset'

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

vi.mock('../../src/util/signal', () => ({
    calculateSignalOffsets: vi.fn(),
    combineAllSignalParts: vi.fn((...parts: any[]) => parts),
    combineSignalParts: vi.fn().mockReturnValue(false),
    isContinuousSignal: vi.fn().mockReturnValue(false),
    mapMontageChannels: vi.fn().mockReturnValue([]),
    shouldDisplayChannel: vi.fn().mockReturnValue(true),
}))

vi.mock('../../src/util/constants', () => ({
    NUMERIC_ERROR_VALUE: -1,
}))

vi.mock('asymmetric-io-mutex', () => ({
    MutexExportProperties: {},
}))

vi.mock('../../src/assets/biosignal/service/MontageService', () => ({
    default: vi.fn().mockImplementation(function() {
        return {
            id: 'mock-service-id',
            getSignals: vi.fn().mockResolvedValue(null),
            setFilters: vi.fn().mockResolvedValue({ success: true }),
            setInterruptions: vi.fn(),
            setupWorker: vi.fn(),
            setupMontageWithCache: vi.fn().mockResolvedValue(true),
            setupMontageWithInputMutex: vi.fn().mockResolvedValue(true),
            setupMontageWithSharedWorker: vi.fn().mockResolvedValue(true),
            unload: vi.fn().mockResolvedValue(undefined),
        }
    }),
}))

class TestBiosignalMontage extends GenericBiosignalMontage {
    constructor(
        name: string, recording: any, setup: any,
        template?: any, manager?: any, config?: any,
    ) {
        super(name, recording, setup, template, manager, config)
    }
}

describe('GenericBiosignalMontage', () => {
    let mockEventBus: any
    let mockRecording: any
    let mockSetup: any
    let originalWindow: any

    beforeEach(() => {
        (Log.error as ReturnType<typeof vi.fn>).mockClear()
        ;(GenericAsset as any).USED_IDS.clear()

        mockEventBus = {
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

        mockRecording = {
            modality: 'eeg',
            totalDuration: 100,
            filters: { bandreject: [], highpass: 0, lowpass: 0, notch: 0 },
            getInterruptions: vi.fn().mockReturnValue([]),
        }

        mockSetup = {
            channels: [],
            derivations: [],
        }

        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: {
                __EPICURRENTS__: { APP: {}, EVENT_BUS: mockEventBus, RUNTIME: null }
            } as any,
            writable: true,
        })

        ;(EventBus as MockedClass<typeof EventBus>).mockImplementation(function() { return mockEventBus as any })
    })

    afterEach(() => {
        global.window = originalWindow
    })

    describe('constructor', () => {
        it('should create a montage with name, recording, and setup', () => {
            const montage = new TestBiosignalMontage('Test Montage', mockRecording, mockSetup)
            expect(montage.name).toBe('Test Montage')
            expect(montage.modality).toBe('eeg')
            expect(montage.label).toBe('Test Montage')
            expect(montage.recording).toBe(mockRecording)
            expect(montage.setup).toBe(mockSetup)
        })

        it('should use config label if provided', () => {
            const montage = new TestBiosignalMontage(
                'Montage', mockRecording, mockSetup,
                undefined, undefined, { label: 'Custom Label' },
            )
            expect(montage.label).toBe('Custom Label')
        })

        it('should call setupChannels when template provided', () => {
            const template = { reference: { common: true, label: 'Avg', type: 'average' } }
            const montage = new TestBiosignalMontage(
                'Montage', mockRecording, mockSetup, template,
            )
            expect(montage.config).toBe(template)
            expect(montage.hasCommonReference).toBe(true)
        })
    })

    describe('label setter', () => {
        it('should set label', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            montage.label = 'New Label'
            expect(montage.label).toBe('New Label')
        })
    })

    describe('hasCommonReference', () => {
        it('should return false when no reference', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            expect(montage.hasCommonReference).toBe(false)
        })
    })

    describe('referenceLabel', () => {
        it('should return empty string when no reference', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            expect(montage.referenceLabel).toBe('')
        })

        it('should return label from reference', () => {
            const template = { reference: { common: true, label: 'AVG', type: 'average' } }
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup, template)
            expect(montage.referenceLabel).toBe('AVG')
        })
    })

    describe('filters', () => {
        it('should combine local and recording filters', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            const filters = montage.filters
            expect(filters).toHaveProperty('highpass')
            expect(filters).toHaveProperty('lowpass')
            expect(filters).toHaveProperty('notch')
            expect(filters).toHaveProperty('bandreject')
        })
    })

    describe('serviceId', () => {
        it('should return the service id', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            expect(montage.serviceId).toBe('mock-service-id')
        })
    })

    describe('highlights', () => {
        it('should add highlight context', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            const result = montage.addHighlightContext('markers', { data: [] })
            expect(result).toBe(true)
        })

        it('should reject duplicate highlight context', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            montage.addHighlightContext('markers', { data: [] })
            const result = montage.addHighlightContext('markers', { data: [] })
            expect(result).toBe(false)
            expect(Log.error).toHaveBeenCalled()
        })

        it('should remove all highlights', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            montage.addHighlightContext('a', {})
            montage.addHighlightContext('b', {})
            montage.removeAllHighlights()
            expect(Object.keys(montage.highlights)).toHaveLength(0)
        })
    })

    describe('getInterruptions', () => {
        it('should delegate to recording', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            montage.getInterruptions()
            expect(mockRecording.getInterruptions).toHaveBeenCalled()
        })
    })

    describe('resetSignalCache', () => {
        it('should clear cached signals', async () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            await montage.resetSignalCache()
            expect(montage.cacheStatus.signals).toEqual([])
            expect(montage.cacheStatus.start).toBe(0)
            expect(montage.cacheStatus.end).toBe(0)
        })
    })

    describe('setupChannels', () => {
        it('should set config and reference', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            const template = {
                reference: { common: true, label: 'REF', type: 'linked', description: 'Linked ears' },
            }
            montage.setupChannels(template as any)
            expect(montage.config).toBe(template)
            expect(montage.hasCommonReference).toBe(true)
            expect(montage.referenceLabel).toBe('REF')
        })

        it('should set reference to null when not common', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            montage.setupChannels({ reference: { common: false } } as any)
            expect(montage.reference).toBeNull()
        })
    })

    describe('trend registry', () => {
        /** Build a stub trend that just records cancellation calls. */
        const makeTrend = (name: string) => ({
            name,
            label: name,
            cancelTrendComputation: vi.fn(),
        }) as any

        it('addTrend should register a trend and expose it via getTrend / trends', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            const trend = makeTrend('aeeg-default')
            const ok = montage.addTrend(trend)
            expect(ok).toBe(true)
            expect(montage.getTrend('aeeg-default')).toBe(trend)
            expect(Object.keys(montage.trends)).toEqual(['aeeg-default'])
        })

        it('addTrend should reject duplicates with the same name', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            montage.addTrend(makeTrend('aeeg-default'))
            const dup = montage.addTrend(makeTrend('aeeg-default'))
            expect(dup).toBe(false)
            expect(Log.error).toHaveBeenCalled()
        })

        it('getTrend should return null for missing names', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            expect(montage.getTrend('does-not-exist')).toBeNull()
        })

        it('removeTrend should cancel computation, drop the trend, and return true', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            const trend = makeTrend('aeeg-default')
            montage.addTrend(trend)
            const ok = montage.removeTrend('aeeg-default')
            expect(ok).toBe(true)
            expect(trend.cancelTrendComputation).toHaveBeenCalled()
            expect(montage.getTrend('aeeg-default')).toBeNull()
        })

        it('removeTrend should return false for an unknown name', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            expect(montage.removeTrend('nope')).toBe(false)
            expect(Log.error).toHaveBeenCalled()
        })

        it('removeAllTrends should cancel every trend and clear the registry', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            const a = makeTrend('a')
            const b = makeTrend('b')
            montage.addTrend(a)
            montage.addTrend(b)
            montage.removeAllTrends()
            expect(a.cancelTrendComputation).toHaveBeenCalled()
            expect(b.cancelTrendComputation).toHaveBeenCalled()
            expect(Object.keys(montage.trends)).toHaveLength(0)
        })

        it('removeAllTrends should be a no-op when no trends are registered', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            expect(() => montage.removeAllTrends()).not.toThrow()
        })

        it('service getter should return the (mocked) montage service', () => {
            const montage = new TestBiosignalMontage('M', mockRecording, mockSetup)
            expect(montage.service.id).toBe('mock-service-id')
        })
    })
})
