/**
 * Default biosignal montage worker.
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
import type { CommonBiosignalSettings } from '#types/config'
import type { WorkerMessage } from '#types/service'
import MontageProcessor from '#assets/biosignal/service/MontageProcessor'
import { validateCommissionProps } from '#util'
import { Log } from 'scoped-event-log'
import { BaseWorker } from './base.worker'

const SCOPE = "MontageWorker"

export class MontageWorker extends BaseWorker {
    protected _actionMap = new Map<
        MontageWorkerCommissionAction,
        (message: WorkerMessage['data']) => Promise<boolean>
    >([
        ['get-signals', this.getSignals],
        ['map-channels', this.mapChannels],
        ['release-cache', this.releaseCache],
        ['release-signal-arrays', this.releaseSignalArrays],
        ['set-interruptions', this.setInterruptions],
        ['set-filters', this.setFilters],
        ['setup-input-cache', this.setInputCache],
        ['setup-input-mutex', this.setupInputMutex],
        ['setup-worker', this.setupWorker],
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
            const data = validateCommissionProps(
                msgData as MontageWorkerCommission['get-signals'],
                {
                    range: ['Number', 'Number'],
                    config: 'Object?',
                    montage: 'String?',
                },
                this._montage !== null
            )
            if (!data) {
                this._failure(msgData)
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
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['map-channels'],
            {
                config: 'Object'
            },
            this._montage !== null
        )
        if (!data) {
            return this._failure(msgData)
        }
        this._montage?.mapChannels(data.config)
        Log.debug(`Channel mapping complete.`, SCOPE)
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
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['set-filters'],
            {
                filters: 'String',
                name: 'String',
                channels: 'Array?',
            },
            this._montage !== null
        )
        if (!data || !this._montage) {
            return this._failure(msgData)
        }
        if (this._name !== data.name)  {
            // This event may trigger before the montage itself has been updated.
            Log.debug(`Received set-filters commission for a different montage.`, SCOPE)
            // TODO: Prevent this from happening in the first place, but don't throw an error for now.
            return this._success(msgData)
        }
        const newFilters = JSON.parse(data.filters as string) as BiosignalFilters
        let someUpdated = false
        // Batch all filter writes with `skipInvalidate=true` and call `invalidateOutputSignals`
        // exactly once at the end. The previous fire-and-forget pattern dispatched up to
        // `(channels + 1) * 3` concurrent invalidations, all contending for the OUTPUT write
        // lock and starving each other (manifesting as `Maximum retries of locking operation
        // reached in ~600 ms` errors at mount when the active montage's filters were initialised
        // and again on every user filter change).
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
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setInputCache (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['setup-input-cache'],
            {
                dataDuration: 'Number',
                port: 'MessagePort',
                recordingDuration: 'Number',
            },
            this._montage !== null
        )
        if (!data) {
            return this._failure(msgData)
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
        const data = validateCommissionProps(
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
            return this._failure(msgData)
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
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['set-interruptions'],
            {
                interruptions: 'Array'
            },
            this._montage !== null
        )
        if (!data) {
            return this._failure(msgData)
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
        const data = validateCommissionProps(
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
            return this._failure(msgData)
        }
        this._namespace = data.namespace as string
        const settings = data.settings.modules[this._namespace] as unknown as CommonBiosignalSettings
        // Explicit postMessage routing: in a real worker the global `postMessage` already routes
        // to the parent thread, but binding it here makes the wiring symmetric with the substitute
        // (which has to inject `returnMessage`) and avoids any future surprises if the processor
        // is constructed in an unusual context.
        this._montage = new MontageProcessor(settings, (msg) => postMessage(msg))
        this._montage.setupChannels(data.montage, data.config, data.setupChannels)
        this._name = data.montage
        Log.debug(`Worker setup complete.`, SCOPE)
        return this._success(msgData)
    }
    /**
     *
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async updateSettings (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['update-settings'],
            { settings: 'Object' }
        )
        if (!data) {
            return this._failure(msgData)
        }
        if (this._namespace && this._montage) {
            // Only update settings after initial setup.
            this._montage.settings = data.settings.modules[this._namespace] as unknown as CommonBiosignalSettings
        }
        Log.debug(`Settings updated in worker.`, SCOPE)
        return this._success(msgData)
    }
}

const MONTAGE = new MontageWorker()

onmessage = async (message: WorkerMessage) => {
    MONTAGE.handleMessage(message)
}
