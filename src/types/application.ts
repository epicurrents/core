/**
 * Asset types. Asset is the root type of all classes and resources used in Epicurrents.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    AppSettings,
    BaseModuleSettings,
    ConfigSchema,
    ConfigStudyLoader,
    ResourceConfig,
    SettingsValue,
} from './config'
import { ConnectorType, DatasourceConnector } from './connector'
import { DatasetLoader, MediaDataset } from './dataset'
import {
    FileSystemItem,
    ReaderMode,
    WriterMode,
} from './reader'
import { AssetService } from './service'
import {
    StudyContext,
    StudyExporterContext,
    StudyImporterContext,
    StudyLoaderProtocolContext,
    StudyLoader,
} from './study'
import { Modify } from './util'
import {
    ScopedEventBus,
    ScopedEventCallback,
    ScopedEventHooks,
    ScopedEventPhase,
} from 'scoped-event-bus/dist/types'
/**
 * Annotation describing a resource or some feature of it.
 */
export interface Annotation extends BaseAsset {
    /** Author of this annotation. */
    annotator: string | null
    /** Annotation class. */
    class: string
    /** Standardized codes for this annotation. */
    codes: (number | string)[]
    /**
     * Text label for the annotation (visible on annotation listings).
     * If left empty, it will return a string representation of the value (array values joined by commas).
     */
    label: string
    /**
     * Priority of this annotation (lower number has lower priority). Priority must be a number greater than zero.
     */
    priority: number
    /** Additional commentary regarding the annotation. */
    text: string
    /** Identifier for a pre-set annotation type. Can also be used as a descriptor for annotation code(s). */
    type: string
    /** The raw value of the label. Will be used as the visible label for the annotation if `label` is `undefined`. */
    value: boolean | number | number[] | string | string[] | null
    /** Is this annotation visible. */
    visible: boolean
    serialize (options?: AssetSerializeOptions): ReturnType<BaseAsset['serialize']> & {
        annotator: string | null
        class: Annotation['class'] | null
        codes: (number | string)[] | null
        label: string | null
        priority: number
        text: string | null
        type: string | null
        value: boolean | number | number[] | string | string[] | null
        visible: boolean
    }
}
/**
 * Label annotation describing the asset as a whole.
 */
export interface AnnotationLabel extends Annotation {
    /**
     * Label class. The default general purpose label classes are:
     * - `evaluation` contains the evaluation results.
     * - `label` is a generic label.
     * - `technical` describes the technical quality of the recording.
     */
    class: "evaluation" | "label" | "technical"
    /**
     * Priority of this label (lower number has lower priority). Priority must be a number greater than zero.
     * Predefined priorities for the default label classes are:
     * - `evaluation` = 300
     * - `label` = 200
     * - `technical` = 100
     */
    priority: number
    serialize (options?: AssetSerializeOptions): ReturnType<Annotation['serialize']> & {
        class: AnnotationLabel['class'] | null
    }
}
/** Optional properties for constructing an annotation. */
export type AnnotationOptions = {
    /** Author of this annotation. */
    annotator?: string
    /** Annotation class. */
    class?: Annotation['class']
    /** Standardized codes for this annotation. */
    codes?: (number | string)[]
    /** Text label for the annotation (visible on annotation listings). */
    label?: string
    /** Priority of this annotation (lower number has lower priority). Priority must be a number greater than zero. */
    priority?: number
    /** Additional commentary regarding the annotation. */
    text?: string
    /** Is this annotation visible. */
    visible?: boolean
}
/**
 * Object template to use when constructing an annotation.
 */
export type AnnotationTemplate = {
    /** Annotation class. */
    class: Annotation['class']
    /**
     * Priority of this annotation (lower number has lower priority). Priority must be a number greater than zero.
     */
    priority: Annotation['priority']
    /** The raw value of the annotation. Will be used as the visible label for the annotation if `label` is `undefined`. */
    value: boolean | number | number[] | string | string[]
    /** Author of this annotation. */
    annotator?: Annotation['annotator']
    /** Standardized codes for this annotation. */
    codes?: (number | string)[]
    /** Text label for the annotation to override the value in annotation listings. */
    label?: Annotation['label']
    /**
     * Unique identifier for matching educational annotations (for programmatically altering their visibility etc.).
     *
     * @remarks
     * Cannot use `id` for this as it is automatically generated.
     */
    name?: Annotation['name']
    /** Additional commentary regarding the annotation. */
    text?: Annotation['text']
    /** Identifier for a pre-set annotation type. Can also be used as a descriptor for annotation code(s). */
    type?: Annotation['type']
    /** Is this annotation visible in the annotation listing (default true). */
    visible?: Annotation['visible']
}
/**
 * Configuration properties for the main application.
 */
export type ApplicationConfig = {
    /**
     * Allow authenticating connections in an insecure context (over HTTP).
     */
    allowInsecureAuth?: boolean
    /**
     * Path from which to load additional application assets, e.g. local settings.
     * Defaults to the same folder as the application file if left blank.
     */
    assetPath?: string
    /**
     * Log priority required for message to be printed into the console.
     * Possible values (from least to most important):
     * DEBUG, INFO, WARN, ERROR
     */
    logThreshold?: "WARN" | "DEBUG" | "INFO" | "ERROR" | "DISABLE"
    /**
     * Should SharedArrayBuffers (if available) be used to manage memory.
     */
    useSAB?: boolean
}
/**
 * Options for serializing an annotation.
 */
export type AssetSerializeOptions = {
    /** List of property names that should be set to null if they are empty. Only applies to string and array properties (not boolean or number properties). */
    nullIfEmpty?: string[]
}
/**
 * The most basic type defining properties that must exist in every asset.
 */
export interface BaseAsset {
    /** Unique id (generated automatically). */
    id: string
    /** Is this asset selected as active. */
    isActive: boolean
    /** Specific modality (or type) of the resource. */
    modality: string
    /* Below fields are given proper descriptions in sub-interfaces */
    name: string
    /**
     * Add a listener for an `event` or list of events.
     * @param event - Event or list of events to listen for.
     * @param callback - Method to call when event occurs.
     * @param subscriber - Name of the subscriber.
     * @param phase - Event phase to trigger the callback in (optional, default 'after').
     */
    addEventListener (
        event: string|RegExp|(string|RegExp)[],
        callback: ScopedEventCallback,
        subscriber: string,
        phase?: ScopedEventPhase
    ): void
    /**
     * Configure this asset with the given `config` and optional `schema`.
     * @param config - Configuration to apply.
     * @param schema - Optional configuration schema to validate against. If not given here, it must be set prior to calling this method.
     * @param resource - Optional asset to apply the configuration to (default this).
     */
    configure (config: ResourceConfig, schema?: ConfigSchema, resource?: BaseAsset): void
    /**
     * Ideally, this method should take care of releasing any resources the asset has reserved.
     * It should be called starting from the last inheriting class and calling the super's `destroy` once all the
     * necessary preparations have been made.
     */
    destroy (): void | Promise<void>
    /**
     * Dispatch an `event`.
     * @param event - Name of the event.
     * @param phase - Event phase (optinal, default 'after').
     * @param detail - Optional `CustomEvent` details.
     * @returns False if the event default was prevented, true otherwise.
     */
    dispatchEvent (event: string, phase?: ScopedEventPhase, detail?: { [key: string]: unknown }): boolean
    /**
     * Dispatch an event that carries some data as payload.
     *
     * This is a helper method that formats the custom event details correctly.
     * @param event - Name of the event.
     * @param payload - Data payload for the event.
     * @param phase - Phase of the event (optional, default 'after').
     * @returns False if the event default was prevented, true otherwise.
     */
    dispatchPayloadEvent<T> (event: string, payload: T, phase?: ScopedEventPhase): boolean
    /**
     * Dispatch an event to signal a change in the value of a property.
     *
     * This is a helper method that formats the custom event details correctly.
     * @param property - Name of the property to change.
     * @param newValue - The new value of the property (optional).
     * @param oldValue - The old value of the property (optional).
     * @param phase - Phase of the event (optional, default 'after').
     * @param event - Custom override for the property change event name (optional).
     * @returns False if the event default was prevented, true otherwise.
     */
    dispatchPropertyChangeEvent<T> (
        property: keyof this,
        newValue?: T,
        oldValue?: T,
        phase?: ScopedEventPhase,
        event?: string
    ): boolean
    /**
     * Get methods for adding listeners to the `before` and `after` phases of a specific `event`.
     * The `unsubscribe` method returned alongside the hooks can be used to unsubscribe from both phases.
     * @param event - Name of the event.
     * @param subscriber - Name of the subscriber.
     * @returns Methods to hook into asset events.
     * @example
     * const hooks = asset.getEventHooks('some-event', 'some-subscriber')
     * hooks.before((event) => {
     *   // Do something before the event occurs...
     *   event.preventDefault() // May stop the event from actually taking place.
     * })
     * hooks.after((event) => {
     *   // Do something after the event has occurred...
     * })
     * hooks.unsubscribe() // Remove all event listeners from this subscriber.
     */
    getEventHooks (event: string, subscriber: string): ScopedEventHooks
    /**
     * Add a `handler` for changes occurring in the given `property` or properties.
     * @param property - Name of the property/properties.
     * @param handler - Handler to run when a change occurs.
     * @param subscriber - Name of the subscriber.
     * @param phase - Optional phase of the event (default 'after').
     *
     * @remarks
     * This is a utility method that correctly formats a default event listener for changes in the given property.
     */
    onPropertyChange (
        property: keyof this | (keyof this)[],
        handler: PropertyChangeHandler,
        subscriber: string,
        phase?: ScopedEventPhase,
    ): void
    /**
     * Remove all event listeners from this asset, optionally limited to the given `subscriber`.
     * @param subscriber - Name of the subscriber (optional).
     */
    removeAllEventListeners (subscriber?: string): void
    /**
     * Remove the listener for the given `event`(s).
     * @param event - Event or list of events to match.
     * @param callback - Callback of the listener.
     * @param subscriber - Name of the subscriber.
     * @param phase - Optional phase of the event (omitted or undefined will match any phase).
     */
    removeEventListener (
        event: string|RegExp|(string|RegExp)[],
        callback: ScopedEventCallback,
        subscriber: string,
        phase?: ScopedEventPhase
    ): void
    /**
     * Return serialized properties that belong to this asset.
     * @param options - Options for serialization.
     */
    serialize (options?: AssetSerializeOptions): Record<string, unknown>
    /**
     * Alias for `addEventListener`.
     */
    subscribe: BaseAsset['addEventListener']
    /**
     * Alias for `removeEventListener`.
     */
    unsubscribe: BaseAsset['removeEventListener']
    /**
     * Alias for `removeAllEventListeners`.
     */
    unsubscribeAll: BaseAsset['removeAllEventListeners']
}
/**
 * DataResource is the most basic scope of resource containing biomedical or media data.
 * It defines all the properties that should be accessible even when the specific resource type is not known.
 */
 export interface DataResource extends BaseAsset {
    /** Currently active child resource, if any. */
    activeChildResource: DataResource | null
    /** Array of child resources, if any. */
    childResources: DataResource[]
    /** Possible resource identifier used in the dataset this resource belongs to. */
    datasetId: string | null
    /** Any dependencies of this resource that are not yet ready to use. */
    dependenciesMissing: string[]
    /** Dependencies of this resource that are ready to use. */
    dependenciesReady: string[]
    /** Message to display as the error state reason. */
    errorReason: string
    /** Is the resource ready for use. */
    isReady: boolean
    /** List of label annotations. */
    labels: AnnotationLabel[]
    /** Source study for this resource. */
    source: StudyContext | null
    /**
     * Resource state depicting the phase of loading and preparing the resource for use.
     * - `added`: Basic resource properties have been added, but loading the resource has not started yet.
     * - `loading`: Resource data is being loaded from the source.
     * - `loaded`: Data has been loaded, but resource is not yet initialized.
     * - `ready`: Resource is initialized and ready for use.
     * - `destroyed`: Resource has been unloaded and is no longer available.
     * - `error`: There was a loading error.
     */
    state: ResourceState
    /**
     * Add `dependencies` to the list of missing dependencies for this resource.
     * @param dependencies - Dependency or dependencies to add.
     */
    addDependencies (...dependencies: string[]): void
    /**
     * Destroy this resource removing references to any child objects.
     */
    destroy (): void | Promise<void>
    /**
     * Remove `dependencies` from the list of missing dependencies for this resource.
     * @param dependencies - Dependency or dependencies to remove.
     */
    removeDependencies (...dependencies: string[]): void
    /**
     * Set `dependencies` as ready, moving them from the list of missing dependencies to the ready dependencies.
     * @param dependencies - Dependency or dependencies to set as ready.
     * @remarks
     * This method fires property watchers for both missng and ready dependencies.
     */
    setDependenciesReady (...dependencies: string[]): void
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
    /**
     * Unload the resource, releasing any reserved memory.
     */
    unload (): Promise<void>
}
/**
 * The main Epicurrents application.
 */
export interface EpicurrentsApp {
    /**
     * Master event bus to broadcast application events.
     */
    eventBus: ScopedEventBus
    /**
     * Path where public assets (mostly javascript) are served from.
     */
    publicPath: string
    /**
     * Runtime state manager used by this application instance.
     */
    runtime: RuntimeState
    /**
     * Does the application instance use a memory manager. A memory manager requires
     * SharedArrayBuffer to be available.
     */
    useMemoryManager: boolean
    /**
     * Add a `resource` to the active dataset.
     * @param resource - The resource to add.
     * @param modality - Override resource modality (optional).
     */
    addResource (resource: DataResource, modality?: string): void
    /**
     * Modify the default configuration before the app is launched.
     * After launching the app, use setSettingsValue() instead.
     * @param config - Field and value pairs to modify.
     * @example
     * Epicurrents.configure(
     *  { 'services.PYODIDE': false }
     * )
     */
    configure (config: { [field: string]: SettingsValue }): void
    /**
     * Create a new dataset.
     * @param name - Name of the dataset.
     * @param setAsActive - Should the created dataset be set as active.
     * @returns The created dataset.
     */
    createDataset (name?: string, setAsActive?: boolean): MediaDataset
    /**
     * Get a worker instance to override a default worker or null if no override exists.
     * @param name - Name of the worker to override.
     */
    getWorkerOverride (name: string): Worker | null
    /**
     * Launch a viewer app in the given container div.
     * @param config - Optional application configuration.
     * @returns True if successful, false if not.
     */
    launch (config?: ApplicationConfig): Promise<boolean>
    /**
     * Load a study from the given file, folder or URL.
     * @param loader - Name of the loader to use for loading the study.
     * @param source - URL(s) to study data file(s) or a file system item.
     * @param options - Optional study and access options.
     * @returns Promise with the resource from the loaded study or null on failure.
     */
    loadStudy (
        loader: string,
        source: string | string[] | FileSystemItem,
        options?: ConfigStudyLoader
    ): Promise<DataResource|null>
    /**
     * Open the provided resource.
     * @param resource - The resource to open.
     */
    openResource (resource: DataResource): void
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
     * Register a new study exporter.
     * @param name - Unique name of the exporter. If another exporter exists with the same name it will be replaced.
     * @param label - A user-facing label for the exporter.
     * @param mode - Writing mode for this exporter (`file` or `dataset`).
     * @param loader - The study loader to use for exporting.
     */
    registerStudyExporter (name: string, label: string, mode: WriterMode, loader: StudyLoader): void
    /**
     * Register a new study importer.
     * @param name - Unique name of the importer. If another importer exists with the same name it will be replaced.
     * @param label - A user-facing label for the importer.
     * @param mode - Opening mode for this importer (`file`, `folder`, `study` or `url`).
     * @param loader - The study loader to use for importing.
     */
    registerStudyImporter (name: string, label: string, mode: ReaderMode, loader: StudyLoader): void
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
        epicApp: EpicurrentsApp,
        runtime?: StateManager,
        modules?: string[],
        config?: ApplicationConfig,
    ): InterfaceModule
}
/**
 * Resource module properties for an application interface.
 * @privateRemarks
 * These getters are very difficult to type properly, have to try again later.
 */
export type InterfaceResourceModule = RuntimeResourceModule & {
    getControlsComponent (): unknown
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
    actions?: unknown // TODO: Better typing.
    /**
     * Mutations for an action-mutation state manager.
     * Note: This is modeled after the VueX library and may need revision later.
     */
    mutations?: unknown // TODO: Better typing.
}
/**
 * Object with the __proto__ property pointing to null.
 */
export type NullProtoObject = {
    __proto__: null
}
/**
 * A handler for asset property change events.
 */
export type PropertyChangeHandler = <T>(newValue?: T, oldValue?: T) => unknown
/**
 * A resource that serves as a collection for a set of interconnected resources.
 */
export interface DataResourceCollection extends DataResource {
    /** Possible date of the resources in this collection. */
    date?: Date | null
    /** Index of the default resource in this collection. */
    defaultResource: number
    /** Array of resources in this collection. */
    resources: DataResource[]
    /**
     * Add a resource to the collection.
     * @param resource - The resource to add.
     * @param setAsDefault - Whether to set this resource as the default.
     */
    addResource (resource: DataResource, setAsDefault?: boolean): void
    /**
     * Get a resource in the collection.
     * @param resource - Id or index (in the resources array) of the resource to get.
     */
    getResource (resource: number | string): DataResource | null
    /**
     * Remove a resource from the collection. This will permanently destroy the resource.
     * @param resource - The resource to remove, or its id or index in the resources array.
     */
    removeResource (resource: DataResource | string | number): void
}
/**
 * Module containing the required runtime and settings properties for a given resource type.
 */
export type ResourceModule = {
    runtime: RuntimeResourceModule
    settings: BaseModuleSettings
}
/**
 * Resource state depicting the phase of loading and preparing the resource for use.
 * - `added`: Basic resource properties have been added, but loading the resource has not started yet.
 * - `loading`: Resource data is being loaded from the source.
 * - `loaded`: Data has been loaded, but resource is not yet initialized.
 * - `ready`: Resource is initialized and ready for use.
 * - `destroyed`: Resource has been unloaded and is no longer available.
 * - `error`: There was a loading error.
 */
export type ResourceState = 'added' | 'destroyed' | 'error' | 'loaded' | 'loading' | 'ready'
/**
 * This is the main application runtime module, which has a unique structure.
 */
export type RuntimeAppModule = NullProtoObject & {
    activeDataset: MediaDataset | null
    connectors: Map<string, DatasourceConnector>
    datasets: MediaDataset[]
    id: string
    moduleName: {
        code: string
        full: string
        short: string
    }
    runningId: number
    studyExporters: Map<string, StudyExporterContext>
    studyImporters: Map<string, StudyImporterContext>
    studyLoadProtocols: Map<string, StudyLoaderProtocolContext>
}

export type RuntimeResourceModule = {
    moduleName: {
        /** Identifying code for this module. (TODO: Rename as id?) */
        code: string
        /** Full name of this module. */
        full: string
        /** Short name for this module (usually abbreviation). */
        short: string
    }
    /**
     * Apply the given configuration to the module.
     * @param config - Configuration to apply.
     * @returns Promise that resolves once the configuration has been applied.
     */
    applyConfiguration: (config: RuntimeResourceModuleConfig) => Promise<void>
    /**
     * Set the given property to its new value, notifying watchers.
     * @param property - Name of the property on kebab-case.
     * @param value - The new value for the property.
     * @param resource - The resource to alter (optional).
     * @param state - Instance for the main runtime state manger (optional).
     * @returns unknown
     */
    setPropertyValue (property: string, value: unknown, resource?: DataResource, state?: StateManager): unknown
    /**
     * Get a resource from its serialized representation, if available for this resource type.
     * @param serialized - Serialized representation of the resource.
     * @returns The resource or null if it could not be deserialized.
     */
    getResourceFromSerialized?: ((serialized: unknown) => DataResource | null)
}
/**
 * Setup properties for runtime modules.
 */
export type RuntimeResourceModuleConfig = {
    /** Override the module name properties. */
    moduleName?: {
        full?: string
        short?: string
    },
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
 * State manager is the instance that manages application runtime state.
 * In addition to the actual modules, it also includes shorthands for
 * core APP properties and methods for altering MODULES and SERVICES.
 */
export interface StateManager extends RuntimeState, BaseAsset {
    /**
     * Add a new connector to the list of available connectors.
     * @param name - Name of the connector used in the UI.
     * @param type - Type of the connector.
     * @param url - URL of the connector.
     * @param username - Username for the connector.
     * @param password - Password for the connector.
     * @param options - Additional options for the connector.
     */
    addConnector (
        name: string,
        type: ConnectorType,
        url: string,
        username: string,
        password: string,
        options?: unknown
    ): void
    /**
     * Add a new dataset to the list of datasets.
     * @param dataset - New dataset to add.
     * @param setAsActive - Optionally set the new dataset as active (default false).
     * @emits `add-dataset` with the new dataset as payload.
     */
    addDataset (dataset: MediaDataset, setAsActive?: boolean): void
    /**
     * Add a new `resource` with the given `modality`.
     * @param modality - Modality of the new resource.
     * @param resource - The resource to add.
     * @param setAsActive - Should the new resource be set as active (default false).
     * @emits `add-resource` with the new resource as payload.
     */
    addResource (modality: string, resource: DataResource, setAsActive?: boolean): void
    /**
     * Set the given `resource` as not active.
     * @param resource - Resource to deactivate.
     * @emits `deactivate-resource` with the resource as payload.
     */
    deactivateResource (resource: DataResource): void
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
     * @emits `initialize`.
     */
    init (initValues?: { [module: string]: unknown }): void
    /**
     * Load a dataset from the given `folder`.
     * @param folder - The folder containing the dataset.
     * @param loader - Loader to use for the dataset.
     * @param studyLoaders - Set of study loaders for the studies in the dataset.
     * @param config - Additional configuration (TODO: Config definitions).
     * @returns Promise with the loaded dataset.
     * @emits `load-dataset` with the folder (in the `before` phase) or loaded dataset (in the `after` phase) as payload.
     */
    loadDatasetFolder (
        folder: FileSystemItem,
        loader: DatasetLoader,
        studyLoaders: StudyLoader[],
        config?: unknown
    ): Promise<MediaDataset>
    /**
     * Remove the connector with the given `name`.
     * @param name - Name of the connector to remove.
     * @emits `remove-connector` with the removed connector as payload.
     */
    removeConnector (name: string): void
    /**
     * Remove the given `resource` from available resources.
     * @param resource - The resource to remove (either resources array index, resource id or resource object).
     * @param dataset - Resource dataset if not the currently active set.
     * @emits `remove-resource` with the removed resource as payload.
     */
    removeResource (resource: DataResource | string | number, dataset?: MediaDataset): void
    /**
     * Set the given dataset as active.
     * @param dataset - New active dataset or null to unset currently active dataset.
     * @emits `set-active-dataset` with the new dataset as payload.
     */
    setActiveDataset (dataset: MediaDataset | null): void
    /**
     * Set the given resource active.
     * @param resource - New resource to set as active or null to deactivate currently active resource.
     * @param deactivateOthers - Deactivate other active resources before activating this (default true). This method can also be used to deactivate other resources while only leaving the given `resource` active.
     * @emits `set-active-resource` with the new resource as payload.
     */
    setActiveResource (resource: DataResource | null, deactivateOthers?: boolean): void
    /**
     * Set a module to the given `name`. Null value will remove the module.
     * @param name - Name of the module.
     * @param module - New value for the module.
     * @emits `set-module` with the module as payload.
     */
    setModule (name: string, module: ResourceModule | null): void
    /**
     * Set the value of a property in one of the loaded modules.
     * @param module - Name of the module.
     * @param property - Property name in kebab-case.
     * @param value - The new value for the property.
     */
    setModulePropertyValue (module: string, property: string, value: unknown): void
    /**
     * Set a service to the given `name`. Null value will remove the service.
     * @param name - Name of the service.
     * @param service - New value for the service.
     * @emits `set-service` with the service as payload.
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

/**
 * Generic response to an asynchronous task.
 */
export type TaskResponse = {
    /** Indicates if the task was successful. */
    success: boolean
    /** The data returned by the task, if successful. */
    data?: unknown
    /** Error information, if an error was caught. */
    error?: Error
    /** Optional message providing additional information about the task outcome (for logging etc.). */
    message?: string
    /** The raw HTTP response if the task was unsuccessful. */
    response?: Response
}
