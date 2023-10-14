/**
 * EpiCurrest application main script.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

//////////////////////////////////////////////////////////////////
//                    MODULE IMPORT/EXPORTS                     //
//////////////////////////////////////////////////////////////////

import {
    BiosignalAudio,
    BiosignalMutex,
    BiosignalService,
    BiosignalServiceSAB,
    BiosignalStudyLoader,
    FileSystemDirectory,
    FileSystemFile,
    GenericAsset,
    GenericBiosignalChannel,
    GenericBiosignalHeaders,
    GenericBiosignalMontage,
    GenericBiosignalResource,
    GenericBiosignalResourceSAB,
    GenericBiosignalSetup,
    GenericDataset,
    GenericDocumentResource,
    GenericFileLoader,
    GenericResource,
    GenericService,
    GenericStudyLoader,
    LocalFileReader,
    MixedFileSystemItem,
    MixedMediaDataset,
    MontageServiceSAB,
    ServiceMemoryManager,
    StudyCollection,
    studyContextTemplate,
} from "./assets"
export {
    BiosignalAudio,
    BiosignalMutex,
    BiosignalService,
    BiosignalServiceSAB,
    BiosignalStudyLoader,
    FileSystemDirectory,
    FileSystemFile,
    GenericAsset,
    GenericBiosignalChannel,
    GenericBiosignalHeaders,
    GenericBiosignalMontage,
    GenericBiosignalResource,
    GenericBiosignalResourceSAB,
    GenericBiosignalSetup,
    GenericDataset,
    GenericDocumentResource,
    GenericFileLoader,
    GenericResource,
    GenericService,
    GenericStudyLoader,
    LocalFileReader,
    MixedFileSystemItem,
    MixedMediaDataset,
    MontageServiceSAB,
    ServiceMemoryManager,
    StudyCollection,
    studyContextTemplate,
}
import SETTINGS from '#config/Settings'
export {
    SETTINGS,
}
import {
    GenericOnnxService,
} from "./onnx"
export {
    GenericOnnxService,
}
import {
    CanvasPlot,
    PlotColor,
    WebGlPlot,
    WebGlPlotTrace,
} from "./plots"
export {
    CanvasPlot,
    PlotColor,
    WebGlPlot,
    WebGlPlotTrace,
}
import {
    PyodideRunner,
    PyodideService,
} from "./pyodide"
export {
    PyodideRunner,
    PyodideService
}
import RuntimeStateManager from "./runtime"
export {
    RuntimeStateManager,
}
import * as util from "./util"
export { util }

//////////////////////////////////////////////////////////////////
//                            CLASS                             //
//////////////////////////////////////////////////////////////////

import { Log } from 'scoped-ts-log'
import {
    type EpiCurrentsApplication,
    type InterfaceModule,
    type InterfaceModuleConstructor,
    type DataResource,
    type ResourceModule,
} from '#types/assets'
import { type SettingsValue } from "#types/config"
import { type AssetService } from '#types/service'
import { type FileSystemItem, type LoaderMode } from '#types/loader'

const SCOPE = 'index'

export class EpiCurrents implements EpiCurrentsApplication {
    // Properties
    #app = null as null | InterfaceModule
    #instanceNum: number
    #interface = null as null | InterfaceModuleConstructor
    #memoryManager = null as null | ServiceMemoryManager
    #state = new RuntimeStateManager()

    constructor () {
        this.#instanceNum = GenericAsset.INSTANCES.push(this) - 1
    }
    addResource (resource: DataResource, scope?: string) {
        if (!resource.type) {
            Log.error(`Cannot add a resource without a type.`, SCOPE)
            return
        }
        const finalScope = scope || resource.type
        if (!this.#state.MODULES.get(finalScope)) {
            Log.error(`Cannot add resource to scope '${finalScope}'; the corresponding module has not been loaded.`, SCOPE)
            return
        }
        if (!this.#state.APP.activeDataset) {
            Log.error(`Cannot add resource without an active dataset`, SCOPE)
            return
        }
        this.#state.addResource(finalScope, resource)
    }
    /**
     * Modify the default configuration before the app is launched.
     * After launching the app, use setSettingsValue() instead.
     * @param config - Field and value pairs to modify.
     * @example
     * EpiCurrents.configure(
     *  { 'services.MNE': false }
     * )
     */
    configure (config: { [field: string]: SettingsValue }) {
        if (this.#app) {
            Log.warn(`Cannot alter default configuration after app launch. Use the setSettingsValue method instead.`, SCOPE)
            return
        }
        for (const [field, value] of Object.entries(config)) {
            Log.debug(`Modifying default configuration field '${field}' to value ${value?.toString()}`, SCOPE)
            SETTINGS.setFieldValue(field, value)
        }
    }
    createDataset (name?: string) {
        const setName = name || `Dataset ${this.#state.APP.datasets.length + 1 }`
        const newSet = new MixedMediaDataset(setName)
        this.#state.addDataset(newSet)
        return newSet
    }
    getFileWorkerSource (name: string) {
        return this.#state.APP.fileWorkerSources.get(name)
    }
    /**
     * Launch a viewer app in the given container div.
     * @param containerId id of the container div element
     * @param appId optional id for the app
     * @param locale optional primary locale code string
     * @return true if successful, false if not
     */
    launch = async (
        containerId: string = '',
        appId: string = `app${this.#instanceNum}`,
        locale: string = 'en'
    ): Promise<boolean> => {
        if (!this.#interface) {
            Log.error(`Cannot launch app before an interface has been registered.`, 'index')
            return false
        }
        // Make sure that the container element exists.
        // Prepend a hyphed to the container id, otherwise just use 'epicv'.
        // Using the literal 'epicv' in the selector is to avoid invalid selector errors.
        containerId = containerId.length ? `-${containerId}` : ''
        const modules = Array.from(this.#state.MODULES.keys())
        this.#app = new this.#interface(this, this.#state, containerId, appId, locale, modules)
        const interfaceSuccess = await this.#app.awaitReady()
        if (!interfaceSuccess) {
            Log.error(`Creating the interface instance was not successful.`, SCOPE)
            return false
        }
        if (!window.crossOriginIsolated) {
            Log.warn(`Cross origin isolation is not enabled! Some features of the app are not available!`, 'index')
        } else {
            this.#memoryManager = new ServiceMemoryManager(SETTINGS.app.maxLoadCacheSize)
        }
        return true
    }
    /**
     * Load a dataset from the given `folder`.
     * @param folder - `MixedFileSystemItem` containing the dataset files.
     * @param name - Optional name for the dataset.
    loadDataset = async (loader: BaseDataset, folder: FileSystemItem | string[], name?: string, context?: string) => {
    }
     */
    /**
     * Load a study from the given file, folder or URL.
     * @param loader - Name of the loader to use for loading the study.
     * @param source - URL(s) to study data file(s) or a file system item.
     * @param name - Optional name for the study.
     */
    loadStudy = async (loader: string, source: string | string[] | FileSystemItem, name?: string) => {
        if (!this.#memoryManager) {
            Log.error(`Could not load study from files, loader manager is not initialized.`, 'index')
            return
        }
        const context = this.#state.APP.studyLoaders.get(loader)
        if (!context) {
            Log.error(`Could not load study, loader ${loader} was not found.`, SCOPE)
            return
        }
        context.loader.registerMemoryManager(this.#memoryManager)
        const study = typeof source === 'string'
            ? await context.loader.loadFromUrl(source, { name: name })
            : Array.isArray(source) ? await context.loader.loadFromDirectory(
                                                MixedFileSystemItem.UrlsToFsItem(...source),
                                                { name: name }
                                            )
            : source.file ? await context.loader.loadFromFile(source.file, { name: name })
                          : null
        if (!study) {
            return
        }
        const nextIdx = await context.loader.useStudy(study)
        const resource = await context.loader.getResource(nextIdx)
        if (resource) {
            this.#state.addResource(context.loader.resourceScope, resource)
            // Start preparing the resource, but return it immediately.
            resource.prepare().then(success => {
                if (!success) {
                    Log.error(`Preparing the resource ${resource.name} failed.`, SCOPE)
                }
            })
            return resource
        }
        return null
    }
    /**
     * Open the provided resource.
     * @param resource - The resource to open.
     */
    openResource = (resource: DataResource) => {
        this.#state.setActiveResource(resource)
        //this.store?.dispatch('set-active-resource', resource)
    }
    /**
     * Register a file worker in the runtime state.
     * @param name - Unique name (key) for this worker.
     * @param getter - Method that creates a new Worker.
     */
    registerFileWorker (name: string, getter: () => Worker) {
        this.#state.APP.fileWorkerSources.set(name, getter)
    }
    /**
     * Register an interface module to be used with the application.
     * @param intf - Constructor for the app interface.
     */
    registerInterface = (intf: InterfaceModuleConstructor) => {
        this.#interface = intf
    }
    registerModule = (name: string, module: ResourceModule) => {
        this.#state.setModule(name, module.runtime)
        this.#state.SETTINGS.registerModule(name, module.settings)
    }
    registerService = (name: string, service: AssetService) => {
        this.#state.setService(name, service)
    }
    /**
     * Register a new study loader.
     * @param name - Unique name of the loader. If another loader exists with the same name it will be replaced.
     * @param label - A user-facing label for the loader.
     * @param mode - Opening mode for this loader (`file`, `folder`, or `study`).
     * @param loader - The study loader itself.
     */
    registerStudyLoader = (name: string, label: string, mode: LoaderMode, loader: GenericStudyLoader) => {
        this.#state.APP.studyLoaders.set(name, { label: label, mode: mode, loader: loader, scopes: loader.supportedScopes, types: loader.supportedTypes })
    }
    /**
     * Select the resource with the given `id` in current dataset as active.
     * @param id - Unique ID of the resource.
     */
    selectResource = (id: string) => {
        if (!this.#state.APP.activeDataset) {
            return
        }
        const setResources = this.#state.APP.activeDataset.resources
        for (const resource of setResources) {
            if (resource.id === id && resource.isPrepared) {
                this.#state.setActiveResource(resource)
            }
        }
    }
    setActiveDataset = (dataset: MixedMediaDataset | null) => {
        this.#state.setActiveDataset(dataset)
        //this.store.dispatch('set-active-dataset', dataset)
    }

    setOnnxService = (service: GenericOnnxService) => {
        this.#state.setService('ONNX', service)
        this.#state.setSettingsValue('services.ONNX', true) //service ? true : false
    }

    /**
     * Set the given settings field to a new value. The field must already exist in settings,
     * this method will not create new fields.
     * @param field - Settings field to change (levels separated with dot).
     * @param value - New value for the field.
     * @example
     * ```
     * setSettingsValue('module.field.subfield', 'New Value')
     * ```
     */
    setSettingsValue = (field: string, value: SettingsValue) => {
        this.#state.setSettingsValue(field, value)
    }
}
