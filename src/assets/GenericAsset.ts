/**
 * Generic asset.
 * This is the root class that all other classes extend.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import EventBus from '#events/EventBus'
import { Log } from 'scoped-event-log'
import { AssetEvents } from '#events/EventTypes'
import type { BaseAsset, PropertyChangeHandler } from '#types/application'
import type { EventWithPayload, PropertyChangeEvent } from '#types/event'
import type {
    ScopedEventBus,
    ScopedEventCallback,
    ScopedEventPhase,
} from 'scoped-event-bus/dist/types'

const SCOPE = "GenericAsset"

export default abstract class GenericAsset implements BaseAsset {
    /**
     * Core events emitted by this asset (not including property change events).
     */
    static readonly EVENTS = AssetEvents
    /**
     * Create an identifier that is unique among the identifiers created with this method.
     * @returns Unique identifier as a string.
     */
    static CreateUniqueId () {
        let retries = 100
        while (retries > 0) {
            const id = (Date.now() + Math.random()).toString(36)
            if (!GenericAsset.USED_IDS.has(id)) {
                GenericAsset.USED_IDS.add(id)
                return id
            }
            retries--
        }
        Log.warn(`Reached retry limit while creating a unique ID.`, SCOPE)
        const errorId = `id-error-${GenericAsset.USED_IDS.size}`
        GenericAsset.USED_IDS.add(errorId)
        return errorId
    }
    private static USED_IDS = new Set<string>()
    protected _eventBus: ScopedEventBus
    protected _id: string
    protected _isActive: boolean = false
    protected _modality: string
    protected _name: string

    constructor (name: string, modality: string) {
        // Make sure that reference to the global __EPICURRENTS__ object exists.
        if (typeof window.__EPICURRENTS__ === 'undefined') {
            Log.error(
                `Reference to global __EPICURRENTS__ object was not found. ` +
                `Main application instance must be created before creating assets.`,
                SCOPE
            )
        }
        this._eventBus = window.__EPICURRENTS__?.EVENT_BUS || new EventBus()
        this._id = GenericAsset.CreateUniqueId()
        this._modality = modality
        this._name = name
        // Dispatch asset created event.
        setTimeout(() => this.dispatchEvent(AssetEvents.CREATE), 1)
    }

    get id () {
        return this._id
    }
    get isActive () {
        return this._isActive
    }
    set isActive (value: boolean) {
        // Dispatch an additional primitive event type on asset activation/deactivation.
        this.dispatchEvent(value ? AssetEvents.ACTIVATE : AssetEvents.DEACTIVATE, 'before')
        this._setPropertyValue('isActive', value)
        this.dispatchEvent(value ? AssetEvents.ACTIVATE : AssetEvents.DEACTIVATE, 'after')
    }
    get modality () {
        return this._modality
    }
    set modality (value: string) {
        this._setPropertyValue('modality', value)
    }
    get name () {
        return this._name
    }
    set name (value: string) {
        if (!value) {
            return
        }
        this._setPropertyValue('name', value)
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    /**
     * Set a new value for a property in this asset.
     * @param property - Name of the property.
     * @param newValue - New value for the property.
     * @param event - Optional event name to override the dispatched default property change event.
     */
    protected _setPropertyValue (property: keyof this, newValue: unknown, event?: string) {
        if (typeof property !== 'string') {
            // Only string type property keys are supported.
            return
        }
        const protectedKey = `_${property}` as keyof this
        const value = newValue as this[keyof this]
        if (property.startsWith('_') || this[protectedKey] === undefined) {
            // Only allow setting public property values not starting with an underscore to prevent meddling with
            // properties from the prototype or infinite call stacks when trying to use an explicit setter.
            Log.error(
                `_setPropertyValue only supports setting public property values; ` +
                `'${property}' is not a valid property name.`, SCOPE)
            return
        }
        if (Array.isArray(this[protectedKey]) && Array.isArray(value)) {
            if (!this.dispatchPropertyChangeEvent(property, value, this[protectedKey], 'before', event)) {
                Log.debug(`Setting new value for property '${property}' was prevented.`, SCOPE)
                return
            }
            const prevValue = (this[protectedKey] as unknown[])
                              .splice(0, (this[protectedKey] as unknown[]).length, ...value)
            this.dispatchPropertyChangeEvent(property, value, prevValue, 'after', event)
        } else {
            const prevValue = this[protectedKey]
            if (!this.dispatchPropertyChangeEvent(property, value, prevValue, 'before', event)) {
                Log.debug(`Setting new value for property '${property}' was prevented.`, SCOPE)
                return
            }
            this[protectedKey] = value
            this.dispatchPropertyChangeEvent(property, value, prevValue, 'after', event)
        }
    }

    addEventListener (
        event: string|RegExp|(string|RegExp)[],
        callback: ScopedEventCallback,
        subscriber: string,
        phase: ScopedEventPhase = 'after',
    ) {
        this._eventBus.addScopedEventListener(event, callback, subscriber, this.id, phase)
    }

    async destroy () {
        this.dispatchEvent(GenericAsset.EVENTS.DESTROY)
    }

    dispatchEvent (event: string, phase: ScopedEventPhase = 'after', detail?: { [key: string]: unknown }) {
        return this._eventBus.dispatchScopedEvent(event, this.id, phase, Object.assign({ origin: this }, detail))
    }

    dispatchPayloadEvent<T> (event: string, payload: T, phase: ScopedEventPhase = 'after') {
        const detail = {
            payload: payload,
        } as EventWithPayload<T>['detail']
        return this.dispatchEvent(event, phase, detail)
    }

    dispatchPropertyChangeEvent<T> (
        property: keyof this,
        newValue: T,
        oldValue: T,
        phase: ScopedEventPhase = 'after',
        event?: string,
    ) {
        const detail = {
            property: property,
            newValue: newValue,
            oldValue: oldValue,
        } as PropertyChangeEvent<T>['detail']
        return this.dispatchEvent(event || `property-change:${property.toString()}`, phase, detail)
    }

    getEventHooks (event: string, subscriber: string): ReturnType<ScopedEventBus['getEventHooks']> {
        return this._eventBus.getEventHooks(event, subscriber, this.id)
    }

    onPropertyChange (
        property: keyof this | (keyof this)[],
        handler: PropertyChangeHandler,
        subscriber: string,
        phase: ScopedEventPhase = 'after',
    ) {
        const properties = Array.isArray(property) ? property : [property]
        for (const prop of properties) {
            if (typeof prop !== 'string') {
                continue
            }
            this.addEventListener(`property-change:${prop}`, (e) => {
                handler(e.detail.newValue, e.detail.oldValue)
            }, subscriber, phase)
        }
    }

    removeAllEventListeners (subscriber?: string) {
        if (subscriber) {
            this._eventBus.removeAllScopedEventListeners(subscriber, this.id)
        } else {
            this._eventBus.removeScope(this.id)
        }
    }

    removeEventListener (
        event: string|RegExp|(string|RegExp)[],
        callback: ScopedEventCallback,
        subscriber: string,
        phase?: ScopedEventPhase
    ) {
        return this._eventBus.removeScopedEventListener(event, callback, subscriber, this.id, phase)
    }

    subscribe (
        event: string|RegExp|(string|RegExp)[],
        callback: ScopedEventCallback,
        subscriber: string,
        phase: ScopedEventPhase = 'after'
    ): ReturnType<ScopedEventBus['subscribe']> {
        return this._eventBus.subscribe(event, callback, subscriber, this.id, phase)
    }

    unsubscribe (
        event: string|RegExp|(string|RegExp)[],
        callback: ScopedEventCallback,
        subscriber: string,
        phase?: ScopedEventPhase
    ) {
        return this._eventBus.unsubscribe(event, callback, subscriber, this.id, phase)
    }

    unsubscribeAll (subscriber: string) {
        return this._eventBus.unsubscribeAll(subscriber, this.id)
    }
}
