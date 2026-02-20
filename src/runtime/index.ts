/**
 * Runtime state management.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    DataResource,
    ResourceModule,
    RuntimeResourceModule,
    RuntimeState,
    StateManager
} from '#types/application'
import type {
    AppSettings,
    BaseModuleSettings,
    ConfigDatasetLoader,
    SettingsValue,
} from '#types/config'
import type {
    ConnectorType,
    DatabaseQueryOptions,
    WebDAVConnectorOptions,
} from '#types/connector'
import type { DatasetLoader, DatasetResourceContext, MediaDataset } from '#types/dataset'
import type { FileSystemItem } from '#types/reader'
import type { AssetService } from '#types/service'
import type { StudyContext, StudyLoader } from '#types/study'
import { Log } from 'scoped-event-log'
import SETTINGS from '#config/Settings'
import GenericAsset from '#assets/GenericAsset'
import DatabaseAPIConnector from '#assets/connector/DatabaseAPIConnector'
import { MixedMediaDataset, WebDAVConnector } from '#assets/dataset'

import { APP as APP_MODULE } from './modules'
export { APP_MODULE }

import { logInvalidMutation } from './util'
export { logInvalidMutation }

const SCOPE = "runtime"

/**
 * A map of initially active resource modules.
 */
const modules = new Map<string, RuntimeResourceModule>()
/**
 * A map of initially active services.
 */
const services = new Map<string, AssetService>()
/**
 * A map over worker overrides.
 */
const workers = new Map<string, (() => Worker)|null>()

/**
 * Initial runtime state.
 */
export const state: RuntimeState = {
    APP: APP_MODULE,
    INTERFACE: null,
    MODULES: modules,
    SERVICES: services,
    SETTINGS: SETTINGS,
    WORKERS: workers,
}

/**
 * The runtime state manager is responsible for handling mutations to any resources that are loaded in the application.
 * These include, but may not me limited to, data resource, datasets, services and core app properties.
 *
 * Properties of the state should not be mutated directly, but instead by using the dedicated methods:
 * - `addDataset`: Add a new dataset to the state.
 * - `addResource`: Add a new resource to the currently active dataset.
 * - `setActiveDataset`: Set the currently active dataset.
 * - `setActiveResource`: Set the currently active resource within the active dataset.
 * - `setActiveScope`: Set the active app scope.
 * - `setActiveType`: Set the active resource type.
 * - `setModulePropertyValue`: Set a new value to a property within the given module.
 *                             If a resource is also defined, the property of that resource is modified.
 * - `setService`: Set a service with the given name (key).
 * - `setSettingsValue`: Set a new value to the given settings property.
 *
 * Events dispatched by this asset, in addition to property update events:
 * @emits `add-dataset` - A new dataset has been added.
 * @emits `add-resource` - A new resource has been added to the active dataset.
 * @emits `initialize` - The manager has been initialized.
 * @emits `load-dataset-folder` - A new dataset has been loaded from a folder.
 * @emits `remove-resource` - A resource is removed from a dataset.
 * @emits `set-active-dataset` - A new dataset (or no dataset) is set active.
 * @emits `set-active-resource` - A new resource (or no resource) is set active.
 * @emits `set-module` - A new module has been set (usually added) to the manager.
 * @emits `set-service` - A new service has been set (usually added) to the manager.
 */
export default class RuntimeStateManager extends GenericAsset implements StateManager {
    /** Has the manager been initialized. */
    protected _isInitialized = false

    constructor () {
        super('RuntimeStateManager', 'runtime')
    }

    get APP () {
        return state.APP
    }

    get INTERFACE () {
        return state.INTERFACE
    }
    set INTERFACE (value: unknown) {
        state.INTERFACE = value
    }

    get MODULES () {
        return state.MODULES
    }

    get SERVICES () {
        return state.SERVICES
    }

    get SETTINGS () {
        return state.SETTINGS
    }

    get WORKERS () {
        return state.WORKERS
    }

    get isInitialized () {
        return this._isInitialized
    }
    set isInitialized (value: boolean) {
        this._setPropertyValue('isInitialized', value)
    }

    addConnector (
        name: string,
        type: ConnectorType,
        url: string,
        username: string,
        password: string,
        options?: unknown
    ): void {
        if (state.APP.connectors.has(name)) {
            Log.warn(`Connector with name '${name}' already exists.`, SCOPE)
            return
        }
        const connector = type === 'filesystem'
                        ? new WebDAVConnector(
                            name,
                            url,
                            { username, password },
                            options as WebDAVConnectorOptions,
                        )
                        : new DatabaseAPIConnector(
                            name,
                            url,
                            { username, password },
                            { username, password },
                            options as DatabaseQueryOptions,
                        )
        this.dispatchPayloadEvent('add-connector', connector, 'before')
        state.APP.connectors.set(name, connector)
        this.dispatchPayloadEvent('add-connector', connector)
    }

    addDataset (dataset: MediaDataset, setAsActive = false) {
        this.dispatchPayloadEvent('add-dataset', dataset, 'before')
        state.APP.datasets.push(dataset)
        if (setAsActive) {
            this.setActiveDataset(dataset)
        }
        this.dispatchPayloadEvent('add-dataset', dataset)
    }

    addResource (
        modality: string,
        resource: DataResource | DatasetResourceContext,
        options = {} as {
            dataset?: MediaDataset
            setAsActive?: boolean
        }
    ) {
        const resourceModule = state.MODULES.get(modality)
        if (!resourceModule) {
            Log.error(
                `Could not add resource '${resource.name}' as no loaded resource module matches its modality ` +
                `${modality}'.`,
            SCOPE)
            return
        }
        const resourceContext = 'resource' in resource ? resource : { resource }
        let targetSet = options.dataset || state.APP.activeDataset
        if (!targetSet) {
            Log.debug(`No active dataset when adding resource, creating a new one.`, SCOPE)
            targetSet = new MixedMediaDataset(`Dataset ${state.APP.datasets.length + 1}`)
            this.addDataset(targetSet, true)
        } else {
            for (const existing of targetSet.resources) {
                if (existing.resource.id === resourceContext.resource.id) {
                    Log.warn(`Tried to add a resource that already exists in current dataset.`, SCOPE)
                    return
                }
            }
        }
        for (const preEx of targetSet.resources) {
            if (preEx.resource.id === resourceContext.resource.id) {
                Log.warn(
                    `Resource '${resourceContext.resource.name}' already existed in currently active dataset.`,
                    SCOPE
                )
                if (targetSet.isActive && options.setAsActive) {
                    this.setActiveResource(resourceContext.resource)
                }
                return
            }
        }
        this.dispatchPayloadEvent('add-resource', resourceContext, 'before')
        targetSet.addResource(resourceContext)
        this.dispatchPayloadEvent('add-resource', resourceContext)
        if (targetSet.isActive && options.setAsActive) {
            this.setActiveResource(resourceContext.resource)
        }
    }

    deactivateResource (resource: DataResource) {
        if (!resource.isActive) {
            Log.debug(`Resource to deactivate was not active to begin with.`, SCOPE)
            return
        }
        this.dispatchPayloadEvent('set-active-resource', null, 'before')
        resource.isActive = false
        this.dispatchPayloadEvent('set-active-resource', null)
    }

    getService (name: string) {
        return state.SERVICES.get(name)
    }

    getWorkerOverride (name: string) {
        const getWorker = state.WORKERS.get(name)
        return getWorker ? getWorker() : null
    }

    init (initValues: { [module: string]: unknown } = {}) {
        this.dispatchEvent('initialize', 'before')
        // FIRST set logging threshold, so all possible messages are seen
        Log.setPrintThreshold(SETTINGS.app.logThreshold)
        // Apply possible initial values
        for (const config of Object.entries(initValues)) {
            if (config[0] === 'SETTINGS') {
                for (const [field, value] of Object.entries(config[1] as string)) {
                    this.setSettingsValue(field, value)
                }
            }
        }
        // Load possible local settings
        const local = window.localStorage.getItem('settings')
        if (local) {
            // Go through available modules
            mod_loop:
            for (const [mod, items] of Object.entries(JSON.parse(local))) {
                const MODULE = SETTINGS[mod as keyof AppSettings] as BaseModuleSettings
                field_loop:
                for (const [field, value] of Object.entries(items as typeof MODULE)) {
                    if (!MODULE._userDefinable) {
                        continue mod_loop
                    }
                    // Check that setting can be modified
                    for (const [uField, uConst] of Object.entries(MODULE._userDefinable)) {
                        if (uField === field && value.constructor === uConst) {
                            Log.debug(`Applied local value ${value} to settings field ${mod}.${field}`, SCOPE)
                            continue field_loop
                        }
                    }
                    Log.warn(`Setting ${mod}.${value} cannot be set by the user or the value type is incorrect.`, SCOPE)
                }
            }
        }
        this.isInitialized = true
        this.dispatchEvent('initialize', 'after')
    }

    async loadDatasetFolder (
        folder: FileSystemItem,
        loader: DatasetLoader,
        studyLoaders: StudyLoader[],
        config?: ConfigDatasetLoader
    ) {
        this.dispatchEvent('load-dataset', 'before')
        const newSet = new MixedMediaDataset(config?.name || folder.name)
        let studyContext = null as StudyContext | null
        loader.loadDataset(folder, async (study) => {
            for (const loader of studyLoaders) {
                if (loader.isSupportedModality(study.modality)) {
                    if (study.files.length === 1) {
                        if (study.files[0].file) {
                            if (!studyContext) {
                                studyContext = await loader.loadFromFile(study.files[0].file)
                            } else {
                                await loader.loadFromFile(study.files[0].file, undefined, studyContext)
                            }
                            newSet.resources.push()
                        }
                    }
                }
            }
        })
        this.addDataset(newSet)
        this.dispatchPayloadEvent('load-dataset', newSet, 'after')
        return newSet
    }

    removeConnector (name: string) {
        if (!state.APP.connectors.has(name)) {
            Log.warn(`Could not remove connector '${name}': it does not exist.`, SCOPE)
            return
        }
        const connector = state.APP.connectors.get(name)
        this.dispatchPayloadEvent('remove-connector', connector, 'before')
        state.APP.connectors.delete(name)
        this.dispatchPayloadEvent('remove-connector', connector)
    }

    removeResource (resource: DataResource | string | number, dataset?: MediaDataset) {
        const activeSet = dataset || this.APP.activeDataset
        if (!activeSet) {
            Log.error(`Could not remove resource: no dataset is active or defined.`, SCOPE)
            return
        }
        this.dispatchPayloadEvent('remove-resource', resource, 'before')
        activeSet.removeResource(resource)
        this.dispatchPayloadEvent('remove-resource', resource)
    }

    setActiveDataset (dataset: MediaDataset | null) {
        this.dispatchPayloadEvent('set-active-dataset', dataset, 'before')
        const prevActive = state.APP.activeDataset
        if (prevActive) {
            prevActive.isActive = false
        }
        state.APP.activeDataset = dataset
        if (dataset) {
            dataset.isActive = true
        }
        this.dispatchPayloadEvent('set-active-dataset', dataset)
    }

    setActiveResource(resource: DataResource | null, deactivateOthers = true) {
        const activeSet = state.APP.activeDataset
        if (!activeSet) {
            Log.warn(`Could not set active resource, no dataset is active.`, SCOPE)
            return
        }
        this.dispatchPayloadEvent('set-active-resource', resource, 'before')
        if (resource) {
            if (deactivateOthers) {
                for (const ctx of activeSet.resources.values()) {
                    if (ctx.resource.isActive && ctx.resource.id !== resource.id)  {
                        ctx.resource.isActive = false
                    }
                }
            }
            if (!resource.isActive) {
                resource.isActive = true
            }
        } else {
            for (const res of activeSet.activeResources) {
                res.isActive = false
            }
        }
        this.dispatchPayloadEvent('set-active-resource', resource)
    }

    setModule (name: string, module: ResourceModule | null) {
        this.dispatchPayloadEvent('set-module', { name, module }, 'before')
        if (!module) {
            this.MODULES.delete(name)
            this.SETTINGS.unregisterModule(name)
        } else {
            this.MODULES.set(name, module.runtime)
            this.SETTINGS.registerModule(name, module.settings)
        }
        this.dispatchPayloadEvent('set-module', { name, module })
    }

    setModulePropertyValue (module: string, property: string, value: unknown, resource?: DataResource): void {
        const mod = this.MODULES.get(module)
        if (mod) {
            mod.setPropertyValue(property, value, resource, this)
        } else {
            Log.error(
                `Could not set property '${property}' value in resource module ${module}; the module is not loaded.`,
                SCOPE
            )
        }
    }

    setService (name: string, service: AssetService | null) {
        this.dispatchPayloadEvent('set-service', { name, service }, 'before')
        if (!service) {
            state.SERVICES.delete(name)
        } else {
            state.SERVICES.set(name, service)
        }
        this.dispatchPayloadEvent('set-service', { name, service })
    }

    setSettingsValue (field: string, value: SettingsValue) {
        if (typeof field !== 'string') {
            Log.error('Invalid setting field type, expected string.', SCOPE)
            return false
        }
        return state.SETTINGS.setFieldValue(field, value)
    }

    setWorkerOverride (name: string, getWorker: (() => Worker)|null) {
        state.WORKERS.set(name, getWorker)
    }
}
