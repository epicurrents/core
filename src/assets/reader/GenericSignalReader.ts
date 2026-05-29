/**
 * Epicurrents signal file reader. This class can be used inside a worker or the main thread.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    awaitThenSleep,
    combineSignalParts,
    MB_BYTES,
    NUMERIC_ERROR_VALUE,
    partsNotCached,
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
import BiosignalCache from '#assets/biosignal/service/BiosignalCache'
import BiosignalMutex from '#assets/biosignal/service/BiosignalMutex'
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
        /** Data contained in this block if loaded, null if not (informational only). */
        data: SignalFilePart | null
        /** Whether this block's samples are currently present in the rolling cache window. */
        loaded: boolean
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
    /**
     * Maximum number of contiguous data blocks that the signal cache can hold at once.
     *
     * Set during {@link _buildDataBlocks} based on the per-channel sample rate, the configured
     * {@link AppSettings.app.dataBlockDuration}, and the available memory budget. When this is
     * greater than or equal to {@link _dataBlocks}`.length` the entire recording fits in the
     * cache and the rolling-window path is bypassed (see {@link _useRolling}).
     *
     * The rolling cache needs to hold at minimum three blocks (one for the current view plus one
     * on each side); deployments where the memory budget cannot accommodate three full blocks
     * for the recording's channels must fall back to either a smaller block duration or refuse
     * to open the recording.
     */
    protected _maxDataBlocks = 0
    /** Loading process start time (for debugging). */
    protected _startTime = 0
    /**
     * True when the recording is large enough that the rolling-window cache must be used (i.e.
     * the full recording cannot fit in memory at the configured cache size). Set by
     * {@link _buildDataBlocks}. The full-cache path is used when this is false.
     */
    protected _useRolling = false
    /**
     * The actual block duration in seconds chosen for the rolling cache, computed adaptively
     * from the channel sample rates and `maxLoadCacheSize` budget. Used by {@link setupMutex}
     * to size the mutex's signal buffers at `samplingRate × 3 × _blockDuration` per channel.
     * Set by {@link _buildDataBlocks}; 0 before that runs.
     */
    protected _blockDuration = 0
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
                // Report signal cache progress and send new event and interruption information.
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
                    inFlightRead: null,
                    signals: [],
                    target: part
                } as SignalCacheProcess
            })
            this._cacheProcesses.push(...newCacheProcs)
            // Start loading missing parts consecutively. Yield to the consumer thread for
            // `signalLoadingYieldMs` after every chunk read so listeners of the
            // `'cache-signals'` dispatch fired inside `_readAndCachePart` have a guaranteed
            // gap to process it before the next chunk arrives. Running the read and the
            // throttle in parallel (the previous pattern) doesn't give the consumer real
            // breathing room when the read is faster than the throttle.
            const yieldMs = this.SETTINGS.app.signalLoadingYieldMs ?? 50
            for (const proc of newCacheProcs) {
                let nextPart = Math.floor(proc.start/this._dataUnitDuration)
                // Check that the cache has not been released in the middle of loading data
                // and that we're not at the end of the recording.
                while (this._cache && nextPart >= 0 && nextPart*this._dataUnitDuration < proc.target.end) {
                    if (!proc.continue) {
                        proc.end = nextPart*this._dataUnitDuration
                        break
                    }
                    // Expose the in-flight chunk on the process so `releaseSignalArrays`
                    // can await it before clearing the process list — that drain is what
                    // makes the release "no stale message can land after the ack" race-free.
                    proc.inFlightRead = awaitThenSleep(
                        this._readAndCachePart(nextPart, proc),
                        yieldMs,
                    )
                    nextPart = await proc.inFlightRead
                    proc.inFlightRead = null
                    proc.end = nextPart*this._dataUnitDuration
                }
            }
        } else {
            // Rolling cache: the recording does not fit in memory, hold three blocks at a time
            // and slide the window as the view crosses block boundaries. `_slideToBlock` does the
            // heavy lifting (mutex range update + per-block load/evict) and is idempotent — calling
            // it when the cache is already correctly positioned is a no-op via `setSignalRange`'s
            // own short-circuit on identical bounds. So we always defer to it rather than trying
            // to second-guess the cache state here.
            if (!this._dataBlocks.length) {
                Log.error(`Rolling cache requested but no data blocks have been built.`, SCOPE)
                return false
            }
            // Find the block that contains the requested view position. The view is in data-time
            // (gap-exclusive) just like the block boundaries, so a simple linear scan suffices.
            // For positions at or past the last block's `endTime` (e.g. user navigates to the very
            // end of the recording where viewStart can equal totalDataLength), default to the last
            // block instead of falling through to 0 — sliding back to block 0 would be the opposite
            // of what the user requested.
            let viewBlock = this._dataBlocks.length - 1
            if (startFrom < this._dataBlocks[0].startTime) {
                viewBlock = 0
            } else {
                for (let i = 0; i < this._dataBlocks.length; i++) {
                    if (this._dataBlocks[i].startTime <= startFrom && this._dataBlocks[i].endTime > startFrom) {
                        viewBlock = i
                        break
                    }
                }
            }
            return await this._slideToBlock(viewBlock)
        }
        return true
    }

    /**
     * Level 1 of the three-level cache lifecycle, signal-reader flavour.
     * Cancels in-flight caching processes (so async `_readAndCachePart` calls
     * that are awaiting between yields don't resume and write into the
     * about-to-be-rebound mutex), clears the process list, and hands off to
     * the mutex to release its array views while preserving layout.
     *
     * The previous behaviour folded this work into `releaseCache` (Level 2)
     * as a band-aid against the race; promoting it to its own Level keeps the
     * cleanup synchronous and pre-release, and lets callers that intend to
     * reuse the mutex shell (re-activation path) avoid the full Level 2
     * teardown.
     */
    async releaseSignalArrays () {
        // Signal every running loop to exit at its next iteration.
        for (const proc of this._cacheProcesses) {
            proc.continue = false
        }
        // CRITICAL: drain any in-flight `_readAndCachePart` chunks before
        // proceeding. `proc.continue = false` only stops the loop at its NEXT
        // iteration check — the currently-running chunk will still complete and
        // post its `cache-signals` progress message. If we cleared the process
        // list and let the release ack reach the main thread before that final
        // message did, the receiver-side `signalCacheStatus = [0, 0]` reset on
        // reactivation would have to defend against a stale message arriving
        // late (the Session 2026-05-18 band-aid). Awaiting the in-flight read
        // here guarantees postMessage ordering: every progress message lands on
        // the main thread *before* the release ack, so no defensive reset is
        // needed downstream.
        await Promise.all(this._cacheProcesses.map(p => p.inFlightRead ?? Promise.resolve()))
        this._cacheProcesses.length = 0
        await super.releaseSignalArrays()
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

    /**
     * Partition the recording into fixed-duration data blocks and decide whether the rolling-window
     * cache strategy applies. Idempotent: re-running with the same recording dimensions produces the
     * same table.
     *
     * After this method runs:
     * - {@link _dataBlocks} contains one entry per block of `dataBlockDuration` seconds, in data-time
     *   (gap-exclusive). The final block may be shorter if the recording length is not a multiple of
     *   the block duration. Each entry has `data = null` initially.
     * - {@link _maxDataBlocks} is the maximum number of blocks that can be held in memory at once,
     *   given the configured `maxLoadCacheSize` and the per-second byte rate of the recording.
     * - {@link _useRolling} is `true` only when the full recording cannot fit in the cache. When
     *   `false` the existing full-load path is used and the block table is informational only.
     *
     * Block sizing is in data-time, not wall-clock time, so EDF+D interruptions do not shrink or
     * stretch blocks. The four-case dispatch in `cacheSignals` uses these block bounds to decide
     * which block(s) to load or evict as the active view crosses boundaries.
     */
    protected _buildDataBlocks () {
        this._dataBlocks.length = 0
        if (!this._header || !this._dataUnitDuration || !this._dataUnitCount || !this._dataUnitSize) {
            // Recording dimensions not yet known; nothing to partition.
            this._maxDataBlocks = 0
            this._useRolling = false
            return
        }
        const blockDurationCap = this.SETTINGS.app.dataBlockDuration || 3600
        const maxCacheBytes = this.SETTINGS.app.maxLoadCacheSize || 0
        const conversionFactor = 4 / this._dataEncoding.BYTES_PER_ELEMENT
        const totalSignalDataSize = this._dataUnitSize * this._dataUnitCount * conversionFactor
        // Compute the adaptive block duration. Goal: 3 blocks of `blockDuration` seconds must fit in
        // ~95 % of `maxLoadCacheSize` worth of channel sample bytes, then clamp to a usable range.
        // The 5 % margin covers the per-channel and per-mutex metadata overhead so the SAB never
        // exactly fills, which can fail `setDataArrays` on integer rounding.
        const bytesPerSecond = this._header.signals.reduce(
            (total, sig) => total + (sig.modality === 'annotation' ? 0 : sig.samplingRate * 4),
            0
        )
        const idealBlockDuration = bytesPerSecond > 0
            ? Math.floor(maxCacheBytes * 0.95 / (3 * bytesPerSecond))
            : blockDurationCap
        // Hard floor of 60 s — going lower makes block transitions fire too frequently to be useful.
        // Soft ceiling at `dataBlockDuration` setting (default 60 min) — blocks much larger than the
        // user's view page don't help and just delay individual block loads.
        const ROLLING_BLOCK_FLOOR = 60
        const blockDuration = Math.max(ROLLING_BLOCK_FLOOR, Math.min(blockDurationCap, idealBlockDuration))
        // Round block size up to the next whole number of data records so block boundaries align
        // with record boundaries — that's what `Range:` requests can address atomically.
        const recordsPerBlock = Math.max(1, Math.ceil(blockDuration / this._dataUnitDuration))
        const blockSeconds = recordsPerBlock * this._dataUnitDuration
        const blockBytes = recordsPerBlock * this._dataUnitSize
        this._blockDuration = blockSeconds
        const totalBlocks = Math.ceil(this._dataUnitCount / recordsPerBlock)
        for (let i = 0; i < totalBlocks; i++) {
            const startRecord = i * recordsPerBlock
            const endRecord = Math.min(startRecord + recordsPerBlock, this._dataUnitCount)
            this._dataBlocks.push({
                startRecord,
                endRecord,
                startTime: startRecord * this._dataUnitDuration,
                endTime: endRecord * this._dataUnitDuration,
                startBytePos: this._dataOffset + startRecord * this._dataUnitSize,
                endBytePos: this._dataOffset + endRecord * this._dataUnitSize,
                data: null,
                loaded: false,
            })
        }
        const blockSignalDataSize = blockBytes * conversionFactor
        if (maxCacheBytes >= totalSignalDataSize) {
            // Full-load path: pretend the cache can hold every block.
            this._maxDataBlocks = totalBlocks
            this._useRolling = false
        } else {
            // Rolling path: how many whole blocks fit?
            this._maxDataBlocks = Math.max(0, Math.floor(maxCacheBytes / blockSignalDataSize))
            this._useRolling = true
            if (this._maxDataBlocks < 3) {
                Log.warn(
                    `Cache size ${maxCacheBytes} bytes can only hold ${this._maxDataBlocks} block(s) of ` +
                    `${blockSeconds.toFixed(1)} s each for this recording; rolling cache requires at least 3.`,
                    SCOPE
                )
            }
        }
        // TODO: Remove once rolling window cache is implemented.
        Log.info(
            `Partitioned recording into ${totalBlocks} block(s) of ${recordsPerBlock} record(s) ` +
            `(${blockSeconds.toFixed(1)} s each, ideal=${idealBlockDuration}s cap=${blockDurationCap}s); ` +
            `max ${this._maxDataBlocks} concurrent in cache, rolling=${this._useRolling}.`,
            SCOPE
        )
    }

    /**
     * Load one data block's worth of raw signal into the cache. The block's data range is converted
     * to data-time seconds and fetched via the existing {@link _readSignalPart} path (HTTP `Range:`
     * or `File.slice()` plus decoder + interruption handling), then inserted into the cache via
     * {@link insertSignals}. The mutex side handles cache-relative addressing — the insert is
     * keyed by the block's absolute data-time start, and the mutex writes to the correct offset
     * inside its current `RANGE_START`/`RANGE_END` window.
     *
     * Sets `_dataBlocks[idx].data` to a sentinel non-null value on success so callers can tell
     * "this block has been loaded since the last slide" from `data === null`. The actual sample
     * bytes live in the SAB-backed mutex, not in this field — keeping a parallel copy would
     * defeat the rolling cache's memory savings.
     */
    protected async _loadBlock (idx: number): Promise<boolean> {
        if (idx < 0 || idx >= this._dataBlocks.length) {
            Log.warn(`Block index ${idx} is out of range [0, ${this._dataBlocks.length}).`, SCOPE)
            return false
        }
        const block = this._dataBlocks[idx]
        if (block.loaded) {
            // Already loaded for the current window.
            return true
        }
        if (!this._cache) {
            Log.error(`Cannot load block ${idx}, cache has not been initialized.`, SCOPE)
            return false
        }
        try {
            const newSignals = await this._readSignalPart(block.startTime, block.endTime)
            if (!newSignals || !newSignals.signals.length) {
                Log.warn(`Block ${idx} read returned no signals.`, SCOPE)
                return false
            }
            if (this.discontinuous) {
                newSignals.start = this._recordingTimeToCacheTime(newSignals.start)
                newSignals.end = this._recordingTimeToCacheTime(newSignals.end)
            }
            await this._cache.insertSignals(newSignals)
            // Notify the main thread that new data has been loaded. The viewer watches
            // `signalCacheStatus` property changes that are driven by these `cache-signals`
            // updates to decide when to render; without this dispatch the renderer would never
            // know the rolling cache has fresh samples and would show blank channels even though
            // the SAB-backed mutex holds the data.
            //
            // `getSignalUpdatedRange()` returns positions *within the cache buffer* (in seconds);
            // when the rolling cache has slid past time 0, the absolute recording-time range is
            // offset by `cacheRange.start`. For the full-cache path `cacheRange.start === 0` so
            // adding it is harmless.
            const updated = await this.getSignalUpdatedRange()
            const cacheRange = await this._getSignalCacheRange()
            const absStart = cacheRange.start + updated.start
            const absEnd = cacheRange.start + updated.end
            if (this._updateCallback) {
                this._updateCallback({
                    action: 'cache-signals',
                    events: this.getEvents([block.startTime, block.endTime]),
                    interruptions: this.getInterruptions(undefined, true),
                    range: [absStart, absEnd],
                    success: true,
                })
            }
            if (this._awaitData) {
                if (this._awaitData.range[0] >= absStart && this._awaitData.range[1] <= absEnd) {
                    this._awaitData.resolve()
                }
            }
            // Mark as loaded. The actual samples live in the SAB-backed mutex; the `loaded`
            // flag just tracks "this block has data in the current window" to avoid redundant
            // re-loads on subsequent `_slideToBlock` calls that don't change the window.
            block.loaded = true
            return true
        } catch (e: unknown) {
            Log.error(`Failed to load block ${idx}: ${(e as Error).message}.`, SCOPE, e as Error)
            return false
        }
    }

    /**
     * Mark a block as no longer present in the cache window. The SAB-side eviction is performed
     * by {@link BiosignalMutex.setSignalRange} inside {@link _slideToBlock}; this method just
     * clears the block-table entry so `_loadBlock` knows the data needs to be fetched again
     * if the window slides back over it.
     */
    protected _evictBlock (idx: number): void {
        if (idx >= 0 && idx < this._dataBlocks.length) {
            this._dataBlocks[idx].loaded = false
        }
    }

    /**
     * Slide the rolling-window cache so that the three blocks `[centerIdx - 1, centerIdx, centerIdx + 1]`
     * (clamped to valid indices) are the ones held in the mutex. Existing in-window data is preserved
     * via {@link BiosignalMutex.setSignalRange} (which shifts samples within the SAB and resets
     * per-channel `updated_start`/`updated_end` for evicted regions); blocks outside the new window
     * are marked evicted via {@link _evictBlock}; blocks inside the new window that are not yet
     * present are loaded via {@link _loadBlock} (in parallel).
     *
     * No-op if the recording is not in rolling mode, or if the requested window already matches the
     * current one.
     */
    protected async _slideToBlock (centerIdx: number): Promise<boolean> {
        if (!this._useRolling || !this._mutex || !this._dataBlocks.length) {
            return false
        }
        const lastIdx = this._dataBlocks.length - 1
        const targetCount = Math.min(3, this._maxDataBlocks, lastIdx + 1)
        // Target a window of exactly `targetCount` blocks, centred on `centerIdx` when possible.
        // At the leading/trailing edge of the recording, "centre" doesn't have a block to its
        // left/right — extend the other direction so the window stays the same width. This keeps
        // the mutex's RANGE_START / RANGE_END at the values picked at setupMutex for the initial
        // call (viewBlock=0), avoiding the costly and currently-buggy case 4 / case 3 paths in
        // `BiosignalMutex.setSignalRange` when the window contains or contracts from the existing
        // one.
        let firstIdx = Math.max(0, centerIdx - 1)
        let secondIdx = Math.min(lastIdx, centerIdx + 1)
        while (secondIdx - firstIdx + 1 < targetCount) {
            if (firstIdx > 0) {
                firstIdx -= 1
            } else if (secondIdx < lastIdx) {
                secondIdx += 1
            } else {
                // Recording is shorter than the target count of blocks; use what we have.
                break
            }
        }
        // Shrink (shouldn't happen with the expansion logic above, but stay defensive).
        if (secondIdx - firstIdx + 1 > targetCount) {
            if (centerIdx - firstIdx >= secondIdx - centerIdx) {
                firstIdx = secondIdx - targetCount + 1
            } else {
                secondIdx = firstIdx + targetCount - 1
            }
        }
        const rangeStart = this._dataBlocks[firstIdx].startTime
        // Clamp the end at the recording duration — the last block may be shorter than a full
        // `dataBlockDuration` and the mutex's allocated range starts at `cacheProps.start = 0`.
        const rangeEnd = Math.min(this._dataBlocks[secondIdx].endTime, this._totalDataLength)
        const blocksToLoadCount = this._dataBlocks
            .slice(firstIdx, secondIdx + 1)
            .filter(b => !b.loaded).length
        // TODO: Remove once rolling window cache is implemented.
        Log.info(
            `_slideToBlock(center=${centerIdx}): window=[${firstIdx},${secondIdx}] ` +
            `range=[${rangeStart},${rangeEnd}]s blocksToLoad=${blocksToLoadCount}`,
            SCOPE
        )
        // Update the mutex range. For a forward slide (rangeStart > oldStart) the mutex shifts
        // in-window data down to position 0; for a backward slide (rangeEnd < oldEnd) it shifts
        // data up. For "same range" (e.g. the initial call when the target already matches the
        // window picked by setupMutex), `setSignalRange` short-circuits without touching anything.
        await this._mutex.setSignalRange(rangeStart, rangeEnd)
        // Block-table bookkeeping: blocks outside the new window are evicted, blocks now in range
        // but not yet present are loaded.
        for (let i = 0; i < this._dataBlocks.length; i++) {
            if (i < firstIdx || i > secondIdx) {
                this._evictBlock(i)
            }
        }
        const loadTasks: Promise<boolean>[] = []
        for (let i = firstIdx; i <= secondIdx; i++) {
            if (!this._dataBlocks[i].loaded) {
                loadTasks.push(this._loadBlock(i))
            }
        }
        if (loadTasks.length) {
            const results = await Promise.all(loadTasks)
            return results.every(Boolean)
        }
        return true
    }

    setupCache (dataDuration = 0) {
        if (this._fallbackCache) {
            Log.warn(`Tried to re-initialize already initialized signal data cache.`, SCOPE)
        } else {
            this._fallbackCache = new BiosignalCache(dataDuration)
            this._buildDataBlocks()
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
        this._buildDataBlocks()
        this._mutex = new BiosignalMutex()
        // For rolling caches, the mutex buffer holds only the active 3-block window in data-time
        // (gap-exclusive). Initial `RANGE_START`/`RANGE_END` cover `[0, dataLength)` — the first
        // three blocks — and `setSignalRange` slides this window as the view crosses boundaries.
        // `_blockDuration` was computed adaptively in `_buildDataBlocks` from the cache budget
        // and channel sample rates. For non-rolling caches `dataLength` is the full data-time
        // length of the recording.
        const dataLength = this._useRolling
            ? Math.min(this._totalDataLength, this._blockDuration * 3)
            : this._totalDataLength
        this._mutex.initSignalBuffers(cacheProps, dataLength, buffer, bufferStart)
        Log.debug(`Signal data cache initiation complete.`, SCOPE)
        // Mutex is fully set up.
        this._isMutexReady = true
        return this._mutex.propertiesForCoupling
    }

    setUpdateCallback (callback: ((update: { [prop: string]: unknown }) => void) | null) {
        this._updateCallback = callback
    }
}
