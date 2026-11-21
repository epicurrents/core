/**
 * Generic resource.
 * This class serves only as as superclass for more specific resource classes.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import type { AnnotationLabel, DataResource, MainProperty, ResourceListing } from '#types/application'
import type { ConfigStudyLoader } from '#types/config'
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
    protected _labels: AnnotationLabel[] = []
    /** What the resource was listed with, kept after loading so an unloaded resource can be loaded again. */
    protected _listing: ResourceListing | null = null
    /** Is this record selected as active in the UI. */
    protected _loaded = false
    /** The load in progress, shared by every call to `load` made while it runs. */
    protected _loadRun: Promise<boolean> | null = null
    protected _source: StudyContext | null = null

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
    get isListed () {
        return this._listing !== null && this._state === 'added'
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

    /**
     * Leave the resource in `error`, keeping a reason the load already gave.
     */
    protected _failLoad (reason: string) {
        if (!this._errorReason) {
            this._errorReason = reason
        }
        if ((this._state as string) !== 'error') {
            this.state = 'error'
        }
    }

    /**
     * Finish the setup of a resource whose source study is in `_source`. A module fills this with what a resource
     * needs only once it is opened: its worker, its service and their setup, and any check that depends on them.
     * Resolve true once the resource is ready; resolving false or throwing leaves it in `error`. The default prepares
     * the resource, which is all a resource created complete needs.
     * @param options - Options to load with.
     * @returns Promise resolving true on success.
     */
    protected async _load (options?: ConfigStudyLoader): Promise<boolean> {
        return this.prepare(options)
    }

    /**
     * Run one load: read the study of a listed resource that has none, then finish the setup through `_load`.
     */
    protected async _runLoad (options?: ConfigStudyLoader): Promise<boolean> {
        const loadOptions = { ...this._listing?.options, ...options }
        try {
            this.state = 'loading'
            if (!this._source && this._listing) {
                const study = await this._listing.readStudy()
                if (this._state === 'destroyed') {
                    return false
                }
                if (!study) {
                    this._failLoad('Reading the study failed')
                    return false
                }
                if (study.meta?.datasetId) {
                    this._datasetId = study.meta.datasetId as string
                }
                this.source = study
            }
            const loaded = await this._load(loadOptions)
            // The state is read back rather than narrowed: `_load` may destroy the resource or fail it itself.
            const state = this._state as string
            if (state === 'destroyed') {
                return false
            }
            if (!loaded || state === 'error') {
                this._failLoad('Loading the study failed')
                return false
            }
            if (state !== 'ready') {
                this.state = 'ready'
            }
            return true
        } catch (e) {
            Log.error(`Loading resource ${this.name} failed.`, SCOPE, e as Error)
            if ((this._state as string) !== 'destroyed') {
                this._failLoad('Loading the study failed')
            }
            return false
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

    async awaitDeactivation () {
        // No deferred teardown by default; subclasses that release on deactivation override this.
    }

    destroy () {
        this._dependenciesMissing.length = 0
        this._dependenciesReady.length = 0
        this._errorReason = ''
        this._listing = null
        this._loaded = false
        this._loadRun = null
        this._source = null
        super.destroy()
    }

    getMainProperties () {
        // Override this in a child class.
        // Typed to the interface's own return rather than left to infer from the first `set`. An
        // untyped map is `Map<any, any>`, which admits an entry of any shape at all — here and in
        // every subclass that builds on this one — so the declaration would stop describing what
        // the map holds with nothing reporting it.
        const props = new Map<string, MainProperty>()
        if (this.isListed && this._listing?.properties?.length) {
            return new Map(this._listing.properties)
        }
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
    load (options?: ConfigStudyLoader) {
        if (this._loadRun) {
            return this._loadRun
        }
        if (this._state === 'ready') {
            return Promise.resolve(true)
        }
        if (this._state === 'error' || this._state === 'destroyed') {
            return Promise.resolve(false)
        }
        // Held before the run starts: its first step dispatches the `loading` state synchronously, and a listener that
        // calls `load` from that dispatch has to find this load rather than start a second one.
        let settle = (_loaded: boolean) => {}
        const load = new Promise<boolean>(resolve => {
            settle = resolve
        })
        this._loadRun = load
        this._runLoad(options).then(settle, () => settle(false))
        // Cleared whatever the outcome, so an unloaded resource can be loaded again; a later load is guarded by state.
        load.then(() => {
            if (this._loadRun === load) {
                this._loadRun = null
            }
        })
        return load
    }
    async prepare (..._args: unknown[]) {
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
    setListing (listing: ResourceListing) {
        this._listing = listing
    }
    async unload () {
        // Override this in a child class.
    }
}
