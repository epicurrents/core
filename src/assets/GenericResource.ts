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
    /**
     * The `errorReason` listeners last heard of. A reason written to `_errorReason` directly differs from it, which is
     * how a failed load knows the reason still has to be announced.
     */
    protected _errorReasonAnnounced = ''
    protected _labels: AnnotationLabel[] = []
    /** What the resource was listed with, kept after loading so an unloaded resource can be loaded again. */
    protected _listing: ResourceListing | null = null
    /** Is this record selected as active in the UI. */
    protected _loaded = false
    /**
     * Identifies the current load run. `_supersedeLoad` moves it on, so a run that started under an earlier value has
     * been superseded; `_isLoadSuperseded` is the check.
     */
    protected _loadGeneration = 0
    /** The load in progress, shared by every call to `load` made while it runs. */
    protected _loadRun: Promise<boolean> | null = null
    /** The resource holding this one among its `childResources`, so a child destroyed on its own leaves that list. */
    protected _parentResource: GenericResource | null = null
    /**
     * Set while `retryLoad` releases what the failed attempt left behind. The release goes through `unload`, which
     * supersedes the load in progress; under this flag that leaves the retry itself standing.
     */
    protected _releasingFailedLoad = false
    /** The retry in progress, shared by every call to `retryLoad` and `load` made while it runs. */
    protected _retryRun: Promise<boolean> | null = null
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
    get canRetryLoad () {
        return this._state === 'error' && (this._listing !== null || this._source !== null)
    }
    get childResources () {
        return this._childResources
    }
    set childResources (value: DataResource[]) {
        const previous = [...this._childResources]
        this._setPropertyValue('childResources', value)
        for (const child of previous) {
            if (
                child instanceof GenericResource && child._parentResource === this
                && !this._childResources.includes(child)
            ) {
                child._parentResource = null
            }
        }
        for (const child of this._childResources) {
            if (child instanceof GenericResource) {
                child._parentResource = this
            }
        }
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
        super.errorReason = value
        this._errorReasonAnnounced = this._errorReason
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
     * Leave the resource in `error`, keeping a reason the load already gave. The reason is announced with a property
     * change before the state is, whether it is given here or was written to `_errorReason` directly during the load,
     * so a listener of either finds the other in place.
     */
    protected _failLoad (reason: string) {
        if (!this._errorReason) {
            this._errorReason = reason
        }
        if (this._errorReason !== this._errorReasonAnnounced) {
            const announced = this._errorReasonAnnounced
            this._errorReasonAnnounced = this._errorReason
            this.dispatchPropertyChangeEvent('errorReason', this._errorReason, announced)
        }
        if ((this._state as string) !== 'error') {
            this.state = 'error'
        }
    }

    /**
     * Has the load run that started under `generation` been superseded: the resource was unloaded or destroyed while
     * the run was awaiting something. `_runLoad` checks after the study read and around `_load`; a `_load` that awaits
     * more than once reads `_loadGeneration` before its first await and checks after each, resolving false without
     * setting anything more up on a resource that has been released under it.
     * @param generation - The value of `_loadGeneration` read when the run started.
     * @returns True if the run must stop without touching the resource.
     */
    protected _isLoadSuperseded (generation: number) {
        return generation !== this._loadGeneration || this._state === 'destroyed'
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
     * Release what a failed load, or a setup that failed after it, left on the resource, so that `_load` can run again
     * from the `_source` and the listing the resource keeps. The default unloads the resource, which is where a module
     * releases what it holds; a subclass whose `unload` keeps something a fresh load must not find, such as a service
     * whose worker is in an unknown state, overrides this, calls `super` and lets that go as well. It is called with
     * the resource in `loading`, and must leave `_source` and `_listing` alone.
     */
    protected async _releaseFailedLoad (): Promise<void> {
        await this.unload()
    }

    /**
     * Run one load: read the study of a listed resource that has none, then finish the setup through `_load`. A run
     * superseded by an unload or a destroy resolves false and leaves the state to whatever superseded it.
     */
    protected async _runLoad (options?: ConfigStudyLoader): Promise<boolean> {
        const generation = this._loadGeneration
        const loadOptions = { ...this._listing?.options, ...options }
        try {
            this._errorReasonAnnounced = this._errorReason
            // A retry has announced `loading` already.
            if (this._state !== 'loading') {
                this.state = 'loading'
            }
            if (!this._source && this._listing) {
                const study = await this._listing.readStudy()
                if (this._isLoadSuperseded(generation)) {
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
            // Checked on the path without a read as well: a listener of the `loading` state runs before this line and
            // may have unloaded or destroyed the resource.
            if (this._isLoadSuperseded(generation)) {
                return false
            }
            const loaded = await this._load(loadOptions)
            if (this._isLoadSuperseded(generation)) {
                return false
            }
            // The state is read back rather than narrowed: `_load` may fail the resource itself.
            const state = this._state as string
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
            if (!this._isLoadSuperseded(generation)) {
                this._failLoad('Loading the study failed')
            }
            return false
        }
    }

    /**
     * Run one retry: let go of what the failed attempt left behind, then load. The reason is cleared and `loading`
     * announced before the release is awaited, so the resource never reads as listed, or as failed, while the retry
     * is under way.
     */
    protected async _runRetry (options?: ConfigStudyLoader): Promise<boolean> {
        const reason = this._errorReason
        this._errorReason = ''
        this._errorReasonAnnounced = ''
        if (reason) {
            this.dispatchPropertyChangeEvent('errorReason', '', reason)
        }
        this.state = 'loading'
        this._releasingFailedLoad = true
        try {
            // A teardown started by a deactivation is releasing the same buffers.
            await this.awaitDeactivation()
            await this._releaseFailedLoad()
        } catch (e) {
            Log.error(`Releasing the failed load of ${this.name} failed.`, SCOPE, e as Error)
        } finally {
            this._releasingFailedLoad = false
        }
        // Whatever state the release left is `_startLoad`'s to answer: a resource destroyed meanwhile resolves false.
        return this._startLoad(options)
    }

    /**
     * Start a load run, or join the one in progress; see `load`, which answers with a retry in progress first.
     */
    protected _startLoad (options?: ConfigStudyLoader) {
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

    /**
     * Supersede the load in progress, if there is one: its run stops at its next check, and the next `load` starts a
     * run of its own. `unload` and `destroy` call this first. A subclass whose `unload` or `destroy` awaits before it
     * reaches `super` calls it before that await, or the run finishes its setup on a resource being released. A retry
     * in progress is superseded with its load, except by the unload the retry itself runs to release the failed
     * attempt.
     */
    protected _supersedeLoad () {
        this._loadGeneration++
        this._loadRun = null
        if (!this._releasingFailedLoad) {
            this._retryRun = null
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
        this._supersedeLoad()
        // A child destroyed on its own leaves its parent's list; a parent being destroyed has let go of it already.
        const parent = this._parentResource
        this._parentResource = null
        if (parent && parent._state !== 'destroyed') {
            if (parent._activeChildResource === this) {
                parent.activeChildResource = null
            }
            if (parent._childResources.includes(this)) {
                parent.childResources = parent._childResources.filter(child => child !== this)
            }
        }
        // Children belong to the resource they are listed under.
        const children = this._childResources
        this._activeChildResource = null
        this._childResources = []
        for (const child of children) {
            if (child instanceof GenericResource && child._parentResource === this) {
                child._parentResource = null
            }
            if (child.state === 'destroyed') {
                continue
            }
            try {
                Promise.resolve(child.destroy()).catch((e: unknown) => {
                    Log.error(`Destroying child resource ${child.name} of ${this.name} failed.`, SCOPE, e as Error)
                })
            } catch (e) {
                Log.error(`Destroying child resource ${child.name} of ${this.name} failed.`, SCOPE, e as Error)
            }
        }
        this._dependenciesMissing.length = 0
        this._dependenciesReady.length = 0
        this._errorReason = ''
        this._listing = null
        this._loaded = false
        this._loadRun = null
        this._retryRun = null
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
        // A retry in progress is the load in progress.
        return this._retryRun ?? this._startLoad(options)
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
    retryLoad (options?: ConfigStudyLoader) {
        if (this._retryRun) {
            return this._retryRun
        }
        if (this._state !== 'error') {
            return this.load(options)
        }
        if (!this.canRetryLoad) {
            return Promise.resolve(false)
        }
        // Held before the run starts, for the reason given in `_startLoad`: the run's first step dispatches.
        let settle = (_loaded: boolean) => {}
        const retry = new Promise<boolean>(resolve => {
            settle = resolve
        })
        this._retryRun = retry
        this._runRetry(options).then(settle, () => settle(false))
        retry.then(() => {
            if (this._retryRun === retry) {
                this._retryRun = null
            }
        })
        return retry
    }
    setDependenciesReady (...dependencies: string[]) {
        const depsReady = this.removeDependencies(...dependencies)
        this._setPropertyValue('dependenciesReady', [...this._dependenciesReady, ...depsReady])
    }
    setListing (listing: ResourceListing) {
        this._listing = listing
    }
    async unload () {
        // A subclass releases what it holds and calls this first, before anything it awaits. An interrupted load
        // leaves nothing set up, so the state goes back to where a load can start again.
        const wasLoading = this._loadRun !== null
        this._supersedeLoad()
        if (wasLoading && this._state === 'loading') {
            this.state = 'added'
        }
    }
}
