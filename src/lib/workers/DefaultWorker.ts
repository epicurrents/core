/**
 * Default worker to be used as a template for specialized workers.
 * This file (as is) is not meant to be used as an actual worker!
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import Log from 'scoped-ts-log'

const SCOPE = "DefaultWorker"
const SETTINGS = new Map<string, any>()

onmessage = async (message: any) => {
    if (!message?.data?.action) {
        return
    }
    Log.error(`Default worker received a commission with the action ${message.data.action}.`, SCOPE)
    postMessage({
        action: message.data.action,
        rn: message.data.rn,
        success: false,
    })
}

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
    extra?: any
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
    extra?: any
) => void

/**
 * Synchronize the given settings with main application.
 * - Provide the `message` object when checking a message from the main application for an update in settings.
 * - Provide the `post` method when setting up sync with main application.
 * @param settings - Map of settings to keep in sync.
 * @param message - The message from loader to chech for update in settings (after setup).
 * @param post - The worker's postMessage method (when setting up).
 * @returns True if a setting was update or setup was successful, false otherwise.
 */
export const syncSettings = (
    settings: typeof SETTINGS,
    message?: any,
    post?: typeof postMessage
) => {
    if (!post && !message) {
        return false
    }
    if (post) {
        const fields = Array.from(settings.keys())
        if (!fields) {
            return false
        }
        post({
            action: 'update-settings',
            fields: Array.from(fields),
        })
    } else if (message) {
        if (
            message?.data?.action !== 'update-settings' ||
            message.data.field === undefined ||
            message.data.value === undefined
        ) {
            return false
        }
        settings.set(message.data.field, message.data.value)
    }
    return true
}
