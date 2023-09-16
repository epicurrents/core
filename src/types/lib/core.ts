/**
 * Core types.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { AppSettings, BaseModuleSettings, SettingsColor } from "../config"
import { DatasetLoader, MediaDataset } from "./dataset"
import { FileSystemItem, LoaderMode } from "./loader"
import { BiosignalPlot } from "./plot"
import { AssetService } from "./service"
import { OrderedLoadingProtocol, StudyContext, StudyLoader } from "./study"

/**
 * The most basic type defining properties that must exist in every asset.
 */
export interface BaseAsset {
    /** Unique id (generated automatically). */
    id: string
    /** Is this asset selected as active. */
    isActive: boolean
    /* Below fields are given proper descriptions in sub-interfaces */
    name: string
    /** Application scope that this asset belongs to. */
    scope: string
    /** Specific type (or modality) of the resource. */
    type: string
    /**
     * Add and update handler for the given `property`.
     * @param property - Name of the property (in kebab-case).
     * @param handler - Handler to fire when the property changes.
     * @param caller - Optional ID for the caller.
     */
    addPropertyUpdateHandler (property: string, handler: (newValue?: any, oldValue?: any) => any, caller?: string): void
    /**
     * Fire all property update handlers attached to the given property.
     * @param property - Property that was updated.
     * @param newValue - Optional new value of the property to pass to the handler.
     * @param oldValue - Optional previous value of the property to pass to the handler.
     */
    onPropertyUpdate (property: string, newValue?: any, oldValue?: any): void
    /**
     * Remove all property update handlers from this asset.
     */
    removeAllPropertyUpdateHandlers (): void
    /**
     * Remove all property update handlers registered for the given `caller`.
     * @param caller - ID of the caller.
     */
    removeAllPropertyUpdateHandlersFor (caller: string): void
    /**
     * Remove an update handler from the given `property`.
     * @param property - Name of the property (in kebab-case).
     * @param handler - Handler to remove.
     */
    removePropertyUpdateHandler (property: string, handler: () => any): void
}
/**
 * DataResource is the most basic scope of resource containing biomedical or media data.
 * It defines all the properties that should be accessible even when the specific resource type is not known.
 */
 export interface DataResource extends BaseAsset {
    /** Is the metadata (necessary properties) for this resource loaded. */
    isPrepared: boolean
    /**
     * General scope of this resource.
     * @remarks
     * Scope refers to the gneral modality of the resource, such as
     * *biosignal*, *radiology* or *multimedia*.
     */
    scope: string
    /** Source study for this resource. */
    source: StudyContext | null
    /**
     * Get the main properties of this resource as a map of
     * <labelString, stringParams>.
     * @remarks
     * This method should only return the most important properties
     * defining this resource, such as duration, channel count,
     * number of images/pages or similar. The properties are meant
     * to be used alongside resource names as key attributes.
     */
    getMainProperties (): Map<string, { [key: string]: string|number }|null>
    /**
     * Prepare this resource for use. This includes steps like loading
     * the necessary metadata etc.
     * @param args - Possible parameters to use in preparation.
     * @returns true on success, false otherwise
     */
    prepare (...args: any[]): Promise<boolean>
}
/**
 * The main EpiCurrents application.
 */
export interface EpiCurrentsApplication {
    /**
     * Add a resource to the active dataset.
     * @param resource - The resource to add.
     * @param scope - Optional resource scope (defaults to the value of the resource's type property).
     */
    addResource (resource: DataResource, scope?: string): void
    getFileWorkerSource (name: string): (() => Worker) | undefined
}
/**
 * A modular interface for the main application.
 */
export interface InterfaceModule {
    isReady: boolean
    awaitReady (): Promise<boolean>
    displayUI (): void
    fullscreenChange ():  void
    registerModule (name: string, mod: InterfaceResourceModuleContext): void
    registerService (name: string, service: AssetService): void
}
/**
 * Resource module properties for an application interface.
 */
export type InterfaceResourceModule = RuntimeResourceModule & {
    getViewerComponent (): any
}
/**
 * Context for the interface resource module.
 */
export type InterfaceResourceModuleContext = {
    /** Properties to override in the main application runtime. */
    runtime: InterfaceResourceModule
    /** Actions for an action-mutation state manager. */
    actions?: SafeObject // TODO: Better typing.
    /** Mutations for an action-mutation state manager. */
    mutations?: SafeObject // TODO: Better typing.
}
/**
 * Common definition for an interface module constructor.
 */
export interface InterfaceModuleConstructor {
    new (
        epicvApp: EpiCurrentsApplication,
        state?: StateManager,
        containerId?: string,
        appId?: string,
        locale?: string,
        modules?: string[],
    ): InterfaceModule
}
/**
 * A service that is managed by the application memory manager.
 */
export type ManagedService = {
    /**
     * The range of indices this loader occupies in the buffer.
     * @example
     * [start (included), end (excluded)]
     */
    bufferRange: number[]
    /**
     * Loaders that this loader depends on. When a loader is used, both
     * its and all of its dependencies' last used timestamps are updated.
     *
     * #### Example:
     * Loader-B is dependent on Loader-A as a data source. Loader-B will
     * have Loader-A as it's dependency, so its source will not be
     * removed from cache just because it hasn't been directly accessed.
     */
    dependencies: ManagedService[]
    /** Timestamp of the last time this loader was used. */
    lastUsed: number
    /** The actual service instance. */
    service: AssetService
}
/**
 * The memory manager is responsible for managing the master buffer and
 * allocating parts of it to loaders as needed. The most recently used
 * loaders are kept in the buffer and least recently used ones removed
 * if memory needs to be freed.
 *
 * Since the buffer is used to store typed 32-bit numbers, all memory values
 * are presented in 32-bit units (except for the initial size of the master
 * buffer given at the time of instance creation).
 */
export interface MemoryManager {
    /** The shared array buffer used as master buffer by this manager. */
    buffer: SharedArrayBuffer
    /** Size of the allocated buffer (in 32-bit units). */
    bufferSize: number
    /** The amount of memory (in 32-bit units) not yet allocated. */
    freeMemory: number
    /**The amount of memory (in 32-bit units) allocated to services.*/
    memoryUsed: number
    /** All the services managed by this manager. */
    services: AssetService[]
    /**
     * Attempt to allocate the given `amount` to the given `loaders`.
     * Will try to free up space if not enough is available.
     * @param amount - Amount of memory to allocate (in 32-bit units).
     * @param service - The service to allocate the memory to.
     * @return An object holding the reserved range's start and end or null if unsuccessful.
     */
    allocate (amount: number, service: AssetService): Promise<{ start: number, end: number } | null>
    /**
     * Free memory by given amount.
     * @param amount - Amount of memory to free (in 32-bit units).
     */
    freeBy (amount: number): void
    /**
     * Get the manged service with the given `id`.
     * @param id - ID of the service.
     * @return Matching service or null if not found.
     */
    getService (id: string): AssetService | null
    /**
     * Remove the given loader, releasing its memory in the process.
     * @param service - Either the service to remove or its id.
     */
    release (service: AssetService | string): void
    /**
     * Remove the given ranges from the manager's buffer.
     * @param ranges - Array of ranges to remove as [start, end].
     */
    removeFromBuffer (...ranges: number[][]): Promise<void>
    /**
     * Update the last used manager.
     * @param manager - New last used manager.
     */
    updateLastUsed (loader: ManagedService): void
}
/**
 * Supported mouse interactions in the UI.
 */
export type MouseInteraction = 'drag'
/**
 * Module containing the required runtime and settings properties for a given resource type.
 */
export type ResourceModule = {
    runtime: RuntimeResourceModule
    settings: BaseModuleSettings
}
/**
 * This is the main application runtime module, which has a unique structure.
 */
export type RuntimeAppModule = SafeObject & {
    activeDataset: MediaDataset | null
    activeScope: string
    activeType: string
    containerId: string
    datasets: MediaDataset[]
    /** List of file worker as <name, source-url>. */
    fileWorkerSources: Map<string, () => Worker>,
    id: string
    isFullscreen: boolean
    moduleName: {
        code: string
        full: string
        short: string
    }
    /** List of available plots as <name, plot-instance|null>. */
    plots: Map<string, BiosignalPlot | null>
    runningId: number
    settingsOpen: boolean
    showOverlay: boolean
    studyLoaders: Map<string, StudyLoaderContext>
    studyLoadProtocols: Map<string, StudyLoadProtocolContext>
    userSettings: {
        [setting: string]: string
    }
}

export type RuntimeResourceModule = SafeObject & {
    moduleName: {
        code: string
        full: string
        short: string
    }
    /**
     * Set the given property to its new value, notifying watchers.
     * @param property - Name of the property on kebab-case.
     * @param value - The new value for the property.
     * @param resource - The resource to alter (optional).
     * @param state - Instance for the main runtime state manger (optional).
     * @returns unknown
     */
    setPropertyValue (property: string, value: unknown, resource?: DataResource, state?: StateManager): unknown
}

/**
 * The main runtime state of the application.
 */
export type RuntimeState = SafeObject & {
    APP: RuntimeAppModule
} & {
    MODULES: Map<string, RuntimeResourceModule>
    SERVICES: Map<string, AssetService>
    SETTINGS: AppSettings
}
/**
 * An object with the property (pointer) __propto__ removed. This will prevent using the object
 * in prototype pollution attacks.
 */
export type SafeObject = {
    __proto__: null
}
export type SafeObjectMap = Omit<{ [name: string]: any }, "__proto__"> & SafeObject
/**
 * Statemanager is the instance that manages application runtime state.
 * In addition to the actual modules, it also includes shorthands for
 * core APP properties and methods for altering MODULES and SERVICES.
 */
export interface StateManager {
    /** Core app state. */
    APP: RuntimeAppModule
    /** States of dynamically loaded modules. */
    MODULES: Map<string, RuntimeResourceModule>
    /** States of dynamically loaded services. */
    SERVICES: Map<string, AssetService>
    /** Application settings. */
    SETTINGS: AppSettings
    /** Id of the container housing the application. */
    containerId: string
    /** Is the applciation in full-screen mode. */
    isFullscreen: boolean
    /**
     * Are the settings open. Setecting a settings closed can be used to trigger reloading and applying
     * any changes in settings.
     */
    settingsOpen: boolean
    /** Should an overlay (for picking up mouse events) be displayed over the application. */
    showOverlay: boolean
    /**
     * Add a new dataset to the list of datasets.
     * @param dataset - New dataset to add.
     * @param setAsActive - Optionally set the new dataset as active (default false).
     */
    addDataset (dataset: MediaDataset, setAsActive?: boolean): void
    /**
     * Add and update handler for the given `property`.
     * @param property - Name of the property/properties (in kebab-case).
     * @param handler - Handler to fire when the property changes.
     * @param caller - Optional ID for the caller.
     */
    addPropertyUpdateHandler (property: string | string[], handler: (newValue?: unknown, oldValue?: unknown) => any, caller?: string): void
    /**
     * Add a new `resource` into the given `scope`.
     * @param scope - Scope of the new resoure.
     * @param resource - The resource to add.
     * @param setAsActive - Should the new resource be set as active (default false).
     */
    addResource (scope: string, resource: DataResource, setAsActive?: boolean): void
    /**
     * Get the service with the given name.
     * @param name - Name of the service.
     * @returns Service or null, if not found
     */
    getService (name: string): AssetService | undefined
    /**
     * Initialize the app runtime instance.
     * @param initValues - Optional values as an object of { field: value } pairs (eg. { appId: 'app', SETTINGS: { 'eeg.trace.margin.top': 10 } })
     */
    init (initValues?: { [module: string]: any }): void
    /**
     * Load a dataset from the given `folder`.
     * @param folder - The folder containing the dataset.
     * @param loader - Loader to use for the dataset.
     * @param studyLoaders - Set of study loaders for the studies in the dataset.
     * @param config - Additional configuration (TODO: Config definitions).
     */
    loadDatasetFolder (folder: FileSystemItem, loader: DatasetLoader, studyLoaders: StudyLoader[], config?: any): Promise<MediaDataset>
    /**
     * Remove all property update handlers from this asset.
     */
    removeAllPropertyUpdateHandlers (): void
    /**
     * Remove all property update handlers registered for the given `caller`.
     * @param caller - ID of the caller.
     */
    removeAllPropertyUpdateHandlersFor (caller: string): void
    /**
     * Remove an update handler from the given `property`.
     * @param property - Name of the property/properties (in kebab-case).
     * @param handler - Handler to remove.
     */
    removePropertyUpdateHandler (property: string | string[], handler: (newValue?: unknown, oldValue?: unknown) => any): void
    /**
     * Set the given dataset as active.
     * @param dataset - New active dataset.
     */
    setActiveDataset (dataset: MediaDataset | null): void
    /**
     * Set the given resource active.
     * @param resource - Resource to set as active.
     * @param deactivateOthers - Deactivate other active resources before activating this (default true). This method can also be used to deactivate other resources while only leaving the given `resource` active.
     * @returns
     */
    setActiveResource (resource: DataResource | null, deactivateOthers?: boolean): void
    /**
     * Set the given scope as active.
     * @param scope - The new active scope.
     */
    setActiveScope (scope: string): void
    /**
     * Set the given type as active.
     * @param value - New active type.
     */
    setActiveType (value: string): void
    /**
     * Set the value of a property in one of the loaded modules.
     * @param module - Name of the module.
     * @param property - Property name in kebab-case.
     * @param value - The new value for the property.
     */
    setModulePropertyValue (module: string, property: string, value: unknown): void
    /**
     * Set a service to the given `name`.
     * @param name - Name of the service.
     * @param service - New value for the service.
     */
    setService (name: string, service: AssetService | null): void
    /**
     * Set a new value to the given SETTINGS field calling the
     * appropriate handlers afterwards.
     * @param field - Name or path of the field.
     * @param value - The new value.
     */
    setSettingsValue (field: string, value: string | number | boolean | SettingsColor | Object): void
}
/**
 * Context for a study loader.
 */
export type StudyLoaderContext = {
    /** Label for the loader (to be displayed in the UI). */
    label: string
    /** Mode to use (file, folder). */
    mode: LoaderMode
    /** The loader itself. */
    loader: StudyLoader
    /** Study scopes supported by this loader. */
    scopes: string[]
    /** Study tyles supported by this loader. */
    types: string[]
}
/**
 * Context for a study load protocol.
 */
export type StudyLoadProtocolContext = {
    /** Label for the protocol (to be displayed in the UI). */
    label: string
    /** Mode to use (file, folder). */
    mode: LoaderMode
    /** The protocol itself. */
    protocol: OrderedLoadingProtocol
    /** Study scopes supported by this loader. */
    scopes: string[]
    /** Study tyles supported by this loader. */
    types: string[]
}
