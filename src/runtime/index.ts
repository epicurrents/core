/**
 * Runtime state management.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type AppSettings,
    type BaseModuleSettings,
    type ConfigDatasetLoader,
    type SettingsValue,
} from '#types/config'
import {
    type DataResource,
    type ResourceModule,
    type RuntimeResourceModule,
    type RuntimeState,
    type StateManager
} from '#root/src/types/application'
import { type DatasetLoader, type MediaDataset } from '#types/dataset'
import { type FileSystemItem } from '#root/src/types/reader'
import { type AssetService } from '#types/service'
import { type StudyContext, type StudyLoader } from '#types/study'
import { Log } from 'scoped-ts-log'
import SETTINGS from '#config/Settings'
import GenericAsset from '#assets/GenericAsset'
import { MixedMediaDataset } from '#assets/dataset'

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
    __proto__: null,
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
 */
export default class RuntimeStateManager extends GenericAsset implements StateManager {
    /** Has the manager been initialized. */
    isInitialized = false

    constructor () {
        super('RuntimeStateManager', GenericAsset.SCOPES.UTILITY, GenericAsset.SCOPES.UTILITY)
    }

    // Returning null for __proto__ is required to make this class compatible with the RuntimeState type.
    get __proto__ () {
        return null
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

    addDataset (dataset: MediaDataset, setAsActive = false) {
        state.APP.datasets.push(dataset)
        this.onPropertyUpdate('datasets', dataset)
        if (setAsActive) {
            this.setActiveDataset(dataset)
        }
    }

    addResource (scope: string, resource: DataResource, setAsActive = false) {
        const resourceModule = state.MODULES.get(scope)
        if (!resourceModule) {
            Log.error(
                `Cound not add resource '${resource.name}' as no loaded resource module matches its type '${scope}'.`,
            SCOPE)
            return
        }
        let activeSet = state.APP.activeDataset
        if (!activeSet) {
            Log.debug(`No active dataset when adding resource, creating a new one.`, SCOPE)
            activeSet = new MixedMediaDataset(`Dataset ${state.APP.datasets.length + 1}`)
            this.addDataset(activeSet, true)
        } else {
            for (const existing of activeSet.resources) {
                if (existing.id === resource.id) {
                    Log.warn(`Tried to add a resource that already exists in current dataset.`, SCOPE)
                    return
                }
            }
        }
        for (const preEx of activeSet.resources) {
            if (preEx.id === resource.id) {
                Log.warn(`Resource '${resource.name}' already existed in currently active dataset.`, SCOPE)
                if (setAsActive) {
                    this.setActiveResource(resource)
                }
                return
            }
        }
        activeSet.resources.push(resource)
        if (setAsActive) {
            this.setActiveResource(resource)
        }
        this.onPropertyUpdate('resources', resource)
    }

    deactivateResource (resource: DataResource) {
        if (!resource.isActive) {
            Log.debug(`Reasource to deactivate was not active to begin with.`, SCOPE)
            return
        }
        resource.isActive = false
        this.onPropertyUpdate('active-resource')
    }

    getService (name: string) {
        return state.SERVICES.get(name)
    }

    getWorkerOverride (name: string) {
        const getWorker = state.WORKERS.get(name)
        return getWorker ? getWorker() : null
    }

    init (initValues: { [module: string]: unknown } = {}) {
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
    }

    async loadDatasetFolder (
        folder: FileSystemItem,
        loader: DatasetLoader,
        studyLoaders: StudyLoader[],
        config?: ConfigDatasetLoader
    ) {
        const newSet = new MixedMediaDataset(config?.name || folder.name)
        let studyContext = null as StudyContext | null
        loader.loadDataset(folder, async (study) => {
            for (const loader of studyLoaders) {
                if (loader.isSupportedScope(study.scope) && loader.isSupportedType(study.type)) {
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
        return newSet
    }

    onPropertyUpdate (property: string, newValue?: unknown, oldValue?: unknown) {
        for (const update of this._propertyUpdateHandlers) {
            if (update.property === property || property.match(update.pattern)) {
                Log.debug(
                    `Executing ${property} update handler${update.caller ? ' for ' + update.caller : ''}.`,
                SCOPE)
                update.handler(newValue, oldValue)
            }
        }
    }

    removeAllPropertyUpdateHandlers () {
        Log.debug(`Removing all ${this._propertyUpdateHandlers.splice(0).length} property update handlers.`, SCOPE)

    }

    removeAllPropertyUpdateHandlersFor (caller: string) {
        for (let i=0; i<this._propertyUpdateHandlers.length; i++) {
            const update = this._propertyUpdateHandlers[i]
            if (caller === update.caller) {
                this._propertyUpdateHandlers.splice(i, 1)
                i--
                Log.debug(`Removed ${update.property} handler for ${caller}.`, SCOPE)
            }
        }
    }

    removePropertyUpdateHandler (property: string | string[], handler: () => unknown) {
        if (!Array.isArray(property)) {
            property = [property]
        }
        for (let i=0; i<this._propertyUpdateHandlers.length; i++) {
            const update = this._propertyUpdateHandlers[i]
            const propIdx = property.indexOf(update.property)
            if (propIdx > -1 && handler === update.handler) {
                this._propertyUpdateHandlers.splice(i, 1)
                const removed = property.splice(propIdx, 1)
                Log.debug(`Removed ${removed} handler${update.caller ? ' for '+ update.caller : ''}.`, SCOPE)
                if (!property.length) {
                    return
                }
            }
        }
        Log.debug(`Cound not locate the requsted handlers for ${property.join(', ')}.`, SCOPE)
    }

    removeResource (resource: DataResource | string | number, dataset?: MediaDataset) {
        const activeSet = dataset || this.APP.activeDataset
        if (!activeSet) {
            Log.error(`Could not remove resource: no dataset is active or defined.`, SCOPE)
            return
        }
        activeSet.removeResource(resource)
        this.onPropertyUpdate('resouces')
    }

    setActiveDataset (dataset: MediaDataset | null) {
        const prevActive = state.APP.activeDataset
        if (prevActive) {
            prevActive.isActive = false
        }
        state.APP.activeDataset = dataset
        if (dataset) {
            dataset.isActive = true
        }
        this.onPropertyUpdate('active-dataset', dataset, prevActive)
    }

    setActiveResource(resource: DataResource | null, deactivateOthers = true) {
        const activeSet = state.APP.activeDataset
        if (!activeSet) {
            Log.warn(`Could not set active resource, no dataset is active.`, SCOPE)
            return
        }
        if (resource) {
            if (deactivateOthers) {
                for (const res of activeSet.resources.values()) {
                    if (res.isActive && res.id !== resource.id)  {
                        res.isActive = false
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
        this.onPropertyUpdate('active-resource', resource)
    }

    setModule (name: string, module: ResourceModule) {
        this.MODULES.set(name, module.runtime)
        this.SETTINGS.registerModule(name, module.settings)
        this.onPropertyUpdate('modules', name)
    }

    setModulePropertyValue (module: string, property: string, value: unknown, resource?: DataResource): void {
        const mod = this.MODULES.get(module)
        if (mod) {
            mod.setPropertyValue(property, value, resource, this)
        } else {
            Log.error(`Could not set property '${property}' value in resource module ${module}; the module is not loaded.`, SCOPE)
        }
    }

    setService (name: string, service: AssetService) {
        state.SERVICES.set(name, service)
        this.onPropertyUpdate('services', name)
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
