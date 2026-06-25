/**
 * Worker utilities.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type SafeObject } from '#root/src/types/application'
import { Log } from 'scoped-event-log'
import { type WorkerResponse, type WorkerMessage } from '../types'

const SCOPE = "util:worker"

/**
 * Create a Worker from a code string. The source must be compiled JavaScript (not TypeScript)!
 * @param name - Name of the worker (for logging).
 * @param code - Worker source code as string.
 * @param type - Type of worker to create, either 'classic' or 'module' (default 'classic').
 * @returns Object with the source object `url` and a method to `create` a worker from the source.
 */
export const inlineWorker = (
    name: string,
    code: string,
    type = 'classic' as 'classic' | 'module'
): { create: () => Worker, url: string } => {
    let blob = new Blob()
    try {
        blob = new Blob([code], { type: 'application/javascript' })
    } catch (e) {
        Log.error(`Could not turn code string into blob, worker '${name}' creation failed.`, SCOPE)
    }
    const url = URL.createObjectURL(blob)
    return {
        create: () => new Worker(URL.createObjectURL(blob), { type }),
        url,
    }
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
 * Return a success response to the service.
 * @param data - The worker message data containing the rn and action.
 * @param results - Optional additional result properties to return.
 */
export const returnSuccess = (
    data: { rn: number, action: string },
    results?: Record<string, unknown>
) => {
    if (typeof WorkerGlobalScope === 'undefined') {
        throw new Error('returnSuccess can only be used inside a worker scope.')
    }
    postMessage({
        rn: data.rn,
        action: data.action,
        success: true,
        ...results
    })
}
/**
 * Return a failure response to the service.
 * @param data - The worker message data containing the rn and action.
 * @param error - The error message(s) to return.
 */
export const returnFailure = (
    data: { rn: number, action: string },
    error: string | string[]
) => {
    if (typeof WorkerGlobalScope === 'undefined') {
        throw new Error('returnFailure can only be used inside a worker scope.')
    }
    postMessage({
        rn: data.rn,
        action: data.action,
        success: false,
        error: error,
    })
}
/**
 * Synchronize the given settings with main application.
 *
 * @deprecated This function is not used by any worker and has never been wired into the settings
 * update pathway. Workers receive settings via the `update-settings` commission action — the main
 * thread sends a full `AppSettings._CLONABLE` snapshot and the worker reads
 * `data.settings.modules[namespace]`. Do **not** call this function; use `_CLONABLE` transfer
 * instead. See `TrendService.setupWorker` and `MontageService.setupWorker` for the canonical
 * pattern.
 *
 * @param settings - Map of settings to keep in sync.
 * @param message - The message from loader to check for updated settings or the worker's postMessage method (when setting up).
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
 * Recursively rebuild plain `Object` / `Array` / `Map` / `Set` structures so any exotic wrapper —
 * most often a host UI framework's reactive `Proxy` — is stripped, leaving a value the structured
 * clone algorithm can serialise across a worker boundary. Binary payloads (typed arrays,
 * `ArrayBuffer`, `SharedArrayBuffer`, `DataView`) are returned **by reference**, so transferables
 * survive the transfer list and shared memory stays shared rather than being copied. Cyclic
 * references are resolved through a seen-map so reactive trees that link parent ↔ child don't
 * recurse forever.
 *
 * This is a recovery path, not a routine one: callers should pass plain data so it never runs. It
 * exists to turn an otherwise fatal `DataCloneError` into a logged warning plus a working post.
 */
export const toPlainData = (value: unknown, seen: WeakMap<object, unknown> = new WeakMap()): unknown => {
    if (value === null || typeof value !== 'object') {
        return value
    }
    // Binary payloads must cross by reference, never copied.
    if (
        ArrayBuffer.isView(value) ||
        value instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)
    ) {
        return value
    }
    const existing = seen.get(value)
    if (existing !== undefined) {
        return existing
    }
    if (Array.isArray(value)) {
        const out = [] as unknown[]
        seen.set(value, out)
        for (const item of value) {
            out.push(toPlainData(item, seen))
        }
        return out
    }
    if (value instanceof Map) {
        const out = new Map<unknown, unknown>()
        seen.set(value, out)
        for (const [key, val] of value) {
            out.set(toPlainData(key, seen), toPlainData(val, seen))
        }
        return out
    }
    if (value instanceof Set) {
        const out = new Set<unknown>()
        seen.set(value, out)
        for (const val of value) {
            out.add(toPlainData(val, seen))
        }
        return out
    }
    const out = {} as Record<string, unknown>
    seen.set(value, out)
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        out[key] = toPlainData(val, seen)
    }
    return out
}

/**
 * Validate that a commission message has all the require properties.
 * @param data - The data property of the worker message.
 * @param requiredProps - Required data properties as property constructor names or arrays of names. Properties with names ending with '?' are considered optional.
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
        if (!Object.hasOwn(data, prop[0]) || data[prop[0]] === undefined || data[prop[0]] === null) {
            if (!Array.isArray(prop[1]) && prop[1].endsWith('?')) {
                continue
            }
            return validationFailure(`Received commission '${data.action}' without the required '${prop[0]}' property.`)
        }
        // Check if property can optionally be undefined and remove that.
        if (!Array.isArray(prop[1]) && prop[1].endsWith('?')) {
            prop[1] = prop[1].slice(0, -1)
        }
        const dataProp = data[prop[0]] as object // May not be object, but we only use the constructor property.
        if (Array.isArray(prop[1])) {
            if (!Array.isArray(dataProp)) {
                return validationFailure(`Property '${prop[0]}' for commission '${data.action}' is not an array.`)
            }
            for (let i=0; i<prop[1].length; i++) {
                const dataItem = dataProp[i]
                if ((dataItem === undefined || dataItem === null) && !prop[1][i].endsWith('?')) {
                    return validationFailure(
                        `Property '${prop[0]}' for commission '${data.action}' ` +
                        `does not have the correct number of items: ` +
                        `expected ${prop[1].length}, received ${dataItem.length}.`
                    )
                }
                if (prop[1][i].endsWith('?')) {
                    // Remove the question mark for matching the actual type.
                    prop[1][i] = prop[1][i].slice(0, -1)
                }
                if (dataItem.constructor.name !== prop[1][i]) {
                    return validationFailure(
                        `Property '${prop[0]}' for commission '${data.action}' item type at index ${i} is wrong: ` +
                        `expected ${prop[1][i]}, received ${dataItem.constructor.name}.`
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
