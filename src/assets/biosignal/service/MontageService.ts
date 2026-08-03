/**
 * Biosignal montage service.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import BiosignalMutex from './BiosignalMutex'
import MontageWorkerSubstitute from './MontageWorkerSubstitute'
import type {
    BiosignalChannelFilters,
    BiosignalMontage,
    BiosignalMontageService,
    GetSignalsResponse,
    MontageChannel,
    MontageWorkerCommission,
    SetupMutexResponse,
    SetupSharedWorkerResponse,
    SetFiltersResponse,
    SetupCacheResponse,
    SignalDataCache,
    SignalInterruptionMap,
} from '#types/biosignal'
import type { ConfigChannelFilter } from '#types/config'
import type {
    MemoryManager,
    WorkerResponse,
    SetupWorkerResponse,
} from '#types/service'
import { Log } from 'scoped-event-log'
import GenericService from '#assets/service/GenericService'
import { MutexExportProperties } from 'asymmetric-io-mutex'
import { mapSignalsToSamplingRates } from '#util/signal'

const SCOPE = "MontageService"

export default class MontageService extends GenericService implements BiosignalMontageService {
    private _mutex = null as null | BiosignalMutex
    private _montage: BiosignalMontage
    /**
     * Newest read waiting for the in-flight one to finish, or `null` when nothing waits. Holds one
     * entry at most: a newer read displaces the waiting one. See {@link getSignals}.
     */
    private _queuedRead: {
        config?: ConfigChannelFilter & { overwriteRequest?: boolean }
        range: number[]
        resolve: (response: GetSignalsResponse) => void
    } | null = null
    /** True while a {@link getSignals} commission is in flight. */
    private _readInFlight = false

    get hasQueuedRead () {
        return this._queuedRead !== null
    }
    get mutex () {
        return this._mutex
    }
    get name () {
        return this._montage.name
    }

    /**
     * Create a new montage service to handle relaying commission to and from the montage worker.
     * @param montage - The montage that uses this service.
     * @param manager - Possible memory manager for the service.
     * @param overrideWorker - Possible worker override name (`substitute` is reserved for the worker substitute).
     */
    constructor (montage: BiosignalMontage, manager?: MemoryManager, overrideWorker?: string) {
        if (!window.__EPICURRENTS__?.RUNTIME) {
            Log.error(`Reference to application runtime was not found.`, SCOPE)
        }
        let worker: Worker | undefined
        if (manager && overrideWorker !== 'substitute') {
            const getOverrideWorker = window.__EPICURRENTS__.RUNTIME?.WORKERS.get(overrideWorker || 'montage')
            worker = getOverrideWorker ? getOverrideWorker() : new Worker(
                new URL(
                    /* webpackChunkName: 'montage.worker' */
                    `../../../workers/montage.worker`,
                    import.meta.url
                ),
                { type: 'module'}
            )
        } else {
            worker = new MontageWorkerSubstitute()
        }
        super(SCOPE, worker, false, manager)
        this._montage = montage
        this._worker?.addEventListener('message', this.handleMessage.bind(this))
    }

    cacheMontageSignals () {
        if (!this._montage) {
            Log.error(`Cannot cache montage signals, the montage has not been set up.`, SCOPE)
            return
        }
        // All this nonsense is required to pass the Proxied array to the worker.
        const cache = JSON.stringify({
            start: this._montage.cacheStatus.start,
            end: this._montage.cacheStatus.end,
            signals: []
        })
        const channels = JSON.stringify(([] as (MontageChannel|null)[]).concat(this._montage.channels))
        const filters = JSON.stringify(this._montage.filters)
        this._worker?.postMessage({
            action: 'cache-montage-signals',
            cache: cache,
            channels: channels,
            filters: filters,
            montage: this._montage.name,
        })
    }

    async destroy () {
        this._montage = null as unknown as BiosignalMontage
        this._mutex = null
        await super.destroy()
    }

    async getSignals (range: number[], config?: ConfigChannelFilter & { overwriteRequest?: boolean }) {
        // `overwriteRequest` is no substitute for this queue: it drops the main thread's
        // bookkeeping for earlier commissions, but the messages are already posted, so the worker
        // derives every one of them and the discarded promises never settle.
        if (this._readInFlight) {
            // Displace whatever was waiting; only the newest target is worth deriving.
            this._queuedRead?.resolve({ success: false })
            return new Promise<GetSignalsResponse>((resolve) => {
                this._queuedRead = { config, range, resolve }
            })
        }
        return this._dispatchRead(range, config)
    }

    /**
     * Run one `get-signals` commission and start whichever read queued up behind it. Failures are
     * contained so the in-flight flag is always released; leaking it would strand every later read.
     */
    private async _dispatchRead (
        range: number[],
        config?: ConfigChannelFilter & { overwriteRequest?: boolean }
    ): Promise<GetSignalsResponse> {
        this._readInFlight = true
        try {
            const signals = this._commissionWorker(
                'get-signals',
                new Map<string, unknown>([
                    ['range', range],
                    ['config', config],
                    ['montage', this.name],
                ]),
                undefined,
                { overwriteRequest: config?.overwriteRequest }
            )
            return await (signals.promise as Promise<GetSignalsResponse>)
        } catch (e: unknown) {
            Log.error(`Deriving montage signals failed: ${(e as Error)?.message ?? e}.`, SCOPE)
            return { success: false }
        } finally {
            this._readInFlight = false
            const queued = this._queuedRead
            if (queued) {
                this._queuedRead = null
                this._dispatchRead(queued.range, queued.config).then(queued.resolve)
            }
        }
    }

    async handleMessage (message: WorkerResponse) {
        const data = message.data
        if (!data) {
            return false
        }
        if (super._handleWorkerUpdate(message)) {
            return true
        }
        const commission = this._getCommissionForMessage(message)
        if (!commission) {
            return false
        }
        if (data.action === 'cache-montage-signals') {
            if (data.success && this._montage?.name === data.montage) {
                const range = data.range as number[]
                const signals = data.signals as Float32Array[]
                this._montage?.saveSignalsToCache({
                    start: range[0],
                    end: range[1],
                    signals: mapSignalsToSamplingRates(signals, this._montage.channels)
                })
            }
            return true
        } else if (data.action === 'get-signals') {
            if (!data.success) {
                Log.error("Loading signals failed!", SCOPE, data.error as Error)
                commission.resolve({ signals: [], range: data.range })
            } else {
                commission.resolve({ signals: data.signals, range: data.range })
            }
            return true
        } else if (data.action === 'map-channels') {
            if (data.success) {
                commission.resolve()
            } else {
                Log.error(`Mapping channels in the worker failed.`, SCOPE)
                commission.reject()
            }
            return true
        } else if (data.action === 'set-filters') {
            if (data.success) {
                if (data.updated) {
                    commission.resolve(true)
                } else {
                    commission.resolve(false)
                }
            } else {
                Log.error(`Settings filters in the worker failed.`, SCOPE)
                commission.reject()
            }
            return true
        } else if (data.action === 'setup-input-mutex') {
            this._isCacheSetup = data.success
            if (data.success) {
                commission.resolve()
            } else {
                Log.error(`Setting up montage in the worker failed.`, SCOPE)
                commission.reject()
            }
            this._notifyWaiters('setup-cache', data.success)
            return true
        } else if (data.action === 'setup-input-cache') {
            this._isCacheSetup = data.success
            if (data.success) {
                commission.resolve(true)
            } else {
                Log.error(`Setting up montage in the worker failed.`, SCOPE)
                commission.reject()
            }
            this._notifyWaiters('setup-cache', data.success)
            return true
        } else if (data.action === 'setup-worker') {
            this._isWorkerSetup = data.success
            commission.resolve(data.success)
            this._notifyWaiters('setup-worker', data.success)
            return true
        }
        if (await super._handleWorkerCommission(message)) {
            return true
        }
        Log.warn(`Message with action ${data.action} was not handled.`, SCOPE)
        return false
    }

    mapChannels (): Promise<void> {
        const channels = this._commissionWorker(
            'map-channels',
            new Map<string, unknown>([
                ['config', this._montage.config]
            ])
        )
        return channels.promise as Promise<void>
    }

    setInterruptions (interruptions: SignalInterruptionMap) {
        // Convert interruptions into a JSON friendly format.
        const interruptionList = []
        for (const intr of interruptions.entries()) {
            interruptionList.push({ start: intr[0], duration: intr[1] })
        }
        this._worker?.postMessage({
            action: 'set-interruptions',
            interruptions: interruptionList
        } as MontageWorkerCommission['set-interruptions'])
    }

    async setFilters () {
        // TODO: Don't flood the worker with multiple requests for the same thing.
        // This can happen when changing filters on multiple channels at the same time.
        const channelFilters = this._montage.channels.map(c => {
            return {
                bandreject: [...c?.filters.bandreject],
                highpass: c?.highpassFilter,
                lowpass: c?.lowpassFilter,
                notch: c?.notchFilter,
            } as BiosignalChannelFilters
        })
        const filters = this._commissionWorker(
            'set-filters',
            new Map<string, unknown>([
                ['filters', JSON.stringify(this._montage.filters)],
                ['name', this._montage.name],
                ['channels', channelFilters],
            ])
        )
        return filters.promise as Promise<SetFiltersResponse>
    }

    async setupMontageWithCache (cache: SignalDataCache) {
        if (!this._montage) {
            Log.error('Cannot set up montage without valid montage configuration.', SCOPE)
            return { success: false }
        }
        this._initWaiters('setup-cache')
        const montage = this._commissionWorker(
            'setup-cache',
            new Map<string, unknown>([
                ['cache', cache],
                ['dataDuration', this._montage.recording.dataDuration],
                ['recordingDuration', this._montage.recording.totalDuration],
            ])
        )
        return montage.promise as Promise<SetupCacheResponse>
    }

    async setupMontageWithInputMutex (inputProps: MutexExportProperties) {
        if (!this._montage) {
            Log.error('Cannot set up montage without valid montage configuration.', SCOPE)
            return { success: false }
        }
        if (!this._manager?.buffer) {
            Log.error(`Cannot set up montage before manager has been initialized.`, SCOPE)
            return { success: false }
        }
        // We will use the generic setup-cache action to wait for this setup to complete.
        this._initWaiters('setup-cache')
        // Only reserve SAB space when output-side caching is actually enabled.
        // When precacheMontages is falsy every getSignals call recomputes from the input mutex on
        // the fly, so an output buffer would be permanently empty allocation.
        const modules = window.__EPICURRENTS__?.RUNTIME?.SETTINGS?.modules
        const precacheMontages = modules && Object.values(modules).some(
            (m) => (m as unknown as { precacheMontages?: number }).precacheMontages
        )
        if (precacheMontages) {
            // Lock cell (1) + meta fields (5: allocated, start, end, data_unit_duration,
            // window_epoch). Must track the meta-field set in BiosignalMutex.
            let totalMem = 6
            const dataFieldsLen = BiosignalMutex.SIGNAL_DATA_POS
            for (const chan of this._montage.channels) {
                if (chan) {
                    // TODO: allocate memory for channel signals as well.
                }
                totalMem += dataFieldsLen
            }
            const bufferPart = await this.requestMemory(totalMem)
            if (!bufferPart || !this._memoryRange) {
                Log.error(`Allocating memory for montage failed.`, SCOPE)
                return { success: false }
            }
        }
        this._mutex = new BiosignalMutex({ coupledProps: inputProps })
        const montage = this._commissionWorker(
            'setup-input-mutex',
            new Map<string, unknown>([
                ['montage', this._montage.name],
                ['config', this._montage.config],
                ['input', BiosignalMutex.convertPropertiesForCoupling(inputProps)],
                ['bufferStart', this._memoryRange?.start ?? 0],
                ['dataDuration', this._montage.recording.dataDuration],
                ['recordingDuration', this._montage.recording.totalDuration],
                ['setupChannels', this._montage.setup.channels],
            ])
        )
        return montage.promise as Promise<SetupMutexResponse>
    }

    async setupMontageWithSharedWorker (inputPort: MessagePort) {
        if (!this._montage) {
            Log.error('Cannot set up montage without valid montage configuration.', SCOPE)
            return { success: false }
        }
        // We will use the generic setup-cache action to wait for this setup to complete.
        this._initWaiters('setup-cache')
        const montage = this._commissionWorker(
            'setup-input-cache',
            new Map<string, unknown>([
                ['montage', this._montage.name],
                ['config', this._montage.config],
                ['input', inputPort],
                ['dataDuration', this._montage.recording.dataDuration],
                ['recordingDuration', this._montage.recording.totalDuration],
                ['setupChannels', this._montage.setup.channels],
            ])
        )
        return montage.promise as Promise<SetupSharedWorkerResponse>
    }

    async setupWorker () {
        this._initWaiters('setup-worker')
        const commission = this._commissionWorker(
            'setup-worker',
            new Map<string, unknown>([
                ['config', this._montage.config],
                ['montage', this._montage.name],
                ['namespace', this._montage.modality],
                ['settings', window.__EPICURRENTS__.RUNTIME?.SETTINGS._CLONABLE],
                ['setupChannels', this._montage.setup.channels],
            ])
        )
        return commission.promise as Promise<SetupWorkerResponse>
    }
}
