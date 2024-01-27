/**
 * EpiCurrents signal file loader utility. This class can be used inside a worker or the main thread.
 * @package    @epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    NUMERIC_ERROR_VALUE,
    nullPromise,
} from '#util'
import {
    type BiosignalAnnotation,
    type SignalCacheMutex,
    type SignalCacheProcess,
    type SignalDataCache,
    type SignalDataLoader,
    type SignalFilePart,
} from '#types'
import { Log } from 'scoped-ts-log'

const SCOPE = 'SignalFileLoader'

export default abstract class SignalFileLoader implements SignalDataLoader {

    /** Map of annotations as <position in seconds, list of annotations>. */
    protected _annotations = new Map<number, BiosignalAnnotation[]>()
    /** Promise awaiting data to update. */
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
    /** Map of data gaps as <gap position, gap length> in seconds. */
    protected _dataGaps = new Map<number, number>()
    /** Actual signal data length without gaps. */
    protected _dataLength = 0
    /** Byte position of the first data unit (= header size in bytes). */
    protected _dataOffset = 0
    /** Number of data units in in the source file. */
    protected _dataUnitCount = 0
    /** Duration of single data unit in seconds. */
    protected _dataUnitDuration = 0
    /** Size of single data unit in bytes. */
    protected _dataUnitSize = 0
    /** Is the source file discontinous. */
    protected _discontinuous = false
    /** A plain fallback data cache in case mutex is not usable. */
    protected _fallbackCache = null as SignalDataCache | null
    /** The file to load. */
    protected _file = null as SignalFilePart
    /** Index of next data data unit to load. */
    protected _filePos = 0
    /** Is the mutex fully setup and ready. */
    protected _isMutexReady = false
    protected _maxDataBlocks = 0
    protected _mutex = null as SignalCacheMutex | null
    /** Loading process start time (for debugging). */
    protected _startTime = 0
    /** Total recording length including possible gaps. */
    protected _totalLength = 0
    /** File data url. */
    protected _url = ''

    constructor () {
    }

    protected get _cache (): SignalCacheMutex | SignalDataCache | null {
        if (this._mutex && this._isMutexReady) {
            return this._mutex
        } else if (this._fallbackCache) {
            return this._fallbackCache
        }
        return null
    }

    get cacheReady () {
        return this._cache !== null
    }

    get dataLength () {
        return this._dataLength
    }

    get dataUnitSize () {
        return this._dataUnitSize
    }

    get discontinuous () {
        return this._discontinuous
    }

    get totalLength () {
        return this._totalLength
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
     * Convert cache time (i.e. time without data gaps) to recording time.
     * @param time - Cache time without gaps.
     * @returns Matching recording time (with gaps).
     */
    _cacheTimeToRecordingTime (time: number) {
        if (time === NUMERIC_ERROR_VALUE) {
            return time
        }
        if (time < 0 || time > this._dataLength) {
            Log.error(
                `Cannot convert cache time to recording time, given time ${time} is out of recording bounds ` +
                `(0 - ${this._dataLength}).`,
            SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        if (!time || !this._discontinuous) {
            return time
        }
        return this._dataUnitIndexToTime(time/this._dataUnitDuration)
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
     * Convert a data unit index into timestamp.
     * @param index - Data unit index to convert.
     * @returns Recording timestamp in seconds.
     */
    _dataUnitIndexToTime (index: number) {
        if (index < 0 || index > this._dataUnitCount) {
            Log.error(
                `Cannot convert data unit index to time, given index ${index} is out of recording bounds ` +
                `(0 - ${this._dataUnitCount}).`,
            SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        let priorGapsTotal = 0
        for (const gap of this._dataGaps) {
            if (gap[0] < index*this._dataUnitDuration) {
                priorGapsTotal += gap[1]
            }
        }
        return index*this._dataUnitDuration + priorGapsTotal
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
     * Get the total gap time between two points in recording time.
     * @param start - Starting time in recording seconds.
     * @param end - Ending time in recording seconds.
     * @returns Total gap time in seconds.
     */
    protected _getGapTimeBetween (start: number, end: number): number {
        if (!this._discontinuous) {
            return 0
        }
        let gapTotal = 0
        for (const gap of this.getDataGaps([start, end])) {
            gapTotal += gap.duration
        }
        return gapTotal
    }
    /**
     * Get current signal cache range.
     * @returns Range as { start: number, end: number } measured in seconds or NUMERIC_ERROR_VALUE if an error occurred.
     */
    protected async _getSignalCacheRange () {
        if (!this._cache) {
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        const rangeStart = await this._cache.outputRangeStart
        const rangeEnd = await this._cache.outputRangeEnd
        if (rangeStart === null || rangeEnd === null) {
            Log.error(
                `Signal cache did not report a valid range: start (${rangeStart}) or end (${rangeEnd}).`,
            SCOPE)
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        return { start: rangeStart, end: rangeEnd }
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
     * Convert recording time to cache time (i.e. time without data gaps).
     * @param time - Recording time.
     * @returns Matching cache time (without gaps).
     */
    protected _recordingTimeToCacheTime (time: number): number {
        if (time === NUMERIC_ERROR_VALUE) {
            return time
        }
        if (time < 0 || time > this._totalLength) {
            Log.error(
                `Cannot convert recording time to cache time, given time ${time} is out of recording bounds ` +
                `(0 - ${this._totalLength}).`,
            SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        if (!time || !this._discontinuous) {
            // Zero is always zero, continuous recording has the same cache and recording time.
            return time
        }
        return time - this._getGapTimeBetween(0, time)
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
    /**
     * Convert a recording timestamp to data unit index.
     * @param time - Timestamp in seconds to convert.
     * @returns Data unit index.
     */
    protected _timeToDataUnitIndex (time: number): number {
        if (time > this._totalLength) {
            Log.error(
                `Cannot convert time to data unit index, given itime ${time} is out of recording bounds ` +
                `(0 - ${this._totalLength}).`,
            SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        const priorGapsTotal = time > 0 ? this._getGapTimeBetween(0, time) : 0
        return Math.floor((time - priorGapsTotal)/this._dataUnitDuration)
    }

    async cacheFile(_file: File, _startFrom?: number | undefined): Promise<void> {
        Log.error(`cacheFile has not been overridden by child class.`, SCOPE)
    }

    cacheNewAnnotations (...annotations: BiosignalAnnotation[]) {
        // Arrange the annotations by record.
        const recordAnnos = [] as BiosignalAnnotation[][]
        for (const anno of annotations) {
            if (!anno) {
                continue
            }
            const annoRec = Math.round(anno.start/this._dataUnitSize)
            if (!recordAnnos[annoRec]) {
                recordAnnos[annoRec] = []
            }
            recordAnnos[annoRec].push(anno)
        }
        new_loop:
        for (const newKey of recordAnnos.keys()) {
            for (const exsistingKey of Object.keys(this._annotations)) {
                if (newKey === parseFloat(exsistingKey)) {
                    continue new_loop
                }
            }
            this._annotations.set(newKey, recordAnnos[newKey])
        }
    }

    cacheNewDataGaps (newGaps: Map<number, number>) {
        new_loop:
        for (const newGap of newGaps) {
            if (!newGap[1] || newGap[1] < 0) {
                continue
            }
            for (const exsistingGap of this._dataGaps) {
                if (newGap[0] === exsistingGap[0]) {
                    continue new_loop
                }
            }
            this._dataGaps.set(newGap[0], newGap[1])
        }
        // We need to sort the gaps to make sure keys appear in ascending order.
        this._dataGaps = new Map([...this._dataGaps.entries()].sort((a, b) => a[0] - b[0]))
    }

    getAnnotations (range?: number[]) {
        const [start, end] = range && range.length === 2
                             ? [range[0], Math.min(range[1], this._totalLength)]
                             : [0, this._totalLength]
        if (!this._cache) {
            Log.error(`Cannot load annoations before signal cache has been initiated.`, SCOPE)
            return []
        }
        if (start < 0 || start >= this._totalLength) {
            Log.error(`Requested annotation range ${start} - ${end} was out of recording bounds.`, SCOPE)
            return []
        }
        if (start >= end) {
            Log.error(`Requested annotation range ${start} - ${end} was empty or invalid.`, SCOPE)
            return []
        }
        const annotations = [] as BiosignalAnnotation[]
        for (const annos of this._annotations.entries()) {
            for (const anno of annos[1]) {
                if (anno.start >= start && anno.start < end) {
                    annotations.push(anno)
                }
            }
        }
        return annotations
    }

    getDataGaps (range?: number[]) {
        const [start, end] = range && range.length === 2
                             ? [range[0], Math.min(range[1], this._totalLength)]
                             : [0, this._totalLength]
        const dataGaps = [] as { duration: number, start: number }[]
        if (!this._cache) {
            Log.error(`Cannot return data gaps before signal cache has been initiated.`, SCOPE)
            return dataGaps
        }
        if (start < 0) {
            Log.error(`Requested data gap range start ${start} was smaller than zero.`, SCOPE)
            return dataGaps
        }
        if (start >= end - this._dataUnitDuration) {
            // This checks for ranges shorter than one data unit or in case of file with no data units
            // (dataUnitDuration=0) range of zero or less.
            return dataGaps
        }
        let priorGapsTotal = 0
        for (const gap of this._dataGaps) {
            const gapTime = gap[0] + priorGapsTotal
            priorGapsTotal += gap[1]
            if (gapTime + gap[1] <= start) {
                continue
            } else if (gapTime < start && gapTime + gap[1] > start) {
                // Prior gap partially extends to the checked range.
                if (gapTime + gap[1] < end) {
                    dataGaps.push({ start: start, duration: gapTime + gap[1] - start })
                } else {
                    dataGaps.push({ start: start, duration: end - start })
                    break
                }
            } else if (gapTime >= start && gapTime < end) {
                if (gapTime + gap[1] < end) {
                    dataGaps.push({ start: gapTime, duration: gap[1] })
                } else {
                    dataGaps.push({ start: gapTime, duration: end - gapTime })
                    break
                }
            } else {
                break
            }
        }
        return dataGaps
    }

    async loadPartFromFile(_startFrom: number, _dataLength: number): Promise<SignalFilePart> {
        Log.error(`loadPartFromFile has not been overridden by child class.`, SCOPE)
        return nullPromise
    }

    async loadFileFromUrl (url?: string) {
        return await fetch(url || this._url)
            .then(response => response.blob())
            .then(blobFile => {
                this._file = {
                    data: new File([blobFile], "recording"),
                    start: 0,
                    length: this._dataLength
                }
                return true
            }).catch((reason: Error) => {
                Log.error(`Error loading file from URL '${url || this._url}':`, SCOPE, reason)
                return false
            })
    }

    async releaseCache () {
        for (const proc of this._cacheProcesses) {
            proc.continue = false
        }
        this._cacheProcesses.splice(0)
        this._cache?.releaseBuffers()
        if (this._mutex) {
            this._isMutexReady = false
            this._mutex = null
        } else if (this._fallbackCache) {
            this._fallbackCache = null
        }
    }

    setupCache () {
        Log.error(`setupCache has not been overridden in child class.`, SCOPE)
        return false
    }

    async setupMutex (_buffer: SharedArrayBuffer, _bufferStart: number) {
        Log.error(`setupMutex has not been overridden in child class.`, SCOPE)
        return nullPromise
    }
}
