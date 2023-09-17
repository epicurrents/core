/**
 * Runtime state management.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type AppSettings, type SettingsColor } from 'TYPES/config'
import {
    type DataResource,
    type RuntimeResourceModule,
    type RuntimeState,
    type StateManager
} from 'TYPES/core'
import { type DatasetLoader, type MediaDataset } from 'TYPES/dataset'
import { type FileSystemItem } from 'TYPES/loader'
import { type AssetService } from 'TYPES/service'
import { type StudyContext, type StudyLoader } from 'TYPES/study'
import Log from 'scoped-ts-log'
import SETTINGS from 'CONFIG/Settings'
import { MixedMediaDataset } from 'LIB/core/dataset'
import { PyodideService } from 'LIB/pyodide'
import { hexToSettingsColor, rgbaToSettingsColor } from 'LIB/util/conversions'

import { APP as appModule } from './modules'

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
 * Initial runtime state.
 */
export const state: RuntimeState = {
    __proto__: null,
    APP: appModule,
    MODULES: modules,
    SERVICES: services,
    SETTINGS: SETTINGS,
}

/**
 * The runtime state manager is responsible for handling mutations to any resources that are loaded in the application.
 * These include, but may not me limited to, data resource, datasets, services and core app properties.
 *
 * Properties of the manager should not be mutated directly, but instead by using the dedicated methods:
 * - `addDataset`: Add a new dataset to the runtime.
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
export default class RuntimeStateManager implements StateManager {
    protected _propertyUpdateHandlers: {
        caller: string | null
        handler: (newValue?: any, oldValue?: any) => any
        pattern: RegExp
        property: string
    }[] = []
    isInitialized = false
    constructor () {}
    get APP () {
        return state.APP
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
    get containerId () {
        return state.APP.containerId || ''
    }
    set containerId (value: string) {
        state.APP.containerId = value
    }
    get isFullscreen () {
        return state.APP.isFullscreen
    }
    set isFullscreen (value: boolean) {
        state.APP.isFullscreen = value
    }
    get settingsOpen () {
        return state.APP.settingsOpen
    }
    set settingsOpen (value: boolean) {
        state.APP.settingsOpen = value
    }
    get showOverlay () {
        return state.APP.showOverlay || false
    }
    set showOverlay (value: boolean) {
        state.APP.showOverlay = value
    }
    addDataset (dataset: MediaDataset, setAsActive = false) {
        state.APP.datasets.push(dataset)
        this.onPropertyUpdate('datasets', dataset)
        if (setAsActive) {
            this.setActiveDataset(dataset)
        }
    }
    addPropertyUpdateHandler (property: string | string[], handler: (value?: unknown) => unknown, caller?: string) {
        for (const update of this._propertyUpdateHandlers) {
            if (property === update.property && handler === update.handler) {
                // Don't add the same handler twice.
                return
            }
        }
        if (Array.isArray(property)) {
            for (const prop of property) {
                this._propertyUpdateHandlers.push({
                    caller: caller || null,
                    handler: handler,
                    pattern: new RegExp(`^${property}$`, 'i'),
                    property: prop,
                })
            }
        } else {
            this._propertyUpdateHandlers.push({
                caller: caller || null,
                handler: handler,
                pattern: new RegExp(`^${property}$`, 'i'),
                property: property,
            })
        }
        Log.debug(`Added a handler for ${property}.`, SCOPE)
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
    getService (name: string) {
        return state.SERVICES.get(name)
    }
    init (initValues: { [module: string]: any } = {}) {
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
                const MODULE = SETTINGS[mod as keyof AppSettings]
                field_loop:
                for (const [field, value] of Object.entries(items as typeof MODULE)) {
                    if (!MODULE._userDefinable) {
                        continue mod_loop
                    }
                    // Check that setting can be modified
                    for (const [uField, uConst] of Object.entries(MODULE._userDefinable)) {
                        if (uField === field && (value as any)?.constructor === uConst) {
                            Log.debug(`Applied local value ${value} to settings field ${mod}.${field}`, SCOPE)
                            continue field_loop
                        }
                    }
                    Log.warn(`Setting ${mod}.${value} cannot be set by the user or the value type is incorrect.`, SCOPE)
                }
            }
        }
        // Load optional modules
        if (SETTINGS.services.MNE) {
            state.SERVICES.set('PYODIDE', new PyodideService())
        }
        this.isInitialized = true
    }
    async loadDatasetFolder (folder: FileSystemItem, loader: DatasetLoader, studyLoaders: StudyLoader[], config?: any) {
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
    onPropertyUpdate (property: string, newValue?: any, oldValue?: any) {
        for (const update of this._propertyUpdateHandlers) {
            if (update.property === property || property.match(update.pattern)) {
                Log.debug(`Executing ${property} handler${update.caller ? ' for ' + update.caller : ''}.`, SCOPE)
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
    removePropertyUpdateHandler (property: string | string[], handler: () => any) {
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
        if (resource) {
            if (deactivateOthers) {
                const activeSet = state.APP.activeDataset
                if (!activeSet) {
                    Log.warn(`Could not deactive other resources, no dataset is active.`, SCOPE)
                    return
                } else {
                    for (const res of activeSet.resources.values()) {
                        if (res.isActive && res.id !== resource.id)  {
                            res.isActive = false
                        }
                    }
                }
            } else {
                if (state.APP.activeScope && state.APP.activeScope !== resource.scope) {
                    Log.error(`Current active scope '${state.APP.activeScope}' and resource scope '${resource.scope}' are not compatible.`, SCOPE)
                    return
                }
                if (state.APP.activeType && state.APP.activeType !== resource.type) {
                    Log.error(`Current active type '${state.APP.activeType}' and resource type '${resource.type}' are not compatible.`, SCOPE)
                    return
                }
            }
            if (!resource.isActive) {
                resource.isActive = true
            }
        } else {
            if (state.APP.activeDataset?.activeResources.length) {
                for (const res of state.APP.activeDataset?.activeResources.splice(0)) {
                    res.isActive = false
                }
            }
        }
        this.onPropertyUpdate('active-resource', resource)
        this.setActiveScope(resource?.scope || '')
        this.setActiveType(resource?.type || '')
    }
    setActiveScope (scope: string) {
        state.APP.activeScope = scope
        this.onPropertyUpdate('active-scope', scope)
    }
    setActiveType (value: string) {
        state.APP.activeType = value
        this.onPropertyUpdate('active-type', value)
    }
    setModule (name: string, module: RuntimeResourceModule) {
        this.MODULES.set(name, module)
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
    setSettingsValue (field: string, value: string | number | boolean | SettingsColor | Object) {
        if (typeof field !== 'string') {
            Log.error('Invalid setting field type, expected string.', SCOPE)
            return
        }
        if (field.includes('__proto__')) {
            Log.error(`Settings field ${field} contains insecure field '_proto__' and will be ignored.`, SCOPE)
            return
        }
        // Traverse field's "path" to target property
        const fPath = field.split('.')
        let settingsField = [state.SETTINGS] as any[]
        let i = 0
        for (const f of fPath) {
            if (i === fPath.length - 1) {
                if (settingsField[i] === undefined) {
                    Log.warn(
                        `Default configuration field '`+
                        `${field}`+
                        `' is invalid: cannot find property '`+
                        `${fPath.slice(0, i + 1).join('.')}'.`,
                    SCOPE)
                    return
                } else if (settingsField[i][f as keyof typeof settingsField] === undefined) {
                    Log.warn(
                        `Default configuration field '`+
                        `${field}`+
                        `' is invalid: cannot find property '`+
                        `${fPath.slice(0, i + 1).join('.')}`+
                        `'. Valid properties are:
                        '${Object.keys(settingsField[i]).join("', '")}'.`,
                    SCOPE)
                    return
                }
                // Final field
                const local = settingsField.pop()
                if (typeof value === 'string') {
                    // Parse possible color code
                    value = rgbaToSettingsColor(value) ||
                            hexToSettingsColor(value) ||
                            value
                }
                // Typecheck
                if (local[f].constructor === value.constructor) {
                    const old = local[f] // Will this work for objects?
                    local[f] = value
                    Log.debug(`Changed settings field '${field}' value.`, SCOPE)
                    this.onPropertyUpdate(field, value, old)
                }
                return
            } else {
                settingsField.push(settingsField[i][f as keyof typeof settingsField])
            }
            i++
        }
        // Is it even possible to reach this point?
        Log.error(`Could not change settings field '${field}'; the field was not found.`, SCOPE)
    }
}
