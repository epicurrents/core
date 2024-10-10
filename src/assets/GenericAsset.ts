/**
 * Generic asset.
 * This is the root class that all other classes extend.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import EventBus from '#events/EventBus'
import { Log } from 'scoped-ts-log'
import { AssetEvent } from '#events/EventTypes'
import { type BaseAsset } from '#types/application'
import {
    type ScopedEventBus,
    type ScopedEventCallback,
    type ScopedEventPhase,
} from 'scoped-event-bus/dist/types'

const SCOPE = "GenericAsset"

export default abstract class GenericAsset implements BaseAsset {
    /**
     * Available application scopes for resources inheriting GenericAsset.
     */
    static SCOPES = {
        BIOSIGNAL: 'sig',
        COMPONENT: 'cmp',
        DATASET: 'dat',
        DOCUMENT: 'doc',
        LOADER: 'ldr',
        PRESENTATION: 'prs',
        SERVICE: 'srv',
        UNKNOWN: 'unk',
        UTILITY: 'utl',
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
    protected _scope: string
    protected _type: string

    constructor (name: string, scope: string, type: string) {
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
        this._scope = GenericAsset.SCOPES.UNKNOWN
        for (const validScope of Object.values(GenericAsset.SCOPES)) {
            if (validScope === scope) {
                this._scope = scope
                break
            }
        }
        this._type = type
        this._name = name
    }

    get id () {
        return this._id
    }
    get isActive () {
        return this._isActive
    }
    set isActive (value: boolean) {
        this._setPropertyValue('isActive', value, value ? AssetEvent.ACTIVATE : AssetEvent.DEACTIVATE)
        this.onPropertyUpdate('is-active')
    }
    get name () {
        return this._name
    }
    set name (value: string) {
        if (!value) {
            return
        }
        this._setPropertyValue('name', value, AssetEvent.RENAME)
    }
    get scope () {
        return this._scope
    }
    set scope (value: string) {
        this._setPropertyValue('scope', value)
        this.onPropertyUpdate('scope')
    }
    get type () {
        return this._type
    }
    set type (value: string) {
        this._setPropertyValue('type', value)
        this.onPropertyUpdate('type')
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
        const propKey = String(property)
        const protectedKey = `_${propKey}` as keyof this
        if (propKey.startsWith('_') || this[protectedKey] === undefined) {
            // Only allow setting public property values not starting with an underscore to prevent meddling with
            // properties from the prototype or infinite call stacks when trying to use an explicit setter.
            Log.error(
                `_setPropertyValue only supports setting public property values; ` +
                `'${propKey}' is not a valid property name.`, SCOPE)
            return
        }
        const prevValue = this[protectedKey]
        if (!this.dispatchPropertyChangeEvent(propKey, newValue, prevValue, 'before', event)) {
            Log.debug(`Setting new value for property '${propKey}' was prevented.`, SCOPE)
            return
        }
        this[protectedKey] = newValue as this[keyof this]
        this.dispatchPropertyChangeEvent(propKey, newValue, prevValue, 'after', event)
    }

    addEventListener (
        event: string | string[],
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

    dispatchPropertyChangeEvent (
        property: string,
        newValue: unknown,
        oldValue: unknown,
        phase: ScopedEventPhase = 'after',
        event?: string,
    ) {
        const updateDetails = {
            name: property,
            newValue: newValue,
            oldValue: oldValue,
        }
        return this.dispatchEvent(event || `property-change:${property}`, phase, updateDetails)
    }

    getEventHooks (event: string, subscriber: string) {
        return this._eventBus.getEventHooks(event, subscriber, this.id)
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
        event: string | string[],
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
        event: string | string[],
        callback: ScopedEventCallback,
        subscriber: string,
        phase: ScopedEventPhase = 'after'
    ) {
        return this._eventBus.subscribe(event, callback, subscriber, this.id, phase)
    }

    unsubscribe (
        event: string | string[],
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
