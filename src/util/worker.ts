/**
 * Worker utilities.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type SafeObject } from 'TYPES/assets'
import Log from 'scoped-ts-log'

const SCOPE = "DefaultWorker"

/**
 * Transmit log messages back to the main application thread Log instance using the web worker's postMessage method.
 * @remarks
 * If we import class Log inside a Worker, it is not the same instance of the main application's Log. Instead,
 * in order to keep all log messages/events in the same instance, we need to relay the messages back to the main
 * application thread via `postMessage`.
 * @param post - `postMessage` method of the Worker scope.
 * @param level - Message level (i.e. `DEBUG`, `INFO`, `WARN`, or `ERROR`,).
 * @param event - The actual event as message string or string array.
 * @param scope - Scope of the event.
 * @param extra - Any extra properties (**NOTE!** These must be serializable for postMessage).
 */
export const log = (
    post: typeof postMessage,
    level: keyof typeof Log.LEVELS,
    event: string | string[],
    scope: string,
    extra?: unknown
) => {
    post({
        action: 'log',
        event: event,
        extra: extra,
        level: level,
        scope: scope || SCOPE
    })
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
