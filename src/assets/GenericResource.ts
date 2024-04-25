/**
 * Generic resource.
 * This class serves only as as superclass for more spesific resource classes.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type DataResource, type ResourceState } from '#types/application'
import { type StudyContext } from '#types/study'
import GenericAsset from '#assets/GenericAsset'

//const SCOPE = 'GenericResource'

export default abstract class GenericResource extends GenericAsset implements DataResource {
    /** Is this record selected as active in the UI. */
    protected _active: boolean = false
    protected _loaded = false
    protected _source: StudyContext | null = null
    protected _state: ResourceState = 'added'

    constructor (name: string, scope: string, type: string, source?: StudyContext) {
        super(name, scope, type)
        if (source) {
            this._source = source
        }
    }
    
    get isActive () {
        return this._active
    }
    set isActive (value: boolean) {
        this._active = value
        this.onPropertyUpdate('is-active')
    }
    get isReady () {
        return this._state === 'ready'
    }
    get scope () {
        return this._scope
    }
    set scope (value: string) {
        this._scope = value
    }
    get source () {
        return this._source
    }
    set source (value: StudyContext | null) {
        this._source = value
        this.onPropertyUpdate('source')
    }
    get state () {
        return this._state
    }
    set state (value: ResourceState) {
        const prevState = this._state
        this._state = value
        this.onPropertyUpdate('state', value, prevState)
    }

    getMainProperties () {
        // Override this in a child class.
        return new Map()
    }
    async prepare () {
        // Override this in a child class.
        this.state = 'ready'
        return true
    }
    async unload () {
        // Override this in a child class.
        return Promise.resolve()
    }
}
