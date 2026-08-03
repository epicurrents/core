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
    AnnotationEventTemplate,
    AnnotationLabelTemplate,
    SignalCacheMutex,
    SignalCachePart,
    SignalDataCache,
    SignalInterruption,
    SignalInterruptionMap,
    SignalProcessorCache,
    TypedNumberArray,
    TypedNumberArrayConstructor,
} from '#types'
import IOMutex, { type MutexExportProperties } from 'asymmetric-io-mutex'
import { Log } from 'scoped-event-log'
import { EPS as FLOAT32_EPS } from '@stdlib/constants-float32'
import { GenericBiosignalHeader } from '../biosignal'
import GenericDataProcessor from './GenericDataProcessor'

const SCOPE = 'SignalFileReader'

export default abstract class GenericSignalProcessor extends GenericDataProcessor implements SignalProcessorCache {

    /** Number of data units to write into the file. */
    protected _dataUnitCount = 0
    /** Duration of single data unit in seconds. */
    protected _dataUnitDuration = 0
    /** Size of single data unit in bytes. */
    protected _dataUnitSize = 0
    /** Is the resulting file discontinuous. */
    protected _discontinuous = false
    /** Map of events as <position in seconds, list of events>. */
    protected _events = new Map<number, AnnotationEventTemplate[]>()
    protected _fileTypeHeader: unknown | null = null
    protected _header: GenericBiosignalHeader | null = null
    /** Map of recording interruptions as <data position, length> in seconds. */
    /**
     * Highest data-unit index up to which the recording has been contiguously decoded. On a
     * discontinuous file without a complete interruption table, the recording-time↔data-time
     * mapping is only exact within this explored span — every conversion beyond it silently
     * ignores unseen gaps. Extended by {@link _extendExploredUnits}; retained across cache
     * releases (like the interruption table itself, it is knowledge, not cached data).
     */
    protected _exploredUnitEnd = 0
    protected _interruptions = new Map<number, number>() as SignalInterruptionMap
    /**
     * True when the interruption table was provided complete from trusted external metadata
     * rather than discovered during decoding. Lifts the exploration restriction on
     * discontinuous files — see {@link _exploredRecordingEnd}.
     */
    protected _interruptionsComplete = false
    /** List of labels. */
    protected _labels = [] as AnnotationLabelTemplate[]
    protected _sourceDigitalSignals: TypedNumberArray[] | null = null
    protected _totalRecordingLength = 0

    constructor (dataEncoding: TypedNumberArrayConstructor) {
        super(dataEncoding)
    }

    protected get _cache (): SignalCacheMutex | SignalDataCache | null {
        if (this._mutex) {
            return this._mutex
        } else if (this._fallbackCache) {
            return this._fallbackCache
        }
        return null
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
     * Convert cache time (i.e. time without interruptions) to recording time.
     * @param time - Cache time without interruptions.
     * @returns Matching recording time (with interruptions).
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
        for (const intr of this._interruptions) {
            if (intr[0] < index*this._dataUnitDuration) {
                priorGapsTotal += intr[1]
            }
        }
        return index*this._dataUnitDuration + priorGapsTotal
    }
    /**
     * Get the total interruption time between two points in recording time.
     * @param start - Starting time in recording seconds.
     * @param end - Ending time in recording seconds.
     * @returns Total interruption time in seconds.
     */
    protected _getInterruptionTimeBetween (start: number, end: number): number {
        if (!this._discontinuous) {
            return 0
        }
        let intrTotal = 0
        for (const intr of this.getInterruptions([start, end])) {
            intrTotal += intr.duration
        }
        return intrTotal
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
     * Convert recording time to cache time (i.e. time without interruptions).
     * @param time - Recording time.
     * @returns Matching cache time (without interruptions).
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
        return time - this._getInterruptionTimeBetween(0, time)
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
        const priorIntrTotal = time > 0 ? this._getInterruptionTimeBetween(0, time) : 0
        // Avoid float rounding error when converting from stored 32 bit into internal 64 bit float.
        return Math.floor((time + FLOAT32_EPS - priorIntrTotal)/this._dataUnitDuration)
    }

    addNewEvents (...events: AnnotationEventTemplate[]) {
        // Arrange the events by record.
        const eventMap = new Map<number, AnnotationEventTemplate[]>()
        for (const event of events) {
            if (!event) {
                // Don't add empty events.
                continue
            }
            const eventRec = Math.round(event.start/this._dataUnitSize)
            const recordEvents = eventMap.get(eventRec)
            if (!recordEvents) {
                eventMap.set(eventRec, [event])
            } else {
                recordEvents.push(event)
            }
        }
        new_loop:
        for (const [newKey, newEvents] of eventMap) {
            for (const [exsistingKey, existingEvent] of Object.entries(this._events)) {
                if (newKey === parseFloat(exsistingKey)) {
                    // This record has already been processed, don't duplicate.
                    continue new_loop
                } else  {
                    for (const newEvent of newEvents) {
                        if (
                            newEvent.start === existingEvent.start &&
                            newEvent.duration === existingEvent.duration &&
                            newEvent.class === existingEvent.class &&
                            newEvent.label === existingEvent.label &&
                            newEvent.priority === existingEvent.priority &&
                            newEvent.type === existingEvent.type &&
                            (
                                (!newEvent.codes && !existingEvent.codes) ||
                                (newEvent.codes && Object.entries(newEvent.codes).every(
                                    ([key, val]) => existingEvent.codes?.[key] === val
                                ))
                            )
                        ) {
                            // This event is identical to an existing one, don't duplicate.
                            continue new_loop
                        }
                    }
                }
            }
            this._events.set(newKey, newEvents)
        }
    }

    addNewInterruptions (newInterruptions: Map<number, number>) {
        new_loop:
        for (const intr of newInterruptions) {
            if (!intr[1] || intr[1] < 0) {
                continue
            }
            for (const exsisting of this._interruptions) {
                if (intr[0] === exsisting[0]) {
                    // A single position cannot have multiple interruptions.
                    continue new_loop
                }
            }
            this._interruptions.set(intr[0], intr[1])
        }
        // We need to sort the interruptions to make sure keys appear in ascending order.
        this._interruptions = new Map([...this._interruptions.entries()].sort((a, b) => a[0] - b[0]))
    }

    addNewLabels (...labels: AnnotationLabelTemplate[]) {
        // Arrange the events by record.
        const labelList = [] as AnnotationLabelTemplate[]
        for (const label of labels) {
            if (!label) {
                // Don't add empty labels.
                continue
            }
            if (this._labels.find(
                lbl => lbl.name === label.name && lbl.class === label.class && lbl.label === label.label
                    && lbl.priority === label.priority && lbl.type === label.type
                    && (
                        (!lbl.codes && !label.codes) ||
                        (lbl.codes && Object.entries(lbl.codes)?.every(([key, val]) => label.codes?.[key] === val))
                       )
            )) {
                // This label has already been processed, don't duplicate.
                continue
            }
            labelList.push(label)
        }
        this._labels.push(...labelList)
    }

    getEvents (range?: number[]) {
        const [start, end] = range && range.length === 2
                             ? [range[0], Math.min(range[1], this._totalRecordingLength)]
                             : [0, this._totalRecordingLength]
        if (start < 0 || start >= this._totalRecordingLength) {
            Log.error(`Requested event range ${start} - ${end} was out of recording bounds.`, SCOPE)
            return []
        }
        if (start >= end) {
            Log.error(`Requested event range ${start} - ${end} was empty or invalid.`, SCOPE)
            return []
        }
        const events = [] as AnnotationEventTemplate[]
        for (const event of this._events.entries()) {
            for (const evt of event[1]) {
                if (evt.start >= start && evt.start < end) {
                    events.push(evt)
                }
            }
        }
        return events
    }

    getLabels () {
        return this._labels
    }

    getInterruptions (range = [] as number[], useCacheTime = false): SignalInterruption[] {
        const start = Math.max(0, range[0] || 0)
        const end = useCacheTime
                    ? Math.min(range[1] || this._totalDataLength, this._totalDataLength)
                    : Math.min(range[1] || this._totalRecordingLength, this._totalRecordingLength)
        const interruptions = [] as SignalInterruption[]
        if (start > end) {
            Log.error(`Requested interruption range ${start} - ${end} is not valid.`, SCOPE)
            return interruptions
        } else if (start === end) {
            // This can happen when setting up a discontinous recording, but not outside of that.
            Log.debug(`Requested interruption range ${start} - ${end} is empty.`, SCOPE)
            return interruptions
        }
        let priorGapsTotal = 0
        for (const intr of this._interruptions) {
            const position = useCacheTime ? intr[0] : intr[0] + priorGapsTotal
            priorGapsTotal += intr[1]
            if ((useCacheTime ? position : position + intr[1]) <= start) {
                continue
            } else if (!useCacheTime && position < start && position + intr[1] > start) {
                // Prior interruption partially extends to the checked range.
                if (position + intr[1] < end) {
                    interruptions.push({ start: start, duration: position + intr[1] - start })
                } else {
                    interruptions.push({ start: start, duration: end - start })
                    break
                }
            } else if (position >= start && position < end) {
                if (useCacheTime || position + intr[1] < end) {
                    interruptions.push({ start: position, duration: intr[1] })
                } else {
                    interruptions.push({ start: position, duration: end - position })
                    break
                }
            } else {
                break
            }
        }
        return interruptions
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
        // Signals whose mutex fields are still at the empty sentinel. Before the first cache load
        // that is every one of them — the startup/resize race the summary below describes — so
        // reporting them individually would fire two lines per channel on every open. Only a
        // *mixed* result is worth a warning: the aggregates are then computed from the initialised
        // channels alone and over-report the coverage the uninitialised ones actually have.
        const uninitialised: number[] = []
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
                uninitialised.push(i)
            }
            if (range.end !== IOMutex.EMPTY_FIELD) {
                lowestEnd = (lowestEnd === NUMERIC_ERROR_VALUE || tEnd < lowestEnd) ? tEnd : lowestEnd
            } else if (!uninitialised.includes(i)) {
                uninitialised.push(i)
            }
        }
        if (uninitialised.length && (highestStart !== NUMERIC_ERROR_VALUE || lowestEnd !== NUMERIC_ERROR_VALUE)) {
            Log.warn(
                `Signals #${uninitialised.join(', #')} have no updated position set while others do; ` +
                `the reported range covers only the initialised signals.`,
                SCOPE
            )
        }
        if (highestStart === NUMERIC_ERROR_VALUE && lowestEnd === NUMERIC_ERROR_VALUE) {
            // No channel has an initialised range yet. This is a legitimate query result during the
            // startup/resize race — a read can reach the worker before the cache load has populated
            // the mutex — so it is a transient state, not an error; the caller decides how to react.
            Log.debug(`No updated signal ranges yet, cache has no initialised signals.`, SCOPE)
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        return {
            start: this._cacheTimeToRecordingTime(highestStart),
            end: this._cacheTimeToRecordingTime(lowestEnd),
        }
    }

    setBiosignalHeader(header: GenericBiosignalHeader): void {
        this._header = header
    }

    setEvents (events: AnnotationEventTemplate[]) {
        this._events.clear()
        for (const evt of events) {
            if (!evt) {
                continue
            }
            const existingEvents = this._events.get(evt.start)
            if (existingEvents) {
                // If there are already events at this position, add to them.
                existingEvents.push(evt)
            } else {
                this._events.set(evt.start, [evt])
            }
        }
    }

    /**
     * Extend the contiguously explored span with a freshly decoded data-unit range. The range
     * only counts when it is adjacent to (or overlaps) the current explored span — a decode at
     * a detached position (e.g. the duration probe of the last record at setup) proves nothing
     * about the gaps before it and must not advance the frontier.
     */
    protected _extendExploredUnits (unitStart: number, unitEnd: number) {
        if (unitStart <= this._exploredUnitEnd && unitEnd > this._exploredUnitEnd) {
            this._exploredUnitEnd = unitEnd
        }
    }

    /**
     * Recording-time end of the span within which view positions can be trusted, or -1 when
     * navigation is unrestricted (continuous recording, or a complete trusted interruption
     * table). Beyond this point on a restricted recording, the recording-time→record mapping
     * would silently ignore unseen gaps and place signals at the wrong time.
     */
    protected _exploredRecordingEnd (): number {
        if (!this._discontinuous || this._interruptionsComplete) {
            return -1
        }
        if (!this._exploredUnitEnd) {
            return 0
        }
        const converted = this._dataUnitIndexToTime(this._exploredUnitEnd)
        return converted === NUMERIC_ERROR_VALUE ? 0 : converted
    }

    /**
     * Replace the interruption table. `complete` marks the table as covering the whole
     * recording from trusted external metadata, which lifts the exploration restriction on
     * discontinuous files ({@link _exploredRecordingEnd}); discovered (partial) tables must
     * leave it false.
     */
    setInterruptions (interruptions: SignalInterruptionMap, complete = false) {
        this._interruptions = interruptions
        if (complete) {
            this._interruptionsComplete = true
        }
    }

    setFileTypeHeader(header: unknown): void {
        this._fileTypeHeader = header
    }

    setLabels (labels: AnnotationLabelTemplate[]) {
        this._labels = labels
    }

    setupCacheWithInput (
        _cache: SignalDataCache,
        _dataDuration: number,
        _recordingDuration: number,
        _interruptions = [] as SignalInterruption[]
    ) {
        Log.error(`setupCacheWithInput must be overridden in the child class.`, SCOPE)
    }

    async setupMutexWithInput (
        _input: MutexExportProperties,
        _bufferStart: number,
        _dataDuration: number,
        _recordingDuration: number,
        _interruptions = [] as SignalInterruption[]
    ): Promise<MutexExportProperties|null> {
        Log.error(`setupMutexWithInput must be overridden in the child class.`, SCOPE)
        return null
    }

    /**
     * Set up a shared worker for file loading. This will use a shared worker to query for raw signal data.
     * @param input - Message port from the input worker.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including interruptions) in seconds.
     * @param interruptions - Possible interruptions in the recording.
     */
    async setupSharedWorkerWithInput (
        _input: MessagePort,
        _dataDuration: number,
        _recordingDuration: number,
        _interruptions = [] as SignalInterruption[]
    ): Promise<boolean> {
        Log.error(`setupSharedWorkerWithInput must be overridden in the child class.`, SCOPE)
        return false
    }
}
