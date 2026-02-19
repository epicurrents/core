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

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() }
}))

jest.mock('../../src/events/EventBus')

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
}))

jest.mock('../../src/util/signal', () => ({
    calculateSignalOffsets: jest.fn(),
    combineAllSignalParts: jest.fn((...parts: any[]) => parts),
    combineSignalParts: jest.fn().mockReturnValue(false),
    isContinuousSignal: jest.fn().mockReturnValue(false),
    mapMontageChannels: jest.fn().mockReturnValue([]),
    shouldDisplayChannel: jest.fn().mockReturnValue(true),
}))

jest.mock('../../src/util/constants', () => ({
    NUMERIC_ERROR_VALUE: -1,
}))

jest.mock('asymmetric-io-mutex', () => ({
    MutexExportProperties: {},
}))

jest.mock('../../src/assets/biosignal/service/MontageService', () => {
    return jest.fn().mockImplementation(() => ({
        id: 'mock-service-id',
        getSignals: jest.fn().mockResolvedValue(null),
        setFilters: jest.fn().mockResolvedValue({ success: true }),
        setInterruptions: jest.fn(),
        setupWorker: jest.fn(),
        setupMontageWithCache: jest.fn().mockResolvedValue(true),
        setupMontageWithInputMutex: jest.fn().mockResolvedValue(true),
        setupMontageWithSharedWorker: jest.fn().mockResolvedValue(true),
        unload: jest.fn().mockResolvedValue(undefined),
    }))
})

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
        (Log.error as jest.Mock).mockClear()
        ;(GenericAsset as any).USED_IDS.clear()

        mockEventBus = {
            addScopedEventListener: jest.fn(),
            dispatchScopedEvent: jest.fn().mockReturnValue(true),
            getEventHooks: jest.fn(),
            removeAllScopedEventListeners: jest.fn(),
            removeScopedEventListener: jest.fn(),
            removeScope: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
            unsubscribeAll: jest.fn(),
        }

        mockRecording = {
            modality: 'eeg',
            totalDuration: 100,
            filters: { bandreject: [], highpass: 0, lowpass: 0, notch: 0 },
            getInterruptions: jest.fn().mockReturnValue([]),
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

        ;(EventBus as jest.MockedClass<typeof EventBus>).mockImplementation(() => mockEventBus as any)
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
})
