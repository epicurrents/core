/**
 * Base worker to extend in specialized workers.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type BufferRangeMove } from 'asymmetric-io-mutex'
import { type WorkerMessage } from '#types/service'
import { validateCommissionProps } from '#util'

export abstract class BaseWorker {
    /** 
     * Commission actions mapped to their handler methods.
     * The boolean value returned by the handler indicates whether the operation was successful or not.
     */
    protected _actionMap = new Map<string, (message: WorkerMessage['data']) => Promise<boolean>>()
    /** Namespace within the global options. */
    protected _namespace = ''
    constructor () {
    }
    /** 
     * Return a failure response to the service.
     * @param data - Data part of the received message.
     * @param error - Optional error message as string or array of strings (defaults to validation failure).
     */
    protected _failure (data: WorkerMessage['data'], error?: string|string[]) {
        const errorMsg = error ||  `Commission property validation failed for action '${data.action}'.`
        postMessage({
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
        postMessage({
            rn: data.rn,
            action: data.action,
            success: true,
            ...results
        })
        return true
    }
    /**
     * Target for the 'set-buffer-range' commission — the holder of buffer-backed views that can
     * reposition them after the memory manager has rearranged the shared buffer. Workers whose
     * processor participates in managed shared memory override this to return that processor;
     * the default `null` makes the commission fail with an explanatory error.
     */
    protected _getBufferRangeTarget (): {
        setBufferRange (range?: number[], moves?: BufferRangeMove[]): boolean
    } | null {
        return null
    }
    /**
     * Generic handler for the memory manager's 'set-buffer-range' commission. Validates the
     * payload and delegates to the target returned by {@link _getBufferRangeTarget}. Subclasses
     * register this in their action map under 'set-buffer-range'.
     * @param msgData - Data property from the message to the worker.
     * @returns True if the reposition succeeded, false otherwise.
     */
    async setBufferRange (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as WorkerMessage['data'] & { range?: number[], moves?: BufferRangeMove[] },
            {
                range: 'Array?',
                moves: 'Array?',
            }
        )
        if (!data) {
            return false
        }
        if (!data.range && !data.moves) {
            return this._failure(msgData, `Commission 'set-buffer-range' must carry a range, moves, or both.`)
        }
        const target = this._getBufferRangeTarget()
        if (!target) {
            return this._failure(msgData, `Action 'set-buffer-range' is not supported by this worker.`)
        }
        if (target.setBufferRange(data.range, data.moves)) {
            return this._success(msgData)
        }
        return this._failure(msgData, `Repositioning buffer views failed in the worker.`)
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
        const handler = this._actionMap.get(action)?.bind(this)
        if (!handler) {
            return this._failure(message.data, `Action '${action}' is not supported by this worker.`)
        }
        return handler(message.data)
    }
    /**
     * Extend the action map with provided actions and associated handlers.
     * @param actions - Array of new actions and handlers as `[action, handler]`.
     */
    extendActionMap (actions: [string, (message: WorkerMessage['data']) => Promise<boolean>][]) {
        for (const [newAction, newHandler] of actions) {
            this._actionMap.set(newAction, newHandler)
        }
    }
}