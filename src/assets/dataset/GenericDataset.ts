/**
 * Generic dataset.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type DataResource } from "#root/src/types/application"
import {
    type BaseDataset,
    type DatasetCredentials,
    type ResourceSortingInstructions,
    type ResourceSortingScheme
} from "#types/dataset"
import { Log } from "scoped-ts-log"
import GenericAsset from "../GenericAsset"

const SCOPE = 'GenericDataset'

export default abstract class GenericDataset extends GenericAsset implements BaseDataset {
    protected _credentials: null | DatasetCredentials = null
    protected _resources: DataResource[] = []
    protected _resourceSorting: ResourceSortingInstructions
    /**
     * Create a new dataset with the given properties.
     * @param name - Name of the dataset.
     * @param sortingScheme - Optional sorting scheme for resources in this dataset.
     * @param type - Optional type for the dataset (defaults to 'dataset').
     */
    constructor (name: string, sortingScheme?: ResourceSortingScheme, type?: string) {
        super(name, GenericAsset.SCOPES.DATASET, type || '')
        this._resourceSorting = {
            order: [],
            scheme: sortingScheme || 'id',
        }
    }

    get activeResources () {
        return this._resources.filter(r => r.isActive)
    }

    get credentials () {
        return this._credentials
    }

    get resources () {
        return this._resources
    }
    set resources (value: DataResource[]) {
        this._resources = value
        this.onPropertyUpdate('resources')
    }

    get resourceSorting () {
        return this._resourceSorting
    }
    get sortedResources () {
        const mapped = new Map<string, DataResource[]>()
        if (this._resourceSorting.scheme === 'alphabetical') {
            const sorted = [...this._resources].sort((a, b) => a.name.localeCompare(b.name))
            for (const r of sorted) {
                if (!r.name) {
                    continue
                }
                const initial = r.name.toLocaleUpperCase().substring(0, 1)
                const existing = mapped.get(initial)
                if (existing) {
                    existing.push(r)
                } else {
                    mapped.set(initial, [r])
                }
            }
        } else if (this._resourceSorting.scheme === 'context') {
            for (const rCtx of this._resourceSorting.order) {
                mapped.set(rCtx, this._resources.filter(r => r.scope === rCtx))

            }
        } else if (this._resourceSorting.scheme === 'id') {
            const sorted = this._resourceSorting.order.length ? [...this._resources].sort(
                                (a, b) => this._resourceSorting.order.indexOf(a.id)
                                        - this._resourceSorting.order.indexOf(b.id)
                                )
                            // Defaults to inserted order.
                            : this._resources
            for (const r of sorted) {
                mapped.set(r.id, [r])
            }
        } else if (this._resourceSorting.scheme === 'type') {
            for (const rType of this._resourceSorting.order) {
                mapped.set(rType, this._resources.filter(r => r.type === rType))

            }
        }
        return mapped
    }

    addResource (resource: DataResource) {
        for (const existing of this._resources) {
            if (existing.id === resource.id) {
                Log.debug(`Did not add a pre-existing resource to dataset resources.`, SCOPE)
                return
            }
        }
        this._resources.push(resource)
        if (this._resourceSorting.scheme === 'id') {
            this._resourceSorting.order.push(resource.id)
        }
        this.onPropertyUpdate('resources')
    }

    getResourcesByContext (...scopes: string[]) {
        const matching = [] as DataResource[]
        for (const resource of this._resources) {
            if (scopes.includes(resource.scope)) {
                matching.push(resource)
            }
        }
        return matching
    }

    getResourcesByType (...types: string[]) {
        const matching = [] as DataResource[]
        for (const resource of this._resources) {
            if (types.includes(resource.type)) {
                matching.push(resource)
            }
        }
        return matching
    }

    removeResource (resource: DataResource | string | number) {
        if (typeof resource === 'number') {
            if (!this._resources[resource]) {
                Log.warn(
                    `Could not remove dataset resource at index ${resource}, array index is out of bounds.`,
                    SCOPE
                )
                return
            }
            const removed = this._resources.splice(resource, 1)[0]
            if (this._resourceSorting.scheme === 'id') {
                this._resourceSorting.order.splice(this._resourceSorting.order.indexOf(removed.id), 1)
            }
            Log.debug(`Removed ${removed.name} from dataset resources.`, SCOPE)
        } else {
            for (let i=0; i<this._resources.length; i++) {
                const existing = this._resources[i]
                if (
                    typeof resource === 'string' && existing.id === resource ||
                    typeof resource === 'object' && resource.id === existing.id
                ) {
                    const removed = this._resources.splice(i, 1)[0]
                    if (this._resourceSorting.scheme === 'id') {
                        this._resourceSorting.order.splice(this._resourceSorting.order.indexOf(removed.id), 1)
                    }
                    Log.debug(`Removed ${removed.name} from dataset resources.`, SCOPE)
                    return
                }
            }
            Log.warn(`Could not find the given resource to remove from dataset.`, SCOPE)
        }
    }

    setCredentials (username: string, password: string) {
        this._credentials = {
            username: username,
            password: password,
        }
        this.onPropertyUpdate('credentials')
    }

    setResourceSorting (sorting: ResourceSortingInstructions) {
        this._resourceSorting = sorting
        this.onPropertyUpdate('resources')
    }

    setResourceSortingOrder (order: string[]) {
        if (this._resourceSorting.scheme === 'alphabetical') {
            Log.warn(`Cannot set a custom resource sorting order if sorting scheme is 'alphabetical'.`, SCOPE)
            return
        }
        this._resourceSorting.order = order
        this.onPropertyUpdate('resources')
    }

    setResourceSortingScheme (scheme: ResourceSortingScheme) {
        if (scheme === this._resourceSorting.scheme) {
            Log.debug(`Resource sorting scheme is identical to currently asctive scheme.`, SCOPE)
            return
        }
        this._resourceSorting.scheme = scheme
        this._resourceSorting.order = []
        this.onPropertyUpdate('resources')
    }
}
