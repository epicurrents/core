/**
 * Generic file loader.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import { type AssociatedFileType, type FileFormatReader } from '#types/reader'
import { type MemoryManager } from '#types/service'
import {
    type StudyContext,
    type StudyContextFile,
    type StudyLoader
} from '#types/study'
import { studyContextTemplate } from '#assets/study/loaders/GenericStudyLoader'

export default abstract class GenericFileReader extends GenericAsset implements FileFormatReader {
    /**
     * File headers to mime type associations.
     * @remarks
     * I may finish this some day, or may not.
     * Seems like a lot of work for something that can be left for
     * external libraries to handle.
    private static MIME_TYPES: {
        // Image types
        '00000100': 'image/x-icon',
        '00000200': 'image/x-icon',
        '424d': 'image/bmp',
        '474946383761': 'image/gif',
        '474946383961': 'image/gif',
        '52494646????????574542505650': 'image/webp',
        '89504e470d0a1a0a': 'image/png',
        'ffd8ff': 'Image/jpeg',
        // A/V types
        '464f524d????????41494646': 'audio/aiff',
        '494433': 'audio/mpeg',
        '4f67675300': 'application/ogg',
        '4d54686400000006': 'audio/midi',
        '52494646????????41564920': 'video/avi',
        '52494646????????57415645': 'audio/wave',
        '????????667479706d7034': 'video/mp4',
        '1a45dfa3': 'video/webm',
        'fffb': 'audio/mp3',
        'fff3': 'audio/mp3',
        'fff2': 'audio/mp3',
        // Fonts
        '000010000': 'font/ttf',
        '4f54544f': 'font/otf',
        '74746366': 'font/collection',
        '774f4646': 'font/woff',
        '774f4632': 'font/woff2',
        // Compressed archives
        '1f8b08': 'application/x-gzip',
        '504b0304': 'application/zip',
        '526172201a0700': 'application/x-rar-compressed',
        // Text
        'efbbbf': 'text/plain',
    }
     */
    protected _fileTypes: AssociatedFileType[]
    /** A substitute processor to use in environments where workers cannot be used. */
    protected _getWorkerSubstitute: (() => Worker | null) = () => null
    protected _matchPatterns: RegExp[] = []
    protected _memoryManager: MemoryManager | null  = null
    protected _modalities: string[]
    protected _name: string
    protected _onlyAcceptedTypes: boolean
    protected _study: StudyContext = studyContextTemplate()
    protected _studyLoader: StudyLoader | null = null
    protected _workerOverrides = new Map<string, (() => Worker)|null>()

    constructor (
        name: string,
        modalities: string[],
        fileTypes: AssociatedFileType[],
        namePatterns = [] as string[],
        onlyAcceptedTypes = false
    ) {
        super(name, 'unknown')
        this._modalities = modalities
        this._fileTypes = fileTypes
        this._name = name
        for (const pattern of namePatterns) {
            this._matchPatterns.push(new RegExp(pattern, 'i'))
        }
        this._onlyAcceptedTypes = onlyAcceptedTypes
    }

    get fileTypes () {
        return this._fileTypes
    }
    get name () {
        return this._name
    }
    get onlyAcceptedTypes () {
        return this._onlyAcceptedTypes
    }
    get study (): StudyContext | null {
        return this._study
    }
    get studyLoader () {
        return this._studyLoader
    }
    set studyLoader (value: StudyLoader | null) {
        this._setPropertyValue('studyLoader', value)
    }

    destroy () {
        this._fileTypes.length = 0
        this._matchPatterns.length = 0
        this._memoryManager = null
        this._modalities.length = 0
        this._name = ''
        this._studyLoader = null
        this._workerOverrides.clear()
        super.destroy()
    }

    getFileTypeWorker (): Worker | null {
        return null
    }

    /*async getMimeFromFile (file: File) {
        const header = new Uint8Array(await file.arrayBuffer()).subarray(0, 16)
        let headerText = ''
        for (const byte of header) {
            headerText += byte.toString(16)
        }
    }*/

    isSupportedModality (modality: string) {
        return this._modalities.includes(modality)
    }

    async readFile (source: File | StudyContextFile): Promise<StudyContextFile|null> {
        if (typeof source === 'object' && Object.hasOwn(source, 'url')) {
            return source as StudyContextFile
        }
        return {
            file: source,
            format: null,
            mime: null,
            modality: 'unknown',
            url: URL.createObjectURL(source as File),
        } as StudyContextFile
    }

    async readUrl (source: string | StudyContextFile): Promise<StudyContextFile|null> {
        if (typeof source === 'object' && Object.hasOwn(source, 'url')) {
            return source as StudyContextFile
        }
        return {
            file: null,
            format: null,
            mime: null,
            modality: 'unknown',
            url: source as string,
        } as StudyContextFile
    }

    matchName (fileName: string) {
        for (const pattern of this._matchPatterns) {
            if (fileName.match(pattern)) {
                return true
            }
        }
        for (const fileType of this._fileTypes) {
            for (const extensions of Object.values(fileType.accept)) {
                for (const ext of extensions) {
                    if (fileName.toLowerCase().endsWith(ext.toLowerCase())) {
                        return true
                    }
                }
            }
        }
        return false
    }

    registerMemoryManager (manager: MemoryManager) {
        this._memoryManager = manager
    }

    registerStudy (study: StudyContext) {
        if (study) {
            this._setPropertyValue('study', study)
        }
    }

    setWorkerOverride (name: string, getWorker: (() => Worker)|null) {
        this._workerOverrides.set(name, getWorker)
    }
}
