/**
 * EpiCurrents core settings. These settings can be extended by modules.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type PropertyUpdateHandler
} from '#root/src/types/application'
import {
    type AppSettings,
    type BaseModuleSettings,
    type ClonableAppSettings,
    type ClonableModuleSettings,
    type SettingsValue,
} from '#types/config'
import { MB_BYTES } from '#util/constants'
import { hexToSettingsColor, rgbaToSettingsColor } from '#util/conversions'
import { safeObjectFrom } from '#util/general'
import { Log } from 'scoped-ts-log'

const SCOPE = 'Settings'

const _propertyUpdateHandlers = [] as {
    /** Name of the caller (owner) of this handler, if specified. */
    caller: string | null
    /** Name of the field to watch. Updates to this field and any of it's children trigger the hander. */
    field: string
    /** Handler to execute on field update. */
    handler: PropertyUpdateHandler
}[]
/**
 * Remove the properties that cannot be cloned to a worker and return the rest as an object.
 * @returns SETTINGS with only clonable, non-proxied properties.
 */
const clonableSettings = () => {
    /** Names of root level properties that are recursed into serializable objects. */
    const clonableFields = ['app', 'services']
    // Remove the private _userDefinable (it also can't be cloned).
    const outSettings = {
        app: {},
        modules: {},
        services: {},
    } as {
        app: BaseModuleSettings
        modules: ClonableModuleSettings
        services: BaseModuleSettings
    }
    for (const key of clonableFields) {
        if (!_settings[key as keyof AppSettings]) {
            continue
        }
        const clonable = {} as BaseModuleSettings
        for (const [field, value] of Object.entries(_settings[key as keyof AppSettings] as object)) {
            if (!field.startsWith('_') && typeof value !== "function") {
                clonable[field as keyof BaseModuleSettings] = value
            }
        }
        outSettings[key as keyof typeof outSettings] = clonable
    }
    // Modules.
    for (const [key, mod] of _modules) {
        const clonable = {} as ClonableModuleSettings
        for (const [field, value] of Object.entries(mod)) {
            if (!field.startsWith('_')) {
                clonable[field] = value
            }
        }
        outSettings.modules[key] = clonable
    }
    return outSettings as ClonableAppSettings
}
/**
 * Handler for a proxied settings object. Will proxy all object
 * properties unless the property name starts with an underscore.
 */
const proxyHandler = {
    // Can't find a way to avoid using any in these overrides.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get (target: any, key: string|symbol, receiver: unknown): unknown {
        // Check if module settings have been initialized.
        if (
            target === _settings.modules &&
            typeof key !== 'symbol' &&
            !key.startsWith('_')
        ) {
            // Return the mapped module settings as a property of modules.
            // I'm not sure if this proxy implementation is really needed for anything else?
            const modSettings = _modules.get(key)
            if (modSettings) {
                return new Proxy(modSettings, proxyHandler)
            } else {
                return undefined
            }
        }
        if (
            typeof target[key] === 'object' &&
            target[key] !== null &&
            // Don't proxy static properties starting with an underscore.
            (typeof key === 'symbol' || !key.startsWith('_'))
        ) {
            return new Proxy(target[key], proxyHandler)
        } else {
            return Reflect.get(target, key, receiver)
        }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set (target: any, key: string|symbol, value: unknown, receiver: unknown) {
        const success = Reflect.set(target, key, value, receiver)
        return success
    },
}

const _modules = new Map<string, BaseModuleSettings>()

const _settings = {
    // Prevent prototype injection
    __proto__: null,
    /**
     * The settings object excluding any properties that
     * cannot be cloned (e.g. to a worker).
     */
    get _CLONABLE () {
        return clonableSettings()
    },
    app: {
        _userDefinable: {
            hotkeyAltOrOpt: Boolean,
            screenPPI: Number,
            theme: String,
        },
        dataChunkSize: 5*MB_BYTES,
        fontawesomeLib: 'free',
        hotkeyAltOrOpt: false,
        iconLib: 'fa',
        isMainComponent: true,
        logThreshold: 'WARN',
        maxDirectLoadSize: 10*MB_BYTES,
        maxLoadCacheSize: 1000*MB_BYTES,
        screenPPI: 96,
        theme: 'default',
        useMemoryManager: true,
    },
    interface: null,
    modules: {},
    services: {
        onnx: false,
        pyodide: false,
    },
    addPropertyUpdateHandler (field: string, handler: PropertyUpdateHandler, caller?: string) {
        if (typeof field !== 'string' || !field) {
            Log.error(`Invalid field supplied to addPropertyUpdateHandler.`, SCOPE)
            return
        }
        const newHandler = {
            field: field,
            handler: handler,
            caller: caller || null,
        }
        for (let i=0; i<_propertyUpdateHandlers.length; i++) {
            const update = _propertyUpdateHandlers[i]
            if (handler === update.handler) {
                if (field === update.field) {
                    Log.debug(`The given handler already existed for field ${field}.`, SCOPE)
                } else if (field.startsWith(`${update.field}.`)) {
                    // Listeners of a parent field are notified on updates.
                    Log.debug(
                        `The given handler already existed for parent '${update.field}' of the field '${field}'.`,
                    SCOPE)
                } else if (update.field.startsWith(`${field}.`)) {
                    // Replace the child field handler with the new, more general parent field handler.
                    Log.debug(
                        `The given handler already existed for child '${update.field}' of the field '${field}' ` +
                        `and was replaced.`,
                    SCOPE)
                    _propertyUpdateHandlers.splice(i, 1, newHandler)
                }
                return
            }
        }
        _propertyUpdateHandlers.push(newHandler)
        Log.debug(`Added a handler for ${field}.`, SCOPE)
    },
    getFieldValue (field: string, depth?: number) {
        // Traverse field's "path" to target property
        const fPath = field.split('.')
        // This is incredibly difficult to type, maybe one day I'll get it right...
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const configFields = [SETTINGS] as any[]
        let i = 0
        for (const f of fPath) {
            if (
                (depth !== undefined && (
                    depth >= 0 && i === depth ||
                    depth < 0 && i === fPath.length - 1 + depth
                )) ||
                (depth === undefined && i === fPath.length - 1)
            ) {
                if (
                    configFields[i][f as keyof typeof configFields] === undefined
                ) {
                    Log.warn(
                        `Could not locate field '${field}': property '${fPath.slice(i).join('.')}' ` +
                        `does not exist. Valid properties on this level are ` +
                        Object.keys(configFields[i]).join("', '") + '.',
                    SCOPE)
                    return undefined
                }
                // Final field
                const config = configFields.pop()
                return config[f]
            } else {
                configFields.push(configFields[i][f as keyof typeof configFields])
            }
            i++
        }
        return undefined
    },
    onPropertyUpdate (field: string, newValue?: SettingsValue, oldValue?: SettingsValue) {
        for (const handlerContext of _propertyUpdateHandlers) {
            if (field === handlerContext.field || field.startsWith(`${handlerContext.field}.`)) {
                Log.debug(
                    `Executing ${field} update handler` +
                    (handlerContext.caller ? ' for ' + handlerContext.caller : '') +
                    `.`,
                SCOPE)
                handlerContext.handler(newValue, oldValue)
            }
        }
    },
    registerModule (name: string, moduleSettings: BaseModuleSettings) {
        const safeProps = safeObjectFrom(moduleSettings)
        _modules.set(name, safeProps)
    },
    removeAllPropertyUpdateHandlers () {
        const removed = _propertyUpdateHandlers.splice(0)
        for (const { field, handler } of removed) {
            _settings.removePropertyUpdateHandler(field, handler)
        }
        Log.debug(`Removing all ${removed.length} property update handlers.`, SCOPE)
    },
    removeAllPropertyUpdateHandlersFor (caller: string) {
        for (let i=0; i<_propertyUpdateHandlers.length; i++) {
            const update = _propertyUpdateHandlers[i]
            if (caller === update.caller) {
                _settings.removePropertyUpdateHandler(update.field, update.handler)
                i--
            }
        }
    },
    removePropertyUpdateHandler (field: string, handler: PropertyUpdateHandler) {
        for (let i=0; i<_propertyUpdateHandlers.length; i++) {
            const update = _propertyUpdateHandlers[i]
            if ((field === update.field || field.startsWith(`${update.field}.`)) && handler === update.handler) {
                const caller = _propertyUpdateHandlers.splice(i, 1)[0].caller || ''
                Log.debug(`Removed ${field} handler${caller ? ' for '+ caller : ''}.`, SCOPE)
                return
            }
        }
        Log.debug(`Could not locate the requested ${field} handler.`, SCOPE)
    },
    setFieldValue (field: string, value: SettingsValue) {
        // Settings object should have the reference to object proto removed, but the user should be informed of
        // this attempt.
        if (field.includes('__proto__')) {
            Log.warn(
                `Field ${field} passed to setFieldValue contains insecure property name '_proto__' and weas ignored.`,
            SCOPE)
            return false
        }
        // Traverse field's "path" to target property.
        const fPath = field.split('.')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const settingsField = [SETTINGS] as any[]
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
                    return false
                } else if (settingsField[i][f as keyof typeof settingsField] === undefined) {
                    Log.warn(
                        `Default configuration field '`+
                        `${field}`+
                        `' is invalid: cannot find property '`+
                        `${fPath.slice(0, i + 1).join('.')}`+
                        `'. Valid properties are:
                        '${Object.keys(settingsField[i]).join("', '")}'.`,
                    SCOPE)
                    return false
                }
                // Final field.
                const local = settingsField.pop()
                if (typeof value === 'string') {
                    // Parse possible color code.
                    value = rgbaToSettingsColor(value) ||
                            hexToSettingsColor(value) ||
                            value
                }
                // Check constructors for type match (TODO: Should null be a valid settings value?).
                if (local[f].constructor === value?.constructor) {
                    const old = local[f]
                    local[f] = value
                    Log.debug(`Changed settings field '${field}' value.`, SCOPE)
                    _settings.onPropertyUpdate(field, value, old)
                    return true
                }
                return false
            } else {
                settingsField.push(settingsField[i][f as keyof typeof settingsField])
            }
            i++
        }
        // Is it even possible to reach this point?
        Log.error(`Could not change settings field '${field}'; the field was not found.`, SCOPE)
        return false
    }
} as AppSettings

const SETTINGS = new Proxy(
    _settings,
    proxyHandler
) as AppSettings

export default SETTINGS
