/**
 * Default biosignal montage worker. Holds every commission a montage answers, on either side of the
 * thread boundary: the worker thread runs this class through `montage.worker.entry`, and
 * {@link MontageWorkerSubstitute} runs the same class on the main thread with
 * {@link BaseWorker._postMessage} and `_close` redirected.
 *
 * The vocabulary is a contract with `MontageService`, not a menu. A commission with no handler is
 * answered with a failure, and the service reads that as the operation having been refused — so a
 * `shutdown` nobody implements leaves the worker running with its processor, its cache and its
 * buffer views, and reports nothing. Keeping the set in one class is what stops the two halves from
 * drifting into answering different questions.
 *
 * Four commissions cannot mean the same thing on both sides, and each says so where it is
 * overridden rather than by being absent. `setup-cache` hands over a live cache object and is
 * answerable only where there is no boundary to clone it across; `set-buffer-range`,
 * `setup-input-cache` and `setup-input-mutex` need shared memory or a shared worker, which is
 * precisely what the environments using a substitute do not have.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BiosignalFilters,
    MontageWorkerCommission,
    MontageWorkerCommissionAction,
    SetFiltersResponse,
    SetupMutexResponse,
    SignalInterruptionMap,
} from '#types/biosignal'
import type { AppSettings, CommonBiosignalSettings } from '#types/config'
import type { WorkerMessage } from '#types/service'
import MontageProcessor from '#assets/biosignal/service/MontageProcessor'
import { Log } from 'scoped-event-log'
import { BaseWorker } from './base.worker'

const SCOPE = "MontageWorker"

export class MontageWorker extends BaseWorker {
    protected _actionMap = new Map<
        MontageWorkerCommissionAction,
        (message: WorkerMessage['data']) => Promise<boolean>
    >([
        ['get-signals', this.getSignals],
        ['invalidate-cache', this.invalidateCache],
        ['map-channels', this.mapChannels],
        ['release-cache', this.releaseCache],
        ['release-signal-arrays', this.releaseSignalArrays],
        ['reset-network', this.resetNetwork],
        ['set-buffer-range', this.setBufferRange],
        ['set-interruptions', this.setInterruptions],
        ['set-filters', this.setFilters],
        ['setup-cache', this.setupCache],
        ['setup-input-cache', this.setInputCache],
        ['setup-input-mutex', this.setupInputMutex],
        ['setup-worker', this.setupWorker],
        ['shutdown', this.shutdown],
        ['update-settings', this.updateSettings],
    ])
    /** Montage processer. */
    protected _montage = null as MontageProcessor | null
    protected _name = ''
    /**
     * Tail of the get-signals processing chain. Each incoming `get-signals` commission chains
     * itself behind this promise, then replaces it. This serialises `MontageProcessor.getSignals`
     * — without serialisation the async function yields at every `await` and lets another
     * `get-signals` start running, causing many concurrent `Atomics.compareExchange` retries on
     * the same lock view and `Maximum retries of locking operation reached` errors. The price is
     * that bursts of requests run sequentially instead of overlapping, but each individual
     * fetch finishes much faster once contention is gone.
     */
    protected _signalsChain: Promise<void> = Promise.resolve()
    /**
     * Request number of the most recent `get-signals` commission. Older commissions still in the
     * chain check this against their own `rn` and skip the heavy work if a newer request has
     * arrived — under rapid scrolling only the latest viewport is interesting, and processing
     * stale commissions just queues up more lock activity without any visible benefit.
     */
    protected _lastSignalsRn = -1

    constructor () {
        super()
    }

    protected _getBufferRangeTarget () {
        return this._montage
    }

    /**
     * Resolve this montage's module settings from a settings snapshot.
     *
     * A worker holds no settings of its own, so the snapshot a commission carries is the only
     * source it has. A substitute overrides this to read the application's live settings instead:
     * the processor keeps the reference it is given, and handing it a snapshot there would freeze
     * the montage at the values held when the commission was posted.
     * @param settings - Settings snapshot carried by the commission.
     * @returns The module's settings, or null when the snapshot carries none for this namespace.
     */
    protected _resolveModuleSettings (settings: AppSettings): CommonBiosignalSettings | null {
        return (settings.modules[this._namespace] as unknown as CommonBiosignalSettings) || null
    }

    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async getSignals (msgData: WorkerMessage['data']) {
        const myRn = (msgData as { rn?: number }).rn ?? -1
        this._lastSignalsRn = myRn
        // Chain after the previous commission so only one `getSignals` body runs at a time. Older
        // commissions still in the chain will check `_lastSignalsRn` and skip the heavy work
        // when a newer request has arrived (only the latest viewport matters during rapid
        // scrolling).
        const myTurn = this._signalsChain.then(async () => {
            if (this._lastSignalsRn !== myRn) {
                this._failure(msgData, 'Superseded by newer get-signals request.')
                return
            }
            const data = this._validate(
                msgData as MontageWorkerCommission['get-signals'],
                {
                    range: ['Number', 'Number'],
                    config: 'Object?',
                    montage: 'String?',
                },
                this._montage !== null
            )
            if (!data) {
                // `_validate` has already answered the commission.
                return
            }
            try {
                const config = data.config
                const sigs = await this._montage?.getSignals(data.range, config)
                if (sigs) {
                    // This has to be posted separately because of the spread operator.
                    this._success(msgData, sigs)
                } else {
                    this._failure(msgData, 'Failed to get signals from the montage worker.')
                }
            } catch (e) {
                this._failure(msgData, e as string)
            }
        })
        // Swallow rejections on the chain tail so a single failure doesn't break later commissions.
        this._signalsChain = myTurn.catch(() => {})
        await myTurn
        return true
    }
    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async mapChannels (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as MontageWorkerCommission['map-channels'],
            {
                config: 'Object'
            },
            this._montage !== null
        )
        if (!data) {
            return false
        }
        this._montage?.mapChannels(data.config)
        Log.debug(`Channel mapping complete.`, SCOPE)
        return this._success(msgData)
    }
    /**
     * Discard the derived signals cached for this montage, so the next request recomputes them from
     * the source signals. Needed when the source data changes under the montage; a filter change
     * invalidates on its own as part of `set-filters`.
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async invalidateCache (msgData: WorkerMessage['data']) {
        await this._montage?.invalidateOutputCache()
        Log.debug(`Derived signal cache invalidated.`, SCOPE)
        return this._success(msgData)
    }
    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async releaseCache (msgData: WorkerMessage['data']) {
        await this._montage?.releaseCache()
        Log.debug(`Cache released.`, SCOPE)
        return this._success(msgData)
    }
    /**
     * Level 1 of the three-level cache lifecycle: drop signal array views and
     * cancel in-flight caching, but preserve the mutex layout. Pairs with the
     * worker-side `BiosignalMutex.initSignalBuffers(..., overwrite=true)`
     * rebind path on re-activation.
     */
    async releaseSignalArrays (msgData: WorkerMessage['data']) {
        await this._montage?.releaseSignalArrays()
        Log.debug(`Signal arrays released.`, SCOPE)
        return this._success(msgData)
    }
    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setFilters (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as MontageWorkerCommission['set-filters'],
            {
                filters: 'String',
                name: 'String',
                channels: 'Array?',
            },
            this._montage !== null
        )
        if (!data) {
            return false
        }
        if (!this._montage) {
            return this._failure(msgData, `Cannot set filters before the montage has been set up.`)
        }
        if (this._name !== data.name)  {
            // This event may trigger before the montage itself has been updated.
            Log.debug(`Received set-filters commission for a different montage.`, SCOPE)
            // TODO: Prevent this from happening in the first place, but don't throw an error for now.
            return this._success(msgData)
        }
        const newFilters = JSON.parse(data.filters as string) as BiosignalFilters
        let someUpdated = false
        // Batch every filter write with `skipInvalidate=true` and invalidate exactly once at the
        // end. Invalidating per write dispatches up to `(channels + 1) * 3` concurrent
        // invalidations, which contend for the OUTPUT write lock and starve each other —
        // `Maximum retries of locking operation reached` at mount, and again on every filter
        // change the user makes.
        if (newFilters.highpass !== this._montage.filters.highpass) {
            this._montage.setHighpassFilter(newFilters.highpass, undefined, true)
            someUpdated = true
        }
        if (newFilters.lowpass !== this._montage.filters.lowpass) {
            this._montage.setLowpassFilter(newFilters.lowpass, undefined, true)
            someUpdated = true
        }
        if (newFilters.notch !== this._montage.filters.notch) {
            this._montage.setNotchFilter(newFilters.notch, undefined, true)
            someUpdated = true
        }
        if (data.channels && data.channels.length === this._montage.channels.length) {
            const channels = data.channels as BiosignalFilters[]
            for (let i=0; i<channels.length; i++) {
                const chan = channels[i]
                if (chan.highpass !== this._montage.channels[i].highpassFilter) {
                    this._montage.setHighpassFilter(chan.highpass, i, true)
                    someUpdated = true
                }
                if (chan.lowpass !== this._montage.channels[i].lowpassFilter) {
                    this._montage.setLowpassFilter(chan.lowpass, i, true)
                    someUpdated = true
                }
                if (chan.notch !== this._montage.channels[i].notchFilter) {
                    this._montage.setNotchFilter(chan.notch, i, true)
                    someUpdated = true
                }
            }
        }
        if (someUpdated) {
            await this._montage.invalidateOutputCache()
        }
        Log.debug(`Filters updated.`, SCOPE)
        return this._success(msgData, { updated: someUpdated } as SetFiltersResponse)
    }
    /**
     * Take over a signal cache that already exists on the commissioning side.
     *
     * Refused on a worker thread and answered by {@link MontageWorkerSubstitute}. The commission
     * carries a live {@link SignalDataCache}, an object whose methods a structured clone does not
     * carry, so the only context that can accept one is a context sharing the caller's heap. A
     * worker takes its input through `setup-input-mutex` or `setup-input-cache` instead.
     * @param msgData - Data property from the message to the worker.
     * @returns False, always; the refusal is the answer.
     */
    // The refusal needs no await, but the signature is the action map's.
    // eslint-disable-next-line @typescript-eslint/require-await
    async setupCache (msgData: WorkerMessage['data']) {
        return this._failure(
            msgData,
            `A montage worker cannot take over a cache held on another thread; ` +
            `use 'setup-input-mutex' or 'setup-input-cache'.`
        )
    }
    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setInputCache (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as MontageWorkerCommission['setup-input-cache'],
            {
                dataDuration: 'Number',
                port: 'MessagePort',
                recordingDuration: 'Number',
            },
            this._montage !== null
        )
        if (!data) {
            return false
        }
        const setupSuccess = await this._montage?.setupSharedWorkerWithInput(
            data.port as MessagePort,
            data.dataDuration as number,
            data.recordingDuration as number
        )
        if (setupSuccess) {
            Log.debug(`Shared worker setup complete.`, SCOPE)
            return this._success(msgData)
        } else {
            return this._failure(msgData, `Setting up shared worker cache in the montage worker failed.`)
        }
    }
    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setupInputMutex (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as MontageWorkerCommission['setup-input-mutex'],
            {
                bufferStart: 'Number',
                dataDuration: 'Number',
                input: 'Object',
                recordingDuration: 'Number',
            },
            this._montage !== null
        )
        if (!data) {
            return false
        }
        const cacheSetup = await this._montage?.setupMutexWithInput(
            data.input,
            data.bufferStart,
            data.dataDuration,
            data.recordingDuration
        )
        if (cacheSetup) {
            Log.debug(`Mutex setup complete.`, SCOPE)
            // Pass the generated shared buffers back to main thread.
            return this._success(msgData, { cacheProperties: cacheSetup } as SetupMutexResponse)
        } else {
            return this._failure(msgData, `Failed to set up input mutex in the montage worker.`)
        }
    }
    /**
     * Sets interruptions in the source recording to the montage worker.
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setInterruptions (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as MontageWorkerCommission['set-interruptions'],
            {
                interruptions: 'Array'
            },
            this._montage !== null
        )
        if (!data) {
            return false
        }
        const newInterruptions = new Map<number, number>() as SignalInterruptionMap
        for (const intr of data.interruptions) {
            newInterruptions.set(intr.start, intr.duration)
        }
        this._montage?.setInterruptions(newInterruptions)
        Log.debug(`New data interruptions set.`, SCOPE)
        return this._success(msgData)
    }
    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setupWorker (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as MontageWorkerCommission['setup-worker'],
            {
                config: 'Object',
                montage: 'String',
                namespace: 'String',
                settings: 'Object',
                setupChannels: 'Array',
            }
        )
        if (!data) {
            return false
        }
        this._namespace = data.namespace as string
        const settings = this._resolveModuleSettings(data.settings)
        if (!settings) {
            return this._failure(msgData, `Settings carried no '${this._namespace}' module to set the montage up with.`)
        }
        // The processor's replies go out through this worker's own transport, so a staged response
        // reaches the service on either side of the thread boundary.
        this._montage = new MontageProcessor(settings, (msg) => this._postMessage(msg as WorkerMessage['data']))
        this._montage.setupChannels(data.montage, data.config, data.setupChannels)
        this._name = data.montage
        Log.debug(`Worker setup complete.`, SCOPE)
        return this._success(msgData)
    }
    /**
     * Tear the montage processor down and close the worker.
     *
     * The reply is posted before the close, because the service awaits it before terminating the
     * worker and clearing the state that belongs to it. Answering with a failure — which is what an
     * unregistered action does — leaves the service holding a worker it has been told not to
     * terminate.
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async shutdown (msgData: WorkerMessage['data']) {
        await this._montage?.destroy()
        this._montage = null
        const result = this._success(msgData)
        this._close()
        return result
    }
    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async updateSettings (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as MontageWorkerCommission['update-settings'],
            { settings: 'Object' }
        )
        if (!data) {
            return false
        }
        if (this._namespace && this._montage) {
            // Only update settings after initial setup.
            const moduleSettings = this._resolveModuleSettings(data.settings)
            if (moduleSettings) {
                this._montage.settings = moduleSettings
                Log.debug(`Settings updated in worker.`, SCOPE)
            } else {
                // Keeping settings that have gone stale beats replacing them with nothing. Every
                // change posts a whole snapshot to every worker, so one taken while this worker's
                // module was not registered would otherwise blank the montage's settings over a
                // change that had nothing to do with it.
                Log.warn(
                    `Settings snapshot carried no '${this._namespace}' module; kept the previous settings.`,
                    SCOPE
                )
            }
        }
        return this._success(msgData)
    }
}
