/**
 * Epicurrents service worker replacement. Allows using a services in the main thread without actual workers.
 * @remarks
 * WORKER SUBSTITUTES ARE SUBJECT TO DEPRECATION.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type WorkerMessage } from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'ServiceWorkerSubstitute'

export default class ServiceWorkerSubstitute {
    protected _eventListeners = [] as {
        event: string,
        callback: (message: Pick<WorkerMessage, 'data'>) => unknown
    }[]
    onerror = null
    onmessage = null as ((message: Pick<WorkerMessage, 'data'>) => unknown) | null
    onmessageerror = null

    constructor () {
    }

    postMessage (message: WorkerMessage['data']) {
        if (!message?.action) {
            return
        }
        const action = message.action
        Log.warn(`'${action}' is not implemented in service worker replacement.`, SCOPE)
        this.returnMessage({
            action: action,
            success: false,
            rn: message.rn,
        })
    }
    returnMessage (message: WorkerMessage['data']) {
        for (const listener of this._eventListeners) {
            if (listener.event === 'message') {
                // Responses from actual workers are held in the data property.
                listener.callback({ data: message })
            }
        }
        if (this.onmessage) {
            this.onmessage({ data: message })
        }
    }
    terminate () {
        Log.warn(`terminate is not implemented in service worker replacement.`, SCOPE)
    }
    addEventListener <K extends keyof WorkerEventMap>(
        type: K,
        listener: (this: Worker, ev: WorkerEventMap[K]) => unknown,
        _options?: boolean | AddEventListenerOptions | undefined
    ) {
        for (const existing of this._eventListeners) {
            if (existing.event === type && existing.callback === listener) {
                Log.debug(`Listener for event '${type}' already exists, not adding again.`, SCOPE)
                return
            }
        }
        Log.debug(`Adding a listener for event '${type}'.`, SCOPE)
        this._eventListeners.push({
            event: type,
            // This is a bit ridiculous and should be typed better.
            callback: listener as unknown as (message: Pick<WorkerMessage, 'data'>) => unknown
        })
    }
    removeEventListener <K extends keyof WorkerEventMap>(
        type: K,
        listener: (this: Worker, ev: WorkerEventMap[K]) => unknown,
        _options?: boolean | EventListenerOptions | undefined
    ) {
        for (let i=0; i<this._eventListeners.length; i++) {
            const existing = this._eventListeners[i]
            if (existing.event === type && existing.callback === listener) {
                Log.debug(`Removing a listener for event '${type}'.`, SCOPE)
                this._eventListeners.splice(i, 1)
                return
            }
        }
    }
    dispatchEvent (_event: Event) {
        Log.warn(`dispatchEvent is not implemented service worker replacement.`, SCOPE)
        return false
    }
}