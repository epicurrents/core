/**
 * Asset types. Asset is the root type of all classes and resources used in EpiCurrents.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    AppSettings,
    BaseModuleSettings,
    SettingsValue,
} from './config'
import { DatasetLoader, MediaDataset } from './dataset'
import { FileSystemItem, ReaderMode } from './reader'
import { OnnxService } from './onnx'
import { BiosignalPlot } from './plot'
import { AssetService } from './service'
import {
    StudyContext,
    StudyLoaderProtocolContext,
    StudyLoader,
    StudyLoaderContext,
} from './study'
import { Modify } from './util'

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
    addPropertyUpdateHandler (property: string, handler: PropertyUpdateHandler, caller?: string): void
    /**
     * Fire all property update handlers attached to the given property.
     * @param property - Property that was updated.
     * @param newValue - Optional new value of the property to pass to the handler.
     * @param oldValue - Optional previous value of the property to pass to the handler.
     */
    onPropertyUpdate (property: string, newValue?: unknown, oldValue?: unknown): void
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
    removePropertyUpdateHandler (property: string, handler: PropertyUpdateHandler): void
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
    prepare (...args: unknown[]): Promise<boolean>
}
/**
 * The main EpiCurrents application.
 */
export interface EpiCurrentsApp {
    /**
     * Path where public assets (mostly javascript) are served from.
     */
    publicPath: string
    /**
     * Runtime state of this application instance.
     */
    state: RuntimeState
    /**
     * Does the application instance use a memory manager. A memory manager requires
     * SharedArrayBuffer to be available.
     */
    useMemoryManager: boolean
    /**
     * Add a resource to the active dataset.
     * @param resource - The resource to add.
     * @param scope - Optional resource scope (defaults to the value of the resource's type property).
     */
    addResource (resource: DataResource, scope?: string): void
    /**
     * Modify the default configuration before the app is launched.
     * After launching the app, use setSettingsValue() instead.
     * @param config - Field and value pairs to modify.
     * @example
     * EpiCurrents.configure(
     *  { 'services.PYODIDE': false }
     * )
     */
    configure (config: { [field: string]: SettingsValue }): void
    getFileWorkerSource (name: string): (() => Worker) | undefined
    /**
     * Get a worker instance to override a default worker or null if no override exists.
     * @param name - Name of the worker to override.
     */
    getWorkerOverride (name: string): Worker | null
    /**
     * Launch a viewer app in the given container div.
     * @param containerId - Id of the container div element.
     * @param appId - Optional id for the app.
     * @param locale - Optional primary locale code string.
     * @returns True if successful, false if not.
     */
    launch (containerId?: string, appId?: string, locale?: string): Promise<boolean>
    /**
     * Load a study from the given file, folder or URL.
     * @param loader - Name of the loader to use for loading the study.
     * @param source - URL(s) to study data file(s) or a file system item.
     * @param name - Optional name for the study.
     * @returns Promise with the resource from the loaded study or null on failure.
     */
    loadStudy (loader: string, source: string | string[] | FileSystemItem, name?: string)
              : Promise<DataResource|null>
    /**
     * Open the provided resource.
     * @param resource - The resource to open.
     */
    openResource (resource: DataResource): void
    /**
     * Register a file worker in the runtime state.
     * @param name - Unique name (key) for this worker.
     * @param getter - Method that creates a new Worker.
     */
    registerFileWorker (name: string, getter: () => Worker): void
    /**
     * Register an interface module to be used with the application.
     * @param intf - Constructor for the app interface.
     */
    registerInterface (intf: InterfaceModuleConstructor): void
    /**
     * Register a module for a new resource type.
     * @param name - Unique name for the module.
     * @param module - Module that exports a runtime and settings.
     */
    registerModule (name: string, module: ResourceModule): void
    /**
     * Register a new service.
     * @param name - Unique name for the service.
     * @param service - The service to register.
     */
    registerService (name: string, service: AssetService): void
    /**
     * Register a new study loader.
     * @param name - Unique name of the loader. If another loader exists with the same name it will be replaced.
     * @param label - A user-facing label for the loader.
     * @param mode - Opening mode for this loader (`file`, `folder`, or `study`).
     * @param loader - The study loader itself.
     */
    registerStudyLoader (name: string, label: string, mode: ReaderMode, loader: StudyLoader): void
    /**
     * Select the resource with the given `id` in current dataset as active.
     * @param id - Unique ID of the resource.
     */
    selectResource (id: string): void
    /**
     * Load the given dataset.
     * @param dataset - The dataset to load.
     */
    setActiveDataset (dataset: MediaDataset | null): void
    /**
     * Set the given ONNX service as actively used service.
     * @param service - New active ONNX service.
     */
    setOnnxService (service: OnnxService): void
    /**
     * Set the given settings field to a new value. The field must already exist in settings,
     * this method will not create new fields.
     * @param field - Settings field to change (levels separated with dot).
     * @param value - New value for the field.
     * @example
     * ```
     * setSettingsValue('app.setting', 'New setting')
     * setSettingsValue('modules.name.field.subfield', 'New value')
     * ```
     */
    setSettingsValue (field: string, value: SettingsValue): void
    /**
     * Override a default worker with a method that returns a worker instance.
     * @param name - Name of the worker to override.
     * @param getWorker - The worker method to use instead, or null to use default.
     */
    setWorkerOverride (name: string, getWorker: (() =>  Worker)|null): void
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
 * Common definition for an interface module constructor.
 */
export interface InterfaceModuleConstructor {
    new (
        epicvApp: EpiCurrentsApp,
        state?: StateManager,
        containerId?: string,
        appId?: string,
        locale?: string,
        modules?: string[],
    ): InterfaceModule
}
/**
 * Resource module properties for an application interface.
 */
export type InterfaceResourceModule = RuntimeResourceModule & {
    getViewerComponent (): unknown
}
/**
 * Context for the interface resource module.
 */
export type InterfaceResourceModuleContext = {
    /** Properties to override in the main application runtime. */
    runtime: InterfaceResourceModule
    /**
     * Actions for an action-mutation state manager.
     * Note: This is modeled after the VueX library and may need revision later.
     */
    actions?: NullProtoObject // TODO: Better typing.
    /**
     * Mutations for an action-mutation state manager.
     * Note: This is modeled after the VueX library and may need revision later.
     */
    mutations?: NullProtoObject // TODO: Better typing.
}
/**
 * Supported mouse interactions in the UI.
 */
export type MouseInteraction = 'drag'
/**
 * Object with the __proto__ property pointing to null.
 */
export type NullProtoObject = {
    __proto__: null
}
export type PropertyUpdateHandler = (newValue?: unknown, oldValue?: unknown) => unknown
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
export type RuntimeAppModule = NullProtoObject & {
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
    studyLoadProtocols: Map<string, StudyLoaderProtocolContext>
    userSettings: {
        [setting: string]: string
    }
}

export type RuntimeResourceModule = NullProtoObject & {
    moduleName: {
        /** Identifying code for this module. (TODO: Rename as id?) */
        code: string
        /** Full name of this module. */
        full: string
        /** Short name for this module (usually abbreviation). */
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
export type RuntimeState = NullProtoObject & {
    APP: RuntimeAppModule
    INTERFACE: unknown
    MODULES: Map<string, RuntimeResourceModule>
    SERVICES: Map<string, AssetService>
    SETTINGS: AppSettings
    WORKERS: Map<string, (() => Worker)|null>
}
/**
 * An object with the property (pointer) __proto__ removed. This will prevent using any objects
 * based on this type in prototype pollution attacks.
 */
export type SafeObject = Modify<{ [name: string]: unknown }, NullProtoObject>
/**
 * Statemanager is the instance that manages application runtime state.
 * In addition to the actual modules, it also includes shorthands for
 * core APP properties and methods for altering MODULES and SERVICES.
 */
export interface StateManager extends RuntimeState {
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
    addPropertyUpdateHandler (property: string | string[], handler: PropertyUpdateHandler, caller?: string): void
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
     * Get a worker instance to override a default worker or null if no override exists.
     * @param name - Name of the worker to override.
     */
    getWorkerOverride (name: string): Worker | null
    /**
     * Initialize the app runtime instance.
     * @param initValues - Optional values as an object of { field: value } pairs (eg. { appId: 'app', SETTINGS: { 'eeg.trace.margin.top': 10 } })
     */
    init (initValues?: { [module: string]: unknown }): void
    /**
     * Load a dataset from the given `folder`.
     * @param folder - The folder containing the dataset.
     * @param loader - Loader to use for the dataset.
     * @param studyLoaders - Set of study loaders for the studies in the dataset.
     * @param config - Additional configuration (TODO: Config definitions).
     */
    loadDatasetFolder (folder: FileSystemItem, loader: DatasetLoader, studyLoaders: StudyLoader[], config?: unknown):
    Promise<MediaDataset>
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
    removePropertyUpdateHandler (property: string | string[], handler: PropertyUpdateHandler): void
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
     * @returns true if a field value was changed, false otherwise.
     */
    setSettingsValue (field: string, value: SettingsValue): boolean
    /**
     * Override a default worker with a method that returns a worker instance.
     * @param name - Name of the worker to override.
     * @param getWorker - The worker method to use instead, or null to use default.
     */
    setWorkerOverride (name: string, getWorker: (() => Worker)|null): void
}
