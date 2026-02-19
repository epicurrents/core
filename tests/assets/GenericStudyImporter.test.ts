/**
 * Unit tests for GenericStudyImporter class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericStudyImporter from '../../src/assets/study/GenericStudyImporter'
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

jest.mock('../../src/assets/service/ServiceMemoryManager')

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url')

class TestStudyImporter extends GenericStudyImporter {
    constructor(
        name: string, modalities: string[],
        fileTypes: any[] = [], patterns: string[] = [],
    ) {
        super(name, modalities, fileTypes, patterns)
    }
}

describe('GenericStudyImporter', () => {
    let mockEventBus: any
    let originalWindow: any

    beforeEach(() => {
        (GenericAsset as any).USED_IDS.clear()

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
        it('should create an importer with name and modalities', () => {
            const imp = new TestStudyImporter('EDF Reader', ['eeg'])
            expect(imp.name).toBe('EDF Reader')
            expect(imp.onlyAcceptedTypes).toBe(false)
        })

        it('should compile name patterns into RegExp', () => {
            const imp = new TestStudyImporter('Test', ['eeg'], [], ['\\.edf$', '\\.bdf$'])
            expect(imp.matchName('recording.edf')).toBe(true)
            expect(imp.matchName('recording.bdf')).toBe(true)
            expect(imp.matchName('recording.csv')).toBe(false)
        })
    })

    describe('matchName', () => {
        it('should match by file type extensions', () => {
            const imp = new TestStudyImporter('Test', ['eeg'], [
                { accept: { 'application/edf': ['.edf', '.EDF'] } },
            ])
            expect(imp.matchName('data.edf')).toBe(true)
            expect(imp.matchName('DATA.EDF')).toBe(true)
            expect(imp.matchName('data.csv')).toBe(false)
        })

        it('should match by pattern', () => {
            const imp = new TestStudyImporter('Test', ['eeg'], [], ['test_.*\\.dat'])
            expect(imp.matchName('test_001.dat')).toBe(true)
            expect(imp.matchName('other.dat')).toBe(false)
        })
    })

    describe('isSupportedModality', () => {
        it('should check modality support', () => {
            const imp = new TestStudyImporter('Test', ['eeg', 'emg'])
            expect(imp.isSupportedModality('eeg')).toBe(true)
            expect(imp.isSupportedModality('mri')).toBe(false)
        })
    })

    describe('importFile', () => {
        it('should create a StudyContextFile from a File', async () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            const file = new File(['data'], 'test.edf')
            const result = await imp.importFile(file)
            expect(result).toBeDefined()
            expect(result!.url).toBe('blob:mock-url')
        })

        it('should pass through StudyContextFile objects', async () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            const scf = { url: 'https://example.com/file.edf', file: null } as any
            const result = await imp.importFile(scf)
            expect(result).toBe(scf)
        })
    })

    describe('importUrl', () => {
        it('should create a StudyContextFile from a URL string', async () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            const result = await imp.importUrl('https://example.com/test.edf')
            expect(result).toBeDefined()
            expect(result!.url).toBe('https://example.com/test.edf')
        })

        it('should pass through StudyContextFile objects', async () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            const scf = { url: 'https://example.com/file.edf', file: null } as any
            const result = await imp.importUrl(scf)
            expect(result).toBe(scf)
        })
    })

    describe('registerStudy', () => {
        it('should register a study', () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            const study = { name: 'Test Study' } as any
            imp.registerStudy(study)
            expect(imp.study).toBe(study)
        })
    })

    describe('registerMemoryManager', () => {
        it('should register a memory manager', () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            const manager = {} as any
            imp.registerMemoryManager(manager)
            // No getter, but should not throw
        })
    })

    describe('setWorkerOverride', () => {
        it('should set worker override', () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            const getWorker = jest.fn()
            imp.setWorkerOverride('loader', getWorker)
            // No getter, but should not throw
        })
    })

    describe('getFileTypeWorker', () => {
        it('should return null by default', () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            expect(imp.getFileTypeWorker()).toBeNull()
        })
    })

    describe('destroy', () => {
        it('should clean up properties', () => {
            const imp = new TestStudyImporter('Test', ['eeg'])
            imp.destroy()
            expect(imp.name).toBe('')
            expect(imp.state).toBe('destroyed')
        })
    })
})
