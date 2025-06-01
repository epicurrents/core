/**
 * Epicurrents signal file reader. This class can be used inside a worker or the main thread.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    NUMERIC_ERROR_VALUE,
} from '#util'
import type {
    AnnotationTemplate,
    SignalCacheMutex,
    SignalCachePart,
    SignalDataCache,
    SignalDataGap,
    SignalDataGapMap,
    SignalProcessorCache,
    TypedNumberArray,
    TypedNumberArrayConstructor,
} from '#types'
import IOMutex, { type MutexExportProperties } from 'asymmetric-io-mutex'
import { Log } from 'scoped-event-log'
import { EPS as FLOAT32_EPS } from '@stdlib/constants-float32'
import { GenericBiosignalHeader } from '../biosignal'

const SCOPE = 'SignalFileReader'

export default abstract class GenericSignalProcessor implements SignalProcessorCache {

    /** Map of annotations as <position in seconds, list of annotations>. */
    protected _annotations = new Map<number, AnnotationTemplate[]>()
    protected _dataEncoding: TypedNumberArrayConstructor
    /** Map of data gaps as <gap data position, gap length> in seconds. */
    protected _dataGaps = new Map<number, number>() as SignalDataGapMap
    /** Number of data units to write into the file. */
    protected _dataUnitCount = 0
    /** Duration of single data unit in seconds. */
    protected _dataUnitDuration = 0
    /** Size of single data unit in bytes. */
    protected _dataUnitSize = 0
    /** Is the resulting file discontinuous. */
    protected _discontinuous = false
    /** A plain fallback data cache in case mutex is not usable. */
    protected _fallbackCache = null as SignalDataCache | null
    protected _fileTypeHeader: unknown | null = null
    protected _header: GenericBiosignalHeader | null = null
    /** Data source mutex. */
    protected _mutex = null as SignalCacheMutex | null
    protected _sourceBuffer: ArrayBuffer | null = null
    protected _sourceDigitalSignals: TypedNumberArray[] | null = null
    protected _totalDataLength = 0
    protected _totalRecordingLength = 0

    constructor (dataEncoding: TypedNumberArrayConstructor) {
        this._dataEncoding = dataEncoding
    }

    protected get _cache (): SignalCacheMutex | SignalDataCache | null {
        if (this._mutex) {
            return this._mutex
        } else if (this._fallbackCache) {
            return this._fallbackCache
        }
        return null
    }

    get cacheReady () {
        return this._cache !== null
    }

    get dataEncoding () {
        return this._dataEncoding
    }

    get dataLength () {
        return this._totalDataLength
    }

    get dataUnitSize () {
        return this._dataUnitSize
    }

    get discontinuous () {
        return this._discontinuous
    }

    get totalLength () {
        return this._totalRecordingLength
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
        if (time < 0 || time > this._totalDataLength) {
            Log.error(
                `Cannot convert cache time to recording time, given time ${time} is out of recording bounds ` +
                `(0 - ${this._totalDataLength}).`,
            SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        if (!time || !this._discontinuous) {
            return time
        }
        return this._dataUnitIndexToTime(time/this._dataUnitDuration)
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
     * Convert recording time to cache time (i.e. time without data gaps).
     * @param time - Recording time.
     * @returns Matching cache time (without gaps).
     */
    protected _recordingTimeToCacheTime (time: number): number {
        if (time === NUMERIC_ERROR_VALUE) {
            return time
        }
        if (time < 0 || time > this._totalRecordingLength) {
            Log.error(
                `Cannot convert recording time to cache time, given time ${time} is out of recording bounds ` +
                `(0 - ${this._totalRecordingLength}).`,
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
     * Convert a recording timestamp to data unit index.
     * @param time - Timestamp in seconds to convert.
     * @returns Data unit index.
     */
    protected _timeToDataUnitIndex (time: number): number {
        // We cannot check total length if it hasn't been determined yet for a (discontinuous file).
        if (this._totalRecordingLength && time > this._totalRecordingLength) {
            Log.error(
                `Cannot convert time to data unit index, given itime ${time} is out of recording bounds ` +
                `(0 - ${this._totalRecordingLength}).`,
            SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        const priorGapsTotal = time > 0 ? this._getGapTimeBetween(0, time) : 0
        // Avoid float rounding error when converting from stored 32 bit into internal 64 bit float.
        return Math.floor((time + FLOAT32_EPS - priorGapsTotal)/this._dataUnitDuration)
    }

    async cacheFile(_file: File, _startFrom?: number | undefined): Promise<void> {
        Log.error(`cacheFile has not been overridden by child class.`, SCOPE)
    }

    async destroy () {
        await this.releaseCache()
        this._annotations.clear()
        this._dataGaps.clear()
        this._fallbackCache = null
        this._mutex = null
    }

    addNewAnnotations (...annotations: AnnotationTemplate[]) {
        // Arrange the annotations by record.
        const annoMap = new Map<number, AnnotationTemplate[]>()
        for (const anno of annotations) {
            if (!anno) {
                // Don't add empty annotations.
                continue
            }
            const annoRec = Math.round(anno.start/this._dataUnitSize)
            const recordAnnos = annoMap.get(annoRec)
            if (!recordAnnos) {
                annoMap.set(annoRec, [anno])
            } else {
                recordAnnos.push(anno)
            }
        }
        new_loop:
        for (const [newKey, newAnno] of annoMap) {
            for (const exsistingKey of Object.keys(this._annotations)) {
                if (newKey === parseFloat(exsistingKey)) {
                    // This record has already been processed, don't duplicate.
                    continue new_loop
                }
            }
            this._annotations.set(newKey, newAnno)
        }
    }

    addNewDataGaps (newGaps: Map<number, number>) {
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
                             ? [range[0], Math.min(range[1], this._totalRecordingLength)]
                             : [0, this._totalRecordingLength]
        if (!this._cache) {
            Log.error(`Cannot load annoations before signal cache has been initiated.`, SCOPE)
            return []
        }
        if (start < 0 || start >= this._totalRecordingLength) {
            Log.error(`Requested annotation range ${start} - ${end} was out of recording bounds.`, SCOPE)
            return []
        }
        if (start >= end) {
            Log.error(`Requested annotation range ${start} - ${end} was empty or invalid.`, SCOPE)
            return []
        }
        const annotations = [] as AnnotationTemplate[]
        for (const annos of this._annotations.entries()) {
            for (const anno of annos[1]) {
                if (anno.start >= start && anno.start < end) {
                    annotations.push(anno)
                }
            }
        }
        return annotations
    }

    getDataGaps (range = [] as number[], useCacheTime = false): SignalDataGap[] {
        const start = Math.max(0, range[0] || 0)
        const end = useCacheTime
                    ? Math.min(range[1] || this._totalDataLength, this._totalDataLength)
                    : Math.min(range[1] || this._totalRecordingLength, this._totalRecordingLength)
        const dataGaps = [] as SignalDataGap[]
        if (start > end) {
            Log.error(`Requested data gap range ${start} - ${end} is not valid.`, SCOPE)
            return dataGaps
        } else if (start === end) {
            // This can happen when setting up a discontinous recording, but not outside of that.
            Log.debug(`Requested data gap range ${start} - ${end} is empty.`, SCOPE)
            return dataGaps
        }
        let priorGapsTotal = 0
        for (const gap of this._dataGaps) {
            const gapTime = useCacheTime ? gap[0] : gap[0] + priorGapsTotal
            priorGapsTotal += gap[1]
            if ((useCacheTime ? gapTime : gapTime + gap[1]) <= start) {
                continue
            } else if (!useCacheTime && gapTime < start && gapTime + gap[1] > start) {
                // Prior gap partially extends to the checked range.
                if (gapTime + gap[1] < end) {
                    dataGaps.push({ start: start, duration: gapTime + gap[1] - start })
                } else {
                    dataGaps.push({ start: start, duration: end - start })
                    break
                }
            } else if (gapTime >= start && gapTime < end) {
                if (useCacheTime || gapTime + gap[1] < end) {
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

    async getSignals (_range: number[], _config?: unknown): Promise<SignalCachePart|null> {
        Log.error(`getSignals must be overridden in the child class.`, SCOPE)
        return null
    }
    /**
     * Get the largest start and lowest end updated data range (in seconds) for the signals.
     * @returns Range as { start: number, end: number } measured in seconds or NUMERIC_ERROR_VALUE if an error occurred.
     */
    async getSignalUpdatedRange () {
        if (!this._cache) {
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        const ranges = this._cache.outputSignalUpdatedRanges
        const srs = this._cache.outputSignalSamplingRates
        let highestStart = NUMERIC_ERROR_VALUE
        let lowestEnd = NUMERIC_ERROR_VALUE
        for (let i=0; i<ranges.length; i++) {
            const sr = await srs[i]
            if (!sr) {
                // Empty or missing channel, skip
                continue
            }
            const range = await ranges[i]
            if (!range) {
                Log.error(`Montage signal mutex did not report a valid updated range for signal at index ${i}.`, SCOPE)
                return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
            }
            const tStart = range.start/sr
            const tEnd = range.end/sr
            if (range.start !== IOMutex.EMPTY_FIELD) {
                highestStart = (highestStart === NUMERIC_ERROR_VALUE || tStart > highestStart) ? tStart : highestStart
            } else {
                Log.warn(`Signal #${i} has not updated start position set.`, SCOPE)
            }
            if (range.end !== IOMutex.EMPTY_FIELD) {
                lowestEnd = (lowestEnd === NUMERIC_ERROR_VALUE || tEnd < lowestEnd) ? tEnd : lowestEnd
            } else {
                Log.warn(`Signal #${i} has not updated end position set.`, SCOPE)
            }
        }
        if (highestStart === NUMERIC_ERROR_VALUE && lowestEnd === NUMERIC_ERROR_VALUE) {
            Log.error(`Cannot get ranges of updated signals, cache has no initialized signals.`, SCOPE)
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        return {
            start: this._cacheTimeToRecordingTime(highestStart),
            end: this._cacheTimeToRecordingTime(lowestEnd),
        }
    }

    async releaseCache () {
        this._cache?.releaseBuffers()
        if (this._mutex) {
            this._mutex = null
        } else if (this._fallbackCache) {
            this._fallbackCache = null
        }
        Log.debug(`Signal cache released.`, SCOPE)
    }

    setAnnotations (annotations: AnnotationTemplate[]) {
        this._annotations.clear()
        for (const anno of annotations) {
            if (!anno) {
                continue
            }
            const existingAnnos = this._annotations.get(anno.start)
            if (existingAnnos) {
                // If there are already annotations at this position, add to them.
                existingAnnos.push(anno)
            } else {
                this._annotations.set(anno.start, [anno])
            }
        }
    }

    setBiosignalHeader(header: GenericBiosignalHeader): void {
        this._header = header
    }

    setDataGaps (dataGaps: SignalDataGapMap) {
        this._dataGaps = dataGaps
    }

    setFileTypeHeader(header: unknown): void {
        this._fileTypeHeader = header
    }

    setupCache (): SignalDataCache | null {
        Log.error(`setupCache has not been overridden in the child class.`, SCOPE)
        return null
    }

    setupCacheWithInput (
        _cache: SignalDataCache,
        _dataDuration: number,
        _recordingDuration: number,
        _dataGaps = [] as SignalDataGap[]
    ) {
        Log.error(`setupCacheWithInput must be overridden in the child class.`, SCOPE)
    }

    async setupMutex (_buffer: SharedArrayBuffer, _bufferStart: number): Promise<MutexExportProperties|null> {
        Log.error(`setupMutex has not been overridden in the child class.`, SCOPE)
        return null
    }

    async setupMutexWithInput (
        _input: MutexExportProperties,
        _bufferStart: number,
        _dataDuration: number,
        _recordingDuration: number,
        _dataGaps = [] as SignalDataGap[]
    ): Promise<MutexExportProperties|null> {
        Log.error(`setupMutexWithInput must be overridden in the child class.`, SCOPE)
        return null
    }

    /**
     * Set up a shared worker for file loading. This will use a shared worker to query for raw signal data.
     * @param input - Message port from the input worker.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including gaps) in seconds.
     * @param dataGaps - Possible data gaps in the recording.
     */
    async setupSharedWorkerWithInput (
        _input: MessagePort,
        _dataDuration: number,
        _recordingDuration: number,
        _dataGaps = [] as SignalDataGap[]
    ): Promise<boolean> {
        Log.error(`setupSharedWorkerWithInput must be overridden in the child class.`, SCOPE)
        return false
    }
}
