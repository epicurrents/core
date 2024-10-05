/**
 * Worker utilities.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type SafeObject } from '#root/src/types/application'
import { Log } from 'scoped-ts-log'
import { type WorkerResponse, type WorkerMessage } from '../types'

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
        Log.error(`Could not turn code string into blob, worker '${name}' creation failed.`, SCOPE)
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
export const validateCommissionProps = <T extends WorkerMessage['data']>(
    data: T,
    requiredProps: { [name: string]: string | string[] },
    requiredSetup = true,
    returnMessage = postMessage,
): false | T => {
    /** Send worker response with `success`: false, with the given reason as `error` message. */
    const validationFailure = (reason: string): false => {
        returnMessage({
            action: data.action,
            error: reason,
            success: false,
            rn: data.rn,
        } as WorkerResponse['data'])
        Log.error(reason, SCOPE)
        return false
    }
    if (!requiredSetup) {
        return validationFailure(`Received commission '${data.action}' before required setup was complete.`)
    }
    for (const prop of Object.entries(requiredProps)) {
        if (!Object.hasOwn(data, prop[0]) || data[prop[0]] === undefined) {
            if (prop[1].includes('undefined')) {
                continue
            }
            return validationFailure(`Received commission '${data.action}' without the required '${prop[0]}' property.`)
        }
        // Check if property can optionally be undefined and remove that.
        if (Array.isArray(prop[1]) && prop[1].includes('undefined')) {
            prop[1].splice(prop[1].indexOf('undefined'), 1)
            // If only one option remains, flatten the array.
            // This is not an optimal solution, optional properties should be handled some other way.
            if (prop[1].length === 1) {
                prop[1] = prop[1][0]
            }
        }
        const dataProp = data[prop[0]] as object // May not be object, but we only use the constructor property.
        if (Array.isArray(prop[1])) {
            if (!Array.isArray(dataProp)) {
                return validationFailure(`Property '${prop[0]}' for commission '${data.action}' is not an array.`)
            }
            for (let i=0; i<prop[1].length; i++) {
                const propItem = prop[1][i]
                const dataItem = dataProp[i]
                if (dataItem === undefined) {
                    return validationFailure(
                        `Property '${prop[0]}' for commission '${data.action}' ` +
                        `does not have the correct number of items: ` +
                        `expected ${prop[1].length}, received ${dataItem.length}.`
                    )
                }
                if (dataItem.constructor.name !== propItem) {
                    return validationFailure(
                        `Property '${prop[0]}' for commission '${data.action}' item type at index ${i} is wrong: ` +
                        `expected ${propItem}, received ${dataItem.constructor.name}.`
                    )
                }
            }
        } else {
            if (dataProp.constructor.name !== prop[1]) {
                return validationFailure(
                    `Property '${prop[0]}' for commission '${data.action}' has a wrong type: ` +
                    `expected ${prop[1]}, received ${dataProp.constructor.name}.`
                )
            }
        }
    }
    return data
}