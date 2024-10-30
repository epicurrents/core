/**
 * Application event types.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BroadcastStateEvent, EventWithPayload, PropertyChangeEvent } from '#types/event'
import { BaseAsset, BiosignalAnnotation, BiosignalMontage, DataResource, VideoAttachment } from '#types'

/**
 * Names of events emitted by all assets.
 */
export enum AssetEvents {
    /** The asset has been set as active. */
    ACTIVATE = 'activate',
    /** The asset has been created (this is for global listeners). */
    CREATE = 'create',
    /** The asset has been set as not active. */
    DEACTIVATE = 'deactivate',
    /** The asset is going to be destroyed. */
    DESTROY = 'destroy',
}
/**
 * Events emitted by asset classes.
 */
export type AssetEvent = {
    [AssetEvents.ACTIVATE]: BroadcastStateEvent
    [AssetEvents.CREATE]: BroadcastStateEvent
    [AssetEvents.DEACTIVATE]: BroadcastStateEvent
    [AssetEvents.DESTROY]: BroadcastStateEvent
}
// Property events emitted by asset classes.
export enum AssetPropertyEvents {
    SCOPE = 'property-change:scope',
    TYPE = 'property-change:type',
}
export type AssetPropertyEvent = {
    [AssetPropertyEvents.SCOPE]: PropertyChangeEvent<string>
    [AssetPropertyEvents.TYPE]: PropertyChangeEvent<string>
}
/**
 * Events emitted by datasets.
 */
export enum DatasetEvents {
    /** An item has been added to the dataset. */
    ADD_ITEM = 'add-item',
    /** The given resource within this dataset has been set as active. */
    SET_ACTIVE_RESOURCE = 'set-active-resource',
}
/**
 * Events emitted by the dataset class (in addition to the asset events).
 */
export type DatasetEvent = {
    [DatasetEvents.ADD_ITEM]: EventWithPayload<BaseAsset>
    [DatasetEvents.SET_ACTIVE_RESOURCE]: EventWithPayload<DataResource>
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
 * Names of property change events emitted by the biosignal resource class (in addition to resource events).
 */
export enum BiosignalPropertyEvents {
    ANNOTATIONS = 'property-change:annotations',
    DATA_DURATION = 'property-change:dataDuration',
    DISPLAY_VIEW_START = 'property-change:displayViewStart',
    MONTAGES = 'property-change:montages',
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
    [BiosignalPropertyEvents.MONTAGES]: PropertyChangeEvent<BiosignalMontage[]>
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
export type BiosignalResourceEvent = AssetEvent & BiosignalPropertyEvent