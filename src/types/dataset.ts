/**
 * Dataset types.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BaseAsset, DataResource, MainProperty, TaskResponse } from './application'
import { ConfigStudyLoader } from './config'
import { ConnectorWriteFileOptions } from './connector'
import { FileSystemItem } from './reader'
import { StudyContext } from './study'

/**
 * Base type for all datasets.
 */
export interface BaseDataset extends BaseAsset {
    /** List of dataset resources that have been marked active. */
    activeResources: ReadonlyArray<DataResource>
    /** Does this dataset have an active input data source. */
    hasInputSource: boolean
    /** Does this dataset have an active output data source. */
    hasOutputSource: boolean
    /** Array of resources in this dataset. */
    resources: ReadonlyArray<DatasetResourceContext>
    /** Sorting scheme used to order the resources in `resources` array. */
    resourceSorting: ResourceSortingInstructions
    /**
     * Resources in this dataset sorted by the sorting scheme. Hidden resources are excluded.
     * @example
     * // alphabetical: Sorted alphabetically with the initial letter of the name serving as map key
     *    Map<initial, resource[]>
     * // id: Sorted by id as set in `order` or in the order they were inserted into the dataset if `order` is empty.
     *    Map<resource.id, [resource]>
     * // type: Sorted by type as set in `order` and secondarily by the order they were added into the dataset in.
     *    Map<resource.type, resource[]>
     */
    sortedResources: Map<string, DatasetResourceContext[]>
    /**
     * Add a new resource into this dataset.
     * @param resource - The resource to add.
     * @emits `add-resource` with the new resource as payload.
     */
    addResource (resource: DatasetResourceContext | DataResource): void
    /**
     * Destroy the dataset and all its resources.
     * @emits `destroy` with the dataset as payload.
     */
    destroy (): void | Promise<void>
    /**
     * Get all resources in the given modalit(y/ies).
     * Returned resources are ordered according to the `resourceSorting` property.
     * @param contexts - The modalit(y/ies) to include.
     */
    getResourcesByModality (...modality: string[]): DataResource[]
    /**
     * Remove the given resource from this dataset, returning it.
     * Removal will **not** automatically unload or destroy the resource.
     * @param resource - Either the resource object *or* the ID of the resource *or* its index within the resource array (in adding order).
     * @returns The removed resource or null on failure.
     * @emits `remove-resource` with the removed resource as payload.
     */
    removeResource (resource: DataResource | string | number): DatasetResourceContext | null
    /**
     * Put `next` in the place `previous` holds in this dataset: the same position in `resources` and in the sorting
     * order, with the active-state watch moved over. `previous` is not unloaded or destroyed.
     * @param previous - The resource to replace.
     * @param next - The resource to put in its place.
     * @returns The context now holding `next`, or null if `previous` is not in this dataset.
     * @emits `replace-resource` with `{ previous, next }` contexts as payload.
     */
    replaceResource (previous: DataResource, next: DataResource): DatasetResourceContext | null
    /**
     * Set the output conflict resolution strategy. This will determine what is done if a file of the same name already
     * exists on the output data source.
     * @param value - The conflict resolution strategy.
     */
    setOutputConflictResolution (value: ConnectorWriteFileOptions): void
    /**
     * Set instructions for resource sorting when retrieving them via the `resources` property or one of the getters.
     * @param sorting - new sorting instructions.
     */
    setResourceSorting (sorting: ResourceSortingInstructions): void
    /**
     * Set a new resource sorting order keeping the sorting scheme as is.
     * @param order - The new sorting order.
     */
    setResourceSortingOrder (order: string[]): void
    /**
     * Set a new scheme for resource sorting.
     *
     * **Note**: Also the resource sorting order is reset, so either add a new order immediately after or use the
     * `setResourceSorting` method instead.
     * @param scheme - New sorting scheme.
     */
    setResourceSortingScheme (scheme: ResourceSortingScheme): void
    /**
     * Unload and remove all the resources registered to this dataset.
     */
    unload (): Promise<void>
    /**
     * Write data to the output data source.
     * @param path - The path to the output data source.
     * @param data - The data to write.
     * @returns A promise that resolves to true if the write was successful, false otherwise.
     */
    writeToOutputDataSource (path: string, data: Blob | string): Promise<TaskResponse>
}
/**
 * A special loader type for loading the various studies within a dataset.
 */
export interface DatasetLoader {
    /**
     * Load the dataset returning each study via callback before continuing to the next one.
     * @param dir - The directory containing dataset files as a MixedFileSystemItem.
     * @param callback - Callback to pass the loaded studies back to caller.
     * @param config - Optional configuration.
     * @return A promise that fulfills when the dataset has been fully loaded.
     */
    loadDataset (dir: FileSystemItem, callback: (study: StudyContext) => Promise<void>, config?: unknown): Promise<void>
}
/**
 * A study listed in a dataset before it is loaded, and the instructions for loading it when it is opened.
 *
 * Loading reads the study from `source` with the importer named in `loader`, exactly as `loadStudy` would; nothing
 * here takes part in it except those two and `options`. `properties` are shown in listings until then and are never
 * read for loading, so whoever builds the descriptor decides whether the values are trustworthy enough to show.
 */
export type DeferredStudy = {
    /** Name of the study importer to load the study with. */
    loader: string
    /** Name to list the study under. */
    name: string
    /** URL(s) or file system item to load the study from. */
    source: string | string[] | File | FileSystemItem
    /** Modality to list the study under, if not the importer's resource modality. */
    modality?: string
    /**
     * Called with the loaded resource once it has taken the study's place in its dataset and finished preparing.
     * Errors are logged and do not undo the load.
     */
    onLoaded?: (resource: DataResource) => void | Promise<void>
    /** Options passed to the importer, as in `loadStudy`. */
    options?: ConfigStudyLoader
    /** Properties to show in listings before the study is loaded, as returned by `getMainProperties`. */
    properties?: [string, MainProperty][]
}
/** Context for a resource in the dataset. */
export type DatasetResourceContext = {
    /** The data resource. */
    resource: DataResource
    /** If true, hide the resource in listings. */
    hidden?: boolean
    /** Optional name to display instead of the resource name. */
    name?: string
}
/**
 * Dataset for holding media resources. These include signal recordings and traditional types of media.
 */
export interface MediaDataset extends BaseDataset, DataResource  {}
/**
 * Set of instructions for sorting resources within a dataset.
 */
export type ResourceSortingInstructions = {
    /**
     * Sorting order of the resources.
     * - If scheme is 'id' then order must contain resource `id`s in desired order.
     * - if scheme is 'context' or 'type' then order must contain valid `context`s or `type`s in desired order.
     */
    order: string[]
    /**
     * Scheme to apply when sorting resources. Defaults to 'alphabetical' if the `order` property is empty.
     */
    scheme: ResourceSortingScheme
}
/**
 * The scheme adding to which the resources are sorted.
 * - `alphabetical`- Sorting follows the alphabetical order of resource names.
 * - `id` - Resources are sorted in the order of their `id`s in the `order` property.
 * - `modality` - Resources are sorted primarily in the order of `modality` values in the `order` property
 *                and secondarily by the order in which they were inserted into the dataset.
 */
export type ResourceSortingScheme = 'alphabetical' | 'id' | 'modality'
