/**
 * Generic asset.
 * This is the root class that all other classes extend.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import EventBus from '#events/EventBus'
import { deepClone, safeObjectFrom } from '#util'
import { Log } from 'scoped-event-log'
import { AssetEvents } from '#events/EventTypes'
import type {
    AssetState,
    BaseAsset,
    EpicurrentsApp,
    PropertyChangeHandler,
} from '#types/application'
import type { ConfigSchema, ResourceConfig } from '#types/config'
import type { EventWithPayload, PropertyChangeEvent } from '#types/event'
import type {
    ScopedEventBus,
    ScopedEventCallback,
    ScopedEventPhase,
} from 'scoped-event-bus/dist/types'

/**
 * Configuration schema for generic asset.
 */
const CONFIG_SCHEMA = {
    context: 'generic_asset',
    fields: [
        // Properties that can be modified with an external config.
        {
            name: 'modality',
            type: 'string',
        },
        {
            name: 'name',
            type: 'string',
        },
    ],
    name: 'Generic asset configuration',
    type: 'epicurrents_configuration',
    // Since this is the root schema, it must have the highest (= most recent) version.
    version: '1.0',
} as ConfigSchema

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
    protected _app: EpicurrentsApp | null = null
    protected _configSchema: null | ConfigSchema = null
    protected _errorReason = ''
    protected _eventBus: ScopedEventBus
    protected _id: string
    protected _isActive: boolean = false
    protected _modality: string
    protected _name: string
    protected _state: AssetState = 'added'

    constructor (name: string, modality: string) {
        // Make sure that reference to the global __EPICURRENTS__ object exists.
        if (typeof window === 'undefined') {
            Log.error(`Tried to create an asset outside of a browser environment.`, SCOPE)
        } else if (typeof window.__EPICURRENTS__ === 'undefined') {
            Log.error(
                `Reference to global __EPICURRENTS__ object was not found. ` +
                `Main application instance must be created before creating assets.`,
                SCOPE
            )
        } else if (!window.__EPICURRENTS__.APP || !window.__EPICURRENTS__.EVENT_BUS) {
            Log.error(`An Epicurrents application must be instantiated before creating assets.`, SCOPE)
        } else {
            this._app = window.__EPICURRENTS__.APP
            this._eventBus = window.__EPICURRENTS__.EVENT_BUS
        }
        this._eventBus ??= new EventBus()
        this._id = GenericAsset.CreateUniqueId()
        this._modality = modality
        this._name = name
        // Dispatch asset created event.
        setTimeout(() => this.dispatchEvent(AssetEvents.CREATE), 1)
    }

    get errorReason () {
        return this._errorReason
    }
    set errorReason (value: string) {
        this._setPropertyValue('errorReason', value)
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
    get state () {
        return this._state
    }
    set state (value: AssetState) {
        const prevState = this._state
        this._setPropertyValue('state', value)
        if (prevState === 'error' && value !== 'error') {
            // Reset error message if state changes from error into something else.
            this._errorReason = ''
        }
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    /**
     * Merge the given config `schema` with this resource's schema. This method validates all fields in the schema,
     * avoiding possible errors when applying a config.
     * @param schema - Config schema to merge with this resource.
     * @param resource - Optional resource to use for property name validation. If not provided, this resource is used.
     */
    protected _mergeConfigSchema (schema: ConfigSchema, resource?: BaseAsset) {
        // Check schema version compatibility.
        const [major, minor] = schema.version.split('.').map(n => parseInt(n))
        const [thisMaj, thisMin] = CONFIG_SCHEMA.version.split('.').map(n => parseInt(n))
        if (major !== thisMaj || minor > thisMin) {
            Log.error(
                `Config schema version mismatch: expected '${CONFIG_SCHEMA.version}', ` +
                `but received '${schema.version}'.`,
                SCOPE
            )
            return
        }
        const target = (resource ?? this) as typeof this
        const localSchema = deepClone(safeObjectFrom(schema)) // Avoid modifying the original schema.
        if (!localSchema) {
            Log.error(`Config schema is not a serializable object.`, SCOPE)
            return
        }
        for (let i=0; i<localSchema.fields.length; i++) {
            const field = localSchema.fields[i]
            if (field.type === 'schema') {
                // Nested schemas should have been extracted from the config, they cannot be processed here.
                Log.warn(`Config schema error: field '${field.name}' is a nested schema.`, SCOPE)
                localSchema.fields.splice(i, 1)
                i--
                continue
            }
            // Check if the field is a public property of this resource, protected properties are not configurable.
            if (field.name.startsWith('_')) {
                Log.warn(
                    `Config schema error: field '${field.name}' is a protected property and cannot be configured.`,
                    SCOPE
                )
                localSchema.fields.splice(i, 1)
                i--
                continue
            }
            // The field must have a setter to be configurable.
            const propertySetter = Object.getOwnPropertyDescriptor(target, field.name)?.set
            if (!propertySetter) {
                Log.warn(
                    `Config schema error: property '${field.name}' is not configurable on ` +
                    `'${target.constructor.name}'.`,
                    SCOPE
                )
                localSchema.fields.splice(i, 1)
                i--
                continue
            }
            // Add the field to the config schema.
            CONFIG_SCHEMA.fields.push(field)
        }
    }

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

    configure (config: ResourceConfig, schema?: ConfigSchema, resource?: BaseAsset) {
        if (schema) {
            this._mergeConfigSchema(schema, resource)
        }
        const target = (resource ?? this) as typeof this
        if (!target._configSchema) {
            Log.error(`Config schema is not defined for ${target.constructor.name}.`, SCOPE)
            return
        }
        if (!config.hasOwnProperty('type') || config.type !== 'epicurrents_configuration') {
            Log.error(`Config type is not 'epicurrents_configuration'.`, SCOPE)
            return
        }
        for (const [key, value] of Object.entries(config) as [string, unknown][]) {
            // Validate the config against the schema.
            const field = target._configSchema.fields.find(f => f.name === key)
            if (field === undefined) {
                Log.warn(`Config field '${key}' is not defined in the config schema.`, SCOPE)
                continue
            }
            const fieldTypes = Array.isArray(field.type) ? field.type : [field.type] as string[]
            if (
                // Date fields are strings in the config.
                (field.type !== 'date' || typeof value !== 'string') &&
                // Otherwise the value type must match the field type.
                !fieldTypes.includes(typeof value)
            ) {
                Log.warn(
                    `Config field '${key}' must be of type '${fieldTypes.join('/')}', ` +
                    `but received type '${typeof value}'.`,
                    SCOPE
                )
                continue
            }
            // Only allow setting public property values (this also catches prototype injections).
            if (key.startsWith('_')) {
                Log.warn(`Config field '${key}' is a protected property and cannot be configured.`, SCOPE)
                continue
            }
            // The property must have a setter or it isn't configurable.
            const propertySetter = Object.getOwnPropertyDescriptor(target, key)?.set
            if (!propertySetter) {
                Log.warn(`Property '${key}' is not configurable on '${target.name}'.`, SCOPE)
                continue
            }
            propertySetter(value as BaseAsset[keyof BaseAsset])
        }
    }

    destroy () {
        // Deactivate the asset and remove all event listeners afterwards.
        if (this._isActive) {
            this.isActive = false
        }
        this.removeAllEventListeners()
        this.dispatchEvent(GenericAsset.EVENTS.DESTROY)
        this.state = 'destroyed'
        // Event bus reference is kept until the end of the destroy process to allow event dispatching.
        this._eventBus = null as unknown as ScopedEventBus
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
        newValue?: T,
        oldValue?: T,
        phase: ScopedEventPhase = 'after',
        event?: string,
    ) {
        const detail = {
            property: property,
            newValue: newValue !== undefined ? newValue : this[property],
            oldValue: oldValue !== undefined ? oldValue : this[property],
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

    serialize () {
        return {
            id: this.id,
            modality: this.modality,
            name: this.name,
        } as Record<string, unknown>
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
