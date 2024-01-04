/**
 * EpiCurrents signal file loader utility.
 * @package    @epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { SETTINGS } from '#config'
import {
    log,
    MB_BYTES,
    NUMERIC_ERROR_VALUE,
} from '#util'
import { type SignalFilePart, type SignalDataLoader } from '#types/loader'

const SCOPE = 'SignalFileLoader'

export default class SignalFileLoader implements SignalDataLoader {
    /** Number of records to load as a chunk. */
    protected _chunkLoadSize = 0
    /** Number of data units to load as a single chunk. */
    protected _chunkUnitCount = 0
    /** Byte position of the first data record (= header size in bytes). */
    protected _dataOffset = 0
    /** Number of data units in in the source file. */
    protected _dataUnitCount = 0
    /** Duration of single data unit in seconds. */
    protected _dataUnitDuration = 0
    /** Size of single data unit in bytes. */
    protected _dataUnitSize = 0
    /** The file to load. */
    protected _file = null as SignalFilePart
    /** The first visible part loaded and cached. */
    protected _cachedParts = {
        active: null as SignalFilePart,
        preceding: null as SignalFilePart,
        trailing: null as SignalFilePart,
    }
    /** Index of next data record to load. */
    protected _filePos = 0
    /** Callback to use whenever the loader is done processing something. */
    protected _callback: ((update: unknown) => void)
    /**
     * postMessage method of the parent worker.
     * This is not really the correct type for postMessage, but it serves its purpose.
     */
    protected _postMessage: (message: string) => void
    /** Loading process start time (for debugging). */
    protected _startTime = 0
    /** File data url. */
    protected _url = ''

    constructor (callback: ((update: unknown) => void), postMessage: (message: string) => void) {
        this._callback = callback
        this._postMessage = postMessage
    }

    get dataUnitSize () {
        return this._dataUnitSize
    }

    get url () {
        return this._url
    }
    set url (url: string) {
        this._url = url
    }

    /**
     * Expand the given blob into a file-like object.
     * @param blob - Blob to modify.
     * @param name - Name of the file.
     * @param path - Optional webkitRelativePath (defaults to "").
     * @returns Pseudo-file created from the blob.
     */
    protected _blobToFile (blob: Blob, name: string, path?: string): File {
        // Import properties expected of a file object.
        Object.assign(blob, {
            lastModified: Date.now(),
            name: name,
            webkitRelativePath: path || "",
        })
        return <File>blob
    }

    /**
     * Cancel an ongoing file loading process.
     */
    protected _cancelLoading () {
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        log(this._postMessage, 'INFO',
            `File loading canceled, managed to load ${this._filePos} bytes in ${loadTime} seconds.`,
        SCOPE)
        this._chunkLoadSize = 0
        this._file = null
        this._filePos = 0
    }

    /**
     * Convert a data unit index into timestamp.
     *
     * **NOTE!** This method does not check that the given values are within recording bounds!
     *
     * @param index - Data unit index to conver.
     * @returns Recording timestamp in seconds.
     */
    protected _dataUnitIndexToTime (index: number) {
        if (!this._dataUnitDuration) {
            return NUMERIC_ERROR_VALUE
        }
        return index*this._dataUnitDuration
    }

    /**
     * Wrap up after file loading has finished.
     */
    protected _finishLoading () {
        // Log message
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        log(this._postMessage, 'DEBUG',
            `File loading complete, ${this._filePos} bytes loaded in ${loadTime} seconds.`,
        SCOPE)
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
            log(this._postMessage, 'ERROR', `Requested file part has not been cached.`, SCOPE)
        }
        this._callback({
            action: 'load-file-part',
            file: this._file.data,
            start: this._filePos,
            end: partEnd,
        })
        this._filePos = partEnd
    }

    /**
     * Stop current loading process, but don't reset cached file data.
     */
    protected _stopLoading () {
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        log(this._postMessage, 'INFO',
            `File loading stopped after loading ${this._filePos} bytes in ${loadTime} seconds.`,
        SCOPE)
    }

    /**
     * Convert a recording timestamp to data unit index.
     *
     * **NOTE!** This method does not check that the given values are within recording bounds!
     *
     * @param time - Timestamp in seconds to convert.
     * @returns data unit index
     */
    protected _timeToDataUnitIndex (time: number) {
        if (!this._dataUnitDuration) {
            return NUMERIC_ERROR_VALUE
        }
        return time/this._dataUnitDuration
    }

    async cacheFile (file: File, startFrom: number = 0) {
        // If there is a previous loading task in progress, we need to stop or cancel it first.
        if (this._file) {
            if (file === this._file.data) {
                // Stop loading but keep file data.
                this._stopLoading()
            } else {
                // Cancel loading and start anew.
                this._cancelLoading()
            }
        }
        // Save starting time for debugging.
        this._startTime = Date.now()
        /** The number of data units in the file to be loaded. */
        this._dataUnitCount = Math.floor((file.size - this._dataOffset)/this._dataUnitSize)
        // Signal data is converted from int16 to float32, so it will take double the size of the file itself.
        if (file.size < SETTINGS.app.maxLoadCacheSize/2 && !startFrom) {
            // Load file in stages.
            log(this._postMessage, 'INFO',
                `Starting progressive loading of a file of size ${(file.size/MB_BYTES).toFixed(2)} MiB.`,
            SCOPE)
            // Cache the entire file.
            this._file = {
                data: file,
                length: this._dataUnitCount*this._dataUnitDuration,
                start: 0,
            }
            try {
                this._filePos = 0
                this._loadNextPart()
            } catch (e) {
                this._callback({ error: e })
            }
        } else {
            // The idea is to consider the cached file data in three parts.
            // - Middle part is where the active view is.
            // - In addition, one third of cached data precedes it and one third follows it.
            // Whenever the active view enters the preceding or following third, a new "third" is loaded
            // to that end and the third at the far end is scrapped.
            // First, determine a meaningful starting point considering the record data block structure
            // and needed filter padding, so we can display the initial view as soon as possible.
            log(this._postMessage, 'INFO',
                `Not starting from beginning of file or file size ${file.size} bytes exceeds allowed cache size, `+
                `loading file in parts.`,
            SCOPE)
            // Cache info for data loading.
            this._dataOffset = 0
            // Next, load the rest of the "active third".
            const startPos = Math.floor(startFrom/this._dataUnitSize)
            const thirdSize = Math.floor(SETTINGS.app.maxLoadCacheSize/(3*this._dataUnitSize))
            const activeThirdStart = Math.max(Math.floor(startPos - thirdSize/2), 0)
            const activeThirdEnd = Math.min(activeThirdStart + thirdSize, this._dataUnitCount)
            const activeThirdLength = activeThirdEnd - activeThirdStart
            const activeDataStart = this._dataOffset + activeThirdStart*this._dataUnitSize
            const activeDataEnd = this._dataOffset + activeThirdEnd*this._dataUnitSize
            const activePart = this._blobToFile(
                file.slice(activeDataStart, activeDataEnd),
                file.name,
                file.webkitRelativePath
            )
            this._cachedParts.active = {
                data: activePart,
                length: activeThirdLength,
                start: activeThirdStart,
            }
            // Cache the active part.
            this._file = this._cachedParts.active
            // Load the new data etiher in chunks or in one go.
            this._chunkLoadSize = activeThirdLength/2 > SETTINGS.app.dataChunkSize/this._dataUnitSize
                                        ? Math.floor(SETTINGS.app.dataChunkSize/(this._dataUnitSize)) - 1
                                        : 1
            this._filePos = 0
            this._loadNextPart()
            // Next, load the trailing third of the cache, if not already loaded.
            const trailingThirdStart = this._cachedParts.active.start + this._cachedParts.active.length
            const trailingThirdEnd = Math.min(trailingThirdStart + thirdSize, this._dataUnitCount)
            const trailingThirdLength = trailingThirdEnd - trailingThirdStart
            if (trailingThirdStart < this._dataUnitCount) {
                const trailingDataStart = this._dataOffset + trailingThirdStart*this._dataUnitSize
                const trailingDataEnd = this._dataOffset + trailingThirdEnd*this._dataUnitSize
                const trailingPart = this._blobToFile(
                    file.slice(trailingDataStart, trailingDataEnd),
                    file.name,
                    file.webkitRelativePath
                )
                this._cachedParts.trailing = {
                    data: trailingPart,
                    length: trailingThirdLength,
                    start: trailingThirdStart,
                }
                // Combine the active and trailing parts.
                if (this._cachedParts.active) {
                    this._file = {
                        data: this._blobToFile(
                            new Blob([ this._cachedParts.active.data, this._cachedParts.trailing.data]),
                            file.name,
                            file.webkitRelativePath
                        ),
                        length: this._cachedParts.active.length + trailingThirdLength,
                        start: this._cachedParts.active.start,
                    }
                }
                // Load the new data either in chunks or in one go.
                this._loadNextPart()
            }
        }
    }

    async loadFileFromUrl (url?: string) {
        return await fetch(url || this._url)
            .then(response => response.blob())
            .then(blobFile => {
                this._file = {
                    data: new File([blobFile], "recording"),
                    start: 0,
                    length: this._dataUnitCount*this._dataUnitDuration
                }
                return true
            }).catch((reason: unknown) => {
                log(this._postMessage, 'ERROR',
                    `Error loading file from URL '${url || this._url}':`,
                SCOPE, reason)
                return false
            })
    }

    async loadPartFromFile (startFrom: number, dataLength: number): Promise<SignalFilePart> {
        if (!this._url.length) {
            log(this._postMessage, 'ERROR', `Could not load file part, there is no source URL to load from.`, SCOPE)
            return null
        }
        if (!this._dataUnitSize) {
            log(this._postMessage, 'ERROR', `Could not load file part, data unit size has not been set.`, SCOPE)
            return null
        }
        // Save starting time for debugging.
        this._startTime = Date.now()
        const unitStart = Math.max(
            0,
            Math.floor(this._timeToDataUnitIndex(startFrom))
        )
        const unitEnd = Math.min(
            Math.ceil(this._timeToDataUnitIndex(startFrom + dataLength)),
            this._dataUnitCount
        )
        const dataStart = this._dataOffset + unitStart*this._dataUnitSize
        const dataEnd = this._dataOffset + unitEnd*this._dataUnitSize
        const getBlob = this._file?.data ? async () => {
            return this._file?.data.slice(dataStart, dataEnd) as Blob
        } : async () => {
            const headers = new Headers()
            headers.set('range', `bytes=${dataStart}-${dataEnd - 1}`)
            return await fetch(this._url, {
                headers: headers,
            }).then(response => response.blob()).then(blob => { return blob })
        }
        const startTime = this._dataUnitIndexToTime(unitStart)
        const partLength = this._dataUnitIndexToTime(unitEnd - unitStart)
        const SignalFilePart = this._blobToFile(
            await getBlob(),
            `SignalFilePart[${startTime},${startTime + partLength}]`
        )
        // Cache only the visible part.
        return {
            data: SignalFilePart,
            length: partLength,
            start: startTime,
        }
    }
}
