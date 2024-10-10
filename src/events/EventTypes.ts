/**
 * Application event types.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Events emitted by the asset class.
 */
export enum AssetEvent {
    ACTIVATE = 'activate',
    CREATE = 'create',
    DEACTIVATE = 'deactivate',
    DESTROY = 'destroy',
    RENAME = 'rename',
}
// Property events emitted by the asset class.
export enum AssetPropertyEvent {
    SCOPE = 'property-change:scope',
    TYPE = 'property-change:type',
}
/**
 * Events emitted by the dataset class (in addition to the asset events).
 */
export enum DatasetEvent {
    ADD_ITEM = 'add-item',
    SET_ACTIVE_RESOURCE = 'set-active-resource',
}
/**
 * Events emitted by the resource class (in addition to asset events).
 */
export enum ResourceEvent {
}
// Property events emitted by the biosignal resource class.
enum BiosignalPropertyEvent {
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
/**
 * Events emitted by the biosignal resource class.
 */
export const BiosignalResourceEvent = {
    PROPERTY_CHANGE: {
        ...AssetPropertyEvent,
        ...BiosignalPropertyEvent,
    },
    ...AssetEvent,
    ...ResourceEvent,
}