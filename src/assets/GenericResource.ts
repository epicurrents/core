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
import { Log } from 'scoped-ts-log'

const SCOPE = 'GenericResource'

export default abstract class GenericResource extends GenericAsset implements DataResource {
    protected _dependenciesMissing = [] as string[]
    protected _dependenciesReady = [] as string[]
    protected _errorReason = ''
    /** Is this record selected as active in the UI. */
    protected _loaded = false
    protected _source: StudyContext | null = null
    protected _state: ResourceState = 'added'

    constructor (name: string, scope: string, type: string, source?: StudyContext) {
        super(name, scope, type)
        if (source) {
            this._source = source
        }
    }

    get dependenciesMissing () {
        return this._dependenciesMissing
    }
    set dependenciesMissing (value: string[]) {
        this._dependenciesMissing = value
        this.onPropertyUpdate('dependencies-missing')
    }
    get dependenciesReady () {
        return this._dependenciesMissing
    }
    set dependenciesReady (value: string[]) {
        this._dependenciesReady = value
        this.onPropertyUpdate('dependencies-ready')
    }
    get errorReason () {
        return this._errorReason
    }
    set errorReason (value: string) {
        const prevValue = this._errorReason
        this._errorReason = value
        this.onPropertyUpdate('error-reason', value, prevValue)
    }
    get isReady () {
        return this._dependenciesMissing.length === 0 && this._state === 'ready'
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
        if (prevState === 'error' && value !== 'error') {
            // Reset error message if state changes from error into something else.
            this._errorReason = ''
        }
        this.onPropertyUpdate('state', value, prevState)
    }

    addDependencies (...dependencies: string[]) {
        const prevCount = this._dependenciesMissing.length
        this._dependenciesMissing.push(...dependencies)
        this.onPropertyUpdate('dependencies-missing')
        if (!prevCount && this._state === 'ready') {
            // This resource is no longer ready to be used.
            this.onPropertyUpdate('is-ready')
        }
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
    removeDependencies (...dependencies: string[]): string[] {
        const removed = [] as string[]
        dep_loop:
        for (const dep of dependencies) {
            for (let i=0; i<this._dependenciesMissing.length; i++) {
                if (this._dependenciesMissing[i] === dep) {
                    removed.push(...this._dependenciesMissing.splice(i, 1))
                    continue dep_loop
                }
            }
            Log.warn(`Depedency '${dep}' was not found in missing dependencies.`, SCOPE)
        }
        this.onPropertyUpdate('dependencies-missing')
        if (!this._dependenciesMissing.length && this._state === 'ready') {
            // Notify listeners that this recording is ready to use.
            this.onPropertyUpdate('is-ready')
        }
        return removed
    }
    setDependenciesReady (...dependencies: string[]) {
        this._dependenciesReady.push(...this.removeDependencies(...dependencies))
        this.onPropertyUpdate('dependencies-ready')
    }
    async unload () {
        // Override this in a child class.
        return Promise.resolve()
    }
}
