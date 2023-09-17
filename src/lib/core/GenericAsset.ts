/**
 * Generic asset.
 * This is the root class that all other classes extend.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type BaseAsset, type EpiCurrentsApplication } from "TYPES/core"
import Log from 'scoped-ts-log'
import { safeObjectFrom } from 'LIB/util/general'

const SCOPE = "GenericAsset"

export default abstract class GenericAsset implements BaseAsset {
    /**
     * Reference to the root EpiCurrents application must be added to this array before any assets are created.
     */
    public static INSTANCES = [] as EpiCurrentsApplication[]
    public static SCOPES = safeObjectFrom({
        BIOSIGNAL: 'sig',
        COMPONENT: 'cmp',
        DATASET: 'dat',
        DOCUMENT: 'doc',
        PRESENTATION: 'prs',
        SERVICE: 'srv',
        UNKNOWN: 'unk',
    })
    /**
     * This will be automatically populated with a reference to the application instance.
     * @remarks
     * A window is not supposet to contain multiple instances of the application,
     * so this should always point to the correct instance. That said, this is an
     * incredibly hacky solution and should be improved somehow.
     */
    protected _app = GenericAsset.INSTANCES[0]
    protected _id: string
    protected _isActive: boolean = false
    protected _name: string
    protected _propertyUpdateHandlers: {
        caller: string | null
        handler: (newValue?: any, oldValue?: any) => any
        pattern: RegExp
        property: string
    }[] = []
    protected _scope: string
    protected _type: string

    constructor (name: string, scope: string, type: string) {
        if (!GenericAsset.INSTANCES.length) {
            Log.error(`Base instance of the application has not been added to the static property INSTANCES. ` +
                      `Application will not work correctly!`, SCOPE)
        }
        this._id = Math.random().toString(36).substring(2, 10)
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
        this._isActive = value
        this.onPropertyUpdate('is-active')
    }
    get name () {
        return this._name
    }
    get scope () {
        return this._scope
    }
    set scope (value: string) {
        this._scope = value
        this.onPropertyUpdate('scope')
    }
    get type () {
        return this._type
    }
    set type (value: string) {
        this._type = value
        this.onPropertyUpdate('type')
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    addPropertyUpdateHandler (property: string, handler: (value?: any) => any, caller?: string) {
        for (const update of this._propertyUpdateHandlers) {
            if (property === update.property && handler === update.handler) {
                // Don't add the same handler twice
                return
            }
        }
        this._propertyUpdateHandlers.push({
            caller: caller || null,
            handler: handler,
            pattern: new RegExp(`^${property}$`, 'i'),
            property: property,
        })
        Log.debug(`Added a handler for ${property}.`, SCOPE)
    }

    onPropertyUpdate (property: string, newValue?: any, oldValue?: any) {
        for (const update of this._propertyUpdateHandlers) {
            if (update.property === property || property.match(update.pattern)) {
                Log.debug(`Executing ${property} handler${update.caller ? ' for ' + update.caller : ''}.`, SCOPE)
                update.handler(newValue, oldValue)
            }
        }
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

    removePropertyUpdateHandler (property: string, handler: () => any) {
        for (let i=0; i<this._propertyUpdateHandlers.length; i++) {
            const update = this._propertyUpdateHandlers[i]
            if (property === update.property && handler === update.handler) {
                this._propertyUpdateHandlers.splice(i, 1)
                Log.debug(`Removed ${property} handler${update.caller ? ' for '+ update.caller : ''}.`, SCOPE)
                return
            }
        }
        Log.debug(`Cound not locate the requsted ${property} handler.`, SCOPE)
    }
}
