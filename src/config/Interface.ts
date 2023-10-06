/**
 * EpiCurrents core settings. These settings can be extended by modules.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type PropertyUpdateHandler
} from "#types/assets"
import {
    InterfaceSettings,
    type SettingsValue,
} from "#types/config"
import { hexToSettingsColor, rgbaToSettingsColor } from "#util/conversions"
import { Log } from 'scoped-ts-log'

const SCOPE = 'InterfaceSettings'

const _propertyUpdateHandlers = [] as {
    /** Name of the caller (owner) of this handler, if specified. */
    caller: string | null
    /** Name of the field to watch. Updates to this field and any of it's children trigger the hander. */
    field: string
    /** Handler to execute on field update. */
    handler: PropertyUpdateHandler
}[]

const INTERFACE = {
    app: {},
    modules: {},
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
        const configFields = [INTERFACE] as any[]
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
    removeAllPropertyUpdateHandlers () {
        const removed = _propertyUpdateHandlers.splice(0)
        for (const { field, handler } of removed) {
            INTERFACE.removePropertyUpdateHandler(field, handler)
        }
        Log.debug(`Removed all ${removed.length} property update handlers.`, SCOPE)
    },
    removeAllPropertyUpdateHandlersFor (caller: string) {
        for (let i=0; i<_propertyUpdateHandlers.length; i++) {
            const update = _propertyUpdateHandlers[i]
            if (caller === update.caller) {
                INTERFACE.removePropertyUpdateHandler(update.field, update.handler)
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
        // Settings object should have the reference to object proto removed, but just in case.
        if (field.includes('__proto__')) {
            Log.warn(
                `Field ${field} passed to setFieldValue contains insecure property name '_proto__' and weas ignored.`,
            SCOPE)
            return
        }
        // Traverse field's "path" to target property.
        const fPath = field.split('.')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const settingsField = [INTERFACE] as any[]
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
                    INTERFACE.onPropertyUpdate(field, value, old)
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
} as InterfaceSettings

export default INTERFACE