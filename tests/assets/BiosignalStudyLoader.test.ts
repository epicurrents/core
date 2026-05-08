/**
 * Unit tests for BiosignalStudyLoader class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import BiosignalStudyLoader from '../../src/assets/biosignal/loaders/BiosignalStudyLoader'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

vi.mock('../../src/assets/service/ServiceMemoryManager')

describe('BiosignalStudyLoader', () => {
    let mockImporter: any

    beforeEach(() => {
        vi.clearAllMocks()
        mockImporter = {
            studyLoader: null,
            registerMemoryManager: vi.fn(),
            isSupportedModality: vi.fn().mockReturnValue(true),
            matchName: vi.fn().mockReturnValue(true),
            registerStudy: vi.fn(),
            importFile: vi.fn().mockResolvedValue({}),
            importUrl: vi.fn().mockResolvedValue({}),
        }
    })

    describe('constructor', () => {
        it('should create a biosignal study loader', () => {
            const loader = new BiosignalStudyLoader('EEG Loader', ['eeg'], mockImporter)
            expect(loader.supportedModalities).toEqual(['eeg'])
            expect(loader.studyImporter).toBe(mockImporter)
        })

        it('should accept optional exporter', () => {
            const exporter = {} as any
            const loader = new BiosignalStudyLoader('Test', ['eeg'], mockImporter, exporter)
            expect(loader.studyExporter).toBe(exporter)
        })
    })

    describe('loadFromUrl', () => {
        it('should load a study from URL', async () => {
            const loader = new BiosignalStudyLoader('Test', ['eeg'], mockImporter)
            const result = await loader.loadFromUrl('https://example.com/test.edf')
            expect(result).toBeDefined()
            expect(result).not.toBeNull()
            expect(mockImporter.importUrl).toHaveBeenCalled()
        })

        it('should fail without importer', async () => {
            const loader = new BiosignalStudyLoader('Test', ['eeg'], mockImporter)
            // Remove importer reference
            ;(loader as any)._studyImporter = null
            const result = await loader.loadFromUrl('https://example.com/test.edf')
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('useStudy', () => {
        it('should process study files', async () => {
            const loader = new BiosignalStudyLoader('Test', ['eeg'], mockImporter)
            const study = {
                api: null,
                data: null,
                files: [],
                format: 'edf',
                meta: {},
                modality: 'eeg',
                name: 'Test Study',
                version: '1.0',
            }
            const result = await loader.useStudy(study as any)
            expect(result).toBe(0)
        })
    })
})
