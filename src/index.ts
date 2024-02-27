/**
 * EpiCurrents core application main script.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

//////////////////////////////////////////////////////////////////
//                    CLASS IMPORT/EXPORTS                      //
//////////////////////////////////////////////////////////////////

import {
    BiosignalAudio,
    BiosignalCache,
    BiosignalMutex,
    GenericBiosignalService,
    BiosignalStudyLoader,
    FileSystemDirectory,
    FileSystemFile,
    GenericAsset,
    GenericBiosignalChannel,
    GenericBiosignalHeaders,
    GenericBiosignalMontage,
    GenericBiosignalResource,
    GenericBiosignalSetup,
    GenericDataset,
    GenericDocumentResource,
    GenericFileReader,
    GenericResource,
    GenericService,
    GenericStudyLoader,
    LocalFileReader,
    MixedFileSystemItem,
    MixedMediaDataset,
    MontageService,
    MontageWorkerSubstitute,
    ServiceMemoryManager,
    ServiceWorkerSubstitute,
    SharedWorkerCache,
    SignalFileReader,
    StudyCollection,
    studyContextTemplate,
} from './assets'
export {
    BiosignalAudio,
    BiosignalCache,
    BiosignalMutex,
    GenericBiosignalService,
    BiosignalStudyLoader,
    FileSystemDirectory,
    FileSystemFile,
    GenericAsset,
    GenericBiosignalChannel,
    GenericBiosignalHeaders,
    GenericBiosignalMontage,
    GenericBiosignalResource,
    GenericBiosignalSetup,
    GenericDataset,
    GenericDocumentResource,
    GenericFileReader,
    GenericResource,
    GenericService,
    GenericStudyLoader,
    LocalFileReader,
    MixedFileSystemItem,
    MixedMediaDataset,
    MontageService,
    MontageWorkerSubstitute,
    ServiceMemoryManager,
    ServiceWorkerSubstitute,
    SharedWorkerCache,
    SignalFileReader,
    StudyCollection,
    studyContextTemplate,
}

import SETTINGS from './config/Settings'
export {
    SETTINGS,
}
import {
    GenericOnnxService,
} from './onnx'
export {
    GenericOnnxService,
}
import {
    CanvasPlot,
    PlotColor,
    WebGlPlot,
    WebGlPlotTrace,
} from './plots'
export {
    CanvasPlot,
    PlotColor,
    WebGlPlot,
    WebGlPlotTrace,
}
import RuntimeStateManager from './runtime'
export {
    RuntimeStateManager,
}
import * as util from './util'
export { util }

//////////////////////////////////////////////////////////////////
//                            TYPES                             //
//////////////////////////////////////////////////////////////////

import { Log } from 'scoped-ts-log'
import {
    type AssetService,
    type DataResource,
    type EpiCurrentsApp,
    type FileSystemItem,
    type InterfaceModule,
    type InterfaceModuleConstructor,
    type ReaderMode,
    type MediaDataset,
    type OnnxService,
    type ResourceModule,
    type SettingsValue,
    type StudyLoader,
} from './types'

const SCOPE = 'index'
if (window.__EPICURRENTS_APPS__ === undefined) {
    window.__EPICURRENTS_APPS__ = []
}
export class EpiCurrents implements EpiCurrentsApp {
    // Private poperties.
    /**
     * Index of this application instance in the global applications object.
     */
    #id: number
    /**
     * Initiated user interface.
     */
    #interface = null as null | InterfaceModule
    /**
     * Constructor for an interface module to use for the app.
     */
    #interfaceConstructor = null as null | InterfaceModuleConstructor
    /**
     * Memory manager used to control the shared array buffer (or null if not used).
     */
    #memoryManager = null as null | ServiceMemoryManager
    /**
     * Application state.
     */
    #state = new RuntimeStateManager()

    constructor () {
        this.#id = window.__EPICURRENTS_APPS__.length
        window.__EPICURRENTS_APPS__.push(this)
        console.log(window)
    }

    // Public properties.
    get publicPath () {
        return __webpack_public_path__
    }
    set publicPath (value: string) {
        __webpack_public_path__ = value
    }

    get state () {
        return this.#state
    }

    get useMemoryManager () {
        return this.#memoryManager !== null
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

    configure (config: { [field: string]: SettingsValue }) {
        if (this.#interface) {
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

    getWorkerOverride (name: string) {
        return this.#state.getWorkerOverride(name)
    }

    async launch (
        containerId: string = '',
        appId: string = `epicurrents`,
        locale: string = 'en'
    ): Promise<boolean> {
        if (!this.#interfaceConstructor) {
            Log.error(`Cannot launch app before an interface has been registered.`, 'index')
            return false
        }
        if (SETTINGS.app.useMemoryManager) {
            if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
                Log.warn(`Cross origin isolation is not enabled! Some features of the app are not available!`, 'index')
                // TODO: Shared worker cache.
            } else {
                this.#memoryManager = new ServiceMemoryManager(SETTINGS.app.maxLoadCacheSize)
            }
        }
        // Make sure that the container element exists.
        // Prepend a hyphed to the container id, otherwise just use 'epicv'.
        // Using the literal 'epicv' in the selector is to avoid invalid selector errors.
        containerId = containerId.length ? `-${containerId}` : ''
        const modules = Array.from(this.#state.MODULES.keys())
        this.#interface = new this.#interfaceConstructor(this, this.#state, containerId, appId, locale, modules)
        const interfaceSuccess = await this.#interface.awaitReady()
        if (!interfaceSuccess) {
            Log.error(`Creating the interface instance was not successful.`, SCOPE)
            return false
        }
        return true
    }

    /*
     * Load a dataset from the given `folder`.
     * @param folder - `MixedFileSystemItem` containing the dataset files.
     * @param name - Optional name for the dataset.
    loadDataset = async (loader: BaseDataset, folder: FileSystemItem | string[], name?: string, context?: string) => {
    }
     */

    async loadStudy (loader: string, source: string | string[] | FileSystemItem, name?: string) {
        const context = this.#state.APP.studyLoaders.get(loader)
        if (!context) {
            Log.error(`Could not load study, loader ${loader} was not found.`, SCOPE)
            return null
        }
        if (this.#memoryManager) {
            context.loader.registerMemoryManager(this.#memoryManager)
        }
        const study = typeof source === 'string'
            ? await context.loader.loadFromUrl(source, { name: name })
            : Array.isArray(source) ? await context.loader.loadFromDirectory(
                                                MixedFileSystemItem.UrlsToFsItem(...source),
                                                { name: name }
                                            )
            : source.file ? await context.loader.loadFromFile(source.file, { name: name })
                          : null
        if (!study) {
            return null
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

    openResource (resource: DataResource) {
        this.#state.setActiveResource(resource)
        //this.store?.dispatch('set-active-resource', resource)
    }

    registerFileWorker (name: string, getter: () => Worker) {
        this.#state.APP.fileWorkerSources.set(name, getter)
    }

    registerInterface (intf: InterfaceModuleConstructor) {
        this.#interfaceConstructor = intf
    }

    registerModule (name: string, module: ResourceModule) {
        this.#state.setModule(name, module)
    }

    registerService (name: string, service: AssetService) {
        this.#state.setService(name, service)
    }

    registerStudyLoader (name: string, label: string, mode: ReaderMode, loader: StudyLoader) {
        if (this.#memoryManager) {
            loader.registerMemoryManager(this.#memoryManager)
        }
        this.#state.APP.studyLoaders.set(
            name,
            {
                label: label,
                mode: mode,
                loader: loader,
                scopes: loader.supportedScopes,
                types: loader.supportedTypes
            }
        )
    }

    selectResource (id: string) {
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

    setActiveDataset (dataset: MediaDataset | null) {
        this.#state.setActiveDataset(dataset)
        //this.store.dispatch('set-active-dataset', dataset)
    }

    setOnnxService (service: OnnxService) {
        this.#state.setService('ONNX', service)
        this.#state.setSettingsValue('services.ONNX', true) //service ? true : false
    }

    setSettingsValue (field: string, value: SettingsValue) {
        this.#state.setSettingsValue(field, value)
    }

    setWorkerOverride (name: string, getWorker: (() => Worker)|null) {
        this.#state.setWorkerOverride(name, getWorker)
    }
}