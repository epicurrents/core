/**
 * Generic resource.
 * This class serves only as as superclass for more specific resource classes.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import type {
    AnnotationLabel,
    DataResource,
    ResourceState,
} from '#types/application'
import type { StudyContext } from '#types/study'
import { Log } from 'scoped-event-log'
import { ResourceEvents } from '#events'

const SCOPE = 'GenericResource'

export default abstract class GenericResource extends GenericAsset implements DataResource {
    /**
     * Core events emitted by this resource (not including property change events).
     */
    static readonly EVENTS = { ...GenericAsset.EVENTS, ...ResourceEvents }

    /**
     * Create a resource from its serialized representation. Not all resource types support deserialization.
     * @param _serialized - A serialized object presenting a resource.
     * @returns The deserialized resource instance, or null if deserialization fails or is not supported.
     */
    static readonly fromSerialized = (_serialized: Partial<GenericResource>): GenericResource | null => {
        Log.error('GenericResource cannot be deserialized directly. Use a subclass instead.', SCOPE)
        return null
    }

    protected _activeChildResource: DataResource | null = null
    protected _childResources: DataResource[] = []
    protected _datasetId: string | null = null
    protected _dependenciesMissing: string[] = []
    protected _dependenciesReady: string[] = []
    protected _errorReason = ''
    protected _labels: AnnotationLabel[] = []
    /** Is this record selected as active in the UI. */
    protected _loaded = false
    protected _source: StudyContext | null = null
    protected _state: ResourceState = 'added'

    constructor (name: string, modality: string, source?: StudyContext) {
        super(name, modality)
        if (source) {
            this._source = source
            // TODO: Implement meta property handling in all resource classes.
            if (source.meta?.datasetId) {
                this._datasetId = source.meta.datasetId as string
            }
        }
    }

    get activeChildResource () {
        return this._activeChildResource
    }
    set activeChildResource (value: DataResource | null) {
        this._setPropertyValue('activeChildResource', value)
    }
    get childResources () {
        return this._childResources
    }
    set childResources (value: DataResource[]) {
        this._setPropertyValue('childResources', value)
    }
    get datasetId () {
        return this._datasetId
    }
    set datasetId (value: string | null) {
        this._setPropertyValue('datasetId', value)
    }
    get dependenciesMissing () {
        return this._dependenciesMissing
    }
    set dependenciesMissing (value: string[]) {
        this._setPropertyValue('dependenciesMissing', value)
    }
    get dependenciesReady () {
        return this._dependenciesReady
    }
    set dependenciesReady (value: string[]) {
        this._setPropertyValue('dependenciesReady', value)
    }
    get errorReason () {
        return this._errorReason
    }
    set errorReason (value: string) {
        this._setPropertyValue('errorReason', value)
    }
    get isReady () {
        return this._dependenciesMissing.length === 0 && this._state === 'ready'
    }
    get labels () {
        return this._labels
    }
    set labels (value: AnnotationLabel[]) {
        for (const newLabel of value) {
            if (!newLabel.id) {
                newLabel.id = GenericResource.CreateUniqueId()
            }
        }
        this._setPropertyValue('labels', value)
    }
    get source () {
        return this._source
    }
    set source (value: StudyContext | null) {
        this._setPropertyValue('source', value)
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
    }

    addDependencies (...dependencies: string[]) {
        // This action may change the resource from being ready to not being ready.
        const wasReady = this.isReady
        this._setPropertyValue('dependenciesMissing', [...this._dependenciesMissing, ...dependencies])
        if (wasReady) {
            this.dispatchPropertyChangeEvent('isReady', this.isReady, wasReady)
        }
    }

    destroy () {
        this._dependenciesMissing.length = 0
        this._dependenciesReady.length = 0
        this._errorReason = ''
        this._loaded = false
        this._source = null
        super.destroy()
        this.state = 'destroyed'
    }

    getMainProperties () {
        // Override this in a child class.
        const props = new Map()
        // Show universal state-related information.
        if (this.state === 'error') {
            props.set(this._errorReason, null)
        } else if (this.state === 'added') {
            props.set('Waiting to load...', null)
        } else if (this.state === 'loading') {
            props.set('Loading details...', null)
        } else if (this.state === 'loaded') {
            props.set('Initializing...', null)
        } else if (this.state === 'ready') {
            // Dependencies may still be loading.
            if (this._dependenciesMissing.length > 0) {
                const totalDeps = this._dependenciesMissing.length + this._dependenciesReady.length
                props.set(
                    'Loading dependency {n}/{t}...',
                    {
                        n: totalDeps - this._dependenciesMissing.length + 1,
                        t: totalDeps,
                    }
                )
            }
        }
        return props
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
        if (wasReady !== this.isReady) {
            // Notify listeners that this recording is ready to use.
            this.dispatchPropertyChangeEvent('isReady', this.isReady, wasReady)
        }
        return removed
    }
    setDependenciesReady (...dependencies: string[]) {
        const depsReady = this.removeDependencies(...dependencies)
        this._setPropertyValue('dependenciesReady', [...this._dependenciesReady, ...depsReady])
    }
    async unload () {
        // Override this in a child class.
    }
}
