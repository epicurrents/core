/**
 * Application event types.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BroadcastStateEvent, EventWithPayload, PropertyChangeEvent } from '#types/event'
import { BaseAsset, BiosignalAnnotation, BiosignalMontage, DataResource, VideoAttachment } from '#types'

export enum AssetEvents {
    ACTIVATE = 'activate',
    CREATE = 'create',
    DEACTIVATE = 'deactivate',
    DESTROY = 'destroy',
    RENAME = 'rename',
}
/**
 * Events emitted by the asset class.
 */
export type AssetEvent = {
    [AssetEvents.ACTIVATE]: BroadcastStateEvent
    [AssetEvents.CREATE]: BroadcastStateEvent
    [AssetEvents.DEACTIVATE]: BroadcastStateEvent
    [AssetEvents.DESTROY]: BroadcastStateEvent
    [AssetEvents.RENAME]: BroadcastStateEvent
}
// Property events emitted by the asset class.
export enum AssetPropertyEvents {
    SCOPE = 'property-change:scope',
    TYPE = 'property-change:type',
}
export type AssetPropertyEvent = {
    [AssetPropertyEvents.SCOPE]: PropertyChangeEvent<string>
    [AssetPropertyEvents.TYPE]: PropertyChangeEvent<string>
}
export enum DatasetEvents {
    ADD_ITEM = 'add-item',
    SET_ACTIVE_RESOURCE = 'set-active-resource',
}
/**
 * Events emitted by the dataset class (in addition to the asset events).
 */
export type DatasetEvent = {
    [DatasetEvents.ADD_ITEM]: EventWithPayload<BaseAsset>
    [DatasetEvents.SET_ACTIVE_RESOURCE]: EventWithPayload<DataResource>
}
enum ResourcePropertyEvents {
    DEPENDENCIES_MISSING = 'property-change:dependencies-missing',
    DEPENDENCIES_READY = 'property-change:dependencies-ready',
    ERROR_REASON = 'property-change:error-reason',
    SOURCE = 'property-change:source',
    STATE = 'property-change:state',
}
/**
 * Property events emitted by the resource class.
 */
export type ResourcePropertyEvent = AssetPropertyEvent & {
    [ResourcePropertyEvents.DEPENDENCIES_MISSING]: PropertyChangeEvent<string[]>
    [ResourcePropertyEvents.DEPENDENCIES_READY]: PropertyChangeEvent<string[]>
    [ResourcePropertyEvents.ERROR_REASON]: PropertyChangeEvent<string>
    [ResourcePropertyEvents.SOURCE]: PropertyChangeEvent<string>
    [ResourcePropertyEvents.STATE]: PropertyChangeEvent<string>
}
// Property events emitted by the biosignal resource class (in addition to resource events).
enum BiosignalPropertyEvents {
    ANNOTATIONS = 'property-change:annotations',
    DATA_DURATION = 'property-change:data-duration',
    DISPLAY_VIEW_START = 'property-change:display-view-start',
    MONTAGES = 'property-change:montages',
    SAMPLE_COUNT = 'property-change:sample-count',
    SAMPLING_RATE = 'property-change:sampling-rate',
    SENSITIVITY = 'property-change:sensitivity',
    SIGNAL_CACHE_STATUS = 'property-change:signal-cache-status',
    TIMEBASE = 'property-change:timebase',
    TOTAL_DURATION = 'property-change:total-duration',
    VIDEOS = 'property-change:videos',
    VIEW_START = 'property-change:view-start',
}
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