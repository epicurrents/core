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

    constructor (name: string, context: string, type: string, source?: StudyContext) {
        super(name, context, type)
        if (source) {
            this._source = source
        }
    }

    get dependenciesMissing () {
        return this._dependenciesMissing
    }
    set dependenciesMissing (value: string[]) {
        this._setPropertyValue('dependenciesMissing', value)
        this.onPropertyUpdate('dependencies-missing') // TODO: Deprecated.
    }
    get dependenciesReady () {
        return this._dependenciesMissing
    }
    set dependenciesReady (value: string[]) {
        this._setPropertyValue('dependenciesReady', value)
        this.onPropertyUpdate('dependencies-ready') // TODO: Deprecated.
    }
    get errorReason () {
        return this._errorReason
    }
    set errorReason (value: string) {
        const prevValue = this._errorReason
        this._setPropertyValue('errorReason', value)
        this.onPropertyUpdate('error-reason', value, prevValue) // TODO: Deprecated.
    }
    get isReady () {
        return this._dependenciesMissing.length === 0 && this._state === 'ready'
    }
    get source () {
        return this._source
    }
    set source (value: StudyContext | null) {
        this._setPropertyValue('source', value)
        this.onPropertyUpdate('source') // TODO: Deprecated.
    }
    get state () {
        return this._state
    }
    set state (value: ResourceState) {
        const prevState = this._state
        this._setPropertyValue('state', value)
        if (prevState === 'error' && value !== 'error') {
            // Reset error message if state changes from error into something else.
            this._errorReason = ''
        }
        this.onPropertyUpdate('state', value, prevState) // TODO: Deprecated.
    }

    addDependencies (...dependencies: string[]) {
        // This action may change the resource from being ready to not being ready.
        const wasReady = this.isReady
        this._setPropertyValue('dependenciesMissing', [...this._dependenciesMissing, ...dependencies])
        this.onPropertyUpdate('dependencies-missing') // TODO: Deprecated.
        if (wasReady) {
            this.dispatchPropertyChangeEvent('isReady', this.isReady, wasReady)
            this.onPropertyUpdate('is-ready') // TODO: Deprecated.
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
        const newList = [...this._dependenciesMissing]
        const wasReady = this.isReady
        dep_loop:
        for (const dep of dependencies) {
            for (let i=0; i<newList.length; i++) {
                if (newList[i] === dep) {
                    removed.push(...newList.splice(i, 1))
                    continue dep_loop
                }
            }
            Log.warn(`Depedency '${dep}' was not found when removing dependencies.`, SCOPE)
        }
        this._setPropertyValue('dependenciesMissing', newList)
        this.onPropertyUpdate('dependencies-missing') // TODO: Deprecated.
        if (wasReady !== this.isReady) {
            // Notify listeners that this recording is ready to use.
            this.dispatchPropertyChangeEvent('isReady', this.isReady, wasReady)
            this.onPropertyUpdate('is-ready') // TODO: Deprecated.
        }
        return removed
    }
    setDependenciesReady (...dependencies: string[]) {
        const depsReady = this.removeDependencies(...dependencies)
        this._setPropertyValue('dependenciesReady', [...this._dependenciesReady, ...depsReady])
        this.onPropertyUpdate('dependencies-ready') // TODO: Deprecated.
    }
    async unload () {
        // Override this in a child class.
        return Promise.resolve()
    }
}
