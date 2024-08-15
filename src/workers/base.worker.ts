/**
 * Base worker to extend in specialized workers.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type WorkerMessage, type WorkerResponse } from '#types/service'

export abstract class BaseWorker {
    /** 
     * Commission actions mapped to their handler methods.
     * The boolean value returned by the handler indicates whether the operation was successful or not.
     */
    protected _actionMap = new Map<string, (message: WorkerMessage['data']) => Promise<boolean>>()
    /** Namespace within the global options. */
    protected _namespace = ''
    /** The postMessage method to use when responding to commissions. */
    protected _postMessage: (message: WorkerResponse['data']) => void
    constructor (postMessage: (message: WorkerResponse['data']) => void) {
        this._postMessage = postMessage
    }
    /** 
     * Return a failure response to the service.
     * @param data - Data part of the received message.
     * @param error - Optional error message as string or array of strings (defaults to validation failure).
     */
    protected _failure (data: WorkerMessage['data'], error?: string|string[]) {
        const errorMsg = error ||  `Commission property validation failed for action '${data.action}'.`
        this._postMessage({
            rn: data.rn,
            action: data.action,
            success: false,
            error: errorMsg,
        })
        return false
    }
    /**
     * Return a success response to the service.
     * @param data - Data part of the received message.
     * @param results - Optional results to add to the response message.
     */
    protected _success (data: WorkerMessage['data'], results?: { [prop: string]: unknown }) {
        this._postMessage({
            rn: data.rn,
            action: data.action,
            success: true,
            ...results
        })
        return true
    }
    /**
     * Handle a commission message to the worker.
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async handleMessage (message: WorkerMessage) {
        if (!message?.data?.action) {
            // Failsafe.
            return this._failure(message.data || {}, `Worker commission did not contain data or an action.`)
        }
        const action = message.data.action
        const handler = this._actionMap.get(action)
        if (!handler) {
            return this._failure(message.data, `Action '${action}' is not supported by montage worker.`)
        }
        return handler(message.data)
    }
}