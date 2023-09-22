/**
 * Generic resource.
 * This class serves only as as superclass for more spesific resource classes.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { DataResource } from "TYPES/assets"
import GenericAsset from "ASSETS/GenericAsset"
import { StudyContext } from "TYPES/study"

//const SCOPE = 'GenericResource'

export default abstract class GenericResource extends GenericAsset implements DataResource {
    /** Is this record selected as active in the UI. */
    protected _active: boolean = false
    protected _loaded = false
    protected _source: StudyContext | null = null

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
    get isPrepared () {
        return this._loaded
    }
    set isPrepared (value: boolean) {
        this._loaded = value
        this.onPropertyUpdate('is-prepared')
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

    getMainProperties () {
        // Override this in a child class.
        return new Map<string, { [key: string]: string|number }|null>()
    }
    async prepare () {
        // Override this in a child class.
        this.isPrepared = true
        return true
    }
}