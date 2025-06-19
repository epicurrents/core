/**
 * Biosignal types.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    BaseAsset,
    DataResource,
    SafeObject
} from './application'
import { BiosignalMutex } from '../assets'
import {
    AppSettings,
    ConfigBiosignalSetup,
    ConfigChannelFilter,
    ConfigChannelLayout,
    ConfigMapChannels,
    ConfigReleaseBuffers,
    SettingsColor,
} from './config'
import { HighlightContext, SignalHighlight } from './plot'
import {
    AssetService,
    CacheSignalsResponse,
    MemoryManager,
    MessageHandled,
    SetupStudyResponse,
    SignalCacheResponse,
    SignalCachePart,
    WorkerResponse,
    WorkerMessage,
} from './service'
import { StudyContext } from './study'
import { type MutexExportProperties, type MutexMetaField } from 'asymmetric-io-mutex'

/**
 * Object template to use when constructing a biosignal annotation.
 */
export type AnnotationTemplate = {
     /** List of channel numbers, empty for a general annotation. */
    channels: number[]
    /**
     * Annotation class. The default general purpose classes are:
     * - `activation` is any activation procedure that may have an effect on the EEG.
     * - `comment` is free-from commentary, may be unrelated to the recording itself.
     * - `event` describes something taking place during the recording at that exact moment.
     * - `technical` describes any technical data/events regarding the recording, such as impedance readings, calibration, input montage switches etc.
     * - `trigger` is a special event used as a reference for measuring effects (e.g. a stimulus).
     *
     * In addition, there are special classes for educational purposes. These have a priority of 0 and must be
     * individually displayed/hidden.
     * - `answer` is a *quiz* answer, which may be related to a question.
     * - `example` is an example of a feature, finding, technique etc.
     * - `question` is a *quiz* question, which may have answers.
     */
    class: BiosignalAnnotation['class']
    /** Duration of the annotation, in seconds (zero for instant annotation). */
    duration: BiosignalAnnotation['duration']
    /** Text label for the annotation (visible on the interface and annotation list). */
    label: BiosignalAnnotation['label']
    /**
     * Priority of this annotation (lower number has lower priority). Priority must be a number greater than zero.
     * Predefined priorities for the default annotation classes are:
     * - `activation` = 300
     * - `comment` = 200
     * - `event` = 400
     * - `technical` = 100
     */
    priority: BiosignalAnnotation['priority']
    /** Annotation starting time, in seconds after the recording start. */
    start: BiosignalAnnotation['start']
    /** Author of this annotation. */
    annotator?: BiosignalAnnotation['annotator']
    /** Should this annotation be placed in the background (behind the traces). */
    background?: BiosignalAnnotation['background']
    /** Color override for the annotation type's default color. */
    color?: BiosignalAnnotation['color']
    /**
     * Unique identifier for matching educational annotations (for programmatically altering their visibility etc.).
     *
     * @remarks
     * Cannot use `id` for this as it is automatically generated.
     */
    name?: BiosignalAnnotation['name']
    /** Additional opacity multiplier for the annotation opacity set in the `color` property. */
    opacity?: BiosignalAnnotation['opacity']
    /** Additional commentary regarding the annotation. */
    text?: BiosignalAnnotation['text']
    /** Identifier for a pre-set annotation type. */
    type?: BiosignalAnnotation['type']
    /**
     * Is this annotation visible (default true).
     * Should be set to false for any educational annotation types that should not be immediately visible when the
     * recording is opened (such as quiz answers).
     */
    visible?: BiosignalAnnotation['visible']
}
/**
 * Annotation for a single moment or period of time in a biosignal resource.
 */
export interface BiosignalAnnotation extends BaseAsset {
    /** Author of this annotation. */
    annotator: string | null
    /** Should this annotation be placed in the background (behind the plot). */
    background: boolean
    /** List of channel numbers, empty for a general type annotation. */
    channels: number[]
    /**
     * Annotation class. The default general purpose classes are:
     * - `activation` is any activation procedure that may have an effect on the EEG.
     * - `comment` is free-from commentary, may be unrelated to the recording itself.
     * - `event` describes something taking place during the recording at that exact moment.
     * - `technical` describes any technical data/events regarding the recording, such as impedance readings, calibration, input montage switches etc.
     * - `trigger` is a special event used as a reference for measuring effects (e.g. a stimulus).
     *
     * In addition, there are special classes for educational purposes. These have a priority of 0 and must be
     * individually displayed/hidden.
     * - `answer` is a *quiz* answer, which may be related to a question.
     * - `example` is an example of a feature, finding, technique etc.
     * - `question` is a *quiz* question, which may have answers.
     */
    class: "activation" | "answer" | "comment" | "event" | "example" | "question" | "technical" | "trigger"
    /** Duration of the annotation, in seconds (zero for instant annotation). */
    duration: number
    /** Text label for the annotation (visible on the interface and annotation list). */
    label: string
    /**
     * Priority of this annotation (lower number has lower priority). Priority must be a number greater than zero.
     * Predefined priorities for the default annotation classes are:
     * - `activation` = 300
     * - `comment` = 200
     * - `event` = 400
     * - `technical` = 100
     */
    priority: number
    /** Annotation starting position, in seconds. */
    start: number
    /** Additional commentary regarding the annotation. */
    text: string
    /** Identifier for a pre-set annotation type. */
    type: string
    /** Is this annotation visible. */
    visible: boolean
    /**
     * Color override for the annotation type's default color.
     * Changing this property triggers an additional event `appearance-changed`.
     */
    color?: SettingsColor
    /**
     * Additional opacity multiplier for the annotation opacity set in the `color` property.
     * Changing this property triggers an additional event `appearance-changed`.
     */
    opacity?: number
}
/**
 * Common base for all biosignal channel types.
 */
export interface BiosignalChannel {
    /** Is the signal on this channel referenced to an average. */
    averaged: boolean
    /** Display polarity of the signal on this channel. */
    displayPolarity: SignalPolarity
    /**
     * Individual filters in Hz to override the resource's general filter.
     * Null means that the channel uses the resource's filter value for that type.
     * Zero means that the filter is disabled.
     */
    filters: BiosignalChannelFilters
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
    /** Modality of the signal held in this channel. */
    modality: string
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
    /** Total count of samples. */
    sampleCount: number
    /** Sampling rate as samples/second. */
    samplingRate: number
    /**
     * Channel base scale as an exponent of 10, mostly used if the channel has a different unit value (e.g. mV instead
     * of uV) to scale the signal by the recording default sensitivity.
     */
    scale: number
    /** Individual signal sensitivity as a multiplier. */
    sensitivity: number
    /** The computed channel signal. */
    signal: Float32Array
    /** Unit of the signal on this channel (e.g. 'uV'). */
    unit: string
    /** Is this channel visible to the user. */
    visible: boolean
    /**
     * Add the given `markers` to this channel.
     * @param markers - Markers to add to the channel.
     */
    addMarkers (...markers: BiosignalChannelMarker[]): void
    /**
     * Set a highpass filter value to override the resource's general filter (or null to use it).
     * @param value - New value for the filter (in Hz).
     */
    setHighpassFilter (value: number | null): void
    /**
     * Set a lowpass filter value to override the resource's general filter (or null to use it).
     * @param value - New value for the filter (in Hz).
     */
    setLowpassFilter (value: number | null): void
    /**
     * Set a notch filter value to override the resource's general filter (or null to use it).
     * @param value - New value for the filter (in Hz).
     */
    setNotchFilter (value: number | null): void
    /**
     * Replace this channel's signal data with the given array of data points.
     * @param signal - Signal data.
     */
    setSignal (signal: Float32Array): void
}
/**
 * A derivation using two or more raw signals. Derivations are calculated before montage signals and can be used like
 * any other source channel signal.
 */
export type BiosignalChannelDerivationTemplate = BiosignalChannelTemplate & {
    /**
     * Properties for matching the active channel signal. Name of the signal is used to match to the already mapped
     * setup channels and if that fails, only then against the source file signal labels.
     * If more than one channel is given, a weighted average of the signals will be calculated.
     * */
    active: BiosignalReferenceChannelTemplate[]
    /**
     * Properties for matching reference channel signals. Name of the signal is used to match to the already mapped
     * setup channels and if that fails, only then against the source file signal labels.
     * If more than one channel is given, a weighted average of the signals will be calculated.
     */
    reference: BiosignalReferenceChannelTemplate[]
}
/**
 * Filters for a single biosignal channel. Null means the channel uses the resource's filter value for that type.
 */
export type BiosignalChannelFilters = {
    /** Null for resource filter value, zero to disable. */
    highpass: number | null
    /** Null for resource filter value, zero to disable. */
    lowpass: number | null
    /** Null for resource filter value, zero to disable. */
    notch: number | null
    /** List of possible additional band-reject filters as `[low limit, high limit]`. */
    bandreject: [number, number][]
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
/**
 * Basic properties of the biosignal channel entity to be used when loading configurations from JSON.
 */
export type BiosignalChannelProperties = {
    /** Index or indices of the active channel(s). */
    active?: number | DerivedChannelProperties
    /** Is the signal on this channel average referenced. */
    averaged?: boolean
    /** Polarity of the signal on this channel. */
    displayPolarity?: -1 | 0 | 1
    /** ? */
    height?: number
    /** Channel label displayed in the UI. */
    label?: string
    /** Laterality of the signal. */
    laterality?: BiosignalLaterality
    /** Modality of the signal on this channel. */
    modality?: string
    /** Unique name for this signal (not shown in the UI). */
    name?: string
    /** Predefined signal offsets as a fraction of the viewport height. */
    offset?: {
        /** Baseline (or zero-line) position. */
        baseline: number
        /** Signal bottom edge position. */
        bottom: number
        /** Signal top edge position. */
        top: number
    }
    /** List of reference channel indices. */
    reference?: DerivedChannelProperties
    /** Number of samples in this signal. */
    sampleCount?: number
    /** Sampling rate of the signal. */
    samplingRate?: number
    /**
     * Multiplier applied to the signal amplitude as a ten's exponent (default 0). This can be used to scale the signal
     * of very small or very amplitude values on the screen while still using the recording main sensitivity.
     * @remarks
     * This can take any value, but only has options for whole digits in the UI.
     */
    scale?: number
    /** Initial sensitivity of the signal. */
    sensitivity?: number
    /** Physical unit identifier (such as `uV`). */
    unit?: string,
    /** Should this channel be visible to the user. */
    visible?: boolean
}
/**
 * A basic template for biosignal channel configurations.
 */
export type BiosignalChannelTemplate = {
    /** Short label for the channel (visible to the user). */
    label: string
    /** Laterality of the recorded signal. */
    laterality: BiosignalLaterality
    /** Channel signal modality. */
    modality: string
    /**
     * Unique name for the channel (not visible to the user). A direct match between source file channel name
     * and this name is attempted first, before trying to match by `pattern (optional)`.
     */
    name: string
    /** Physical unit of the channel signal. */
    unit: string
    /** Does this channel contain an already averaged signal (default false). */
    averaged?: boolean
    /** A reg-exp pattern to match signals in the source file to this channel. */
    pattern?: string
    /** Signal polarity, if not same as the default polarity of the recording. */
    polarity?: SignalPolarity
    /** Sampling rate of the signal, if already known. */
    samplingRate?: number
    /**
     * Multiplier applied to the signal amplitude as a ten's exponent (default 0). This can be used to scale the signal
     * of very small or very amplitude values on the screen while still using the recording main sensitivity.
     * @remarks
     * This can take any value, but only has options for whole digits in the UI.
     */
    scale?: number
}

export type BiosignalConfig = {
    formatHeader?: SafeObject
    modality?: string
    sensitivity?: number
}
/**
 * A cursor spanning the whole height or width of the viewport.
 */
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
export interface BiosignalDataService extends AssetService {
    /** Start index of the individual signal buffers in the managed memory buffer. */
    signalBufferStart: number
    /**
     * Start the process of caching raw signals from the preset URL.
     */
    cacheSignalsFromUrl (): Promise<CacheSignalsResponse>
    /**
     * Destroy the service and release all resources.
     * @remarks
     * This method irrevocably removes the reference to the resource it was serving and should only be called when the
     * service is no longer needed.
     */
    destroy (): void
    /**
    * Load montage signals within the given range.
    * @param range - Range in seconds [start (included), end (excluded)]
    * @param config - Optional configuration (TODO: Config definitions).
    * @return A promise with the loaded signals as SignalCacheResponse.
    */
    getSignals (range: number[], config?: unknown): void
    /**
     * Attempt to handle a message from the service's worker.
     * @param message - Message from a worker.
     * @returns true if handled, false otherwise.
     * @remarks
     * `handleMessage` methods are meant to be called in a cascading fashion.
     * First override any actions that are handled differently from the parent.
     * If none of those match, pass the message up to the parent class.
     */
    handleMessage (message: WorkerResponse): Promise<MessageHandled>
    /**
     * Prepare the worker with the given biosignal study.
     * @param header - BiosignalHeaderRecord for the study.
     * @param study - Study object to load.
     * @param formatHeader - Possible format-specific header object, if needed by the worker.
     * @returns Promise that fulfills with the real duration of the recording, or 0 if loading failed.
     */
    setupWorker (
        header: BiosignalHeaderRecord, study: StudyContext, formatHeader?: unknown
    ): Promise<SetupStudyResponse>
    /**
     * Setup a simple signal data cache.
     * @param dataDuration - Duration of signal data in the recording in seconds.
     * @returns A promise that resolves with the created cache if successful, null otherwise.
     */
    setupCache (dataDuration: number): Promise<SignalDataCache|null>
}
/**
 * Filter types for biosignal resources.
 */
export type BiosignalFilters = {
    /** List of additional band-reject filters as `[low limit, high limit]`. */
    bandreject: [number, number][]
    /** High-pass filter in Hz, zero to disable. */
    highpass: number
    /** Low-pass filter in Hz, zero to disable. */
    lowpass: number
    /** Notch filter in Hz, zero to disable. */
    notch: number
}
/**
 * Types of default filters that can be applied to biosignals.
 */
export type BiosignalFilterType = 'highpass' | 'lowpass' | 'notch'
/**
 * A record containing the essential metadata of a biosignal recording.
 */
export interface BiosignalHeaderRecord {
    /** List of annotations for this recording. */
    annotations: AnnotationTemplate[]
    /** Duration of the actual data (excluding gaps) in seconds. */
    dataDuration: number
    /** List of interriptions in the recording as <start time, length> in seconds. */
    interruptions: SignalInterruptionMap
    /** Number of data units in the recording. */
    dataUnitCount: number
    /** Duration of a single data unit in seconds. */
    dataUnitDuration: number
    /** The total size of a single data unit in bytes. */
    dataUnitSize: number
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
        dataUnitCount: number
        dataUnitDuration: number
        dataUnitSize: number
        discontinuous: boolean
        fileType: string
        interruptions: number[][]
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
     * Add the given recording interruptions to this header record.
     * The interruptions are transferred to the actual recording at the time of instantiation.
     * @param items - Recording interruptions to add.
     */
    addInterruptions (items: SignalInterruptionMap): void
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
    getSignalPrefiltering (index: number): BiosignalFilters | null
    /**
    * Get the sampling frequency in Hz of a given signal.
    * @param index - Index of the signal.
    * @return Sampling frequency in Hz or null if index is out of range.
    */
    getSignalSamplingFrequency (index: number): number | null
}
/**
 * Signal properties expected to be present in a biosignal file header.
 */
export type BiosignalHeaderSignal = {
    /** Displayed label of this signal. */
    label: string
    /** Signal data modality (such as 'eeg'). */
    modality: string
    /** Unique identifying name for this signal (used for signal mapping). */
    name: string
    /** Name of the physical unit of the recorded signal in ASCII characters. */
    physicalUnit: string
    /** Possible prefiltering applied to the recorded signal. */
    prefiltering: BiosignalFilters
    /** Total number of samples in this signal. */
    sampleCount: number
    /** Signal sampling rate in Hz. */
    samplingRate: number
    /** Custom sensitivity to apply when displaying this signal in `physicalUnit`/cm. */
    sensitivity: number
    /** Type of the sensor used when recording this signal. */
    sensor: string
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
    channels: MontageChannel[]
    /** Saved configuration for this montage. */
    config: unknown
    /** Default signal filters. */
    filters: BiosignalFilters
    /** Does this recording use common reference for signals. */
    hasCommonReference: boolean
    /**
     * Highlights for montage signal segments.
     * `key` is the id of the source of the highlights.
     */
    highlights: { [key: string]: HighlightContext }
    /** Descriptive name for this montage. */
    label: string
    /** Unique, identifying name for this montage. */
    name: string
    /** Parent recording of this montage. */
    recording: BiosignalResource
    /** Label of the (possible) common reference electrode/signal. */
    referenceLabel: string
    /** ID of the service of this montage. */
    serviceId: string
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
     * Start the process of caching signals from the source.
     * @param ranges - Ranges to cache in seconds `[start, end]` (defaults to whole recording).
     * @remarks
     * Montages are calculated in real time so this is not yet implemented.
     */
    cacheSignals (...ranges: [number, number][]): Promise<void>
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
    getAllSignals (range: number[], config?: unknown): Promise<SignalCacheResponse>
    /**
     * Get the derived signal of a single montage channel.
     * @param channel - Index or name of the montage channel.
     * @param range - Range of the signal in seconds.
     * @param config - Optional configuration (TODO: config definitions).
     * @return Promise with the requested signal as the first member of the signals array.
     */
    getChannelSignal (channel: number | string, range: number[], config?: unknown): Promise<SignalCacheResponse>
    /**
     * Get a list of interruptions in the parent recording.
     * @param useCacheTime - Use cache time (ignoring previous interruptions) instead of recording time.
     */
    getInterruptions (useCacheTime?: boolean): SignalInterruption[]
    /**
     * Map the channels that have been loaded into the setup of this montage.
     * Mapping will match the source signals and derivations into proper montage channels.
     * @param config - Optional configuration (TODO: config definitions).
     * @returns Mapped channels as an array.
     */
    mapChannels (config?: unknown): MontageChannel[]
    /**
     * Release the buffers reserved for this montage's signal data.
     * @param config - Optional configuration (TODO: config definitions).
     */
    releaseBuffers (config?: ConfigReleaseBuffers): Promise<void>
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
     * Set the display layout for the channels in this montage.
     * @param config - Optional configuration (will use default if omitted).
     */
    setChannelLayout (config: ConfigChannelLayout): void
    /**
     * Set the recording interruptions to use when calculating this montage. Information will be relayed to the service
     * responsible for signal processing.
     * @param interruptions - New interruptions to use.
     */
    setInterruptions (interruptions: SignalInterruptionMap): void
    /**
     * Set high-pass filter value for given channel.
     * Passing undefined will unset the channel-specific filter value and reapply default (recording level) value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Filter frequency (in Hz) or undefined.
     * @returns Promise that fulfills with true if any filter was changed in the worker, false otherwise.
     */
    setHighpassFilter (value: number, target?: string | number): Promise<SetFiltersResponse>
    /**
     * Set low-pass filter value for given channel.
     * Passing undefined will unset the channel-specific filter value and reapply default (recording level) value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Filter frequency (in Hz) or undefined.
     * @returns Promise that fulfills with true if any filter was changed in the worker, false otherwise.
     */
    setLowpassFilter (value: number, target?: string | number): Promise<SetFiltersResponse>
    /**
     * Set notch filter value for given channel.
     * Passing undefined will unset the channel-specific filter value and reapply default (recording level) value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Filter frequency (in Hz) or undefined.
     * @returns Promise that fulfills with true if any filter was changed in the worker, false otherwise.
     */
    setNotchFilter (value: number, target?: string | number): Promise<SetFiltersResponse>
    /**
     * Set up channels in this montage according to the provided template configuration.
     * @param config - Configuration for the channels in this montage.
     */
    setupChannels (config: BiosignalMontageTemplate): void
    /**
     * Set up a data service using a signal data cache as input for the service.
     * @param cache - The source data cache to use as input.
     * @returns Promise holding the created cache if successful.
     */
    setupServiceWithCache (cache: SignalDataCache) : Promise<SetupCacheResponse>
    /**
     * Set up a data service using a data source mutex output properties as input for the service.
     * @param inputProps - The source mutex export properties to use as input.
     * @returns Promise holding the export properties of the created montage mutex (if setup was successful).
     */
    setupServiceWithInputMutex (inputProps: MutexExportProperties) : Promise<SetupMutexResponse>
    /**
     * Set up a data service using a shared worker holding the cached signals.
     * @param port - The cache worker's message port.
     * @returns Promise that resolves with the property `success` of the setup process.
     */
    setupServiceWithSharedWorker (port: MessagePort) : Promise<SetupSharedWorkerResponse>
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
     * @returns Promise that fulfills with true if any filter was changed in the worker, false otherwise.
     */
    updateFilters (): Promise<SetFiltersResponse>
}
/**
 * Montage reference signal definition.
 */
export type BiosignalMontageReferenceSignal = {
    /** Is this a common reference (same signal for every channel). */
    common: boolean
    /** Signal description. */
    description: string
    /** Signal label to display in the UI. */
    label: string
    /** Signal type. */
    type: string
    /** Physical unit of the reference signal. */
    unit?: string
} | null
export interface BiosignalMontageService extends AssetService {
    /** Mutex holding the cached signals, if using SharedArrayBuffers. */
    mutex: BiosignalMutex | null
    /** Name of the montage. */
    name: string
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
    getSignals (range: number[], config?: unknown): Promise<GetSignalsResponse>
    /**
     * Handle messages from the worker.
     * @param message - The message from the web worker.
     * @return Promise that resolves as true if the message was handled, false if not.
     */
    handleMessage (message: unknown): Promise<MessageHandled>
    /**
     * Map montage channels in the web worker using the montage config.
     */
    mapChannels (): Promise<void>
    /**
     * Set the given interruptions to the recording in the web worker.
     * @param gaps - The interruptions to set as a map of <start data time, duration> in seconds.
     */
    setInterruptions (interruptions: SignalInterruptionMap): void
    /**
     * Set the filters in the web worker to match current montage filters.
     * @returns Promise that resolves as true if some filter was updated, false otherwise.
     */
    setFilters (): Promise<SetFiltersResponse>
    /**
     * Set up the worker to load montage signals using a signal data cache as raw signal source.
     * @param inputProps - The signal data cache to use.
     * @returns Promise that resolves as true if montage setup in the worker succeeds, false if a prerequisite is not met, and rejects if an error occurs (in the worker).
     */
    setupMontageWithCache (cache: SignalDataCache): Promise<SetupCacheResponse>
    /**
     * Set up the worker to load montage signals using an input mutex as raw signal source.
     * @param inputProps - Properties from the raw signal data mutex.
     * @returns Promise that resolves as true if montage setup in the worker succeeds, false if a prerequisite is not met, and rejects if an error occurs (in the worker).
     */
    setupMontageWithInputMutex (inputProps: MutexExportProperties): Promise<SetupMutexResponse>
    /**
     * Set up the worker to load montage signals using a shared worker as signal source.
     * @param inputPort - Message port from the shared worker.
     * @returns Promise that resolves as true if montage setup in the worker succeeds, false if a prerequisite is not met, and rejects if an error occurs (in the worker).
     */
    setupMontageWithSharedWorker (inputPort: MessagePort): Promise<SetupSharedWorkerResponse>
}
/**
 * Template for constructing a biosignal montage.
 * Any setup configuration JSONs should follow this template when defining montages.
 */
export type BiosignalMontageTemplate = {
    /**
     * Templates for channel derivations in this montage.
     */
    channels: BiosignalChannelTemplate[]
    /**
     * Montage description, multiple lines are stored as an array.
     */
    description: string | string[]
    /**
     * Electrode derivations required by this template (as active or reference in the channels array).
     */
    electrodes: string[]
    /**
     * Descriptive label for this montage.
     */
    label: string
    /**
     * Channel layout as an array of numbers, each representing the number of channels in a group.
     * @example
     * // Montage with eight channels divided into two groups of three channels and one of two channels:
     * layout = [3, 3, 2]
     */
    layout: number[]
    /**
     * Unique identifying name for this montage.
     */
    name: string
    /**
     * Reference channel properties.
     */
    reference: BiosignalMontageReferenceSignal
}
export type BiosignalReferenceChannelTemplate = {
    /**
     * Unique name of the channel.
     * This name will be matched against the labels of the source signals first and a pattern match will be used only
     * if no direct match is found.
     */
    name: string
    /** A RegExp pattern to match the source signal label. */
    pattern?: string
    /** Weight of the channel in the average signal calculation (default 1). */
    weight?: number
}
/**
 * BiosignalResource is a collection of uniform or polygraphic biosignals.
 */
export interface BiosignalResource extends DataResource {
    /** Currently active montage. */
    activeMontage: BiosignalMontage | null
    /** List of annotations. */
    annotations: BiosignalAnnotation[]
    /** List of channels as recorded. */
    channels: SourceChannel[]
    /** Cursors for marking points in time on the plot. */
    cursors: BiosignalCursor[]
    /**
     * Contains the properties of the raw signal data cache as:
     * - `MutexExportProperties` if memory manager is used.
     * - `SignalDataCache` if no memory manager is used.
     * - `null` if cache has not been set up.
     */
    dataCache: MutexExportProperties | SignalDataCache | null
    /** Duration of the actual signal data in seconds, without gaps. */
    dataDuration: number
    /**
     * Interruptions in source signal data as an array of
     * { `start`: number (in seconds of recording time), `duration`: number (in seconds) }.
     * */
    interruptions: SignalInterruption[]
    /** The display view start can be optionally updated after signals are processed and actually displayed. */
    displayViewStart: number
    /** List of channel types and default filters that should be applied to them. */
    filterChannelTypes: { [type: string]: BiosignalFilterType[] }
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
    /** Active timebase value. */
    timebase: number
    /**
     * Unit of the active timebase.\
     * If switching from one timebase unit to another, always change the unit first and value after, since listeners
     * are only notified of value changes.
     */
    timebaseUnit: string
    /** Total recording duration in seconds, with possible gaps. */
    totalDuration: number
    /** List of record video attachments. */
    videos: VideoAttachment[]
    /** Position of the left edge of the UI viewport (in seconds). */
    viewStart: number
    /** This resource's currently visible channels (primarily montage channels if a montage is active). */
    visibleChannels: (MontageChannel | SourceChannel)[]
    /**
     * Add a set of new annotations to this recording.
     * @param annotations - New annotations.
     */
    addAnnotations (...items: BiosignalAnnotation[]): void
    /**
     * Add new annotations to the recording from the given templates.
     * @param templates - Templates to use for the annotations.
     */
    addAnnotationsFromTemplates (...templates: AnnotationTemplate[]): void
    /**
     * Add the given `cursors` to this resource.
     * @param cursors - Cursors to add.
     */
    addCursors (...cursors: BiosignalCursor[]): void
    /**
     * Add new interruptions to the recording in the form of a data gap map.
     * @param interruptions - Map of new interruptions to add `<start data time, duration>`.
     */
    addInterruptions (interruptions: SignalInterruptionMap): void
    /**
     * Start the process of caching signals from the saved URL.
     * @param ranges - Optional ranges to cache in seconds `[start, end]` (NYI, defaults to the whole recording).
     * @returns Promise that resolves when signal caching is complete, true if process was successful and false if not.
     */
    cacheSignals (...ranges: [number, number][]): Promise<boolean>
    /**
     * Destroy this resource and all resources depending on it.
     * @returns Promise that resolves when the resource is destroyed.
     */
    destroy (): void | Promise<void>
    /**
     * Get the absolute time at the given time in seconds since recording start.
     * @param time - Time point in seconds.
     * @returns Date and time properties at the given time point. `day` property starts from 1 instead of 0.
     */
    getAbsoluteTimeAt (time: number): {
        /** Date at time point or null if recording start date is not known. */
        date: Date | null
        /** Day number at time point starting from 1. */
        day: number
        /** Hour at time point in 24 hour format. */
        hour: number
        /** Minute at time point. */
        minute: number
        /** Second at time point. */
        second: number
    }
    /**
     * Get raw signals from all channels for the given range.
     * @param range - Signal range in seconds `[start (included), end (excluded)]`.
     * @param config - Optional config (TODO: Config definitions).
     * @returns Signals in range as Float32Array[].
     */
    getAllRawSignals (range: number[], config?: unknown): Promise<SignalCacheResponse>
    /**
     * Get signals from the active recording for the given range.
     * @param range - Signal range to return in seconds `[start (included), end (excluded)]`.
     * @param config - Additional config to apply (optional; TODO: Config definitions).
     * @returns Signals from requested range or null.
     */
    getAllSignals (range: number[], config?: unknown): Promise<SignalCacheResponse>
    /**
     * Get position information of the channel at given y-position. Each channel is considered
     * to take one channels spacing worth of space vertically.
     * @param yPos - Relative position from container bottom margin.
     * @return Channel position properties or null if no channel exists at given position.
     */
    getChannelAtYPosition(yPos: number): ChannelPositionProperties | null
    /**
     * Get the derived signal of a single montage channel.
     * @param channel - Index or name of the montage channel.
     * @param range - Range of the signal in seconds.
     * @param config - Optional configuration.
     * @return SignalCacheResponse, with the requested signal as the first member of the signals array, or null.
     */
    getChannelSignal (channel: number | string, range: number[], config?: unknown): Promise<SignalCacheResponse>
    /**
     * Get a list of interruptions in this recording. This method allows you to alternatively get the interruptions
     * using data cache time (i.e. not including prior interruption time) instead of recording time.
     * @param useCacheTime - Use cache time (ignoring previous interruptions) instead of recording time.
     */
    getInterruptions (useCacheTime?: boolean): SignalInterruption[]
    /**
     * Get relative time properties at the given time point in seconds since recording start.
     * @param time - Time point in seconds.
     * @returns Relative time properties at the given time point.
     */
    getRelativeTimeAt (time: number): {
        days: number
        hours: number
        minutes: number
        seconds: number
    }
    /**
     * Check if the recording has video for the given time point or range.
     * @param time - Time point as number or time range as [start, end].
     */
    hasVideoAt (time: number | [number, number]): boolean
    /**
     * Release all buffers referenced by this resource.
     */
    releaseBuffers (): Promise<void>
    /**
     * Remove the given `annotations` from this recording, returning them as an array.
     * @param annotations - Annotation objects or IDs, or indices within the annotations array.
     * @returns An array containing the removed annotations.
     */
    removeAnnotations (...annotations: string[] | number[] | BiosignalAnnotation[]): BiosignalAnnotation[]
    /**
     * Set the given montage as active.
     * @param montage - Montage index or name.
     */
    setActiveMontage (montage: number | string | null): Promise<void>
    /**
     * Set the interruptions present in this recording.
     * @param interruptions - New interruptions to use.
     */
    setInterruptions (interruptions: SignalInterruptionMap): void
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
     * @returns Promise that resolves when the filter is set in montage worker.
     */
    setHighpassFilter (value: number | null, target?: number | string, scope?: string): Promise<void>
    /**
     * Set low-pass filter for the given channel(s).
     * @param value - Filter frequency in Hz.
     * @param target - Channel index or type (default primary channel type).
     * @param scope - Scope of the change: `recording` (default) or `montage`.
     * @returns Promise that resolves when the filter is set in montage worker.
     */
    setLowpassFilter (value: number | null, target?: number | string, scope?: string): Promise<void>
    /**
     * Set the memory manager used by this resource.
     * @param manager - Memory manager or null to unset.
     */
    setMemoryManager (manager: MemoryManager | null): void
    /**
     * Set notch filter for the given channel(s).
     * @param value - Filter frequency in Hz.
     * @param target - Channel index or type (default primary channel type).
     * @param scope - Scope of the change: `recording` (default) or `montage`.
     * @returns Promise that resolves when the filter is set in montage worker.
     */
    setNotchFilter (value: number | null, target?: number | string, scope?: string): Promise<void>
    /**
     * Setu up a signal data cache for input signals.
     * @returns A promise resolving with the created signal data cache or null on error.
     */
    setupCache (): Promise<SignalDataCache | null>
    /**
     * Set up a mutex as input signal data cache.
     * @returns A promise resolving with clonable mutex properties if success, null on failure.
     */
    setupMutex (): Promise<MutexExportProperties | null>
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
    /** Descriptive label for this setup. */
    label: string
    /** Channel derivations that are precalculated and stored as source signals. */
    derivations?: SetupDerivation[]
    /** Channels that should have been present, but were not found. */
    missingChannels: SetupChannel[]
    /** Unique name for this setup. */
    name: string
    /** Raw signals that could not be matched to any channel in the setup. */
    unmatchedSignals: SetupChannel[]
    /**
     * Load setup configuration from an external config object.
     * @param recordSignals - Channel descriptions of the biosignal recording.
     * @param config - Configuration object for the setup.
     */
    loadConfig (recordSignals: BiosignalChannel[], config: ConfigBiosignalSetup): void
}
export type BiosignalSetupReject = (reason: string) => void
export type BiosignalSetupResolve = (response: BiosignalSetupResponse) => void
export type BiosignalSetupResponse = MutexExportProperties | false
/**
 * Common properties that should be defined during the process of loading a biosignal study source.
 */
export type BiosignalStudyProperties = {
    /** A header specific to the data source type of the study. */
    formatHeader: unknown
    /** A generic header record containing key properties of the underlying recording. */
    header: BiosignalHeaderRecord
}
export type ChannelPositionProperties = {
    /** Bottom edge position as a fraction of the viewport height. */
    bottom: number
    /** Channel index in the array of visible channels. */
    index: number
    /** Top edge position as a fraction of the viewport height. */
    top: number
}
/**
 * Indices of channels in the source file used for constructing a derived channel.
 *
 * If multiple indices are present, the channel is an average of the signals at those indices. Each channel may have a
 * weight as a second item in the array, e.g. `[0, 1]` or `[[0, 1], [2]]`. The weight will be used as a multiplier for
 * each sample value in that signal. Default weight is 1 (if omitted).
 *
 * @example
 * // Single channel with index 0:
 * active: [0]
 * // Two channels with indices 0 and 1, both with weight 1:
 * active: [0, 1]
 * // Two channels with indices 0 and 1, with weights 0.5 and 1:
 * active: [[0, 0.5], [1]]
 */
export type DerivedChannelProperties = (number | number[])[]
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
 * A response containing the `signals` for the requested range, if `success` is true.
 */
export type GetSignalsResponse = {
    success: boolean
} & Partial<SignalCachePart>
/**
 * A single channel in an biosignal montage configuration.
 */
export interface MontageChannel extends BiosignalChannel, BaseAsset {
    /**
     * Active channel index or a set of active channel indices; multiple channels will be averaged using optional
     * weights.
     */
    active: number | DerivedChannelProperties
    /** Does this channel use a common average reference. */
    averaged: boolean
    /** Set of reference channel indices; multiple channels will be averaged using optional weights. */
    reference: DerivedChannelProperties
}
/**
 * Commission types for a montage worker with the action name as key and property types as value.
 */
export type MontageWorkerCommission = {
    /** Get montage signals for the given range */
    'get-signals': WorkerMessage['data'] & {
        /** Signals range in seconds as [start (included), end (excluded)]. */
        range: number[]
        config?: ConfigChannelFilter
        /** Name of the montage, for validation. */
        montage?: string
    }
    /** Map montage channels according to given configuration. */
    'map-channels': WorkerMessage['data'] & {
        /** Channel configuration. */
        config: ConfigMapChannels
    }
    /** Release the momery used by the cache in this montage. */
    'release-cache': WorkerMessage['data']
    /** Set interruptions in signal data. */
    'set-interruptions': WorkerMessage['data'] & {
        /** Array of data interruptions. */
        interruptions: { duration: number, start: number }[]
    }
    /** Set default filters as a JSON string. */
    'set-filters': WorkerMessage['data'] & {
        /** Filters as a JSON string. */
        filters: string
        /** Name of the montage. */
        name: string
        /** Filters for individual channels. */
        channels?: BiosignalFilters[]
    }
    /** Set up a shared worker cache as signal data source in the montage worker. */
    'setup-input-cache': WorkerMessage['data'] & {
        /** Duration of the signal data in seconds. */
        dataDuration: number
        /** Message port of the cache worker. */
        port: MessagePort
        /** Total duration of the recording in seconds. */
        recordingDuration: number
    }
    /** Set up an input mutex as signal data source in the montage worker. */
    'setup-input-mutex': WorkerMessage['data'] & {
        /** Index of the data position where this mutex starts in the input buffer. */
        bufferStart: number
        /** Actual signal data duration in seconds. */
        dataDuration: number
        /** Export properties from the input data mutex. */
        input: MutexExportProperties
        /** Total recording duration in seconds. */
        recordingDuration: number
    }
    /** Set up the necessary properties; the worker should be ready to receive commissions after this. */
    'setup-worker': WorkerMessage['data'] & {
        /** Channel mapping configuration. */
        config: ConfigMapChannels
        /** Name of the montage. */
        montage: string
        /** General recording type (e.g. 'eeg'). */
        namespace: string
        /** Global settings. */
        settings: AppSettings
        /** Channel setup configuration. */
        setupChannels: SetupChannel[]
    }
    /** Update global settings. */
    'update-settings': WorkerMessage['data'] & {
        settings: AppSettings
    }
}
/** A valid commission action for a montage worker. */
export type MontageWorkerCommissionAction = keyof MontageWorkerCommission
/**
 * Response sent after a request to release cache buffers.
 */
export type ReleaseCacheResponse = {
    success: boolean
}
/**
 * Response sent after a request to update filters in the worker. If any filter was changed from the previous value,
 * `updated` will be true and the signals should be reloaded.
 */
export type SetFiltersResponse = {
    success: boolean
    updated: boolean
}
/**
 * Response sent after setting up a signal cache.
 */
export type SetupCacheResponse = {
    success: boolean
    cacheProperties?: SignalDataCache
}
/**
 * Configuration for a single signal channel in BiosignalSetup.
 */
export interface SetupChannel extends BiosignalChannelTemplate {
    /** Index of the active channel. */
    active: number | DerivedChannelProperties
    /** Set to true if the raw signal uses average reference, so it is not applied twice. */
    averaged: boolean
    /** Non-default polarity of this channel's signal. */
    displayPolarity: SignalPolarity
    /** Index of the matched raw signal. */
    index: number
    /** Set of reference channel indices; multiple channels will be averaged. */
    reference: DerivedChannelProperties
}
/**
 * Configuration for a single derived channel in BiosignalSetup.
 */
export type SetupDerivation = {
    /** Properties of the active channel(s). */
    active: number | DerivedChannelProperties
    /** Set to true if the raw signal uses average reference, so it is not applied twice. */
    averaged: boolean
    /** Non-default polarity of this channel's signal. */
    displayPolarity: SignalPolarity
    /** Set of reference channel indices; multiple channels will be averaged. */
    reference: DerivedChannelProperties
}
/**
 * Reponse that contains the created mutex export properties in `cacheProperties`, if `success` is true.
 */
export type SetupMutexResponse = {
    success: boolean
    cacheProperties?: MutexExportProperties
}
/**
 * Response sent after setting up a shared worker as signal cache.
 */
export type SetupSharedWorkerResponse = {
    success: boolean
}
/**
 * An object holding cached biosignal data.
 */
export interface SignalDataCache {
    inputRangeEnd: Promise<number>
    inputRangeStart: Promise<number>
    inputSignals: Promise<Float32Array[]>
    outputRangeEnd: number
    outputRangeStart: number
    outputSignalSamplingRates: number[]
    /**
     * Range of updated values in the output signals as array indices.
     */
    outputSignalUpdatedRanges: { start: number, end: number }[]
    asCachePart (): SignalCachePart
    /**
     * Destroy the cache and release all resources.
     * @param dispatchEvent - Should a destroy event be dispatched. Set to false if the method is called from a child class and the event has already been dispatched.
     */
    destroy (dispatchEvent?: boolean): void
    insertSignals (signalPart: SignalCachePart): Promise<void>
    invalidateOutputSignals (): void
    releaseBuffers (): void
}
/** A single interruption in a discontinuous recording. */
export type SignalInterruption = {
    /** Interruption duration in seconds. */
    duration: number
    /** Interruption start in seconds of data time (excluding prior interruptions). */
    start: number
}
/**
 * Map of interruptions in discontinuous signal data as Map<position, length> in seconds.
 * Position is expressed in seconds of actual signal data, i.e. ignoring any previous interruptions.
 * @remarks
 * This type should probably be removed in the future in favor of the more verbose SignalInterruption.
 */
export type SignalInterruptionMap = Map<number, number>
export type SignalPart = {
    data: Float32Array
    samplingRate: number
}
/** Signal polarity as one of:
 * - 1 = positivie up
 * - -1 = negative up (inverse)
 * - 0 = don't override default
 */
export type SignalPolarity = -1 | 0 | 1
/** Start and end of a signal range. */
export type SignalRange = { start: number, end: number }
/**
 * A signal channel containing one raw source signal.
 */
export interface SourceChannel extends BiosignalChannel, BaseAsset {
    /** Is the recorded source signal on this channel referenced to an average signal. */
    averaged: boolean
    /** Index of this channel. */
    index: number
}
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
     * Montages are not tied to any certain file, so once the montage has been initiated data from any file with the
     * same setup can be processed by the same montage. The main idea behind this is to allow loading only chuncks of
     * large files at a time and processing only those parts.
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
