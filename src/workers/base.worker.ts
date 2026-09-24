/**
 * Base worker to extend in specialized workers.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type BufferRangeMove } from 'asymmetric-io-mutex'
import { Log } from 'scoped-event-log'
import { type WorkerMessage } from '#types/service'
import { validateCommissionProps } from '#util'

const SCOPE = 'BaseWorker'

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
     * Close the context this worker runs in, after the commission that asked for it has been
     * answered.
     *
     * A worker on its own thread closes itself. An implementation running on the main thread has no
     * thread to close and overrides this with a no-op — closing there would be `window.close`.
     */
    protected _close () {
        close()
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
     * Deliver a reply to whoever commissioned this worker.
     *
     * Every reply this class and its subclasses produce goes through here — the success and failure
     * responses, the validation failures raised by {@link _validate}, and any staged reply a handler
     * posts itself. A worker on its own thread posts it across the thread boundary; an
     * implementation running on the main thread overrides this to hand the reply straight to its
     * caller. A handler that reaches for the global `postMessage` instead is unusable in the second
     * case, and unusable silently: on the main thread the reply goes to the window and the
     * commission it was answering never settles.
     * @param reply - Response message to deliver.
     */
    protected _postMessage (reply: WorkerMessage['data']) {
        postMessage(reply)
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
     * Validate the properties a commission must carry, answering the commission itself if they are
     * missing or of the wrong type.
     *
     * Wraps {@link validateCommissionProps} so the validation failure is delivered through this
     * worker's own transport. Calling the utility directly leaves it on its default, the global
     * `postMessage`, which is the right destination on a worker thread and no destination at all on
     * the main one.
     * @param data - Data part of the received message.
     * @param requiredProps - Property names mapped to their expected types.
     * @param requiredSetup - Has the setup this commission requires been completed (default true).
     * @returns The message data when valid, false when not.
     */
    protected _validate <T extends WorkerMessage['data']> (
        data: T,
        requiredProps: { [name: string]: string | string[] },
        requiredSetup = true,
    ): false | T {
        return validateCommissionProps(data, requiredProps, requiredSetup, this._postMessage.bind(this))
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
        const data = this._validate(
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
     * Clear this worker's network breakers so the next load is attempted afresh.
     *
     * Every service posts this to its worker after re-authentication, without a request number and
     * without waiting for a reply, so every worker has to accept it: a worker that has no network
     * of its own answers a commission nobody reads, and the service has nothing to act on either
     * way. A worker that fetches through the resilient client overrides this; the default clears
     * nothing.
     * @param _msgData - Data property from the message to the worker.
     */
    // The no-op needs no await, but the signature is the action map's.
    // eslint-disable-next-line @typescript-eslint/require-await
    async resetNetwork (_msgData: WorkerMessage['data']) {
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
        const handler = this._actionMap.get(action)?.bind(this)
        if (!handler) {
            // The reply settles the commission, but only the caller sees it, and a caller that
            // posted without waiting for one sees nothing at all.
            Log.warn(`Action '${action}' is not supported by this worker.`, SCOPE)
            return this._failure(message.data, `Action '${action}' is not supported by this worker.`)
        }
        try {
            return await handler(message.data)
        } catch (e: unknown) {
            // Every commission must be answered. A handler that throws posts nothing, so the
            // service's promise for it stays pending for the life of the session — and any waiters
            // registered against the same action are never notified either, which wedges the
            // service rather than failing it. Report the failure instead.
            const reason = e instanceof Error ? e.message : String(e)
            Log.error(`Action '${action}' threw in the worker: ${reason}`, SCOPE, e as Error)
            return this._failure(message.data, `Action '${action}' failed in the worker: ${reason}`)
        }
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