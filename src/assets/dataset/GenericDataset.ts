/**
 * Generic dataset.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericResource from '#assets/GenericResource'
import type { DataResource, TaskResponse } from '#types/application'
import type {
    ConnectorWriteFileOptions,
    DatabaseConnector,
    DatasourceConnector,
    FileSystemConnector,
} from '#types/connector'
import type {
    BaseDataset,
    DatasetResourceContext,
    ResourceSortingInstructions,
    ResourceSortingScheme
} from '#types/dataset'
import { Log } from 'scoped-event-log'
import { deepClone } from '#util'

const SCOPE = 'GenericDataset'

export default abstract class GenericDataset extends GenericResource implements BaseDataset {
    protected _connectorIn: DatasourceConnector | null
    protected _connectorOut: DatasourceConnector | null
    protected _outputConflictResolution: ConnectorWriteFileOptions = { overwrite: true }
    protected _resources: DatasetResourceContext[] = []
    protected _resourceSorting: ResourceSortingInstructions
    /**
     * Create a new dataset with the given properties.
     * @param name - Name of the dataset.
     * @param connector - Optional data source connector for the dataset.
     * @param sortingScheme - Optional sorting scheme for resources in this dataset.
     * @param modality - Optional modality for the dataset (defaults to 'dataset').
     */
    constructor (
        name: string,
        connectors?: {
            input?: DatasourceConnector
            output?: DatasourceConnector
        },
        sortingScheme?: ResourceSortingScheme,
        modality?: string
    ) {
        super(name, modality || 'dataset')
        this._connectorIn = connectors?.input || null
        this._connectorOut = connectors?.output || null
        if (!this._app) {
            Log.warn(`Application instance not available in dataset constructor.`, SCOPE)
        } else if (this._fsConnectorIn?.mode.includes('r')) {
            // Add possible resources already present in the data source.
            this._fsConnectorIn.listContents().then(async response => {
                if (!response) {
                    Log.warn(`Could not list contents of input data source for dataset ${this._name}.`, SCOPE)
                } else if (response.files.length) {
                    for (const file of response.files) {
                        if (!file.name || !file.url) {
                            Log.warn(`Data source file is missing name or url, skipping.`, SCOPE)
                            continue
                        }
                        const nameParams = file.name.split('.')
                        // Expect name to contain study type and file format.
                        const studyType = nameParams[nameParams.length - 2]
                        const fileFormat = nameParams[nameParams.length - 1]
                        // Attempt to load the resource.
                        const study = await this._app!.loadStudy(
                            `${studyType}/${fileFormat}-file`,
                            file.url,
                            {
                                name: file.name,
                                authHeader: this._connectorIn!.authHeader || undefined,
                                dataset: this,
                            }
                        )
                        if (!study) {
                            Log.error(`Failed to load study from file ${file.name}.`, SCOPE)
                        }
                    }
                }
            })
        } else if (this._dbConnectorIn) {
            this._dbConnectorIn.listContents().then(async response => {
                if (Array.isArray(response)) {
                    for (const ctx of response) {
                        if (!ctx.name || !ctx.api || !ctx.modality) {
                            Log.warn(`Data source context is missing required parameters, skipping.`, SCOPE)
                            continue
                        }
                        // Attempt to load the resource.
                        const study = await this._app!.loadStudy(
                            `${ctx.modality}/api-url`,
                            ctx.api.url,
                            {
                                ...ctx,
                                authHeader: this._connectorIn!.authHeader || undefined,
                                dataset: this,
                            }
                        )
                        if (!study) {
                            Log.error(`Failed to load study from API item ${ctx.name}.`, SCOPE)
                        }
                    }
                } else {
                    Log.warn(`No contents found in input data source for dataset ${this._name}.`, SCOPE)
                }
            })
        }
        this._resourceSorting = {
            order: [],
            scheme: sortingScheme || 'id',
        }
    }

    /** Returns the input connector if it is a `database` connector, `null` otherwise. */
    protected get _dbConnectorIn (): DatabaseConnector | null {
        if (this._connectorIn?.type === 'database') {
            return this._connectorIn as DatabaseConnector
        }
        return null
    }
    /** Returns the output connector if it is a `database` connector, `null` otherwise. */
    protected get _dbConnectorOut (): DatabaseConnector | null {
        if (this._connectorOut?.type === 'database') {
            return this._connectorOut as DatabaseConnector
        }
        return null
    }

    /** Returns the input connector if it is a `filesystem` connector, `null` otherwise. */
    protected get _fsConnectorIn (): FileSystemConnector | null {
        if (this._connectorIn?.type === 'filesystem') {
            return this._connectorIn as FileSystemConnector
        }
        return null
    }
    /** Returns the output connector if it is a `filesystem` connector, `null` otherwise. */
    protected get _fsConnectorOut (): FileSystemConnector | null {
        if (this._connectorOut?.type === 'filesystem') {
            return this._connectorOut as FileSystemConnector
        }
        return null
    }

    get activeResources () {
        const activeResources: DataResource[] = []
        for (const rCtx of this._resources) {
            if (rCtx.resource.isActive) {
                // Add active child resource if set, otherwise the resource itself.
                activeResources.push(rCtx.resource.activeChildResource || rCtx.resource)
            }
        }
        return activeResources
    }

    get hasInputSource () {
        return this._connectorIn !== null
    }

    get hasOutputSource () {
        return this._connectorOut !== null
    }

    get resources () {
        return this._resources
    }
    set resources (value: DatasetResourceContext[]) {
        this._setPropertyValue('resources', value)
    }

    get resourceSorting () {
        return this._resourceSorting
    }
    get sortedResources () {
        const mapped = new Map<string, DatasetResourceContext[]>()
        if (this._resourceSorting.scheme === 'alphabetical') {
            const sorted = this._resources.sort((a, b) => {
                const aName = a.name || a.resource.name
                const bName = b.name || b.resource.name
                return aName.localeCompare(bName)
            })
            for (const r of sorted) {
                const name = r.name || r.resource.name
                if (!name || r.hidden) {
                    continue
                }
                const initial = name.toLocaleUpperCase().substring(0, 1)
                const existing = mapped.get(initial)
                if (existing) {
                    existing.push(r)
                } else {
                    mapped.set(initial, [r])
                }
            }
        } else if (this._resourceSorting.scheme === 'id') {
            const sorted = this._resourceSorting.order.length ? [...this._resources].sort(
                                (a, b) => this._resourceSorting.order.indexOf(a.resource.id)
                                        - this._resourceSorting.order.indexOf(b.resource.id)
                                )
                            // Defaults to inserted order.
                            : this._resources
            for (const r of sorted) {
                mapped.set(r.resource.id, [r])
            }
        } else if (this._resourceSorting.scheme === 'modality') {
            for (const rCtx of this._resourceSorting.order) {
                mapped.set(rCtx, this._resources.filter(r => r.resource.modality === rCtx))
            }
        }
        return mapped
    }

    addResource (context: DatasetResourceContext) {
        for (const existing of this._resources) {
            if (existing.resource.id === context.resource.id) {
                Log.debug(`Did not add a pre-existing resource to dataset resources.`, SCOPE)
                return
            }
        }
        this.dispatchPayloadEvent('add-resource', context, 'before')
        const prevState = [...this.resources]
        this._resources.push(context)
        if (this._resourceSorting.scheme === 'id') {
            this._resourceSorting.order.push(context.resource.id)
        }
        this.dispatchPayloadEvent('add-resource', context, 'after')
        Log.debug(`Added ${context.resource.name} to dataset resources.`, SCOPE)
        // Also dispatch a property change event.
        this.dispatchPropertyChangeEvent('resources', this.resources, prevState)
    }

    async destroy () {
        await this.unload()
        super.destroy()
    }

    getResourcesByModality (...modalities: string[]) {
        const matching = [] as DataResource[]
        for (const ctx of this._resources) {
            if (modalities.includes(ctx.resource.modality)) {
                matching.push(ctx.resource)
            }
        }
        return matching
    }

    removeResource (resource: DataResource | string | number) {
        const resourceIdx = typeof resource === 'number'
                            ? resource
                            : typeof resource === 'string'
                              ? this._resources.filter(r => r.resource.id === resource).map((_r, idx) => idx)[0]
                              : this._resources.filter(r => r.resource.id === resource.id).map((_r, idx) => idx)[0]
        if (resourceIdx === undefined) {
            Log.error(`Could not remove given resource from dataset: ther resource was not found.`, SCOPE)
            return null
        }
        this.dispatchPayloadEvent('remove-resource', this._resources[resourceIdx], 'before')
        const prevState = [...this.resources]
        const removed = this._resources.splice(resourceIdx, 1)[0]
        if (this._resourceSorting.scheme === 'id') {
            this._resourceSorting.order.splice(this._resourceSorting.order.indexOf(removed.resource.id), 1)
        }
        this.dispatchPayloadEvent('remove-resource', removed, 'after')
        Log.debug(`Removed ${removed.resource.name} from dataset resources.`, SCOPE)
        // Also dispatch a property change event.
        this.dispatchPropertyChangeEvent('resources', this.resources, prevState)
        // Unload the removed resource.
        removed.resource.unload()
        return removed
    }

    setOutputConflictResolution (options: ConnectorWriteFileOptions) {
        this._outputConflictResolution = options
    }

    setResourceSorting (value: ResourceSortingInstructions) {
        this._setPropertyValue('resourceSorting', value)
    }

    setResourceSortingOrder (value: string[]) {
        if (this._resourceSorting.scheme === 'alphabetical') {
            Log.warn(`Cannot set a custom resource sorting order if sorting scheme is 'alphabetical'.`, SCOPE)
            return
        }
        const prevState = deepClone(this.resourceSorting)
        this._resourceSorting.order = value
        this.dispatchPropertyChangeEvent('resourceSorting', this.resourceSorting, prevState)
    }

    setResourceSortingScheme (scheme: ResourceSortingScheme) {
        if (scheme === this._resourceSorting.scheme) {
            Log.debug(`Resource sorting scheme is identical to currently asctive scheme.`, SCOPE)
            return
        }
        const prevState = deepClone(this.resourceSorting)
        this.dispatchPropertyChangeEvent('resourceSorting', this.resourceSorting, prevState, 'before')
        this._resourceSorting.scheme = scheme
        this._resourceSorting.order = []
        this.dispatchPropertyChangeEvent('resourceSorting', this.resourceSorting, prevState)
    }

    async unload () {
        for (let i=0; i<this._resources.length;) {
            const removed = this.removeResource(0)
            await removed?.resource.destroy()
        }
        Log.debug(`Dataset ${this._name} and associated resources unloaded.`, SCOPE)
    }

    async writeToOutputDataSource (path: string, data: Blob | string): Promise<TaskResponse> {
        if (!this._fsConnectorOut || !this._fsConnectorOut.mode.includes('w')) {
            Log.error(`Cannot write to data source: no writable connector defined.`, SCOPE)
            return {
                success: false,
                message: 'Cannot write to data source: no writable connector defined.'
            }
        }
        const content = typeof data === 'string' ? data : await data.arrayBuffer()
        return this._fsConnectorOut.writeFile(path, content, this._outputConflictResolution)
    }
}
