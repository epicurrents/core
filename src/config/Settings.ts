/**
 * EpiCurrents core settings. These settings can be extended by modules.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { AppSettings, BaseModuleSettings, ClonableAppSettings, ClonableModuleSettings } from "TYPES/config"
import { MB_BYTES } from "UTIL/constants"
import Log from "scoped-ts-log"

const SCOPE = 'Settings'

const _propertyUpdateHandlers = [] as {
    caller: string | null
    field: string
    handler: (value?: unknown) => void
}[]
/**
 * Remove the properties that cannot be cloned to a worker and
 * return the rest as an object.
 * @returns SETTINGS with only clonable, non-proxied properties.
 */
const clonableSettings = () => {
    // Remove the private _userDefinable (it also can't be cloned).
    const outSettings = {} as { [key: string]: BaseModuleSettings } &
                              { modules: ClonableModuleSettings }
    for (const mod in SETTINGS) {
        if (mod === '_CLONABLE') {
            // Avoid infinite call stack.
            continue
        }
        const clonable = {} as BaseModuleSettings
        for (const [field, value] of Object.entries(_settings[mod as keyof typeof _settings])) {
            if (!field.startsWith('_') && typeof value !== "function") {
                clonable[field as keyof BaseModuleSettings] = value
            }
        }
        outSettings[mod] = clonable
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
 * @remarks
 * This implementation is not finished which is why the settings
 * object is both proxied and still has the option to add property
 * update watchers. In fact, this will probably be ultimately handled
 * by the runtime state manager, making both of these obsolete.
 */
const proxyHandler = {
    get (target: any, key: string|symbol, receiver: unknown): unknown {
        // Check if module settings have been initialized.
        if (
            target === _settings.modules &&
            typeof key !== 'symbol' &&
            !key.startsWith('_')
        ) {
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
            screenPPI: Number,
            theme: String,
        },
        dataChunkSize: 5*MB_BYTES,
        fontawesomeLib: 'free',
        iconLib: 'fa',
        isMainComponent: true,
        logThreshold: 'DEBUG',
        maxDirectLoadSize: 10*MB_BYTES,
        maxLoadCacheSize: 2000*MB_BYTES,
        screenPPI: 96,
        theme: 'default',
    },
    modules: {},
    services: {
        MNE: true,
        ONNX: false,
    },
    addPropertyUpdateHandler (field: string, handler: (value?: unknown) => unknown, caller?: string) {
        for (const update of _propertyUpdateHandlers) {
            if ((!field || field === update.field) && handler === update.handler) {
                // Don't add the same handler twice
                return
            }
        }
        // The value must be updated both in local app state and global settings
        if (caller) {
            _propertyUpdateHandlers.push({
                caller: caller,
                field: field,
                handler: handler,
            })
        }
        Log.debug(`Added a handler for ${field}.`, SCOPE)
    },
    getFieldValue (field: string, depth?: number) {
        // Traverse field's "path" to target property
        const fPath = field.split('.')
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
    registerModule (name: string, moduleSettings: BaseModuleSettings) {
        _modules.set(name, moduleSettings)
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
    removePropertyUpdateHandler (field: string, handler: (value?: unknown) => unknown) {
        // Remove it from the list of handler references
        for (let i=0; i<_propertyUpdateHandlers.length; i++) {
            const update = _propertyUpdateHandlers[i]
            if ((!field || field === update.field) && handler === update.handler) {
                const caller = _propertyUpdateHandlers.splice(i, 1)[0].caller || ''
                Log.debug(`Removed ${field} handler${caller ? ' for '+ caller : ''}.`, SCOPE)
                return
            }
        }
        Log.debug(`Could not locate the requested ${field} handler.`, SCOPE)
    },
} as AppSettings

const SETTINGS = new Proxy(
    _settings,
    proxyHandler
) as AppSettings

export default SETTINGS
