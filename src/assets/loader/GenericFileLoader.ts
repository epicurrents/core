/**
 * Generic file loader.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type MemoryManager } from 'TYPES/assets'
import { type FileFormatLoader } from 'TYPES/loader'
import {
    type StudyContext,
    type StudyContextFile,
    type StudyLoader
} from 'TYPES/study'
import { studyContextTemplate } from 'ASSETS/study/loaders/GenericStudyLoader'

export default abstract class GenericFileLoader implements FileFormatLoader {
    /**
     * File headers to mime type associations.
     * @remarks
     * I may finish this some day, or may not.
     * Seems like a lot of work for something that can be left for
     * external libraries to handle.
     */
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
    protected _fileExtensions: string[]
    protected _matchPatterns: RegExp[] = []
    protected _memoryManager: MemoryManager | null  = null
    protected _name: string
    protected _scopes: string[]
    protected _study: StudyContext = studyContextTemplate()
    protected _studyLoader: StudyLoader | null = null

    constructor (name: string, scopes: string[], fileExtensions = [] as string[], namePatterns = [] as string[]) {
        this._scopes = scopes
        this._fileExtensions = fileExtensions
        this._name = name
        for (const pattern of namePatterns) {
            this._matchPatterns.push(new RegExp(pattern, 'i'))
        }
    }

    get fileType () {
        return 'unknown'
    }

    get name () {
        return this._name
    }
    get study (): StudyContext | null {
        return this._study
    }
    get studyLoader () {
        return this._studyLoader
    }
    set studyLoader (value: StudyLoader | null) {
        this._studyLoader = value
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

    isSupportedScope (scope: string) {
        for (const supportedScope of this._scopes) {
            if (supportedScope === scope) {
                return true
            }
        }
        return false
    }

    async loadFile (source: File | StudyContextFile): Promise<StudyContextFile|null> {
        if (Object.hasOwn(source, 'url')) {
            return source as StudyContextFile
        }
        return {
            file: source,
            format: null,
            mime: null,
            type: 'file',
            url: URL.createObjectURL(source as File),
        } as StudyContextFile
    }

    async loadUrl (source: string | StudyContextFile): Promise<StudyContextFile|null> {
        if (typeof source === 'object' && Object.hasOwn(source, 'url')) {
            return source as StudyContextFile
        }
        return {
            file: null,
            format: null,
            mime: null,
            type: 'file',
            url: source as string,
        } as StudyContextFile
    }

    matchName (fileName: string) {
        for (const pattern of this._matchPatterns) {
            if (fileName.match(pattern)) {
                return true
            }
        }
        for (const ext of this._fileExtensions) {
            if (fileName.indexOf(ext) !== -1) {
                return true
            }
        }
        return false
    }

    registerMemoryManager (manager: MemoryManager) {
        this._memoryManager = manager
    }

    registerStudy (study: StudyContext) {
        if (study) {
            this._study = study
        }
    }
}
