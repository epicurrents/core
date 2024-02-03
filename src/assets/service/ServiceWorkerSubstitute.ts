/**
 * EpiCurrents service worker replacement. Allows using a services in the main thread without actual workers.
 * @package    @epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-ts-log'

const SCOPE = 'ServiceWorkerSubstitute'

export default class ServiceWorkerSubstitute extends Worker {
    protected _eventListeners = [] as {
        event: string,
        callback: (message: any) => unknown
    }[]
    onerror = null
    onmessage = null as ((message: any) => unknown) | null
    onmessageerror = null

    constructor () {
        super('')
    }

    postMessage (message: any) {
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
    returnMessage (message: any) {
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
        listener: (this: Worker, ev: WorkerEventMap[K]) => any,
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
            callback: listener
        })
    }
    removeEventListener <K extends keyof WorkerEventMap>(
        type: K,
        listener: (this: Worker, ev: WorkerEventMap[K]) => any,
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