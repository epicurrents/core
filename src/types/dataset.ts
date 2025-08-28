/**
 * Dataset types.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BaseAsset, DataResource } from './application'
import { ConnectorWriteFileOptions } from './connector'
import { FileSystemItem } from './reader'
import { StudyContext } from './study'

/**
 * Base type for all datasets.
 */
export interface BaseDataset extends BaseAsset {
    /** List of dataset resources that have been marked active. */
    activeResources: BaseAsset[]
    /** Does this dataset have an active input data source. */
    hasInputSource: boolean
    /** Does this dataset have an active output data source. */
    hasOutputSource: boolean
    /** Array of resources in this dataset. */
    resources: DataResource[]
    /** Sorting scheme used to order the resources in `resources` array. */
    resourceSorting: ResourceSortingInstructions
    /**
     * Resources in this dataset sorted by the sorting scheme.
     * @example
     * // alphabetical: Sorted alphabetically with the initial letter of the name serving as map key
     *    Map<initial, resource[]>
     * // id: Sorted by id as set in `order` or in the order they were inserted into the dataset if `order` is empty.
     *    Map<resource.id, [resource]>
     * // type: Sorted by type as set in `order` and secondarily by the order they were added into the dataset in.
     *    Map<resource.type, resource[]>
     */
    sortedResources: Map<string, DataResource[]>
    /**
     * Add a new resource into this dataset.
     * @param resource - The resource to add.
     * @emits `add-resource` with the new resource as payload.
     */
    addResource (resource: DataResource): void
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
    removeResource (resource: DataResource | string | number): DataResource | null
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
    writeToOutputDataSource (path: string, data: Blob | string): Promise<boolean>
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
