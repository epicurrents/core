/**
 * Epicurrents signal file reader. This class can be used inside a worker or the main thread.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    nullPromise,
} from '#util'
import type {
    SignalCacheProcess,
    SignalDataReader,
    SignalFilePart,
    TypedNumberArrayConstructor,
} from '#types'
import { Log } from 'scoped-event-log'
import GenericSignalProcessor from './GenericSignalProcessor'

const SCOPE = 'GenericSignalFileReader'

export default abstract class GenericSignalReader extends GenericSignalProcessor implements SignalDataReader {
    protected _awaitData = null as null | {
        range: number[],
        resolve: () => void,
        timeout: unknown,
    }
    /** Ongoing cache process. */
    protected _cacheProcesses = [] as SignalCacheProcess[]
    /** Number of data units to load as a chunk. */
    protected _chunkLoadSize = 0
    /** Number of data units to load as a single chunk. */
    protected _chunkUnitCount = 0
    /** Recording data block structure in data chunks. */
    protected _dataBlocks = [] as {
        /** Record index this block starts at. */
        startRecord: number
        /** Record index this block ends at (excluded). */
        endRecord: number
        /** Recording time (in seconds) at start of this block. */
        startTime: number
        /** Recording time (in seconds) at end of this block. */
        endTime: number
        /** File byte position this block starts at. */
        startBytePos: number
        /** File byte position this block ends at. */
        endBytePos: number
        /** Data contained in this block if loaded, null if not. */
        data: SignalFilePart | null
    }[]
    /** Byte position of the first data unit (= header size in bytes). */
    protected _dataOffset = 0
    /** The file to load. */
    protected _file = null as SignalFilePart | null
    /** Index of next data data unit to load. */
    protected _filePos = 0
    /** Is the mutex fully setup and ready. */
    protected _isMutexReady = false
    protected _maxDataBlocks = 0
    /** Loading process start time (for debugging). */
    protected _startTime = 0
    /** File data url. */
    protected _url = ''

    constructor (dataEncoding: TypedNumberArrayConstructor) {
        super(dataEncoding)
    }

    get url () {
        return this._url
    }
    set url (url: string) {
        this._url = url
    }

    /**
     * Cancel an ongoing file loading process.
     */
    protected _cancelLoading () {
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        Log.info(`File loading canceled, managed to load ${this._filePos} bytes in ${loadTime} seconds.`, SCOPE)
        this._chunkLoadSize = 0
        this._file = null
        this._filePos = 0
    }
    /**
     * Wrap up after file loading has finished.
     */
    protected _finishLoading () {
        // Log message
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        Log.debug(`File loading complete, ${this._filePos} bytes loaded in ${loadTime} seconds.`, SCOPE)
        this._chunkLoadSize = 0
        this._file = null
        this._filePos = 0
    }
    /**
     * Load the next part from the cached file.
     */
    protected _loadNextPart () {
        if (!this._file) {
            return
        }
        const partEnd = this._file.length > this._filePos + this._chunkLoadSize
                        ? this._filePos + this._chunkLoadSize
                        : this._file.length
        if (
            this._file.start > this._filePos ||
            (this._file.length - this._file.start + this._filePos) < partEnd
        ) {
            Log.error(`Requested file part has not been cached.`, SCOPE)
        }
        this._filePos = partEnd
    }
    /**
     * Stop current loading process, but don't reset cached file data.
     * @remarks
     * This method doesn't seem to actually do anything?
     */
    protected _stopLoading () {
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        Log.info(`File loading stopped after loading ${this._filePos} bytes in ${loadTime} seconds.`, SCOPE)
    }

    async cacheFile(_file: File, _startFrom?: number | undefined): Promise<void> {
        Log.error(`cacheFile has not been overridden by child class.`, SCOPE)
    }

    async destroy () {
        await this.releaseCache()
        this._dataBlocks.length = 0
        this._file = null
        this._url = ''
        super.destroy()
    }

    async readPartFromFile (_startFrom: number, _dataLength: number): Promise<SignalFilePart | null> {
        Log.error(`readPartFromFile has not been overridden by child class.`, SCOPE)
        return nullPromise
    }

    async readFileFromUrl (url?: string) {
        return await fetch(url || this._url)
            .then(response => response.blob())
            .then(blobFile => {
                this._file = {
                    data: new File([blobFile], "recording"),
                    dataLength: this._totalDataLength,
                    start: 0,
                    length: this._totalRecordingLength,
                }
                return true
            }).catch((reason: Error) => {
                Log.error(`Error loading file from URL '${url || this._url}':`, SCOPE, reason)
                return false
            })
    }
}
