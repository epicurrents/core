/**
 * Unit tests for GenericStudyLoader class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import GenericStudyLoader, { studyContextTemplate } from '../../src/assets/study/GenericStudyLoader'

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() }
}))

jest.mock('../../src/assets/service/ServiceMemoryManager')

describe('studyContextTemplate', () => {
    it('should create a default study context', () => {
        const ctx = studyContextTemplate()
        expect(ctx.api).toBeNull()
        expect(ctx.data).toBeNull()
        expect(ctx.files).toEqual([])
        expect(ctx.format).toBe('')
        expect(ctx.modality).toBe('unknown')
        expect(ctx.name).toBe('')
        expect(ctx.version).toBe('1.0')
    })

    it('should apply meta props', () => {
        const ctx = studyContextTemplate({ modality: 'eeg', name: 'My Study' } as any)
        expect(ctx.modality).toBe('eeg')
        expect(ctx.name).toBe('My Study')
    })
})

describe('GenericStudyLoader', () => {
    beforeEach(() => {
        (Log.debug as jest.Mock).mockClear()
        ;(Log.error as jest.Mock).mockClear()
    })

    describe('constructor', () => {
        it('should create a loader with name and modalities', () => {
            const loader = new GenericStudyLoader('EEG Loader', ['eeg'])
            expect(loader.supportedModalities).toEqual(['eeg'])
            expect(loader.resourceModality).toBe('unknown')
        })

        it('should register importer if provided', () => {
            const importer = { studyLoader: null, registerMemoryManager: jest.fn() } as any
            const loader = new GenericStudyLoader('Test', ['eeg'], importer)
            expect(loader.studyImporter).toBe(importer)
            expect(importer.studyLoader).toBe(loader)
        })

        it('should register exporter if provided', () => {
            const exporter = {} as any
            const loader = new GenericStudyLoader('Test', ['eeg'], undefined, exporter)
            expect(loader.studyExporter).toBe(exporter)
        })
    })

    describe('isSupportedModality', () => {
        it('should return true for supported modality', () => {
            const loader = new GenericStudyLoader('Test', ['eeg', 'emg'])
            expect(loader.isSupportedModality('eeg')).toBe(true)
            expect(loader.isSupportedModality('emg')).toBe(true)
        })

        it('should return false for unsupported modality', () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            expect(loader.isSupportedModality('mri')).toBe(false)
        })
    })

    describe('getResource', () => {
        it('should return null when no resources exist', async () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            expect(await loader.getResource(0)).toBeNull()
        })

        it('should return null for string ID not found', async () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            expect(await loader.getResource('nonexistent')).toBeNull()
        })
    })

    describe('loadFromFile', () => {
        it('should fail without importer', async () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            const file = new File(['data'], 'test.edf')
            const result = await loader.loadFromFile(file)
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })

        it('should fail for unsupported loader name', async () => {
            const importer = {
                studyLoader: null,
                registerMemoryManager: jest.fn(),
                isSupportedModality: jest.fn().mockReturnValue(true),
                matchName: jest.fn().mockReturnValue(true),
                registerStudy: jest.fn(),
                importFile: jest.fn().mockResolvedValue({}),
            } as any
            const loader = new GenericStudyLoader('Test', ['eeg'], importer)
            const file = new File(['data'], 'test.edf')
            const result = await loader.loadFromFile(file, { loader: 'Other' })
            expect(result).toBeNull()
        })
    })

    describe('loadFromUrl', () => {
        it('should fail without importer', async () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            const result = await loader.loadFromUrl('https://example.com/file.edf')
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
        })
    })

    describe('loadFromFsItem', () => {
        it('should return empty array without importer', async () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            const result = await loader.loadFromFsItem({} as any)
            expect(result).toEqual([])
        })
    })

    describe('registerStudyImporter', () => {
        it('should set importer and link loader', () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            const importer = { studyLoader: null, registerMemoryManager: jest.fn() } as any
            loader.registerStudyImporter(importer)
            expect(loader.studyImporter).toBe(importer)
            expect(importer.studyLoader).toBe(loader)
        })

        it('should pass memory manager to importer', () => {
            const manager = {} as any
            const loader = new GenericStudyLoader('Test', ['eeg'])
            loader.registerMemoryManager(manager)
            const importer = { studyLoader: null, registerMemoryManager: jest.fn() } as any
            loader.registerStudyImporter(importer)
            expect(importer.registerMemoryManager).toHaveBeenCalledWith(manager)
        })
    })

    describe('registerStudyExporter', () => {
        it('should set exporter', () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            const exporter = {} as any
            loader.registerStudyExporter(exporter)
            expect(loader.studyExporter).toBe(exporter)
        })
    })

    describe('useStudy', () => {
        it('should return resource count', async () => {
            const loader = new GenericStudyLoader('Test', ['eeg'])
            const study = studyContextTemplate()
            const result = await loader.useStudy(study)
            expect(result).toBe(0)
        })
    })
})
