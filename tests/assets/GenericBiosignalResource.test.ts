/**
 * Unit tests for GenericBiosignalResource class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import EventBus from '../../src/events/EventBus'
import GenericBiosignalResource from '../../src/assets/biosignal/GenericBiosignalResource'
import GenericAsset from '../../src/assets/GenericAsset'

// Mock dependencies - default and named Log must be the same object
// since GenericBiosignalResource uses `import Log from 'scoped-event-log'`
const _mockLog = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}
jest.mock('scoped-event-log', () => {
    // Use a shared reference so both default and named import point to same mock
    const log = {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }
    return {
        __esModule: true,
        default: log,
        Log: log,
    }
})

// Get the actual mock reference after jest.mock hoisting
import Log from 'scoped-event-log'

jest.mock('../../src/events/EventBus')

jest.mock('../../src/events', () => ({
    ResourceEvents: {
        UNLOAD: 'resource-unload',
    },
}))

jest.mock('../../src/util', () => ({
    deepClone: jest.fn((obj) => {
        if (obj === null || obj === undefined) return obj
        try {
            return JSON.parse(JSON.stringify(obj))
        } catch {
            return null
        }
    }),
    safeObjectFrom: jest.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

jest.mock('../../src/util/signal', () => ({
    combineSignalParts: jest.fn(),
    getIncludedChannels: jest.fn((channels) => channels),
    shouldDisplayChannel: jest.fn(() => true),
}))

jest.mock('../../src/util/general', () => ({
    nullPromise: Promise.resolve(null),
}))

jest.mock('asymmetric-io-mutex', () => ({
    MutexExportProperties: {},
}))

// Concrete subclass for testing abstract GenericBiosignalResource
class TestBiosignalResource extends GenericBiosignalResource {
    constructor(name: string, modality: string, source?: any) {
        super(name, modality, source)
    }
    getMainProperties() {
        return new Map<string, { [key: string]: string | number } | null>()
    }
    async prepare() {
        this.state = 'ready'
        return true
    }
}

describe('GenericBiosignalResource', () => {
    let mockEventBus: any
    let mockApp: any
    let originalWindow: any

    beforeEach(() => {
        ;(Log.debug as jest.Mock).mockClear()
        ;(Log.error as jest.Mock).mockClear()
        ;(Log.warn as jest.Mock).mockClear()

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

        mockApp = {}

        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: {
                __EPICURRENTS__: {
                    APP: mockApp,
                    EVENT_BUS: mockEventBus,
                    RUNTIME: {
                        SETTINGS: {
                            modules: {},
                        },
                    },
                }
            } as any,
            writable: true,
        })

        ;(EventBus as jest.MockedClass<typeof EventBus>).mockImplementation(() => mockEventBus as any)
    })

    afterEach(() => {
        global.window = originalWindow
        jest.useRealTimers()
    })

    describe('constructor', () => {
        it('should create a biosignal resource with name and modality', () => {
            const resource = new TestBiosignalResource('EEG Recording', 'eeg')
            expect(resource.name).toBe('EEG Recording')
            expect(resource.modality).toBe('eeg')
        })

        it('should initialize with default values', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            expect(resource.channels).toEqual([])
            expect(resource.cursors).toEqual([])
            expect(resource.events).toEqual([])
            expect(resource.montages).toEqual([])
            expect(resource.activeMontage).toBeNull()
            expect(resource.dataDuration).toBe(0)
            expect(resource.totalDuration).toBe(0)
            expect(resource.viewStart).toBe(0)
            expect(resource.startTime).toBeNull()
            expect(resource.sampleCount).toBeNull()
            expect(resource.samplingRate).toBeNull()
            expect(resource.sensitivity).toBe(0)
            expect(resource.hasVideo).toBe(false)
        })
    })

    describe('dataDuration', () => {
        it('should set and get data duration', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.dataDuration = 300
            expect(resource.dataDuration).toBe(300)
        })
    })

    describe('displayViewStart', () => {
        it('should set and get display view start', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.displayViewStart = 10
            expect(resource.displayViewStart).toBe(10)
        })
    })

    describe('sampleCount', () => {
        it('should set valid sample count', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.sampleCount = 1000
            expect(resource.sampleCount).toBe(1000)
        })

        it('should reject negative sample count', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.sampleCount = -1
            expect(resource.sampleCount).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })

        it('should allow null', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.sampleCount = 100
            resource.sampleCount = null
            expect(resource.sampleCount).toBeNull()
        })

        it('should allow zero', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.sampleCount = 0
            expect(resource.sampleCount).toBe(0)
        })
    })

    describe('samplingRate', () => {
        it('should set valid sampling rate', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.samplingRate = 256
            expect(resource.samplingRate).toBe(256)
        })

        it('should reject zero sampling rate', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.samplingRate = 0
            expect(resource.samplingRate).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })

        it('should reject negative sampling rate', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.samplingRate = -1
            expect(resource.samplingRate).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('sensitivity', () => {
        it('should set valid sensitivity', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.sensitivity = 7
            expect(resource.sensitivity).toBe(7)
        })

        it('should reject zero sensitivity', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.sensitivity = 0
            expect(resource.sensitivity).toBe(0) // initial value stays
            expect(Log.error).toHaveBeenCalled()
        })

        it('should reject negative sensitivity', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.sensitivity = -1
            expect(resource.sensitivity).toBe(0) // initial value stays
        })
    })

    describe('signalCacheStatus', () => {
        it('should set valid signal cache status', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.signalCacheStatus = [50, 100]
            expect(resource.signalCacheStatus).toEqual([50, 100])
        })

        it('should reject invalid length', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.signalCacheStatus = [1, 2, 3]
            expect(resource.signalCacheStatus).toEqual([0, 0]) // default
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('totalDuration', () => {
        it('should set valid total duration', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.totalDuration = 600
            expect(resource.totalDuration).toBe(600)
        })

        it('should reject zero or negative total duration', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.totalDuration = 0
            expect(resource.totalDuration).toBe(0) // stays at default
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('viewStart', () => {
        it('should set valid view start', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.viewStart = 10
            expect(resource.viewStart).toBe(10)
        })

        it('should clamp negative values to 0', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.viewStart = -5
            expect(resource.viewStart).toBe(0)
        })
    })

    describe('startTime', () => {
        it('should set and get start time', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const date = new Date('2025-01-01T08:00:00')
            resource.startTime = date
            expect(resource.startTime).toBe(date)
        })

        it('should allow null', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.startTime = null
            expect(resource.startTime).toBeNull()
        })
    })

    describe('timebase', () => {
        it('should set and get timebase', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.timebase = 30
            expect(resource.timebase).toBe(30)
        })
    })

    describe('timebaseUnit', () => {
        it('should set and get timebase unit', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.timebaseUnit = 'mm/s'
            expect(resource.timebaseUnit).toBe('mm/s')
        })
    })

    describe('subject', () => {
        it('should set and get subject', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const subject = { age: 30, weight: 70 }
            resource.subject = subject
            expect(resource.subject).toBe(subject)
        })
    })

    describe('videos', () => {
        it('should set and get videos', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const videos = [{ startTime: 0, endTime: 60, url: 'test.mp4' }] as any
            resource.videos = videos
            expect(resource.videos).toEqual(videos)
            expect(resource.hasVideo).toBe(true)
        })
    })

    describe('filters', () => {
        it('should return a copy of filters', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const filters = resource.filters
            expect(filters).toHaveProperty('highpass')
            expect(filters).toHaveProperty('lowpass')
            expect(filters).toHaveProperty('notch')
            // Verify it's a copy
            filters.highpass = 999
            expect(resource.filters.highpass).not.toBe(999)
        })
    })

    describe('addCursors', () => {
        it('should add cursors', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const cursor = { position: 10, label: 'cursor1' } as any
            resource.addCursors(cursor)
            expect(resource.cursors).toHaveLength(1)
            expect(resource.cursors[0].position).toBe(10)
        })
    })

    describe('addEvents', () => {
        it('should add events and sort by start time', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.addEvents(
                { start: 20, duration: 1, type: 'spike', label: 'A', channels: [] } as any,
                { start: 10, duration: 1, type: 'spike', label: 'B', channels: [] } as any,
            )
            expect(resource.events).toHaveLength(2)
            expect(resource.events[0].start).toBe(10)
            expect(resource.events[1].start).toBe(20)
        })

        it('should not add duplicate events', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const event = { id: 'evt-1', start: 10, duration: 1, type: 'spike', label: 'A', channels: [] } as any
            resource.addEvents(event)
            resource.addEvents(event)
            expect(resource.events).toHaveLength(1)
        })
    })

    describe('removeEvents', () => {
        it('should remove events by id', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.addEvents(
                { id: 'evt-1', start: 10, duration: 1, type: 'spike', label: 'A', channels: [] } as any,
                { id: 'evt-2', start: 20, duration: 1, type: 'spike', label: 'B', channels: [] } as any,
            )
            const deleted = resource.removeEvents('evt-1')
            expect(deleted).toHaveLength(1)
            expect(deleted[0].id).toBe('evt-1')
            expect(resource.events).toHaveLength(1)
        })

        it('should remove events by index', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.addEvents(
                { id: 'evt-1', start: 10, duration: 1, type: 'spike', label: 'A', channels: [] } as any,
                { id: 'evt-2', start: 20, duration: 1, type: 'spike', label: 'B', channels: [] } as any,
            )
            const deleted = resource.removeEvents(0)
            expect(deleted).toHaveLength(1)
            expect(resource.events).toHaveLength(1)
        })
    })

    describe('interruptions', () => {
        it('should set and get interruptions', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.interruptions = [{ start: 100, duration: 5 }]
            expect(resource.interruptions).toHaveLength(1)
        })
    })

    describe('getAbsoluteTimeAt', () => {
        it('should return relative time when no start time', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const result = resource.getAbsoluteTimeAt(3661) // 1h 1m 1s
            expect(result.date).toBeNull()
            expect(result.day).toBe(1)
            expect(result.hour).toBe(1)
            expect(result.minute).toBe(1)
            expect(result.second).toBe(1)
        })

        it('should return absolute time when start time is set', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.startTime = new Date('2025-01-01T08:00:00')
            const result = resource.getAbsoluteTimeAt(3600) // +1 hour
            expect(result.date).toBeInstanceOf(Date)
            expect(result.hour).toBe(9)
        })
    })

    describe('getRelativeTimeAt', () => {
        it('should return relative time components', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const result = resource.getRelativeTimeAt(90061) // 1 day + 1h 1m 1s
            expect(result.days).toBe(1)
            expect(result.hours).toBe(1)
            expect(result.minutes).toBe(1)
            expect(result.seconds).toBe(1)
        })
    })

    describe('getChannelAtYPosition', () => {
        it('should return null for invalid position', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            expect(resource.getChannelAtYPosition(-1)).toBeNull()
            expect(resource.getChannelAtYPosition(1.5)).toBeNull()
        })

        it('should return null when no visible channels', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            expect(resource.getChannelAtYPosition(0.5)).toBeNull()
        })
    })

    describe('montages', () => {
        it('should set and get montages', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const montages = [{ name: 'montage1' }] as any
            resource.montages = montages
            expect(resource.montages).toEqual(montages)
        })
    })

    describe('recordMontage', () => {
        it('should set and get record montage', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const montage = { name: 'record' } as any
            resource.recordMontage = montage
            expect(resource.recordMontage).toBe(montage)
        })
    })

    describe('setMemoryManager', () => {
        it('should set the memory manager', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const manager = { allocate: jest.fn() } as any
            resource.setMemoryManager(manager)
            expect((resource as any)._memoryManager).toBe(manager)
        })
    })

    describe('setHighpassFilter', () => {
        it('should set highpass filter value', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            await resource.setHighpassFilter(1)
            expect(resource.filters.highpass).toBe(1)
        })

        it('should treat null as 0', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            await resource.setHighpassFilter(null)
            expect(resource.filters.highpass).toBe(0)
        })

        it('should reject negative value', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            await resource.setHighpassFilter(-1)
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setLowpassFilter', () => {
        it('should set lowpass filter value', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            await resource.setLowpassFilter(40)
            expect(resource.filters.lowpass).toBe(40)
        })

        it('should reject negative value', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            await resource.setLowpassFilter(-1)
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setNotchFilter', () => {
        it('should set notch filter value', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            await resource.setNotchFilter(50)
            expect(resource.filters.notch).toBe(50)
        })

        it('should reject negative value', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            await resource.setNotchFilter(-1)
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setDefaultSensitivity', () => {
        it('should set sensitivity value', () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.setDefaultSensitivity(5)
            expect(resource.sensitivity).toBe(5)
        })
    })

    describe('setupCache', () => {
        it('should return null when service is not set', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const result = await resource.setupCache()
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('setupMutex', () => {
        it('should return null when service is not set', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            const result = await resource.setupMutex()
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('destroy', () => {
        it('should clean up all resources', async () => {
            const resource = new TestBiosignalResource('Test', 'eeg')
            resource.addEvents(
                { id: 'evt-1', start: 10, duration: 1, type: 'spike', label: 'A', channels: [] } as any,
            )
            await resource.destroy()
            expect(resource.channels).toEqual([])
            expect(resource.events).toEqual([])
            expect(resource.activeMontage).toBeNull()
            expect(resource.state).toBe('destroyed')
        })
    })
})
