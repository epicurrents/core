/**
 * Epicurrents signal file reader. This class can be used inside a worker or the main thread.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    combineSignalParts,
    MB_BYTES,
    NUMERIC_ERROR_VALUE,
    partsNotCached,
    sleep,
} from '#util'
import type {
    AppSettings,
    ConfigChannelFilter,
    ReadDirection,
    SignalCachePart,
    SignalCacheProcess,
    SignalDataDecoder,
    SignalDataReader,
    SignalDecodeResult,
    SignalFilePart,
    TypedNumberArrayConstructor,
} from '#types'
import { Log } from 'scoped-event-log'
import GenericSignalProcessor from './GenericSignalProcessor'
import SETTINGS from '#config/Settings'
import { BiosignalCache, BiosignalMutex } from '#assets/biosignal'
import { type MutexExportProperties } from 'asymmetric-io-mutex'

const SCOPE = 'GenericSignalFileReader'

export default abstract class GenericSignalReader extends GenericSignalProcessor implements SignalDataReader {

    /** Timeout in milliseconds to wait for awaited data to load before rejecting the promise. */
    static AWAIT_DATA_TIMEOUT = 5000
    /** Alternate read direction between following and preceding parts. */
    static readonly READ_DIRECTION_ALTERNATING: ReadDirection = 'alternate'
    /** Read direction for loading data backward. */
    static readonly READ_DIRECTION_BACKWARD: ReadDirection = 'backward'
    /** Read direction for loading data forward. */
    static readonly READ_DIRECTION_FORWARD: ReadDirection = 'forward'

    /** Authorization header to include in requests. */
    protected _authHeader?: string
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
    /** Decoder used to extract signal data from the file. */
    protected _decoder: SignalDataDecoder | null = null
    /** The file to load. */
    protected _file = null as SignalFilePart | null
    /** Index of next data data unit to load. */
    protected _filePos = 0
    /** Is the mutex fully setup and ready. */
    protected _isMutexReady = false
    protected _maxDataBlocks = 0
    /** Loading process start time (for debugging). */
    protected _startTime = 0
    /** A method to pass update messages to the main thread. */
    protected _updateCallback = null as ((update: { [prop: string]: unknown }) => void) | null
    /** File data url. */
    protected _url = ''
    /** Settings must be kept up-to-date with the main application. */
    SETTINGS: AppSettings

    constructor (dataEncoding: TypedNumberArrayConstructor, settings?: AppSettings) {
        super(dataEncoding)
        this.SETTINGS = settings || SETTINGS
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
     * Read the next signal part starting from the given record index and cache it.
     * @param start - Data record to start from (inclusive).
     * @param process - Optional cache process to continue with this part.
     * @returns Index of the next data record to load or NUMERIC_ERROR_VALUE if an error occurred.
     */
    async _readAndCachePart (start: number, process?: SignalCacheProcess): Promise<number> {
        // Check that cache and all required parameters are set.
        if (
            !this._dataUnitDuration || !this._dataUnitCount || !this._dataUnitSize || !this._totalRecordingLength ||
            !this._cache
        ) {
            Log.warn(`Could not load and cache part, recording or cache was not set up.`, SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        if (start < 0 || start*this._dataUnitDuration >= this._totalRecordingLength) {
            Log.warn(`Could not load and cache part, start position was out of range.`, SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        const dataChunkRecords = Math.max(
            Math.floor(this.SETTINGS.app.dataChunkSize/this._dataUnitSize),
            1 // Always load at least one record at a time.
        )
        const startRecord = start // this.timeToDataRecordIndex(start)
        const finalRecord = process ? process.target.end/this._dataUnitDuration
                                    : this._dataUnitCount
        let nextRecord = Math.min(
            startRecord + dataChunkRecords,
            finalRecord
        )
        if (nextRecord === startRecord) {
            Log.debug(`Loading complete at record index ${nextRecord}.`, SCOPE)
            // End of the line.
            return nextRecord
        }
        try {
            const startTime = this._dataUnitIndexToTime(startRecord)
            const endTime = this._dataUnitIndexToTime(nextRecord)
            const newSignals = await this._readSignalPart(startTime, endTime)
            // Check that some signals were loaded and that the process has not been cancelled/cache released while
            // waiting for the signal data.
            if (newSignals?.signals.length && (!process || process.continue) && this._cache) {
                if (this.discontinuous) {
                    // Convert start and end time to exclude interruptions.
                    newSignals.start = this._recordingTimeToCacheTime(newSignals.start)
                    newSignals.end = this._recordingTimeToCacheTime(newSignals.end)
                }
                await this._cache.insertSignals(newSignals)
                const updated = await this.getSignalUpdatedRange()
                if (
                    updated.start === updated.end ||
                    updated.start === NUMERIC_ERROR_VALUE ||
                    updated.end === NUMERIC_ERROR_VALUE
                ) {
                    Log.error(`Inserting new signals to cache failed.`, SCOPE)
                    return NUMERIC_ERROR_VALUE
                }
                // Report signal cache progress and send new annotation and interruption information.
                if (this._updateCallback) {
                    this._updateCallback({
                        action: 'cache-signals',
                        events: this.getEvents([startTime, endTime]),
                        // Interruption information can change as the file is loaded, they must always be reset.
                        interruptions: this.getInterruptions(undefined, true),
                        range: [updated.start, updated.end],
                        success: true,
                    })
                }
                if (this._awaitData) {
                    if (this._awaitData.range[0] >= updated.start && this._awaitData.range[1] <= updated.end) {
                        Log.debug(`Awaited data loaded, resolving.`, SCOPE)
                        this._awaitData.resolve()
                    }
                }
                // Now, there's a chance the signal cache already contained a part of the signal, so adjust next record
                // accordingly.
                if (
                    !process || process.direction === GenericSignalReader.READ_DIRECTION_FORWARD ||
                    // Either first load or loaded preceding part previously, now load the following part.
                    (process.direction === GenericSignalReader.READ_DIRECTION_ALTERNATING && process.start >= start)
                ) {
                    nextRecord = this._timeToDataUnitIndex(updated.end)
                } else if (
                    process.direction === GenericSignalReader.READ_DIRECTION_BACKWARD ||
                    // We loaded a following part previously, so load a preceding part next.
                    (process.direction === GenericSignalReader.READ_DIRECTION_ALTERNATING && process.start < start)
                ) {
                    if (start === 0) {
                        // Start of recording was loaded.
                        return 0
                    }
                    nextRecord = Math.max(
                        this._timeToDataUnitIndex(updated.start) - dataChunkRecords,
                        0 // Don't try to load negative index records.
                    )
                }
                if (process) {
                    // Update process.
                    if (!combineSignalParts(process, newSignals)) {
                        Log.error(
                            `Failed to combine signal parts ${process.start} - ${process.end} and ` +
                            `${newSignals.start} - ${newSignals.end}.`,
                        SCOPE)
                        return NUMERIC_ERROR_VALUE
                    }
                }
                // A data unit can overflow the available cache size, so check we haven't reached cache end.
                const cacheEnd = await this._cache.outputRangeEnd
                if (cacheEnd && updated.end === cacheEnd) {
                    nextRecord = -1
                }
            }
            // Remove possible process as completed.
            if (process) {
                for (let i=0; i<this._cacheProcesses.length; i++) {
                    if (this._cacheProcesses[i] === process) {
                        this._cacheProcesses.splice(i, 1)
                        break
                    }
                }
            }
            return nextRecord
        } catch (e: unknown) {
            Log.error(`Failed to get signals: ${(e as Error).message}.`, SCOPE, e as Error)
            return NUMERIC_ERROR_VALUE
        }
    }
    /**
     * Read a single part from the cached file.
     * @param startFrom - Starting point of the loading process in seconds of file duration.
     * @param dataLength - Length of the requested data in seconds.
     * @returns Promise containing the signal file part or null.
     */
    async _readPartFromFile (startFrom: number, dataLength: number): Promise<SignalFilePart | null> {
        if (!this._url.length) {
            Log.error(`Could not load file part, there is no source URL to load from.`, SCOPE)
            return null
        }
        if (!this._dataUnitSize) {
            Log.error(`Could not load file part, data unit size has not been set.`, SCOPE)
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
            // Slice the data directly from the file.
            return this._file?.data.slice(dataStart, dataEnd) as Blob
        } : async () => {
            // Fetch the data from the file URL.
            const headers = new Headers()
            headers.set('Range', `bytes=${dataStart}-${dataEnd - 1}`)
            headers.set('Accept-Encoding', 'identity')
            if (this._authHeader) {
                headers.set('Authorization', this._authHeader)
            }
            return await fetch(this._url, {  headers }).then(response => response.blob()).then(blob => {
                if (blob instanceof File || (blob as File).lastModified) {
                    // If the response is a File, it has been downloaded in full (this can happen in e.g. Firefox).
                    return (blob as File).slice(dataStart, dataEnd)
                }
                return blob
            })
        }
        const startTime = this._dataUnitIndexToTime(unitStart)
        const partLength = this._dataUnitIndexToTime(unitEnd - unitStart)
        const signalFilePart = this._blobToFile(
            await getBlob(),
            `SignalFilePart[${startTime},${startTime + partLength}]`
        )
        // Cache only the visible part.
        return {
            data: signalFilePart,
            dataLength: (unitEnd - unitStart)*this._dataUnitDuration,
            length: partLength,
            start: startTime,
        } as SignalFilePart
    }
    /**
     * Read part of raw recording signals. This method should only be used for data formats that support data units.
     * @param start - Start time as seconds.
     * @param end - End time as seconds.
     * @param unknownData - Is the signal data unknown, or especially, can it contain unknown interruptions. If true, final end time is corrected to contain new interruptions (default true).
     * @param raw - Return raw In16 signals instead of physical signals (default false).
     * @returns Promise with signals and corrected start and end times.
     */
    async _readSignalPart (start: number, end: number, unknownData = true, raw = false)
        : Promise<SignalCachePart & Omit<SignalDecodeResult, "signals"> | null>
    {
        // Check that all required parameters are set.
        if (
            !this._decoder ||
            !this._dataUnitDuration || !this._dataUnitSize || !this._dataUnitSize || !this._totalRecordingLength
        ) {
            Log.error(`Cannot read file part, study has not been set up yet.`, SCOPE)
            return null
        }
        if (!this._header) {
            Log.error(`Cannot read file part, study header has not been set.`, SCOPE)
            return null
        }
        if (this._mutex && !this._isMutexReady) {
            Log.error(`Cannot read file part before signal cache has been initiated.`, SCOPE)
            return null
        }
        if (start < 0 || start >= this._totalRecordingLength) {
            Log.error(`Requested signal range ${start} - ${end} was out of recording bounds.`, SCOPE)
            return null
        }
        if (start >= end) {
            Log.error(`Requested signal range ${start} - ${end} was empty or invalid.`, SCOPE)
            return null
        }
        if (end > this._totalRecordingLength) {
            end = this._totalRecordingLength
        }
        const priorGaps = start > 0 ? this._getInterruptionTimeBetween(0, start) : 0
        const innerGaps = this._getInterruptionTimeBetween(start, end)
        const fileStart = start - priorGaps
        const fileEnd = end - priorGaps - innerGaps
        // readPartFromFile performs its own interruption detection.
        const filePart = await this._readPartFromFile(start, end - start)
        if (!filePart) {
            Log.error(`File loader couldn't load signal part between ${fileStart}-${fileEnd}.`, SCOPE)
            return { signals: [], start: start, end: end }
        }
        const recordsPerSecond = 1/this._dataUnitDuration
        // This block is meant to catch possible errors in the decoder and signal interpolation.
        try {
            // Slice a part of the file to process.
            const startPos = Math.round((start - filePart.start)*this._dataUnitSize*recordsPerSecond)
            const endPos = startPos + Math.round((filePart.dataLength)*this._dataUnitSize*recordsPerSecond)
            if (startPos < 0) {
                Log.error(`File starting position is smaller than zero (${startPos})!`, SCOPE)
                throw new Error()
            }
            if (startPos >= endPos) {
                Log.error(`File starting position is greater than ending position (${startPos} > ${endPos})!`, SCOPE)
                throw new Error()
            }
            if (endPos > filePart.data.size) {
                Log.warn(
                    `File ending position is greater than the file size (${endPos} > ${filePart.data.size})!`,
                SCOPE)
                filePart.dataLength = (filePart.data.size - startPos)/(this._dataUnitSize*recordsPerSecond)
            }
            const chunk = filePart.data.slice(startPos, Math.min(endPos, filePart.data.size))
            const chunkBuffer = await chunk.arrayBuffer()
            // Byte offset is always 0, as we slice the data to start from the correct position.
            // Add up all interruptions until this point.
            const sigData = this._decoder.decodeData(
                                this._fileTypeHeader,
                                chunkBuffer,
                                0,
                                (start - priorGaps)*recordsPerSecond,
                                filePart.dataLength/this._dataUnitDuration,
                                priorGaps,
                                raw
                            )
            if (!sigData?.signals) {
                return {
                    signals: [],
                    start: start,
                    end: end,
                }
            }
            // Cache possible new events.
            if (sigData.events?.length) {
                this.addNewEvents(...sigData.events)
            }
            if (sigData.interruptions?.size) {
                this.addNewInterruptions(sigData.interruptions)
                if (unknownData) {
                    // Include new interruptions to end time.
                    let total = 0
                    for (const intr of sigData.interruptions.values()) {
                        total += intr
                    }
                    end += total - innerGaps // Total minus already known interruptions.
                }
            }
            // Construct a cache object to return the signal data in.
            const cacheSignals = [] as SignalCachePart["signals"]
            for (let i=0; i<sigData.signals.length; i++) {
                const sigSr = this._header.signals[i].samplingRate
                const isAnnotation = this._header.signals[i].modality === 'annotation'
                                     ? true : false
                cacheSignals.push({
                    data: isAnnotation ? new Float32Array() : new Float32Array(sigData.signals[i]),
                    samplingRate: isAnnotation ? 0 : sigSr,
                })
            }
            return {
                signals: cacheSignals,
                start: start,
                end: end,
                events: sigData.events,
                interruptions: sigData.interruptions,
            }
        } catch (e: unknown) {
            Log.error(
                `Failed to load signal part between ${start} and ${end}: ${(e as Error).message}`,
                SCOPE,
                e as Error
            )
            return null
        }
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
        // Signal data is converted to float32, so it may take more space than the file itself.
        const conversionFactor = 4/this._dataEncoding.BYTES_PER_ELEMENT
        if (file.size < this.SETTINGS.app.maxLoadCacheSize/conversionFactor && !startFrom) {
            Log.info(`Starting progressive loading of a file of size ${(file.size/MB_BYTES).toFixed(2)} MiB.`, SCOPE)
            // Cache the entire file.
            this._file = {
                data: file,
                dataLength: this._totalDataLength,
                length: this._totalRecordingLength,
                start: 0,
            }
            try {
                this._filePos = 0
                this._loadNextPart()
            } catch (e: unknown) {
                Log.error(`Encountered an error when loading signal file: ${(e as Error).message}.`, SCOPE, e as Error)
            }
        } else {
            Log.error(
                `Not starting from beginning of file or file size ${file.size} bytes exceeds allowed cache size, `+
                `loading file in parts is not yet implemented.`,
            SCOPE)
        }
    }

    async cacheSignals (startFrom = 0): Promise<boolean> {
        if (!this._fileTypeHeader) {
            Log.error([`Could not cache signals.`, `Study parameters have not been set.`], SCOPE)
            return false
        }
        if (!this.cacheReady) {
            Log.error([`Could not cache signals.`, `Signal cache has not been initialized.`], SCOPE)
            return false
        }
        const unitConversionFactor = 4/this._dataEncoding.BYTES_PER_ELEMENT
        const totalSignalDataSize = this._dataUnitSize*this._dataUnitCount*unitConversionFactor
        // Get an array of parts that are in the process of being cached.
        const cacheTargets = this._cacheProcesses.map(proc => proc.target)
        // If we're at the start of the recording and can cache it entirely, just do that.
        if (this.SETTINGS.app.maxLoadCacheSize >= totalSignalDataSize) {
            Log.debug(`Loading the whole recording to cache.`, SCOPE)
            if (startFrom) {
                // Not starting from the beginning, load initial part at location.
                const startRecord = this._timeToDataUnitIndex(startFrom)
                await this._readAndCachePart(startRecord)
            }
            const requestedPart = {
                start: 0,
                end: this._totalDataLength,
                signals: []
            } as SignalCachePart
            // Check what if any parts still need to be cached.
            const partsToCache = partsNotCached(requestedPart, ...cacheTargets)
            // No need to continue if there is nothing left to cache.
            if (!partsToCache.length) {
                return true
            }
            // Otherwise, add the parts that still need caching into ongoing processes.
            const newCacheProcs = partsToCache.map(part => {
                return {
                    continue: true,
                    direction: GenericSignalReader.READ_DIRECTION_FORWARD,
                    start: part.start,
                    end: part.start,
                    signals: [],
                    target: part
                } as SignalCacheProcess
            })
            this._cacheProcesses.push(...newCacheProcs)
            // Start loading missing parts consecutively.
            for (const proc of newCacheProcs) {
                let nextPart = Math.floor(proc.start/this._dataUnitDuration)
                // Check that the cache has not been released in the middle of loading data and that we're not at the
                // end of the recording.
                while (this._cache && nextPart >= 0 && nextPart*this._dataUnitDuration < proc.target.end) {
                    // Continue loading records, but don't hog the entire thread.
                    if (proc.continue) {
                        [nextPart] = await Promise.all([
                            this._readAndCachePart(nextPart, proc),
                            sleep(10)
                        ])
                    }
                    proc.end = nextPart*this._dataUnitDuration
                }
            }
        } else {
            // Cannot load entire file.
            // The idea is to consider the cached signal data in three parts.
            // - Middle part is where the active view is (or should be).
            // - In addition, one third of cached data precedes it and one third follows it.
            // Whenever the active view enters the preceding or following third, a new "third" is loaded to that end
            // and the third at the far end is scrapped.
            // Get current signal cache range
            const range = await this._getSignalCacheRange()
            if (range.start === NUMERIC_ERROR_VALUE) {
                Log.error(`The signal cache mutex did not return a valid signal range.`, SCOPE)
                return false
            }
            // First, check if current cache already has this part as one of the "thirds".
            const cacheThird = this._maxDataBlocks/3
            const firstThird = range.start + Math.round(cacheThird)
            const secondThird = range.start + Math.round(cacheThird*2)
            const lastThird = range.start + this._maxDataBlocks
            // Seek the data block the starting point is in.
            let nowInPart = 0
            if (startFrom) {
                for (let i=0; i<this._dataBlocks.length; i++) {
                    if (this._dataBlocks[i].startTime <= startFrom && this._dataBlocks[i].endTime > startFrom) {
                        nowInPart = i
                    }
                }
            }
            if (
                // Case when the cache does not start from the beginning of the recording, but view is in the middle third.
                startFrom >= firstThird && startFrom < secondThird ||
                // Case when it does (and view is in the first or middle third, this check must be in the first clause!).
                range.start === 0 && startFrom < secondThird
            ) {
                // We don't have to do any changes.
                return true
            } else if (startFrom < firstThird) {
                // Cache does not start from the beginning and the view is in the first third
                // -> ditch last block and load a preceding one.
                null
            } else if (
                startFrom >= secondThird && startFrom < lastThird ||
                range.start === 0 && startFrom < lastThird
            ) {
                // View in the last third -> ditch first block and load following data.

            } else {
                // Check if we are already in the process of loading this part.
                for (const proc of this._cacheProcesses) {
                    // Same checks basically.
                    const procFirstThird = proc.target.start + Math.round(cacheThird)
                    const procSecondThird = proc.target.start + Math.round(cacheThird*2)
                    const procLastThird = proc.target.start + this._maxDataBlocks
                    if (
                        startFrom >= procFirstThird && startFrom < procSecondThird ||
                        proc.target.start === 0 && startFrom < procSecondThird
                    ) {
                        return true
                    } else if (startFrom < procFirstThird) {
                        null
                    } else if (
                        startFrom >= procSecondThird && startFrom < procLastThird ||
                        proc.target.start === 0 && startFrom < procLastThird
                    ) {
                        null
                    }
                }
            }
            // First, load the next part (where the user will most likely browse).
            // TODO: Finish this method.
            nowInPart // Used here to determine the next part, suppress linting error.
            Log.error(`Caching only partial files is not supported yet.`, SCOPE)
            return false
        }
        return true
    }

    async destroy () {
        await this.releaseCache()
        this._dataBlocks.length = 0
        this._file = null
        this._url = ''
        super.destroy()
    }

    async getSignals (range: number[], config?: ConfigChannelFilter) {
        if (!this._fileTypeHeader || !this._cache) {
            Log.error("Cannot load signals, signal cache has not been set up yet.", SCOPE)
            return null
        }
        if (this._mutex && !this._isMutexReady) {
            Log.error(`Cannot load signals before signal cache has been initiated.`, SCOPE)
            return null
        }
        if (range[0] === range[1]) {
            Log.error(`Cannot load signals from an empty range ${range[0]} - ${range[1]}.`, SCOPE)
            return null
        }
        // Get current signal cache range.
        const cacheRange = await this._getSignalCacheRange()
        if (cacheRange.start >= cacheRange.end) {
            Log.error(`The signal cache did not return a valid range for stored signals.`, SCOPE)
            return null
        }
        let requestedSigs: SignalCachePart | null = null
        if (cacheRange.start > range[0] || cacheRange.end < Math.min(range[1], this._totalDataLength)) {
            // Fetch the requested part from signal file.
            try {
                requestedSigs = await this._readSignalPart(range[0], range[1])
                if (!requestedSigs) {
                    return null
                }
            } catch (e: unknown) {
                Log.error(
                    `Loading signals for range [${range[0]}, ${range[1]}] failed: ${(e as Error).message}.`,
                    SCOPE,
                    e as Error
                )
                return null
            }
        }
        // Make sure we have the requested range of signals.
        const loadedSignals = await this.getSignalUpdatedRange()
        if (loadedSignals.start === NUMERIC_ERROR_VALUE || loadedSignals.end === NUMERIC_ERROR_VALUE) {
            if (!this._cacheProcesses.length) {
                Log.error(`Loading signals for range [${range[0]}, ${range[1]}] failed, cannot read updated signal ranges.`, SCOPE)
                return null
            }
        }
        if (
            (
                (loadedSignals.start > range[0] && loadedSignals.start > 0) ||
                (loadedSignals.end < range[1] && loadedSignals.end < this._totalRecordingLength)
            ) &&
            this._cacheProcesses.length
        ) {
            Log.debug(
                `Requested signals have not been loaded yet, waiting for ${
                    (GenericSignalReader.AWAIT_DATA_TIMEOUT/1000)
                } seconds.`,
                SCOPE
            )
            // Set up a promise to wait for an active data loading process to load the missing data.
            const dataUpdatePromise = new Promise<void>((resolve) => {
                this._awaitData = {
                    range: range,
                    resolve: resolve,
                    timeout: setTimeout(resolve, GenericSignalReader.AWAIT_DATA_TIMEOUT),
                }
            })
            await dataUpdatePromise
            if (this._awaitData?.timeout) {
                clearTimeout(this._awaitData.timeout as number)
            } else {
                Log.debug(`Timeout reached when waiting for missing signals.`, SCOPE)
            }
            this._awaitData = null
        }
        requestedSigs = await this._cache.asCachePart()
        // Filter channels, if needed.
        const included = [] as number[]
        // Prioritize include -> only process those channels.
        if (config?.include?.length) {
            for (let i=0; i<requestedSigs.signals.length; i++) {
                if (config.include.indexOf(i) !== -1) {
                    included.push(i)
                } else {
                    Log.debug(`Not including channel #${i} in requested signals.`, SCOPE)
                }
            }
        } else if (config?.exclude?.length) {
            for (let i=0; i<requestedSigs.signals.length; i++) {
                if (config.exclude.indexOf(i) === -1) {
                    included.push(i)
                } else {
                    Log.debug(`Excluding channel #${i} from requested signals.`, SCOPE)
                }
            }
        }
        const responseSigs = {
            start: range[0],
            end: range[1],
            signals: [],
        } as SignalCachePart
        // Find amount of interruption time before and within the range.
        const interruptions = this.getInterruptions(range)
        const priorGapsTotal = range[0] > 0 ? this._getInterruptionTimeBetween(0, range[0]) : 0
        const innerGapsTotal = this._getInterruptionTimeBetween(range[0], range[1])
        const rangeStart = range[0] - priorGapsTotal
        const rangeEnd = range[1] - priorGapsTotal - innerGapsTotal
        for (let i=0; i<requestedSigs.signals.length; i++) {
            if (included.length && included.indexOf(i) === -1) {
                continue
            }
            const signalForRange = new Float32Array(
                Math.round((range[1] - range[0])*requestedSigs.signals[i].samplingRate)
            ).fill(0.0)
            if (rangeStart === rangeEnd) {
                // The whole range is interruption time.
                responseSigs.signals.push({
                    data: signalForRange,
                    samplingRate: requestedSigs.signals[i].samplingRate,
                })
                continue
            }
            const startSignalIndex = Math.round((rangeStart - requestedSigs.start)*requestedSigs.signals[i].samplingRate)
            const endSignalIndex = Math.round((rangeEnd - requestedSigs.start)*requestedSigs.signals[i].samplingRate)
            signalForRange.set(requestedSigs.signals[i].data.slice(startSignalIndex, endSignalIndex))
            for (const intr of interruptions) {
                const startPos = Math.round((intr.start - range[0])*requestedSigs.signals[i].samplingRate)
                const endPos = Math.min(
                    startPos + Math.round(intr.duration*requestedSigs.signals[i].samplingRate),
                    startPos + signalForRange.length
                )
                // Move the existing array members upward.
                const remainder = signalForRange.slice(
                    startPos,
                    startPos + signalForRange.length - endPos
                )
                if (endPos < signalForRange.length) {
                    signalForRange.set(remainder, endPos)
                }
                // Replace with zeroes.
                signalForRange.set(
                    new Float32Array(endPos - startPos).fill(0.0),
                    startPos
                )
            }
            responseSigs.signals.push({
                data: signalForRange,
                samplingRate: requestedSigs.signals[i].samplingRate,
            })
        }
        return responseSigs
    }

    async readFileFromUrl (url?: string) {
        const headers = new Headers()
        if (this._authHeader) {
            headers.set('Authorization', this._authHeader)
        }
        return await fetch(url || this._url, { headers })
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

    setupCache (dataDuration = 0) {
        if (this._fallbackCache) {
            Log.warn(`Tried to re-initialize already initialized signal data cache.`, SCOPE)
        } else {
            this._fallbackCache = new BiosignalCache(dataDuration)
        }
        return this._fallbackCache
    }

    async setupMutex (buffer: SharedArrayBuffer, bufferStart: number): Promise<MutexExportProperties|null> {
        if (this._mutex) {
            Log.warn(`Tried to re-initialize already initialized signal data cache.`, SCOPE)
            return this._mutex.propertiesForCoupling
        }
        if (!this._header) {
            Log.error([`Cannot initialize mutex cache.`, `Study parameters have not been set.`], SCOPE)
            return null
        }
        // Construct a SignalCachePart to initialize the mutex.
        const cacheProps = {
            start: 0,
            end: 0,
            signals: []
        } as SignalCachePart
        for (const sig of this._header.signals) {
            cacheProps.signals.push({
                data: new Float32Array(),
                samplingRate: sig.modality === 'annotation' ? 0 // Don't cache annotation data.
                              : sig.samplingRate
            })
        }
        this._mutex = new BiosignalMutex()
        Log.debug(`Initiating mutex cache in the worker.`, SCOPE)
        this._mutex.initSignalBuffers(cacheProps, this._totalDataLength, buffer, bufferStart)
        Log.debug(`Signal data cache initiation complete.`, SCOPE)
        // Mutex is fully set up.
        this._isMutexReady = true
        return this._mutex.propertiesForCoupling
    }

    setUpdateCallback (callback: ((update: { [prop: string]: unknown }) => void) | null) {
        this._updateCallback = callback
    }
}
