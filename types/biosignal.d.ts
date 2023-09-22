/**
 * EEG types.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BaseAsset, DataResource, SafeObject } from './assets'
import { LoadDirection } from './loader'
import {
    AsymmetricMutex,
    MutexExportProperties,
    MutexMetaField,
} from 'asymmetric-io-mutex'
import { SettingsColor } from './config'
import { StudyContext } from './study'
import { HighlightContext, SignalHighlight } from './plot'
import { SignalCacheResponse, SignalCachePart } from './service'

/**
 * Annotation for a single moment or period of time in a biosignal resource.
 */
export interface BiosignalAnnotation {
    /** Author of this annotation. */
    annotator: string | null
    /** List of channel numbers, empty for a general type annotation. */
    channels: number[]
    /** Duration of the annotation, in seconds (zero for instant annotation). */
    duration: number
    /** Identifier for a pre-set annotation type. */
    id: string | null
    /** Text label for the annotation (visible on the interface and annotation list). */
    label: string
    /** Priority of this annotation (lower number has higher priority). */
    priority: number
    /** Annotation starting position, in seconds. */
    start: number
    /** Additional commentary regarding the annotation. */
    text: string
    /** Annotation type.
     * - `activation` is any activation procedure meant to modify the EEG.
     * - `comment` is free from commentary, may be unrelated to the recording itself.
     * - `event` describes something taking place during the recording at that exact moment.
     * - `technical` describes any technical data/events regarding the recording, such as impedance readings, calibration, input montage switches etc.
     */
    type: "activation" | "comment" | "event" | "technical"
    /** Should this highlight be shown in the background. */
    background?: boolean
    /** Color override for the annotation. */
    color?: SettingsColor
    /** Additional opacity multiplier for the highlight. */
    opacity?: number
}
/**
 * Common base for all biosignal channel types.
 */
export interface BiosignalChannel extends BaseAsset {
    /** Index of the active source channel. */
    active: number
    /** Channel base amplification, mostly used if the channel has a different unit value (e.g. mV instead of uV). */
    amplification: number
    /** Is this channel average referenced. */
    averaged: boolean
    /** Channel-specific cursors. */
    cursors: {
        horizontal: BiosignalCursor[]
        vertical: BiosignalCursor[]
    }
    /** Display polarity of the signal on this channel. */
    displayPolarity: SignalPolarity
    /** Possible individual high-pass filter in Hz. If null, use default from recording. */
    highpassFilter: number | null
    /** Descriptive name for this channel (displayed to the user). */
    label: string
    /** Laterality of this channel. */
    laterality: BiosignalLaterality
    /** Possible individual low-pass filter in Hz. If null, use default from recording. */
    lowpassFilter: number | null
    /** Markers at specific points of the channel data. */
    markers: BiosignalChannelMarker[]
    /** Identifying name for this channel. */
    name: string
    /** Possible individual notch filter in Hz. If null, use default from recording. */
    notchFilter: number | null
    /** Properties of the channel offset, measured from viewport bottom, as fractions of viewport height. */
    offset: {
        baseline: number
        bottom: number
        top: number
    }
    /** Original sample count of the signal before interpolation/subsampling. */
    originalSampleCount?: number
    /** Original sampling rate of the signal before interpolation/subsampling. */
    originalSamplingRate?: number
    /** Indices of the source reference channels. */
    reference: number[]
    /** Total count of samples. */
    sampleCount: number
    /** Sampling rate as samples/second. */
    samplingRate: number
    /** Individual signal sensitivity as a multiplier. */
    sensitivity: number
    /** The computed channel signal. */
    signal: Float32Array
    /** List of signal indices that cross the set trigger value. */
    triggerPoints: number[]
    /**
     * Position of the trigger point on the page x-axis (as a fraction of page length).
     * @example
     * triggerPosition = 0.5 // middle of the page
     * triggerPosition = 0.25 // between the first and second quarter of the page
     */
    triggerPosition: number
    /** Amplitude value to use as signal trigger (in uV). */
    triggerValue: number
    /** Unit of the signal on this channel (e.g. 'uV'). */
    unit: string
    /** Is this channel visible to the user. */
    visible: boolean
    /**
     * Add the given `markers` to this channel.
     * @param markers - Markers to add to the channel.
     */
    addMarkers (...markers: BiosignalChannelMarker[]): void

    addTriggerPoints (...points: number[]): void

    /**
     * Clear all cached trigger points.
     */
    clearTriggerPoints (): void

    /**
     * Find all points in the channel's signal that match or cross a set trigger value.
     * @param value - Specific value used only for this operation (default is channel's triggerValue).
     * @return Trigger points as an array of signal data point indices.
     */
    findTriggerPoints (value?: number): number[]

    /**
     * Get a list of *first* trigger points for each window of the given width.
     * @param win - Window width in milliseconds.
     * @returns Trigger points as an array of signal data point indices.
     */
    getTriggerPointsForWindow (win: number): number[]

    /**
     * Replace this channel's signal data with the given array of data points.
     * @param signal - Signal data.
     */
    setSignal (signal: Float32Array): void
}
/**
 * A marker containing a certain value at certain position of the channel signal.
 */
export type BiosignalChannelMarker = {
    /**
     * Is this marker active in the calculation of signal properties.
     * Inactive markers are usually shown too, but with different styling.
     */
    active: boolean
    channel: BiosignalChannel
    /** Is this marker currently being dragged. */
    dragging: boolean
    label: string
    position: number
    /** CSS styles to apply to the marker. */
    style: string
    value: number
    /**
     * Set a new position for the marker, triggering appropriate update watchers.
     * @param position - The new value of the marker.
     */
    setPosition (position: number): void
    /**
     * Set a ner value for the marker, triggering appropriate update watchers.
     * @param value - The new value of the marker.
     */
    setValue (value: number): void
}

export type BiosignalConfig = {
    formatHeader?: SafeObject
    sensitivity?: number
    type?: string
}

export type BiosignalCursor = {
    /**
     * Is this cursor active.
     * Inactive cursors are usually shown too, but with different styling.
     */
    active: boolean
    id: string
    label: string
    /** Is this cursor currently being dragged. */
    dragging: boolean
    position: number
    /** CSS styles to apply to the cursor. */
    style: string
    value: number
    /**
     * Set a new position for the cursor, triggering appropriate update watchers.
     * @param position - The new value of the cursor.
     */
    setPosition (position: number): void
    /**
     * Set a ner value for the cursor, triggering appropriate update watchers.\
     * **Do not override this method** (it will remove property update hooks).
     * @param value - The new value of the cursor.
     */
    setValue (value: number): void
}
export interface BiosignalDataField extends MutexMetaField {
    name: 'data' | 'samplingRate' | 'validStart' | 'validEnd'
}
export type BiosignalDataReject = (reason: string) => void
export type BiosignalDataResolve = (response: SignalCacheResponse) => void
/**
 * A service that loads raw biosignal data from the source file and returns it for caching.
 */
export interface BiosignalDataService {
    /** Start index of the individual signal buffers in the managed memory buffer. */
    signalBufferStart: number
    /**
     * Start the process of caching raw signals from the preset URL.
     */
    cacheSignalsFromUrl (): Promise<SignalCacheResponse>
    /**
    * Load montage signals within the given range.
    * @param range - Range in seconds [start (included), end (excluded)]
    * @param config - Optional configuration (TODO: Config definitions).
    * @return A promise with the loaded signals as SignalCacheResponse.
    */
    getSignals (range: number[], config?: any): void
    //prepareWorker (headers: any[], recordSize: number, files: FileSystemItem[]): Promise<boolean>
    /**
     * Attemp to handle a message from the service's worker.
     * @param message - Message from a worker.
     * @returns true if handled, false otherwise.
     * @remarks
     * `handleMessage` methods are meant to be called in a cascading fashion.
     * First override any actions that are handled differently from the parent.
     * If none of those match, pass the message up to the parent class.
     */
    handleMessage (message: any): Promise<boolean>
    /**
     * Prepare the worker with the given biosignal recording.
     * @param header - BiosignalHeaderRecord for the study.
     * @param study - study object to load
     * @returns Promise that fulfills with the real duration of the recording, or 0 if loading failed.
     */
    prepareWorker (header: BiosignalHeaderRecord, study: StudyContext): Promise<number>
}
/**
 * Filter types for biosignal resources.
 */
export type BiosignalFilters = {
    highpass: number
    lowpass: number
    notch: number
}
/**
 * A record containing the essential metadata of an EEG recording.
 */
export interface BiosignalHeaderRecord {
    /** List of annotations for this recording. */
    annotations: BiosignalAnnotation[]
    /** Duration of the actual data (excluding gaps) in seconds. */
    dataDuration: number
    /** List of data gaps in the recording as <startTime, length> in seconds. */
    dataGaps: Map<number, number>
    /** Number of data records in the recording. */
    dataRecordCount: number
    /** Duration of a single data record in seconds. */
    dataRecordDuration: number
    /** The total size of a single data record in bytes. */
    dataRecordSize: number
    /** Is the data in this recording discontinuous. */
    discontinuous: boolean
    /** Total recording duration including gaps. */
    duration: number
    /**  Maximum signal sampling rate in recording. */
    maxSamplingRate: number
    /** The original data source file type (such as 'edf', 'edf+'...). */
    fileType: string
    /** Unique identifier for the patient. */
    patientId: string
    /** Unique identifier for the recording. */
    recordingId: string
    /** Date and the time at which the recording has started (if known). */
    recordingStartTime: Date | null
    /** The serializable properties that can be posted between main thread and workers. */
    serializable: {
        annotations: string[]
        dataGaps: number[][]
        dataRecordCount: number
        dataRecordDuration: number
        dataRecordSize: number
        discontinuous: boolean
        fileType: string
        patientId: string
        recordingId: string
        recordingStartTime: Date | null
        signalCount: number
        signals: BiosignalHeaderSignal[]
    }
    /** Number of signals in the recording (and in each data record). */
    signalCount: number
    /** The actual signals in the recording. */
    signals: BiosignalHeaderSignal[]
    /** The total duration of this recording in seconds (including data gaps). */
    totalDuration: number
    /**
     * Add the given annotations to this header record.
     * The annotations are transferred to the actual recording at the time of instantiation.
     * @param items - Annotations to add.
     */
    addAnnotations (...items: BiosignalAnnotation[]): void
    /**
     * Add the given data gaps to this header record.
     * The gaps are transferred to the actual recording at the time of instantiation.
     * @param items - Data gaps to add.
     */
    addDataGaps (items: Map<number, number>): void
    /**
    * Get the label for a given signal index.
    * @param index - Index of the signal.
    * @return The signal label or null if index is out of range.
    */
    getSignalLabel (index: number): string | null
    /**
    * Get the number of samples per record for a given signal.
    * @param index - Index of the signal.
    * @return Samples per record or null if index is out of range.
    */
    getSignalNumberOfSamplesPerRecord (index: number): number | null
    /**
    * Get the unit (dimension label) used for a given signal.
    * E.g. this can be 'uV' when the signal is an EEG.
    * @param index - Index of the signal.
    * @return The unit name or null if index is out of range.
    */
    getSignalPhysicalUnit (index: number): string | null
    /**
    * Get the prefiltering info for a given signal.
    * Format of the info depends on the source file.
    * @param index - Index of the signal.
    * @return Prefiltering info or null if index is out of range.
    */
    getSignalPrefiltering (index: number): string | null
    /**
    * Get the sampling frequency in Hz of a given signal.
    * @param index - Index of the signal.
    * @return Sampling frequency in Hz or null if index is out of range.
    */
    getSignalSamplingFrequency (index: number): number | null
}

export type BiosignalHeaderSignal = {
    label: string
    physicalUnit: string
    prefiltering: string
    sampleCount: number
    samplingRate: number
}
/** Laterality as **d** = right / **s** = left / **z** = center / unknown. */
export type BiosignalLaterality = "d" | "s" | "z" | ""

export interface BiosignalMetaField extends MutexMetaField {
    name: 'allocated' | 'start' | 'end'
}
/**
 * Signal montage describes how a particular set of signals should be displayed.
 */
export interface BiosignalMontage extends BaseAsset {
    /** Cached signal ranges. */
    cacheStatus: SignalCachePart
    /** Configuration for each channel in this montage, null for missing channels. */
    channels: (MontageChannel | null)[]
    /** Gaps in signal data as Map<startTime, duration> in seconds. */
    dataGaps: Map<number, number>
    /** Does this recording use common reference for signals. */
    hasCommonReference: boolean
    /**
     * Highlights for montage signal segments.
     * `key` is the id of the source of the highlights.
     */
    highlights: Map<string, HighlightContext>
    /** Descriptive name for this montage. */
    label: string
    /** Unique, identifying name for this montage. */
    name: string
    /** Parent recording of this montage. */
    recording: BiosignalResource
    /** Label of the (possible) common reference electrode/signal. */
    referenceLabel: string
    setup: BiosignalSetup
    /** This montage's visible channels. */
    visibleChannels: MontageChannel[]
    /**
     * Add a new highlight context to this montage.
     * @param name - Unique name for the context.
     * @param context - The context to add.
     * @returns false if context already exists, true otherwise
     */
    addHighlightContext (name: string, context: HighlightContext): boolean
    /**
     * Add the given `highlights`to the given context.
     * Duplicate highlights (that already exist in the context) are skipped.
     * @param ctxName - Name of the context for these highlights.
     * @param highlights - Highlights to add.
     * @returns
     */
    addHighlights (ctxName: string, ...highlights: SignalHighlight[]): void
    /**
    * Get derived montage channel signals for the given range.
    * @param range - Range of the given signals in seconds.
    * @param config - Optional configuration (TODO: config definitions).
     * @return Promise with the requested signal as the first member of the signals array.
    *
    * @remarks
    * Montages are not tied to any certain file, so once the montage has been initiated data from any file
    * with the same setup can be processed by the same montage. The main idea behind this is to allow loading
    * only chuncks of large files at a time and processing only those parts.
    */
    getAllSignals (range: number[], config?: any): Promise<SignalCacheResponse>
    /**
     * Get the derived signal of a single montage channel.
     * @param channel - Index or name of the montage channel.
     * @param range - Range of the signal in seconds.
     * @param config - Optional configuration (TODO: config definitions).
     * @return Promise with the requested signal as the first member of the signals array.
     */
    getChannelSignal (channel: number | string, range: number[], config?: any): Promise<SignalCacheResponse>
    /**
     * Map the channels that have been loaded into the setup of this montage.
     * Mapping will match the source signals and derivations into proper montage channels.
     * @param config - Optional configuration (TODO: config definitions).
     */
    mapChannels (config?: any): void
    /**
     * Release the buffers reserved for this montage's signal data.
     * @param config - Optional configuration (TODO: config definitions).
     */
    releaseBuffers (config?: any): Promise<void>
    /**
     * Remove all highlights from all contexts in this montage.
     */
    removeAllHighlights (): void
    /**
     * Remove all highlights from the given context.
     * @param ctxName - Name of the context.
     */
    removeAllHighlightsFrom (ctxName: string): void
    /**
     * Remove highlights at given indices from the given source.
     * @param ctxName - Name of the context.
     * @param indices - Indices of highlights to remove.
     */
    removeHighlights (ctxName: string, ...indices: number[]): void
    /**
     * Remove all matching highlights from the given context.
     * @param ctxName - Name of the highlight context.
     * @param matcherFn - Function to check if highlight matches.
     */
    removeMatchingHighlights (ctxName: string, matcherFn: ((highlight: SignalHighlight) => boolean)): void
    /**
     * Not yet implemented (TODO: Remove entriley?).
     */
    resetChannels (): void
    /**
     * Remove all cached signals from this montage, also releasing any reserved buffers.
     */
    resetSignalCache (): void
    /**
     * Save a new signal part to the montage signal cache.
     * @param newPart - The new part.
     */
    saveSignalsToCache (newPart: SignalCachePart): void
    /**
     * Set high-pass filter value for given channel.
     * Passing undefined will unset the channel-specific filter value and reapply default (recording level) value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Filter frequency (in Hz) or undefined.
     */
    setHighpassFilter (target: string | number, value: number): void
    /**
     * Set low-pass filter value for given channel.
     * Passing undefined will unset the channel-specific filter value and reapply default (recording level) value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Filter frequency (in Hz) or undefined.
     */
    setLowpassFilter (target: string | number, value: number): void
    /**
     * Set notch filter value for given channel.
     * Passing undefined will unset the channel-specific filter value and reapply default (recording level) value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Filter frequency (in Hz) or undefined.
     */
    setNotchFilter (target: string | number, value: number): void
    /**
     * Set up a data loader using a data source mutex output properties as input for the loader.
     * @param inputProps - The source mutex export properties to use as input.
     * @param buffer - The shared array buffer to use for storing data.
     * @param bufferStart - The start index of the buffer reserved for this loader.
     *
     * @remarks
     * The idea behind this method is that montages could be reused with different source recordings,
     * which would reduce the time needed for setup when swithing between recordings. It would require
     * that all the available recordings use the same setup and would thus probably only work for
     * well defined datasets. It's a concept under consideration.
     */
    setupLoader (inputProps: MutexExportProperties, buffer: SharedArrayBuffer, bufferStart: number): void
    /**
     * Start the process of caching signals from the source.
     * @remarks
     * Montages are calculated in real time so this is not yet implemented.
     */
    startCachingSignals (): void
    /**
     * Stop the process of cahing signals from the source.
     * If a singal part (that was being loaded) is returned after this method is called, it will be discarded.
     * @remarks
     * Montages are calculated in real time so this is not yet implemented.
     */
    stopCachingSignals (): void
    /**
     * Update any changes in filter values to the service (and worker).
     * Calling this method does not automatically start caching data with the updated values.
     */
    updateFilters (): Promise<boolean>
}
export interface BiosignalMontageService {
    /**
     * Start the process of caching montage signals from loaded raw signals.
     */
    cacheMontageSignals (): void
    /**
     * Load montage signals within the given range.
     * @param range - Range in seconds [start (included), end (excluded)].
     * @param config - Optional configuration (TODO: Config definitions).
     * @return Promise for the loaded signals as SignalResponse.
     */
    getSignals (range: number[], config?: any): Promise<SignalCacheResponse>
    /**
     * Handle messages from the worker.
     * @param message - The message from the web worker.
     * @return Promise that resolves as true if the message was handled, false if not.
     */
    handleMessage (message: any): Promise<boolean>
    /**
     * Map montage channels in the web worker using the montage config.
     */
    mapChannels (): Promise<void>
    /**
     * Set the given gaps to the recording in the web worker.
     * @param gaps - The gaps to set as a map of <startTime, duration> in seconds.
     */
    setDataGaps (gaps: Map<number, number>): void
    /**
     * Set the filters in the web worker to match current montage filters.
     */
    setFilters (): Promise<void>
    /**
     * Set up the worker to load montage signals.
     * @param inputProps - Properties from the raw signal data mutex.
     * @returns Promise that resolves when montage setup in the worker is complete
     */
    setupMontage (inputProps: MutexExportProperties): Promise<void>
}
/**
 * BiosignalResource is a collection of uniform (same type, duration
 * and sampling rate) biosignals.
 */
export interface BiosignalResource extends DataResource {
    /** Currently active montage. */
    activeMontage: BiosignalMontage | null
    /** List of annotations. */
    annotations: BiosignalAnnotation[]
    /** List of channels as recorded. */
    channels: BiosignalChannel[]
    /** Cursors for marking points in time on the plot. */
    cursors: BiosignalCursor[]
    /** Duration of the actual signal data in seconds, without gaps. */
    dataDuration: number
    /** Data gaps in the recording as Map<startTime, duration> (in seconds). */
    dataGaps: Map<number, number>
    /** The display view start can be optionally updated after signals are processed and actually displayed. */
    displayViewStart: number
    /** Get the currently active filters. */
    filters: BiosignalFilters
    /** List of available, initialized montages. */
    montages: BiosignalMontage[]
    /** Montage that displays the recording configuration. */
    recordMontage: BiosignalMontage | null
    /** Number of samples in the signals. */
    sampleCount: number | null
    /** Sampling rate of the signals. */
    samplingRate: number | null
    /** Default sensitivity for the signals. . */
    sensitivity: number
    /** Setup describing the signals in the source data. */
    setup: BiosignalSetup | null
    /** Range of cached signals as [start (inclusive), end (exclusive)]. */
    signalCacheStatus: number[]
    /** Recording start time. */
    startTime: Date | null
    /** Total recording duration in seconds, with possible gaps. */
    totalDuration: number
    /** List of record video attachments. */
    videos: VideoAttachment[]
    /** Position of the left edge of the UI viewport (in seconds). */
    viewStart: number
    /** This resource's visible channels. */
    visibleChannels: BiosignalChannel[]
    /**
     * Add a set of new annotations to this recording.
     * @param annotations - New annotations.
     */
    addAnnotations (...items: BiosignalAnnotation[]): void
    /**
     * Add the given `cursors` to this resource.
     * @param cursors - Cursors to add.
     */
    addCursors (...cursors: any[]): void
    /**
     * Add new data gaps to the recording.
     * @param gaps - Map of new gaps to add `<startTime, duration>`.
     */
    addDataGaps (gaps: Map<number, number>): void
    /**
     * Get raw signals from all channels for the given range.
     * @param range - Signal range in seconds `[start (included), end (excluded)]`.
     * @param config - Optional config (TODO: Config definitions).
     * @returns Signals in range as Float32Array[].
     */
    getAllRawSignals (range: number[], config?: any): Promise<SignalCacheResponse>
    /**
     * Get signals from the active recording for the given range.
     * @param range - Signal range to return in seconds `[start (included), end (excluded)]`.
     * @param config - Additional config to apply (optional; TODO: Config definitions).
     * @returns Signals from requested range or null.
     */
    getAllSignals (range: number[], config?: any): Promise<SignalCacheResponse>
    /**
     * Get the index of the channel at given y-position. Each channel is considered
     * to take one channels spacing worth of space vertically.
     * @param yPos - Relative position from container bottom margin.
     * @return Channel index or null if no channel exists at given position.
     */
    getChannelAtYPosition(yPos: number): any
    /**
     * Get the derived signal of a single montage channel.
     * @param channel - Index or name of the montage channel.
     * @param range - Range of the signal in seconds.
     * @param config - Optional configuration.
     * @return SignalCacheResponse, with the requested signal as the first member of the signals array, or null.
     */
    getChannelSignal (channel: number | string, range: number[], config?: any): Promise<SignalCacheResponse>
    /**
     * Release all buffers referenced by this resource.
     */
    releaseBuffers (): Promise<void>
    /**
     * Set the given montage as active.
     * @param montage - Montage index or name.
     */
    setActiveMontage (montage: number | string | null): Promise<void>
    /**
     * Set the default sensitivity to use for primary channel type.
     * @param value - A positive number in the recording's default unit.
     */
    setDefaultSensitivity (value: number): void

    /**
     * Set high-pass filter for the given channel(s).
     * @param value - Filter frequency in Hz.
     * @param target - Channel index or type (default primary channel type).
     * @param scope - Scope of the change: `recording` (default) or `montage`.
     */
    setHighpassFilter (value: number | null, target?: number | string, scope?: string): void

    /**
     * Set low-pass filter for the given channel(s).
     * @param value - Filter frequency in Hz.
     * @param target - Channel index or type (default primary channel type).
     * @param scope - Scope of the change: `recording` (default) or `montage`.
     */
    setLowpassFilter (value: number | null, target?: number | string, scope?: string): void

    /**
     * Set notch filter for the given channel(s).
     * @param value - Filter frequency in Hz.
     * @param target - Channel index or type (default primary channel type).
     * @param scope - Scope of the change: `recording` (default) or `montage`.
     */
    setNotchFilter (value: number | null, target?: number | string, scope?: string): void

    /**
     * Start the process of caching signals from the saved URL.
     */
    startCachingSignals (): void
}
/**
 * Application scopes for biosignal resource types.
 */
export type BiosignalScope = 'eeg'
/**
 * Setup for interpreting a particular signal resource.
 */
export interface BiosignalSetup {
    /** Channel configuration for each matched raw signal. */
    channels: SetupChannel[]
    /** Unique ID for this setup. */
    id: string
    /** Channels that should have been present, but were not found. */
    missingChannels: SetupChannel[]
    /** Descriptive name for this setup. */
    name: string
    /** Raw signals that could not be matched to any channel in the setup. */
    unmatchedSignals: SetupChannel[]
}
export type BiosignalSetupReject = (reason: string) => void
export type BiosignalSetupResolve = (response: BiosignalSetupResponse) => void
export type BiosignalSetupResponse = MutexExportProperties | false
/**
 * Properties from an FFT analysis of a signal segment.
 */
export type FftAnalysisResult = {
    /** Frequency equivalents for each bin (in Hz). */
    frequencyBins: number[]
    /** Frequency bin magnitudes. */
    magnitudes: number[]
    /** Frequency bin phases. */
    phases: number[]
    /** Power spectral density estimates for frequency bins. */
    psds: number[]
    /** Frequency bin resolution (i.e. the number of Hz covered by a single bin). */
    resolution: number
}
/**
 * A single channel in an biosignal montage configuration.
 */
export interface MontageChannel extends BiosignalChannel {
    /** Index of the active channel. */
    active: number
    /** Does this channel use a common average reference. */
    averaged: boolean
    /** Set of reference channel indices; multiple channels will be averaged. */
    reference: number[]
}
/**
 * Configuration for a single signal channel in BiosignalSetup.
 */
export interface SetupChannel extends BiosignalChannel {
    /** Set to true if the raw signal uses average reference, so it is not applied twice. */
    averaged: boolean
    /** Index of the matched raw signal. */
    index: number
    /** Non-default polarity of this channel's signal. */
    polarity?: SignalPolarity
}

/** Signal polarity as -1, 1 or 0 (= don't override default). */
export type SignalPolarity = -1 | 0 | 1
/**
 * Video attachment synchronized to biosignal data.
 */
export interface VideoAttachment {
    /** Record time in seconds at the video end point. */
    endTime: number
    /** The group this video belongs to (if there are multiple simultaneous video streams). */
    group: number
    /** Record time in seconds at the video start point. */
    startTime: number
    /** Additional record-video sync points as `{ record-time (seconds): video-time (seconds) }`. */
    syncPoints: { [time: number]: number }[]
    /** Video file URL as web URI or fileURL. */
    url: string
}

export interface WorkerMontage {
    /**
     * Get derived montage channel signals from the given raw signals.
     * @param signals - Set of raw signals to use as Float32Array[].
     * @param filters - Active filters as BiosignalFilters.
     * @param range - Range of the given signals in seconds.
     * @param config - Additional configuration.
     *
     * @remarks
     * Montages are not tied to any certain file, so once the montage has been initiated data from any file with the same setup
     * can be processed by the same montage. The main idea behind this is to allow loading only chuncks of large files at a
     * time and processing only those parts.
     */
    getAllSignals(
        signals: Float32Array[],
        filters: BiosignalFilters,
        range: number[],
        config: {
            filterPaddingSeconds: number
            exclude?: number[]
            excludeActiveFromAvg?: boolean
            include?: number[]
        }
    ): Float32Array[]
    setChannels(channels: MontageChannel[]): void
}
