/**
 * Biosignal types.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    Annotation,
    AnnotationLabel,
    AnnotationOptions,
    AnnotationTemplate,
    AssetSerializeOptions,
    BaseAsset,
    DataResource,
    PropertyChangeContext,
    SafeObject
} from './application'
import { BiosignalMutex } from '../assets'
import {
    AppSettings,
    CommonBiosignalSettings,
    ConfigBiosignalSetup,
    ConfigChannelFilter,
    ConfigChannelLayout,
    ConfigMapChannels,
    ConfigReleaseBuffers,
    SettingsColor,
    UrlAccessOptions,
} from './config'
import {
    AssetService,
    CacheSignalsResponse,
    MemoryManager,
    MessageHandled,
    SetupStudyResponse,
    SetupWorkerResponse,
    SignalCacheResponse,
    SignalCachePart,
    WorkerResponse,
    WorkerMessage,
} from './service'
import { StudyContext } from './study'
import { type MutexExportProperties, type MutexMetaField } from 'asymmetric-io-mutex'
import { Modify } from './util'

/**
 * A single element of an amplitude envelope, containing the maximum and minimum values and their indices.
 */
export type AmplitudeEnvelopeElement = {
    max: {
        index: number
        value: number
    }
    min: {
        index: number
        value: number
    }
}

/**
 * Object template to use when constructing a biosignal annotation.
 */
export type AnnotationEventTemplate = AnnotationTemplate & {
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
    class: BiosignalAnnotationEvent['class']
    /** Duration of the event, in seconds (zero for instant event). */
    duration: BiosignalAnnotationEvent['duration']
    /**
     * Priority of this event (lower number has lower priority). Priority must be a number greater than zero.
     * Predefined priorities for the default event classes are:
     * - `activation` = 300
     * - `comment` = 200
     * - `event` = 400
     * - `technical` = 100
     */
    priority: BiosignalAnnotationEvent['priority']
    /** Annotation starting time, in seconds after the recording start. */
    start: BiosignalAnnotationEvent['start']
    /**
     * Should this event be placed in the background (behind the traces).
     * TODO: Remove and create a separate annotation class for this.
     */
    background?: BiosignalAnnotationEvent['background']
    /** List of channel numbers, empty for a general event. */
    channels?: (number | string)[]
    /** Color override for the event type's default color. */
    color?: BiosignalAnnotationEvent['color']
    /** Additional opacity multiplier for the event opacity set in the `color` property. */
    opacity?: BiosignalAnnotationEvent['opacity']
    /**
     * Is this event visible (default true).
     * Should be set to false for any educational event types that should not be immediately visible when the
     * recording is opened (such as quiz answers).
     */
    visible?: BiosignalAnnotationEvent['visible']
}
/**
 * Object template to use when constructing a biosignal label.
 */
export type AnnotationLabelTemplate = AnnotationTemplate & {
    /**
     * Label class. The default general purpose label classes are:
     * - `evaluation` contains the evaluation results.
     * - `label` is a generic label.
     * - `technical` describes the technical quality of the recording.
     */
    class: AnnotationLabel['class']
    /**
     * Priority of this label (lower number has lower priority). Priority must be a number greater than zero.
     * Predefined priorities for the default label classes are:
     * - `evaluation` = 300
     * - `label` = 200
     * - `technical` = 100
     */
    priority: number
}
/**
 * Annotation for a single moment or period of time in a biosignal resource.
 */
export interface BiosignalAnnotationEvent extends Annotation {
    /**
     * Event class. The default general purpose event classes are:
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
    /** Duration of the event, in seconds (zero for instant event). */
    duration: number
    /**
     * Priority of this event (lower number has lower priority). Priority must be a number greater than zero.
     * Predefined priorities for the default event classes are:
     * - `activation` = 300
     * - `comment` = 200
     * - `event` = 400
     * - `technical` = 100
     */
    priority: number
    /** Event starting position, in seconds. */
    start: number
    /** Is this event visible. */
    visible: boolean
    /**
     * Should this event be placed in the background (behind the plot).
     * TODO: Remove and create a separate montage annotation class for this.
     */
    background?: boolean
    /** List of channel indices or `active` channel names, empty for a general type event. */
    channels?: (number | string)[]
    /**
     * Color override for the event type's default color.
     * Changing this property triggers an additional event `appearance-changed`.
     */
    color?: SettingsColor
    /**
     * Additional opacity multiplier for the event opacity set in the `color` property.
     * Changing this property triggers an additional event `appearance-changed`.
     */
    opacity?: number
    serialize (options?: AssetSerializeOptions): ReturnType<Annotation['serialize']> & {
        duration: number
        start: number
        background?: boolean
        channels?: (number | string)[] | null
        color?: string | null
        opacity?: number
    }
}
/** Optional properties for constructing a biosignal annotation event. */
export type BiosignalAnnotationEventOptions = Modify<AnnotationOptions, {
    /** Should this event be placed in the background (behind the traces). */
    background?: boolean
    /** List of channel numbers or labels, empty for a global event. */
    channels?: (number | string)[]
    /** Event class. */
    class?: BiosignalAnnotationEvent['class']
    /** Annotation color. */
    color?: SettingsColor
    /** Additional opacity multiplier for the event color. */
    opacity?: number
}>
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
    /** The computed channel signal. Null if signals should be fetched from the service. */
    signal: Float32Array | null
    /** Unit of the signal on this channel (e.g. 'uV'). */
    unit: string
    /** Is this channel visible to the user. */
    visible: boolean
    /** Is this channel an original (pre-correction) signal that should overlay its corrected counterpart. */
    isOriginal?: boolean
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
     * Operation for combining the matched inputs. Defaults to `'linear'` when omitted.
     * See {@link BiosignalDerivationOperation} for the available operations and their input semantics.
     */
    operation?: BiosignalDerivationOperation
    /**
     * Operation-specific knobs (e.g. window size for a future `'rms'` op). Passed through to the materialisation
     * step verbatim.
     */
    options?: Record<string, unknown>
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
export interface BiosignalChannelMarker extends BaseAsset {
    /** Channel that this marker belongs to. */
    channel: BiosignalChannel
    /** Is this marker currently being dragged. */
    dragging: boolean
    /**
     * Is this marker active in the calculation of signal properties.
     * Inactive markers are usually shown too, but with different styling.
     */
    isActive: boolean
    /** Label visible to the user. */
    label: string
    /** Position of the marker in seconds. */
    position: number | null
    /** Value of the marker used in calculations (e.g. signal amplitude at marker position). */
    value: number | null
    /**
     * Set a new position for the marker, triggering appropriate update watchers.
     * @param position - The new value of the marker.
     */
    setPosition (position: number | null): void
    /**
     * Set a new value for the marker, triggering appropriate update watchers.
     * @param value - The new value of the marker.
     */
    setValue (value: number | null): void
}
/**
 * Basic properties of the biosignal channel entity to be used when loading configurations from JSON.
 */
export type BiosignalChannelProperties = {
    /** Index or indices of the active channel(s). */
    active?: number | DerivedChannelProperties
    /** Is the signal on this channel average referenced. */
    averaged?: boolean
    /** Name of the contralateral channel (if applicable). */
    contralateralChannel?: string
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
    /** Is this channel an original (pre-correction) signal that should overlay its corrected counterpart. */
    isOriginal?: boolean
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
     * Start the process of caching raw signals from the preset File or URL.
     * @param startFrom - Optional data-time offset (seconds) at which to centre the cache when the
     *                    rolling-window strategy is in use. Ignored for recordings that fit fully
     *                    in memory.
     */
    cacheSignals (startFrom?: number): Promise<CacheSignalsResponse>
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
     * @param options - URL access options.
     * @param formatHeader - Possible format-specific header object, if needed by the worker.
     * @returns Promise that fulfills with the real duration of the recording, or 0 if loading failed.
     */
    setupWorker (
        header: BiosignalHeaderRecord, study: StudyContext, options?: UrlAccessOptions, formatHeader?: unknown
    ): Promise<SetupStudyResponse>
    /**
     * Setup a simple signal data cache.
     * @param dataDuration - Duration of signal data in the recording in seconds.
     * @param derivationSlots - Optional setup-declared derivation slots to allocate after source signals.
     * @returns A promise that resolves with the created cache if successful, null otherwise.
     */
    setupCache (dataDuration: number, derivationSlots?: BiosignalCacheDerivationSlot[]): Promise<SignalDataCache|null>
}
/**
 * Downsampling method applied to a signal.
 * - `average`: Calculates the average of the samples within the downsampling window.
 * - `max`: Takes the maximum value of the samples within the downsampling window.
 * - `max-abs`: Takes the value with the maximum absolute of the samples within the downsampling window (negative or positive).
 * - `min`: Takes the minimum value of the samples within the downsampling window.
 * - `sum`: Calculates the sum of the samples within the downsampling window.
 */
export type BiosignalDownsamplingMethod = 'average' | 'max' | 'max-abs' | 'min' | 'sum'
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
    /** List of events for this recording. */
    events: AnnotationEventTemplate[]
    /** List of labels for this recording. */
    labels: AnnotationLabelTemplate[]
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
        dataUnitCount: number
        dataUnitDuration: number
        dataUnitSize: number
        discontinuous: boolean
        events: string[]
        fileType: string
        interruptions: number[][]
        labels: string[]
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
     * Add the given events to this header record.
     * The events are transferred to the actual recording at the time of instantiation.
     * @param items - Events to add.
     */
    addEvents (...items: BiosignalAnnotationEvent[]): void
    /**
     * Add the given recording interruptions to this header record.
     * The interruptions are transferred to the actual recording at the time of instantiation.
     * @param items - Recording interruptions to add.
     */
    addInterruptions (items: SignalInterruptionMap): void
    /**
     * Add the given labels to this header record.
     * The labels are transferred to the actual recording at the time of instantiation.
     * @param items - Labels to add.
     */
    addLabels (...items: AnnotationLabel[]): void
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
    /**
     * When true, mutations targeting `sensitivity`, `filters`, `pageLength`, `timebaseUnit`, etc.
     * land on this montage instead of the recording, and reader sites prefer the montage's value
     * over the recording's. Default is false — mutations and reads behave as if the montage were
     * a view onto recording-level state. Cascade-style montages flip this true so their per-row
     * sensitivity / filter / sec-per-page choices stay separate from the user's regular settings.
     */
    applyToMontage: boolean
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
    /** Named highlight contexts attached to this montage. */
    highlights: { [key: string]: unknown }
    /**
     * True for cascade montages (N rows of one source channel, time-shifted) and false for regular
     * montages. Used as a discriminant: consumers cast to `BiosignalCascadeMontage` for row math
     * (`getRowAtTime`, `getRowAtY`, ...) when this flag is set.
     */
    isCascade: boolean
    /** Descriptive name for this montage. */
    label: string
    /** Unique, identifying name for this montage. */
    name: string
    /**
     * Montage-level override for the recording's page length (seconds per page). When null, the
     * recording / settings default is used. Set by montages whose layout depends on a specific page
     * length.
     */
    pageLength: number | null
    /**
     * Seconds advanced by one page-turn (`goForward` / `goBackward`). When null, navigation falls
     * back to the recording's page length. Cascade-style montages set this to `rowCount * pageLength`
     * so a single page-turn advances the whole stack.
     */
    pageStep: number | null
    /** Parent recording of this montage. */
    recording: BiosignalResource
    /** Label of the (possible) common reference electrode/signal. */
    referenceLabel: string
    /**
     * Montage-level sensitivity override. When `null`, reader sites fall back to the recording's
     * sensitivity. When a positive number AND `applyToMontage` is true, reader sites use this
     * value while the montage is active.
     */
    sensitivity: number | null
    /** Service handle for this montage (used for signal derivation and filter work). */
    service: BiosignalMontageService
    /** ID of the service of this montage. */
    serviceId: string
    setup: BiosignalSetup
    /**
     * Montage-level override for the recording's timebase unit. When null, the recording default is
     * used. Montages whose layout assumes constant sec/page geometry set this to `'sec'` so
     * calibrated (cm/sec) timebase is silently coerced while the montage is active.
     */
    timebaseUnit: string | null
    /** This montage's visible channels. */
    visibleChannels: MontageChannel[]
    /**
     * Attach a named highlight context to this montage.
     * Dispatches `property-change:highlights` so listeners can re-render.
     * Returns false (and logs an error) if a context with the same name already exists.
     */
    addHighlightContext (name: string, context: unknown): boolean
    /**
     * Remove a named highlight context from this montage.
     * Dispatches `property-change:highlights`.
     * Returns false (and logs an error) if the context does not exist.
     */
    removeHighlightContext (name: string): boolean
    /**
     * Remove all highlight contexts from this montage.
     * Dispatches `property-change:highlights`.
     */
    removeAllHighlights (): void
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
     * Level 1 of the three-level cache lifecycle: ask the service to drop the
     * worker-side signal-array views and cancel in-flight caching, keeping
     * the mutex layout (and the underlying SAB allocation) intact for a
     * cheap rebind on reactivation.
     */
    releaseSignalArrays (): Promise<void>
    /**
     * Release the buffers reserved for this montage's signal data.
     * @param config - Optional configuration (TODO: config definitions).
     */
    releaseBuffers (config?: ConfigReleaseBuffers): Promise<void>
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
 * Cascade montage view: N vertically stacked rows display successive `pageLength`-second
 * slices of the same source channel. Consumers narrow `BiosignalMontage` to this type when
 * `isCascade` is true to access the row math helpers.
 */
export interface BiosignalCascadeMontage extends BiosignalMontage {
    readonly isCascade: true
    /** Number of stacked rows. */
    readonly rowCount: number
    /**
     * Row index whose y-band contains a relative y position `relYFromBottom` in `[0, 1]` (0 =
     * bottom of the cascade, 1 = top). Clamps to the nearest row when the value falls just
     * outside the valid range.
     */
    getRowAtY (relYFromBottom: number): number
    /**
     * Row index covering recording time `time`. Returns -1 when `time` falls outside the
     * cascade's currently-visible reach `[viewStart, viewStart + rowCount * pageLength)`.
     */
    getRowAtTime (time: number): number
    /** Recording-time range `[start, end]` displayed by row `rowIndex`, or null if out of range. */
    getRowTimeRange (rowIndex: number): [number, number] | null
    /**
     * Convert a (row index, seconds-from-row-start) pair into recording time.
     */
    getTimeAtRowPosition (rowIndex: number, secondsWithinRow: number): number
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
 * Service interface for the dedicated trend worker. Owns a worker that couples to the EDF
 * reader's output SAB as input-only and writes computed epoch results to its own output SAB.
 * Separate from {@link BiosignalMontageService} so trend computation is independent of which
 * display montage is active.
 */
export interface BiosignalTrendService {
    /**
     * Connect the service to the EDF reader's output SAB (SAB path).
     * Must be called once before any setupTrend / computeTrend commissions.
     * @param inputProps - Export properties from the EDF reader's output mutex.
     * @param dataDuration - Duration of actual signal data in seconds (no gaps).
     * @param recordingDuration - Total recording duration including gaps.
     * @param settings - Common biosignal settings forwarded to the worker.
     */
    setupWorker (
        inputProps: MutexExportProperties,
        dataDuration: number,
        recordingDuration: number,
        namespace: string,
        settings: AppSettings,
        signalModalities?: string[],
    ): Promise<SetupWorkerResponse>
    /**
     * Connect the service to a plain signal cache (no-SAB / TrendWorkerSubstitute path).
     * Used when SharedArrayBuffer is unavailable; the substitute runs TrendProcessor
     * in-process reading from the cache directly.
     */
    setupWithCache (
        cache: SignalDataCache,
        dataDuration: number,
        recordingDuration: number,
        settings: CommonBiosignalSettings
    ): Promise<SetupCacheResponse>
    /**
     * Register a named trend in the worker. Must be called before computeTrend.
     */
    setupTrend (
        name: string,
        derivation: BiosignalTrendDerivation,
        samplingRate: number,
        epochLength: number,
        options?: {
            downsamplingMethod?: BiosignalDownsamplingMethod
            maxFreqHz?: number
            numeratorBand?: [number, number]
            denominatorBand?: [number, number]
            band?: [number, number]
        }
    ): Promise<SetupWorkerResponse>
    /**
     * Forward recording interruptions to the processor so gap epochs can be identified
     * and rendered as gray areas. Call after signal caching completes (interruptions are
     * populated by the EDF reader during `cacheSignals`). A no-op when there are none.
     */
    setInterruptions (interruptions: SignalInterruptionMap): void
    /**
     * Start computing the trend signal.
     * @param name - Name of the trend registered with {@link setupTrend}.
     * @param range - Optional data-unit range `[start, end]` (defaults to the entire recording).
     */
    computeTrend (name: string, range?: number[]): {
        cancel: () => void
        onEpochReady: (
            callback: (signal: number[], epochIndex: number, totalEpochs: number) => void
        ) => void
        result: Promise<unknown>
    }
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
    /** Are annotations locked against modification (adding, removing, or editing). */
    annotationsLocked: boolean
    /** List of events. */
    events: BiosignalAnnotationEvent[]
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
    /** Trends registered on this recording, keyed by trend name. */
    trends: { [name: string]: BiosignalTrend }
    /** Recording start time. */
    startTime: Date | null
    /** Subject properties for reference value calculation. */
    subject: {
        age?: number
        height?: number
        sex?: 'female' | 'male'
        weight?: number
    } | null
    /**
     * Page length (seconds) for the recording's regular (non-routing) display state. Returns the
     * recording-level `timebase` value when its unit is sec/page, otherwise null. Cascade-style
     * views read this to know how wide the recording's main page would be — when a cascade is
     * active the effective `timebase` getter is routed through the cascade montage's
     * `pageLength`, so this getter is the only path back to the underlying main page length.
     */
    mainViewLength: number | null
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
     * Register a cascade montage on this recording — N vertically stacked rows of one source
     * channel, each row a different `pageLength`-second slice. Constructs the modality-appropriate
     * cascade class via the `_constructCascadeMontage` hook (modality subclasses override the
     * hook to return their own class), maps channels, and publishes the new montage on
     * `montages`. Cascade montages deliberately skip the worker-setup dance: every row reads
     * from the same source with no derivation, so the cascade's `getAllSignals` override fetches
     * the raw source directly via `getAllRawSignals`.
     * @param name - Unique name for the montage.
     * @param label - Human-readable label for the montage.
     * @param setup - Electrode setup the source channel is resolved against.
     * @param sourceLabel - Name or label of the source channel in `setup`.
     * @param rowCount - Number of vertically stacked rows.
     * @param pageLength - Seconds displayed per row.
     * @returns The created (or existing) montage, or null when the cascade cannot be built
     *          (source candidate not in setup, buffer not yet initialised, etc.).
     */
    addCascadeMontage (
        name: string,
        label: string,
        setup: BiosignalSetup,
        sourceLabel: string,
        rowCount: number,
        pageLength: number,
    ): Promise<BiosignalMontage | null>
    /**
     * Add the given `cursors` to this resource.
     * @param cursors - Cursors to add.
     */
    addCursors (...cursors: BiosignalCursor[]): void
    /**
     * Add a set of new events to this recording.
     *
     * Two calling conventions are accepted:
     * - Legacy: `addEvents(event1, event2, …)` — no context, source is unspecified.
     * - New: `addEvents(context, event1, event2, …)` — pass `{ source: 'user' }` for
     *   UI-driven calls so that auto-save hooks can distinguish them from system loads.
     */
    addEvents (...items: BiosignalAnnotationEvent[]): void
    addEvents (context: PropertyChangeContext | null, ...items: BiosignalAnnotationEvent[]): void
    /**
     * Add new events to the recording from the given templates.
     * @param context - Optional property-change context.
     * @param templates - Templates to use for the events.
     */
    addEventsFromTemplates (context: PropertyChangeContext | null, ...templates: AnnotationEventTemplate[]): void
    /**
     * Add new interruptions to the recording in the form of a data gap map.
     * @param interruptions - Map of new interruptions to add `<start data time, duration>`.
     */
    addInterruptions (interruptions: SignalInterruptionMap): void
    /**
     * Register a {@link BiosignalTrend} on this recording.
     * Dispatches `property-change:trends`.
     * @returns False if a trend with the same name already exists.
     */
    addTrend (trend: BiosignalTrend): boolean
    /**
     * Look up a registered trend by name.
     * @returns The trend, or null if none is registered under that name.
     */
    getTrend (name: string): BiosignalTrend | null
    /**
     * Remove a registered trend, cancelling any ongoing computation.
     * Dispatches `property-change:trends`.
     * @returns False if no trend with that name exists.
     */
    removeTrend (name: string): boolean
    /**
     * Remove and cancel all registered trends.
     * Dispatches `property-change:trends`.
     */
    removeAllTrends (): void
    /**
     * Add a set of new labels to this recording.
     *
     * Two calling conventions are accepted (see `addEvents` for details).
     */
    addLabels (...items: AnnotationLabel[]): void
    addLabels (context: PropertyChangeContext | null, ...items: AnnotationLabel[]): void
    /**
     * Add new labels to the recording from the given templates.
     * @param context - Optional property-change context.
     * @param templates - Templates to use for the labels.
     */
    addLabelsFromTemplates (context: PropertyChangeContext | null, ...templates: AnnotationLabelTemplate[]): void
    /**
     * Lock all annotations on this resource against modification.
     * Sets `annotationsLocked` to true and marks every existing event and label as `locked`.
     * This operation is irreversible.
     */
    lockAnnotations (): void
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
     * Level 1 of the three-level cache lifecycle: release the worker-side
     * signal-array views and cancel in-flight caching, but keep the mutex
     * layout (and the SAB allocation) intact so a subsequent reactivation can
     * rebind cheaply via `BiosignalMutex.initSignalBuffers(..., overwrite=true)`.
     */
    releaseSignalArrays (): Promise<void>
    /**
     * Level 2 of the three-level cache lifecycle: drop the worker-side mutex
     * entirely and free the SAB allocation from the memory manager. After this
     * a fresh `setupMutex` round-trip is required to use the cache again.
     */
    releaseBuffers (): Promise<void>
    /**
     * Remove the given `events` from this recording, returning them as an array.
     *
     * Two calling conventions are accepted (see `addEvents` for details).
     * @returns An array containing the removed events.
     */
    removeEvents (...events: string[] | number[] | BiosignalAnnotationEvent[]): BiosignalAnnotationEvent[]
    removeEvents (context: PropertyChangeContext | null, ...events: (string | number | BiosignalAnnotationEvent)[]): BiosignalAnnotationEvent[]
    /**
     * Remove the given `labels` from this recording, returning them as an array.
     *
     * Two calling conventions are accepted (see `addEvents` for details).
     * @returns An array containing the removed labels.
     */
    removeLabels (...labels: string[] | number[] | AnnotationLabel[]): AnnotationLabel[]
    removeLabels (context: PropertyChangeContext | null, ...labels: (string | number | AnnotationLabel)[]): AnnotationLabel[]
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
/** A trend calculated from one or more biosignal channel signals. */
export interface BiosignalTrend extends BaseAsset {
    /** Derivation properties for this trend. */
    derivation: BiosignalTrendDerivation
    /** Downsampling method applied to the derived signal. */
    downsamplingMethod: BiosignalDownsamplingMethod
    /** Length of each computed epoch in seconds. */
    epochLength: number
    /** Descriptive label for this trend. */
    label: string
    /** Sampling rate of this trend in Hz. */
    samplingRate: number
    /** How far into the recording (in seconds) has been computed so far. */
    computedUpToSec: number
    /**
     * For spectrogram trends: number of frequency bins per epoch.
     * `signal[i * frequencyBins .. (i+1) * frequencyBins - 1]` is the power
     * spectrum for epoch i. Undefined for other trend types.
     */
    frequencyBins?: number
    /** Computed trend signal. */
    signal: number[]
    /**
     * Cancel the ongoing trend computation.
     */
    cancelTrendComputation: () => void
    /**
     * Compute the trend signal according to the derivation properties. Resolves when computation is complete.
     * Only applicable to service-backed trends; a no-op for externally-loaded trends.
     * @emits trend-complete - Emitted from the class when trend computation is complete.
     * @emits trend-epoch - Emitted from the class after each trend epoch is computed.
     * @emits trend-error - Emitted from the class if an error or interruption occurs during trend computation.
     */
    computeTrend (range?: number[]): Promise<unknown>
    /**
     * Load pre-computed signal data into this trend, bypassing the computation service.
     * Replaces any existing signal data and emits `trend-complete`.
     * Use this for trends whose values are computed externally (e.g. on the backend).
     * @param signal      - Flat signal array in the layout expected by the trend's renderer.
     * @param epochLength - Duration of each epoch in seconds.
     */
    loadSignal (signal: number[], epochLength: number): void
}
/** Definition of a biosignal trend derivation. */
export type BiosignalTrendDerivation = {
    /** Source channel indices in the recording's raw signal data (not montage channels). */
    referenceChannels: number[]
    /** Source channel indices in the recording's raw signal data (not montage channels). */
    sourceChannels: number[]
    /** Trend type. */
    type: BiosignalTrendType
    /**
     * When true the reference signal is replaced by the mean of ALL available input
     * channels (Common Average Reference). `referenceChannels` is ignored.
     * Useful for spectrograms where a single noisy reference electrode would
     * otherwise contaminate all derivations referenced to it.
     */
    averageReference?: boolean
    /**
     * Homologous left/right channel pairs for trends that operate over a set of pairs
     * (currently `'pdbsi'`). Each entry is `[leftIndex, rightIndex]` into the raw input
     * signal arrays. Ignored by trend types that use `sourceChannels`/`referenceChannels`.
     */
    pairs?: [number, number][]
    /** Function applied to reference channels (e.g., averaging). */
    referenceFunction?: BiosignalTrendFunction
    /** Function applied to source channels (e.g., averaging). */
    sourceFunction?: BiosignalTrendFunction
}
/** Function applied to channels in a biosignal trend derivation. */
export type BiosignalTrendFunction = 'average' | 'difference' | 'sum'
/** Required properties for biosignal trend computation. */
export type BiosignalTrendProperties = {
    /** Derivation properties for the trend. */
    derivation: BiosignalTrendDerivation
    /** Downsampling method used for the trend calculation. */
    downsamplingMethod: BiosignalDownsamplingMethod
    /** Length of each epoch in seconds. */
    epochLength: number
    /** Samples per data unit (equals Hz when the data unit is 1 second). */
    samplingRate: number
    /** For spectrogram trends: upper frequency limit in Hz. */
    maxFreqHz?: number
    /** For `'ratio'` trends: numerator band `[hp, lp]` in Hz. */
    numeratorBand?: [number, number]
    /** For `'ratio'` trends: denominator band `[hp, lp]` in Hz. */
    denominatorBand?: [number, number]
    /** For `'pdbsi'` trends: single frequency band `[hp, lp]` in Hz used to integrate band power per electrode. */
    band?: [number, number]
}
/** Type of biosignal trend derivation. */
export type BiosignalTrendType = 'amplitude' | 'pdbsi' | 'ratio' | 'spectrogram'
/** Properties defining the position of a channel in the viewport. */
export type ChannelPositionProperties = {
    /** Bottom edge position as a fraction of the viewport height. */
    bottom: number
    /** Channel index in the array of visible channels. */
    index: number
    /** Top edge position as a fraction of the viewport height. */
    top: number
}
/**
 * Properties for coded biosignal annotation events.
 */
export type CodedEventProperties = {
    /** Unique code for the event. */
    code: string
    /** Descriptive name for the event. */
    name: string
    /** Significance of the event. */
    significance?: 'abnormal' | 'artifact' | 'normal' | 'uncertain'
    /** Optional detailed description of the event. */
    description?: string
    /** Event codes for additional standards. */
    standardCodes?: Record<string, number | string>
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
    /**
     * The montage channel in the corresponding contralateral (homologous) position.
     *
     * The matching depends on the channel names following the international standard (10-x) EEG naming conventions.
     * The channel name should start with the standard channel designator (e.g. 'F3', 'C4', 'Pz' etc.) and may be
     * followed by additional suffixes. The matching is case-insensitive.
     *
     * Results may be unpredictable if the naming is non-standard.
     */
    contralateralChannel: MontageChannel | null
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
    /** Level 1 of the three-level cache lifecycle: drop signal-array views and
     *  cancel in-flight caching, but preserve the mutex layout (and the SAB
     *  allocation, when one is in use). The worker stays ready to be cheaply
     *  re-bound to a fresh buffer. */
    'release-signal-arrays': WorkerMessage['data']
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
 * Actions understood by the dedicated trend worker. The worker couples to the EDF reader's
 * output SAB as an input-only reader and writes computed epoch data to its own output SAB.
 */
export type TrendWorkerCommission = {
    /** Cancel an ongoing trend computation between epochs. */
    'cancel-trend-computation': WorkerMessage['data'] & {
        name: string
    }
    /** Compute the trend signal for the given data-unit range. */
    'compute-trend': WorkerMessage['data'] & {
        name: string
        /** Optional `[start, end]` in data units (defaults to the entire recording). */
        range?: number[]
    }
    /** Register a trend for computation in the worker. */
    'setup-trend': WorkerMessage['data'] & BiosignalTrendProperties & {
        name: string
    }
    /**
     * Connect the worker to the EDF reader's output SAB and provide recording parameters.
     * Must be the first commission sent after worker creation.
     */
    'setup-worker': WorkerMessage['data'] & {
        /** Duration of actual signal data in seconds (no gaps). */
        dataDuration: number
        /** Interruptions in the recording as `{ start, duration }` in seconds. */
        interruptions: { start: number, duration: number }[]
        /** Export properties from the EDF reader's output mutex. */
        input: MutexExportProperties
        /** Total recording duration including gaps. */
        recordingDuration: number
        /**
         * Clonable settings snapshot (`AppSettings._CLONABLE`) — same mechanism as the
         * montage worker. The reactive proxy on the main thread cannot be transferred via
         * postMessage; `_CLONABLE` is a plain object that structured-clone handles correctly.
         * The `update-settings` action keeps this in sync when settings change at runtime.
         */
        settings: AppSettings
        /**
         * Per-channel modality strings (e.g. `'eeg'`, `'ekg'`, `'eog'`, `'annotation'`),
         * indexed identically to the SAB input signal array. Optional for backward
         * compatibility — when absent, Common Average Reference computation falls back
         * to averaging every channel (the previous behaviour, which can be polluted by
         * a single high-amplitude non-EEG channel).
         */
        signalModalities?: string[]
    }
    /**
     * Forward interruptions to the processor. Send after signal caching completes so the
     * processor can skip gap epochs and map recording time → data time correctly.
     * The map is serialized as `[dataTimeStart, duration][]` for postMessage compatibility.
     */
    'set-interruptions': WorkerMessage['data'] & {
        interruptions: [number, number][]
    }
    /** Shut the worker down cleanly. */
    'shutdown': WorkerMessage['data']
    /** Relay updated global settings to the processor (same mechanism as the montage worker). */
    'update-settings': WorkerMessage['data'] & {
        settings: AppSettings
    }
}
/** A valid commission action for the trend worker. */
export type TrendWorkerCommissionAction = keyof TrendWorkerCommission

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
    /** Name of the contralateral channel (if applicable). If omitted, this will be inferred from the channel name. */
    contralateralChannel?: string
    /** Non-default polarity of this channel's signal. */
    displayPolarity: SignalPolarity
    /** Index of the matched raw signal. */
    index: number
    /** Set of reference channel indices; multiple channels will be averaged. */
    reference: DerivedChannelProperties
}
/**
 * Operation used to compute a {@link SetupDerivation}'s samples from its inputs.
 *
 * - `'linear'` (default): weighted sum of `active` minus weighted sum of `reference`.
 *   Composes within the existing montage-derivation loop sample-by-sample, so a
 *   linear derivation can also be expressed inline on a `MontageChannel.active` /
 *   `.reference`. Declaring it at setup level is useful when the same weighted
 *   combination is consumed by several montage channels and the materialised
 *   signal should appear in the raw-signal cache (reachable by cascade montage
 *   and trend services).
 * - `'magnitude'`: pointwise `sqrt(Σᵢ activeᵢ²)` over the weighted active set;
 *   `reference` is unused. Per-axis weights flow through unchanged (a weight of
 *   2 doubles that axis's contribution before squaring).
 *
 * Adding a new operation: extend this union, document the input semantics here,
 * dispatch on it in the materialisation pipeline, and reject unknown values at
 * the setup-loader boundary so a typo doesn't silently degrade to `'linear'`.
 */
export type BiosignalDerivationOperation = 'linear' | 'magnitude'
/**
 * Serialisable description of one materialised derivation cache slot. The resource resolves
 * these from `_setup.derivations` and hands them to the worker so the SAB allocator and the
 * fallback cache both reserve room for the derived signal alongside source channels. Sizing
 * is computed on the main thread (the worker doesn't see `SetupDerivation` directly), so the
 * payload is small and worker-message-friendly.
 */
export type BiosignalCacheDerivationSlot = {
    /**
     * Weighted active inputs. Indices reference source channels in the same cache (slots
     * `0..header.signals.length - 1`). The encoding matches {@link DerivedChannelProperties}.
     */
    active: number | DerivedChannelProperties
    /** Diagnostic label (matches the derivation's `label`). Worker uses it for log messages. */
    label?: string
    /** Diagnostic name (matches the derivation's `name`). */
    name?: string
    /**
     * Operation used to compute samples. Defaults to `'linear'` when omitted at the materialisation
     * site (the resource fills this in from `derivation.operation`, defaulting there too).
     */
    operation: BiosignalDerivationOperation
    /** Operation-specific knobs forwarded verbatim from `derivation.options`. */
    options?: Record<string, unknown>
    /**
     * Weighted reference inputs (used only by `'linear'`; non-linear ops ignore this field).
     * Indices reference source channels in the same cache.
     */
    reference: DerivedChannelProperties
    /** Number of samples to allocate for this slot in the full-buffer case. */
    sampleCount: number
    /** Sampling rate of the derived signal, in Hz. */
    samplingRate: number
}
/**
 * Configuration for a single derived channel in BiosignalSetup.
 *
 * A derivation is materialised after raw signals are decoded and exposed as an
 * additional source-channel slot in the signal cache. This makes the derived
 * signal reachable from the cascade montage's raw-signal path and from trend
 * services that pull through `getAllRawSignals`. The materialisation runs once
 * per cache fill against the raw (unfiltered) inputs; display filters are
 * applied downstream in the montage processor as usual.
 *
 * Extends {@link BiosignalChannelTemplate} so the channel-like display metadata
 * (`label`, `samplingRate`, `unit`, `scale`, `laterality`, `modality`, `name`)
 * sits in one place — the derivation appears alongside source channels in the
 * SAB and needs the same descriptive surface to render.
 */
export type SetupDerivation = BiosignalChannelTemplate & {
    /** Properties of the active channel(s). */
    active: number | DerivedChannelProperties
    /** Set to true if the raw signal uses average reference, so it is not applied twice. */
    averaged: boolean
    /** Non-default polarity of this channel's signal. */
    displayPolarity: SignalPolarity
    /**
     * Operation used to compute samples from {@link active} and {@link reference}.
     * Defaults to `'linear'` when omitted. See {@link BiosignalDerivationOperation}.
     */
    operation?: BiosignalDerivationOperation
    /**
     * Operation-specific knobs (e.g. window size for a future `'rms'` op). Kept
     * deliberately open-shaped; each operation's handler picks the keys it cares
     * about. Unknown keys are ignored.
     */
    options?: Record<string, unknown>
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
    /**
     * Per-channel `{ start, end }` sample positions of the contiguous loaded subrange inside the
     * input cache's current window. Optional because the JS-heap fallback cache does not track
     * input-side updates per channel.
     */
    inputSignalUpdatedRanges?: Promise<{ start: number, end: number }>[]
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
