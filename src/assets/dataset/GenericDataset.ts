/**
 * Generic dataset.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericResource from '#assets/GenericResource'
import type { DataResource } from '#types/application'
import type {
    BaseDataset,
    ResourceSortingInstructions,
    ResourceSortingScheme
} from '#types/dataset'
import { Log } from 'scoped-event-log'
import { deepClone } from '#util'

const SCOPE = 'GenericDataset'

export default abstract class GenericDataset extends GenericResource implements BaseDataset {
    protected _resources: DataResource[] = []
    protected _resourceSorting: ResourceSortingInstructions
    /**
     * Create a new dataset with the given properties.
     * @param name - Name of the dataset.
     * @param sortingScheme - Optional sorting scheme for resources in this dataset.
     * @param modality - Optional modality for the dataset (defaults to 'dataset').
     */
    constructor (name: string, sortingScheme?: ResourceSortingScheme, modality?: string) {
        super(name, modality || 'dataset')
        this._resourceSorting = {
            order: [],
            scheme: sortingScheme || 'id',
        }
    }

    get activeResources () {
        return this._resources.filter(r => r.isActive)
    }

    get resources () {
        return this._resources
    }
    set resources (value: DataResource[]) {
        this._setPropertyValue('resources', value)
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
        } else if (this._resourceSorting.scheme === 'modality') {
            for (const rCtx of this._resourceSorting.order) {
                mapped.set(rCtx, this._resources.filter(r => r.modality === rCtx))
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
        this.dispatchPayloadEvent('add-resource', resource, 'before')
        const prevState = [...this.resources]
        this._resources.push(resource)
        if (this._resourceSorting.scheme === 'id') {
            this._resourceSorting.order.push(resource.id)
        }
        this.dispatchPayloadEvent('add-resource', resource, 'after')
        Log.debug(`Added ${resource.name} to dataset resources.`, SCOPE)
        // Also dispatch a property change event.
        this.dispatchPropertyChangeEvent('resources', this.resources, prevState)
    }

    async destroy () {
        await this.unload()
        super.destroy()
    }

    getResourcesByModality (...modalities: string[]) {
        const matching = [] as DataResource[]
        for (const resource of this._resources) {
            if (modalities.includes(resource.modality)) {
                matching.push(resource)
            }
        }
        return matching
    }

    removeResource (resource: DataResource | string | number) {
        const resourceIdx = typeof resource === 'number'
                            ? resource
                            : typeof resource === 'string'
                              ? this._resources.filter(r => r.id === resource).map((_r, idx) => idx)[0]
                              : this._resources.filter(r => r.id === resource.id).map((_r, idx) => idx)[0]
        if (resourceIdx === undefined) {
            Log.error(`Could not remove given resource from dataset: ther resource was not found.`, SCOPE)
            return null
        }
        this.dispatchPayloadEvent('remove-resource', this._resources[resourceIdx], 'before')
        const prevState = [...this.resources]
        const removed = this._resources.splice(resourceIdx, 1)[0]
        if (this._resourceSorting.scheme === 'id') {
            this._resourceSorting.order.splice(this._resourceSorting.order.indexOf(removed.id), 1)
        }
        this.dispatchPayloadEvent('remove-resource', removed, 'after')
        Log.debug(`Removed ${removed.name} from dataset resources.`, SCOPE)
        // Also dispatch a property change event.
        this.dispatchPropertyChangeEvent('resources', this.resources, prevState)
        // Unload the removed resource.
        removed.unload()
        return removed
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
            await removed?.destroy()
        }
        Log.debug(`Dataset ${this._name} and associated resources unloaded.`, SCOPE)
    }
}
