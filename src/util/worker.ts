/**
 * Worker utilities.
 * @package    @epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type SafeObject } from '#root/src/types/application'
import { Log } from 'scoped-ts-log'
import { WorkerMessage } from '../types'

const SCOPE = "util:worker"

/**
 * Create a Worker from a code string. The source must be compiled JavaScript (not TypeScript)!
 * @param name - Name of the worker (for logging).
 * @param code - Worker source code as string.
 * @returns Worker with the given source.
 */
export const inlineWorker = (name: string, code: string): Worker => {
    let blob = new Blob()
    try {
        blob = new Blob([code], { type: 'application/javascript' })
    } catch (e) {
        Log.error(`Could not turn code string into blob, worker '${name} creation failed.`, SCOPE)
    }
    return new Worker(URL.createObjectURL(blob))
}
/**
 * Method type for relaying log messages inside the worker scope.
 * The method implementing this should post the log messages to the main thread via `log` (importable from this scope).
 */
export type RelayLogMessage = (
    level: keyof typeof Log.LEVELS,
    message: string|string[],
    scope: string,
    extra?: unknown
) => void

/**
 * Synchronize the given settings with main application. The message parameter should be:
 * - The `postMessage` method when setting up sync with main application.
 * - The `message` object when checking a message from the main application for an update in settings.
 * @param settings - Map of settings to keep in sync.
 * @param message - The message from loader to chech for updated settings or the worker's postMessage method (when setting up).
 * @returns True if a setting was updated or setup was successful, false otherwise.
 */
export const syncSettings = (
    settings: Map<string, unknown>,
    message: SafeObject & {
        data: {
            action: string
            field?: string
            fields?: {
                name: string
                value: unknown
            }[]
            value?: unknown
        }
    } | typeof postMessage
) => {
    if (typeof message == 'function') {
        const fields = Array.from(settings.keys())
        if (!fields) {
            return false
        }
        message({
            action: 'update-settings',
            fields: Array.from(fields),
        })
    } else {
        if (
            message?.data?.action !== 'update-settings' ||
            message.data.fields === undefined &&
            (
                message.data.field === undefined ||
                message.data.value === undefined
            )
        ) {
            return false
        }
        if (message.data.fields) {
            for (const field of message.data.fields) {
                settings.set(field.name, field.value)
            }
        }
    }
    return true
}

/**
 * Validate that a commission message has all the require properties.
 * @param data - The data property of the worker message.
 * @param requiredProps - Required data properties as property constructor names or arrays of names.
 * @param requiredSetup - Optional statement that checks if the setup required by this commission is complete.
 * @param returnMessage - Optional override for the postMessage method (if not in worker scope).
 * @returns False if data is invalid, or an object containing the validated properties.
 */
export const validateCommissionProps = (
    data: WorkerMessage['data'],
    requiredProps: { [name: string]: string | string[] },
    requiredSetup = true,
    returnMessage = postMessage,
): false | { [name: keyof typeof requiredProps]: any } => {
    if (!requiredSetup) {
        Log.error(`Received commission '${data.action}' before required setup was complete.`, SCOPE)
        returnMessage({
            action: data.action,
            success: false,
            rn: data.rn,
        })
        return false
    }
    for (const prop of Object.entries(requiredProps)) {
        if (!Object.hasOwn(data, prop[0])) {
            Log.error(`Received commission '${data.action}' without the required '${prop[0]}' property.`, SCOPE)
            returnMessage({
                action: data.action,
                success: false,
                rn: data.rn,
            })
        }
        const dataProp = data[prop[0]] as any
        if (dataProp === undefined) {
            Log.error(`Property '${prop[0]}' for commission '${data.action}' is missing.`, SCOPE)
            returnMessage({
                action: data.action,
                success: false,
                rn: data.rn,
            })
            return false
        }
        if (Array.isArray(prop[1])) {
            if (!Array.isArray(dataProp)) {
                Log.error(`Property '${prop[0]}' for commission '${data.action}' is not an array.`, SCOPE)
                returnMessage({
                    action: data.action,
                    success: false,
                    rn: data.rn,
                })
                return false
            }
            for (let i=0; i<prop[1].length; i++) {
                const propItem = prop[1][i]
                const dataItem = dataProp[i]
                if (dataItem === undefined) {
                    Log.error(
                        `Property '${prop[0]}' for commission '${data.action}' ` +
                        `does not have the correct number of items: ` +
                        `expected ${prop[1].length}, received ${dataItem.length}.`,
                    SCOPE)
                    returnMessage({
                        action: data.action,
                        success: false,
                        rn: data.rn,
                    })
                    return false
                }
                if (dataItem.constructor !== propItem) {
                    Log.error(
                        `Property '${prop[0]}' for commission '${data.action}' item type at index is wrong ${i}: ` +
                        `expected ${propItem}, received ${dataItem.constructor.name}.`,
                    SCOPE)
                    returnMessage({
                        action: data.action,
                        success: false,
                        rn: data.rn,
                    })
                    return false
                }
            }
        } else {
            if (dataProp.constructor !== prop[1]) {
                Log.error(
                    `Property '${prop[0]}' for commission '${data.action}' has a wrong type: ` +
                    `expected ${prop[1]}, received ${dataProp.constructor.name}.`,
                SCOPE)
                returnMessage({
                    action: data.action,
                    success: false,
                    rn: data.rn,
                })
                return false
            }
        }
    }
    return data
}