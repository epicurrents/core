/**
 * Dataset types.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BaseAsset, DataResource } from "./assets"
import { FileSystemItem } from "./loader"
import { StudyContext } from "./study"

/**
 * Base type for all datasets.
 */
export interface BaseDataset extends BaseAsset {
    /** List of dataset resources that have been marked active. */
    activeResources: BaseAsset[]
    /** Credentials nneded to access the dataset source. */
    credentials: null | DatasetCredentials
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
     */
    addResource (resource: DataResource): void
    /**
     * Get all resources in the given context(s).
     * Returned resources are ordered according to the `resourceSorting` property.
     * @param contexts - The context(s) to include.
     */
    getResourcesByContext (...contexts: string[]): DataResource[]
    /**
     * Get all resources with the given type(s).
     * Returned resources are ordered according to the `resourceSorting` property.
     * @param types - The type(s) to include.
     */
    getResourcesByType (...types: string[]): DataResource[]
    /**
     * Remove the given resource from this dataset. Removal will **not** automatically destroy the resource.
     * @param resource - Either the resource object *or* the ID of the resource *or* its index within the resource array (in adding order).
     */
    removeResource (resource: DataResource | string | number): void
    /**
     * Set credentials to use when loading data from the dataset resources.
     * *Not yet implemented*.
     * @param username - Username to use for authentication.
     * @param password - Password to use for authentication.
     */
    setCredentials (username: string, password: string): void
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
}
/**
 * Credentials for authenticating to a data server.
 */
export type DatasetCredentials = {
    password: string
    username: string
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
export interface MediaDataset extends BaseDataset, DataResource  {
    /** Resources added to this dataset. */
    resources: DataResource[]
    /**
     * Add a new media resource into the dataset.
     * @param resource - The resource to add.
     */
    addResource (resource: DataResource): void
    /**
     * Remove a resource from this dataset.
     * @param resource - The resource to remove, its id, or its index in this dataset's array of `resources`.
     */
    removeResource (resource: string | number | DataResource): void
}
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
 * - `context` - Resources are primarily sorted according to their `context` in the order property
 *               and secondarily by the order in which they were inserted into the dataset.
 * - `id` - Resources are sorted in the order of their `id`s in the `order` property.
 * - `type` - Resources are sorted primarily by order of `type` names in the `order` property
 *            and secondarily by the order in which they were inserted into the dataset.
 */
export type ResourceSortingScheme = 'alphabetical' | 'context' | 'id' | 'type'

