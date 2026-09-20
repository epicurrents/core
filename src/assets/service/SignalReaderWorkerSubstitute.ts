/**
 * Epicurrents signal reader worker substitute. Drives a reader on the main thread for environments
 * that cannot use a worker, answering the same commissions the worker answers.
 *
 * The vocabulary is the point. A substitute that implements a subset of it looks like a degraded
 * but working fallback and is not one: {@link ServiceWorkerSubstitute.postMessage} answers an
 * action it does not recognise with a failure, a failed commission rejects, and
 * `GenericService.shutdown` and `unload` both await commissions before tearing anything down. A
 * missing handler therefore does not degrade a study, it makes the study impossible to close.
 *
 * Rather than restate the handlers, this class runs the worker's own. {@link SignalReaderWorker}
 * reaches its caller through {@link BaseWorker._postMessage} and closes its thread through
 * `_close`, so redirecting those two is all it takes to run the same code on the main thread. The
 * three commissions that genuinely differ here are overridden and say why.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericSignalReader from '#assets/reader/GenericSignalReader'
import type { BiosignalCacheDerivationSlot } from '#types/biosignal'
import type { WorkerMessage, WorkerSubstitute } from '#types/service'
import { validateCommissionProps } from '#util'
import { SignalReaderWorker } from '#workers/signal-reader.worker'
import { Log } from 'scoped-event-log'
import ServiceWorkerSubstitute from './ServiceWorkerSubstitute'

const SCOPE = 'SignalReaderWorkerSubstitute'

/**
 * The worker's commission handlers, with the two thread-bound operations redirected and the three
 * commissions that mean something different on the main thread overridden.
 */
class MainThreadCommissions<T extends GenericSignalReader> extends SignalReaderWorker<T> {
    /** Substitute to deliver replies through. */
    protected _substitute: ServiceWorkerSubstitute

    constructor (reader: T, substitute: ServiceWorkerSubstitute) {
        super(reader)
        this._substitute = substitute
    }

    /** There is no thread to close; the service terminates the substitute after the reply. */
    protected override _close () {}

    protected override _postMessage (reply: WorkerMessage['data']) {
        this._substitute.returnMessage(reply)
    }

    /**
     * Set up a cache on the reader's own heap and answer with it.
     *
     * The worker answers with cache properties only for shared memory, because a cache on its own
     * heap would cross the thread boundary as a structured clone with no link to the memory it
     * stands for. Here there is no boundary, so the cache object itself is what the application
     * reads through, and a `useMemoryManager` commission is refused rather than half-served: a
     * substitute exists because the environment has no `SharedArrayBuffer` to manage.
     * @param msgData - Data property from the commission.
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    override async setupCache (msgData: WorkerMessage['data']) {
        if (msgData.useMemoryManager) {
            return this._failure(
                msgData,
                `A worker substitute cannot set up a cache in shared memory.`
            )
        }
        const derivationSlots = (msgData.derivationSlots as BiosignalCacheDerivationSlot[]) || []
        const cache = this._reader.setupCache((msgData.dataDuration as number) || 0, derivationSlots)
        if (!cache) {
            return this._failure(msgData, `Cache setup failed.`)
        }
        return this._success(msgData, { cacheProperties: cache })
    }

    /**
     * Acknowledge a settings snapshot without applying it.
     *
     * The worker applies one because it holds its own copy of the settings tree. This runs in the
     * application's own context and reads the very module the snapshot was taken from, so applying
     * it would write the application's state back over itself.
     * @param msgData - Data property from the commission.
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    override async updateSettings (msgData: WorkerMessage['data']) {
        return this._success(msgData)
    }
}

export default class SignalReaderWorkerSubstitute<T extends GenericSignalReader = GenericSignalReader>
    extends ServiceWorkerSubstitute implements WorkerSubstitute {
    /** The worker's handlers, running on this thread. */
    protected _commissions: MainThreadCommissions<T>
    /** The reader being driven. */
    protected _reader: T

    /**
     * @param reader - Reader to serve commissions from. A subclass registers `setup-worker` against
     *                 the same instance, exactly as the format's worker does.
     */
    constructor (reader: T) {
        super()
        this._reader = reader
        this._commissions = new MainThreadCommissions(reader, this)
    }

    /**
     * Report a failed commission, in the shape a handler registered here would use.
     * @param msgData - Data part of the commission being answered.
     * @param error - Cause of the failure.
     * @returns False, so a handler can return it directly.
     */
    protected _failure (msgData: WorkerMessage['data'], error?: string) {
        this.returnFailure(msgData, error)
        return false
    }

    /**
     * Report a successful commission, in the shape a handler registered here would use.
     * @param msgData - Data part of the commission being answered.
     * @param results - Values to return to the caller, if any.
     * @returns True, so a handler can return it directly.
     */
    protected _success (msgData: WorkerMessage['data'], results?: Record<string, unknown>) {
        this.returnSuccess(msgData, results)
        return true
    }

    /**
     * Validate the properties a commission must carry, answering the commission itself if they are
     * missing or of the wrong type.
     * @param msgData - Data part of the commission being answered.
     * @param requiredProps - Property names mapped to their expected types.
     * @param requiredSetup - Has the setup this commission requires been completed (default true).
     * @returns The message data when valid, false when not.
     */
    protected _validate <D extends WorkerMessage['data']> (
        msgData: D,
        requiredProps: { [name: string]: string | string[] },
        requiredSetup = true,
    ): false | D {
        return validateCommissionProps(msgData, requiredProps, requiredSetup, this.returnMessage.bind(this))
    }

    /**
     * Register handlers for commissions this substitute adds to the shared vocabulary, `setup-worker`
     * above all — the one commission where formats genuinely differ.
     *
     * Each handler is bound to this substitute before it is registered, so a method written here
     * reads the same as the one in the format's worker and reaches the same `_success`, `_failure`
     * and `_validate`.
     * @param actions - Array of new actions and handlers as `[action, handler]`.
     */
    extendActionMap (actions: [string, (message: WorkerMessage['data']) => Promise<boolean>][]) {
        this._commissions.extendActionMap(
            actions.map(([action, handler]) => [action, handler.bind(this)] as typeof actions[number])
        )
    }

    async postMessage (message: WorkerMessage['data']) {
        if (!message?.action) {
            return
        }
        Log.debug(`Received message with action ${message.action}.`, SCOPE)
        await this._commissions.handleMessage({ data: message } as WorkerMessage)
    }
}
