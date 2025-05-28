/**
 * Application event types. These are designed in a cascading manner, where the each child class inherits the events
 * from the parent class. Since property change events are a special case, they are defined separately but also
 * included in the event types.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BaseDataset,
    BiosignalAnnotation,
    BiosignalMontage,
    DataResource,
    VideoAttachment,
} from '#types'
import type {
    BroadcastStateEvent,
    EventWithPayload,
    PropertyChangeEvent,
} from '#types/event'

/**
 * Application events.
 */
export enum ApplicationEvents {
    /** Application configuration was changed. */
    CONFIG_CHANGED = 'config-changed',
    /** The application has been initialized. */
    INITIALIZE = 'initialize',
    /** A new dataset is marked active. */
    SET_ACTIVE_DATASET = 'set-active-dataset',
}
/**
 * Events emitted by the application class.
 */
export type ApplicationEvent = {
    /** Application configuration is changed. */
    [ApplicationEvents.CONFIG_CHANGED]: BroadcastStateEvent
    /** The application is initialized. */
    [ApplicationEvents.INITIALIZE]: BroadcastStateEvent
    /** A new dataset is marked active. */
    [ApplicationEvents.SET_ACTIVE_DATASET]: EventWithPayload<BaseDataset>
}
/**
 * Names of events emitted by all assets.
 */
export enum AssetEvents {
    /** The asset is set as active. */
    ACTIVATE = 'activate',
    /** The asset is created (this is for global listeners). */
    CREATE = 'create',
    /** The asset is set as inactive. */
    DEACTIVATE = 'deactivate',
    /** The asset is destroyed. */
    DESTROY = 'destroy',
}
/**
 * Names of property change events emitted by asset classes.
 */
export enum AssetPropertyEvents {
    SCOPE = 'property-change:scope',
    TYPE = 'property-change:type',
}
/**
 * Property change events emitted by asset classes.
 */
export type AssetPropertyEvent = {
    [AssetPropertyEvents.SCOPE]: PropertyChangeEvent<string>
    [AssetPropertyEvents.TYPE]: PropertyChangeEvent<string>
}
/**
 * Events emitted by asset classes.
 */
export type AssetEvent = AssetPropertyEvent & {
    /** The asset is set as active. */
    [AssetEvents.ACTIVATE]: BroadcastStateEvent
    /** The asset is created (this is for global listeners). */
    [AssetEvents.CREATE]: BroadcastStateEvent
    /** The asset is set as inactive. */
    [AssetEvents.DEACTIVATE]: BroadcastStateEvent
    /** The asset is being destroyed. */
    [AssetEvents.DESTROY]: BroadcastStateEvent
}
/**
 * Events emitted by datasets.
 */
export enum DatasetEvents {
    /** A data resource is added to the dataset. */
    ADD_RESOURCE = 'add-resource',
    /** The given resource within this dataset is set as active. */
    SET_ACTIVE_RESOURCE = 'set-active-resource',
}
/**
 * Events emitted by the dataset class (in addition to the asset events).
 */
export type DatasetEvent = {
    /** A data resource is added to the dataset. */
    [DatasetEvents.ADD_RESOURCE]: EventWithPayload<DataResource>
    /** The given resource within this dataset is set as active. */
    [DatasetEvents.SET_ACTIVE_RESOURCE]: EventWithPayload<DataResource>
}
/**
 * Names of events emitted by resource classes.
 */
export enum ResourceEvents {
    /** The resource is prepared for use. */
    PREPARE = 'prepare',
    /** The resource is unloaded and memory reserved to it released. */
    UNLOAD = 'unload',
}
/**
 * Names of property change events emitted by resource classes.
 */
export enum ResourcePropertyEvents {
    DEPENDENCIES_MISSING = 'property-change:dependenciesMissing',
    DEPENDENCIES_READY = 'property-change:dependenciesReady',
    ERROR_REASON = 'property-change:errorReason',
    SOURCE = 'property-change:source',
    STATE = 'property-change:state',
}
/**
 * Property change events emitted by resource classes.
 */
export type ResourcePropertyEvent = AssetPropertyEvent & {
    [ResourcePropertyEvents.DEPENDENCIES_MISSING]: PropertyChangeEvent<string[]>
    [ResourcePropertyEvents.DEPENDENCIES_READY]: PropertyChangeEvent<string[]>
    [ResourcePropertyEvents.ERROR_REASON]: PropertyChangeEvent<string>
    [ResourcePropertyEvents.SOURCE]: PropertyChangeEvent<string>
    [ResourcePropertyEvents.STATE]: PropertyChangeEvent<string>
}
/**
 * Events emitted by resource classes.
 */
export type ResourceEvent = ResourcePropertyEvent & AssetEvent & {
    /** The resource is prepared for use. */
    [ResourceEvents.PREPARE]: BroadcastStateEvent
    /** The resource is unloaded and memory reserved to it released. */
    [ResourceEvents.UNLOAD]: BroadcastStateEvent
}
/**
 * Names of (non-property) events emitted by biosignal resources.
 */
export enum BiosignalResourceEvents {
    /** Reader has completed caching signals from the data source. */
    SIGNAL_CACHING_COMPLETE = 'signal-caching-complete',
}
/**
 * Names of property change events emitted by the biosignal resource class (in addition to resource events).
 */
export enum BiosignalPropertyEvents {
    ANNOTATIONS = 'property-change:annotations',
    DATA_DURATION = 'property-change:dataDuration',
    DISPLAY_VIEW_START = 'property-change:displayViewStart',
    HIGHPASS_FILTER = 'property-change:highpassFilter',
    LOWPASS_FILTER = 'property-change:lowpassFilter',
    MONTAGES = 'property-change:montages',
    NOTCH_FILTER = 'property-change:nothcFilter',
    SAMPLE_COUNT = 'property-change:sampleCount',
    SAMPLING_RATE = 'property-change:samplingRate',
    SENSITIVITY = 'property-change:sensitivity',
    SIGNAL_CACHE_STATUS = 'property-change:signalCacheStatus',
    TIMEBASE = 'property-change:timebase',
    TOTAL_DURATION = 'property-change:totalDuration',
    VIDEOS = 'property-change:videos',
    VIEW_START = 'property-change:viewStart',
}
/**
 * Property change events emitted by the biosignal resource class.
 */
export type BiosignalPropertyEvent = ResourcePropertyEvent & {
    [BiosignalPropertyEvents.ANNOTATIONS]: PropertyChangeEvent<BiosignalAnnotation[]>
    [BiosignalPropertyEvents.DATA_DURATION]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.DISPLAY_VIEW_START]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.HIGHPASS_FILTER]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.LOWPASS_FILTER]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.MONTAGES]: PropertyChangeEvent<BiosignalMontage[]>
    [BiosignalPropertyEvents.NOTCH_FILTER]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.SAMPLE_COUNT]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.SAMPLING_RATE]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.SENSITIVITY]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.SIGNAL_CACHE_STATUS]: PropertyChangeEvent<number[]>
    [BiosignalPropertyEvents.TIMEBASE]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.TOTAL_DURATION]: PropertyChangeEvent<number>
    [BiosignalPropertyEvents.VIDEOS]: PropertyChangeEvent<VideoAttachment[]>
    [BiosignalPropertyEvents.VIEW_START]: PropertyChangeEvent<number>
}
/**
 * Events emitted by the biosignal resource class.
 */
export type BiosignalResourceEvent = BiosignalPropertyEvent & ResourceEvent & {
    /** Reader has completed caching signals from the data source. */
    [BiosignalResourceEvents.SIGNAL_CACHING_COMPLETE]: BroadcastStateEvent
}
