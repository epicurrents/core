/**
 * Epicurrents montage worker substitute. Drives a montage processor on the main thread for
 * environments that cannot use a worker, answering the same commissions the worker answers.
 *
 * The vocabulary is the point. A substitute implementing a subset of it looks like a degraded but
 * working fallback and is not one: an unregistered action is answered with a failure, and
 * `GenericService.shutdown` reads that as a refusal and skips the teardown it guards — leaving the
 * worker, its processor and its cache in place with nothing reported anywhere.
 *
 * Rather than restate the handlers, this class runs the worker's own. {@link MontageWorker} reaches
 * its caller through {@link BaseWorker._postMessage} and closes its thread through `_close`, so
 * redirecting those two is all it takes to run the same code here. The commissions that genuinely
 * differ on this side are overridden and say why.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import ServiceWorkerSubstitute from '#assets/service/ServiceWorkerSubstitute'
import { MontageWorker } from '#workers/montage.worker'
import type {
    AppSettings,
    CommonBiosignalSettings,
    MontageWorkerCommission,
    WorkerMessage,
    WorkerSubstitute,
} from '#types'

const SCOPE = 'MontageWorkerSubstitute'

/**
 * The worker's commission handlers, with the two thread-bound operations redirected and the four
 * commissions that mean something different on the main thread overridden.
 */
class MainThreadCommissions extends MontageWorker {
    /** Substitute to deliver replies through. */
    protected _substitute: ServiceWorkerSubstitute

    constructor (substitute: ServiceWorkerSubstitute) {
        super()
        this._substitute = substitute
    }

    /** There is no thread to close; the service terminates the substitute after the reply. */
    protected override _close () {}

    protected override _postMessage (reply: WorkerMessage['data']) {
        this._substitute.returnMessage(reply)
    }

    /**
     * Read the module's settings from the application rather than from the snapshot.
     *
     * The processor keeps the reference it is given, and on this thread the application's own
     * settings object is reachable. Handing it the snapshot instead would freeze the montage at the
     * values held when the commission was posted.
     * @param _settings - Settings snapshot carried by the commission, unused here.
     */
    protected override _resolveModuleSettings (_settings: AppSettings) {
        const modules = window.__EPICURRENTS__?.RUNTIME?.SETTINGS?.modules
        return (modules?.[this._namespace] as unknown as CommonBiosignalSettings) || null
    }

    /**
     * Reposition buffer views after the memory manager has rearranged the shared buffer.
     *
     * Refused here. The memory manager arranges a `SharedArrayBuffer`, and a substitute is in use
     * precisely because the environment has none, so a commission asking this side to follow a
     * rearrange describes a situation that cannot arise.
     * @param msgData - Data property from the commission.
     */
    // The refusal needs no await, but the signature is the action map's.
    // eslint-disable-next-line @typescript-eslint/require-await
    override async setBufferRange (msgData: WorkerMessage['data']) {
        return this._failure(msgData, `A worker substitute has no shared buffer to reposition.`)
    }

    /**
     * Take over a signal cache that already exists on the commissioning side.
     *
     * This is the half of the vocabulary only a substitute can serve: the commission carries a live
     * cache object, and sharing the caller's heap is what makes its methods still work here. The
     * worker refuses it and is commissioned with `setup-input-cache` or `setup-input-mutex`
     * instead.
     * @param msgData - Data property from the commission.
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    override async setupCache (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as MontageWorkerCommission['setup-cache'],
            {
                cache: 'BiosignalCache',
                dataDuration: 'Number',
                recordingDuration: 'Number',
            },
            this._montage !== null
        )
        if (!data) {
            return false
        }
        const setupSuccess = this._montage?.setupCacheWithInput(
            data.cache,
            data.dataDuration,
            data.recordingDuration
        )
        if (!setupSuccess) {
            return this._failure(msgData, `Setting up the montage cache failed.`)
        }
        Log.debug(`Cache setup complete.`, SCOPE)
        return this._success(msgData)
    }

    /**
     * Couple the montage to a cache served by a shared worker.
     *
     * Refused here. The commission carries a `MessagePort`, which exists to cross a thread
     * boundary this side does not have; a substitute reads an existing cache through `setup-cache`.
     * @param msgData - Data property from the commission.
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    override async setInputCache (msgData: WorkerMessage['data']) {
        return this._failure(
            msgData,
            `A worker substitute cannot couple to a shared worker cache; use 'setup-cache'.`
        )
    }

    /**
     * Couple the montage to an input mutex in shared memory.
     *
     * Refused here, for the same reason as {@link setBufferRange}: a mutex is built on a
     * `SharedArrayBuffer`, and an environment with one has no need of a substitute.
     * @param msgData - Data property from the commission.
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    override async setupInputMutex (msgData: WorkerMessage['data']) {
        return this._failure(
            msgData,
            `A worker substitute cannot couple to an input mutex in shared memory; use 'setup-cache'.`
        )
    }
}

export default class MontageWorkerSubstitute extends ServiceWorkerSubstitute implements WorkerSubstitute {
    /** The worker's handlers, running on this thread. */
    protected _commissions: MainThreadCommissions

    constructor () {
        super()
        this._commissions = new MainThreadCommissions(this)
    }

    async postMessage (message: WorkerMessage['data']) {
        if (!message?.action) {
            return
        }
        Log.debug(`Received message with action ${message.action}.`, SCOPE)
        await this._commissions.handleMessage({ data: message } as WorkerMessage)
    }
}
