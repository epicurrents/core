/**
 * Generic asset.
 * This is the root class that all other classes extend.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import EventBus from '#events/EventBus'
import { Log } from 'scoped-ts-log'
import { AssetEvents } from '#events/EventTypes'
import { type BaseAsset, type PropertyChangeHandler } from '#types/application'
import { type EventWithPayload, type PropertyChangeEvent } from '#types/event'
import {
    type ScopedEventBus,
    type ScopedEventCallback,
    type ScopedEventPhase,
} from 'scoped-event-bus/dist/types'

const SCOPE = "GenericAsset"

export default abstract class GenericAsset implements BaseAsset {
    /**
     * Available application contexts for resources inheriting GenericAsset.
     */
    static CONTEXTS = {
        BIOSIGNAL: 'biosignal',
        COMPONENT: 'component',
        DATASET: 'dataset',
        DOCUMENT: 'document',
        LOADER: 'loader',
        PRESENTATION: 'presentation',
        SERVICE: 'service',
        UNKNOWN: 'unknown',
        UTILITY: 'utility',
    }
    static CreateUniqueId () {
        let retries = 100
        while (retries > 0) {
            const id = Math.random().toString(36).substring(2, 10)
            if (!GenericAsset.USED_IDS.includes(id)) {
                GenericAsset.USED_IDS.push(id)
                return id
            }
            retries--
        }
        Log.error(`Reached retry limit while creating unique ID.`, SCOPE)
        const errorId = `id-error-${GenericAsset.USED_IDS.length}`
        GenericAsset.USED_IDS.push(errorId)
        return errorId
    }
    private static USED_IDS: string[] = []
    protected _context: string
    protected _eventBus: ScopedEventBus
    protected _id: string
    protected _isActive: boolean = false
    protected _name: string
    protected _propertyUpdateHandlers: {
        caller: string | null
        handler: (newValue?: unknown, oldValue?: unknown) => unknown
        pattern: RegExp
        property: string
        single: boolean
    }[] = []
    protected _type: string

    constructor (name: string, context: string, type: string) {
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
        this._context = GenericAsset.CONTEXTS.UNKNOWN
        for (const validContext of Object.values(GenericAsset.CONTEXTS)) {
            if (validContext === context) {
                this._context = context
                break
            }
        }
        this._type = type
        this._name = name
    }

    get context () {
        return this._context
    }
    set context (value: string) {
        this._setPropertyValue('context', value)
        this.onPropertyUpdate('scope') // TODO: Deprecated.
    }
    get id () {
        return this._id
    }
    get isActive () {
        return this._isActive
    }
    set isActive (value: boolean) {
        this._setPropertyValue('isActive', value, value ? AssetEvents.ACTIVATE : AssetEvents.DEACTIVATE)
        this.onPropertyUpdate('is-active') // TODO: Deprecated.
    }
    get name () {
        return this._name
    }
    set name (value: string) {
        if (!value) {
            return
        }
        this._setPropertyValue('name', value, AssetEvents.RENAME)
    }
    get type () {
        return this._type
    }
    set type (value: string) {
        this._setPropertyValue('type', value)
        this.onPropertyUpdate('type') // TODO: Deprecated.
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

    addPropertyUpdateHandler (
        property: string | string[],
        handler: (newValue?: unknown, oldValue?: unknown) => unknown,
        caller?: string,
        singleEvent = false,
    ) {
        property = Array.isArray(property) ? property : [property] // Simplify method.
        for (const update of this._propertyUpdateHandlers) {
            // Don't add the same handler twice.
            for (let i=0; i<property.length; i++) {
                if (property[i] === update.property && handler === update.handler) {
                    property.splice(i, 1)
                    i--
                }
            }
        }
        if (!property.length) {
            return
        }
        for (const prop of property) {
            this._propertyUpdateHandlers.push({
                caller: caller || null,
                handler: handler,
                pattern: new RegExp(`^${property}$`, 'i'),
                property: prop,
                single: singleEvent,
            })
        }
        Log.debug(`Added a handler(s) for ${property}.`, SCOPE)
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

    getEventHooks (event: string, subscriber: string) {
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

    onPropertyUpdate (property: string, newValue?: unknown, oldValue?: unknown) {
        for (let i=0; i<this._propertyUpdateHandlers.length; i++) {
            const update = this._propertyUpdateHandlers[i]
            if (update.property === property || property.match(update.pattern)) {
                Log.debug(`Executing ${property} handler${update.caller ? ' for ' + update.caller : ''}.`, SCOPE)
                update.handler(newValue, oldValue)
                if (update.single) {
                    this._propertyUpdateHandlers.splice(i, 1)
                    i--
                }
            }
        }
    }

    removeAllEventListeners (subscriber: string) {
        return this._eventBus.removeAllScopedEventListeners(subscriber, this.id)
    }

    removeAllPropertyUpdateHandlers () {
        Log.debug(`Removing all ${this._propertyUpdateHandlers.splice(0).length} property update handlers.`, SCOPE)
    }

    removeAllPropertyUpdateHandlersFor (caller: string) {
        for (let i=0; i<this._propertyUpdateHandlers.length; i++) {
            const update = this._propertyUpdateHandlers[i]
            if (caller === update.caller) {
                this._propertyUpdateHandlers.splice(i, 1)
                i--
                Log.debug(`Removed ${update.property} handler for ${caller}.`, SCOPE)
            }
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

    removePropertyUpdateHandler (property: string | string[], handler: () => unknown) {
        property = Array.isArray(property) ? property : [property] // Simplify method.
        prop_loop:
        for (let i=0; i<property.length; i++) {
            const prop = property[i]
            for (let j=0; j<this._propertyUpdateHandlers.length; j++) {
                const update = this._propertyUpdateHandlers[j]
                if (prop === update.property && handler === update.handler) {
                    this._propertyUpdateHandlers.splice(j, 1)
                    Log.debug(`Removed ${prop} handler${update.caller ? ' for '+ update.caller : ''}.`, SCOPE)
                    continue prop_loop
                }
            }
        }
    }

    subscribe (
        event: string|RegExp|(string|RegExp)[],
        callback: ScopedEventCallback,
        subscriber: string,
        phase: ScopedEventPhase = 'after'
    ) {
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
