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

        describe('video attachments', () => {
            /**
             * Stand in for the video element, resolving metadata immediately. Creating more than a
             * handful means the conversion is revisiting entries it produced, so the stub gives up
             * rather than letting the suite hang until it times out.
             */
            const MAX_VIDEO_ELEMENTS = 5
            let createdVideos = 0
            let originalCreateElement: typeof document.createElement

            beforeEach(() => {
                createdVideos = 0
                originalCreateElement = document.createElement.bind(document)
                vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
                    if (tag !== 'video') {
                        return originalCreateElement(tag)
                    }
                    createdVideos++
                    if (createdVideos > MAX_VIDEO_ELEMENTS) {
                        throw new Error(`Video conversion did not terminate (${createdVideos} elements created).`)
                    }
                    const video: Record<string, unknown> = { duration: 12, preload: '' }
                    Object.defineProperty(video, 'src', {
                        set () {
                            queueMicrotask(() => (video.onloadedmetadata as (() => void) | undefined)?.())
                        },
                    })
                    return video as unknown as HTMLElement
                }) as typeof document.createElement)
            })

            afterEach(() => {
                vi.restoreAllMocks()
            })

            const studyWithVideo = () => ({
                api: null,
                data: null,
                files: [{
                    file: null,
                    format: 'mp4',
                    mime: null,
                    name: 'rec.mp4',
                    partial: false,
                    range: [],
                    role: 'data',
                    modality: 'video',
                    url: 'https://example.com/rec.mp4',
                }],
                format: '',
                meta: {} as { videos?: unknown[] },
                modality: '',
                name: 'Test Study',
                version: '1.0',
            })

            it('should convert a video file exactly once', async () => {
                // The conversion appends a media entry carrying the same URL and removes the
                // original, so the list length does not change. Walking the live list reaches the
                // appended entry, matches it on that URL and converts it again, without end.
                const loader = new BiosignalStudyLoader('Test', ['eeg'], mockImporter)
                const study = studyWithVideo()
                await loader.useStudy(study as any)
                expect(createdVideos).toBe(1)
                expect(study.meta.videos).toHaveLength(1)
                expect(study.files).toHaveLength(1)
                expect(study.files[0].role).toBe('media')
            })

            it('should convert every video file when several are present', async () => {
                const loader = new BiosignalStudyLoader('Test', ['eeg'], mockImporter)
                const study = studyWithVideo()
                study.files.push({ ...study.files[0], name: 'rec2.webm', url: 'https://example.com/rec2.webm' })
                await loader.useStudy(study as any)
                expect(createdVideos).toBe(2)
                expect(study.meta.videos).toHaveLength(2)
                expect(study.files).toHaveLength(2)
            })

            it('should leave non-video files untouched', async () => {
                const loader = new BiosignalStudyLoader('Test', ['eeg'], mockImporter)
                const study = studyWithVideo()
                study.files.unshift({ ...study.files[0], name: 'rec.edf', url: 'https://example.com/rec.edf' })
                await loader.useStudy(study as any)
                expect(createdVideos).toBe(1)
                expect(study.files.map(f => f.url)).toContain('https://example.com/rec.edf')
            })
        })
    })
})
