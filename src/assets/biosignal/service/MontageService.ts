/**
 * Biosignal montage service.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import BiosignalMutex from './BiosignalMutex'
import InlineMontageWorker from '../../../workers/montage.worker.entry.ts?worker&inline'
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
    CommissionWorkerOptions,
    MemoryManager,
    WorkerCommission,
    WorkerResponse,
    SetupWorkerResponse,
} from '#types/service'
import { Log } from 'scoped-event-log'
import GenericService from '#assets/service/GenericService'
import { MutexExportProperties } from 'asymmetric-io-mutex'
import { mapSignalsToSamplingRates } from '#util/signal'
import { toPlainData } from '#util/worker'

const SCOPE = "MontageService"
/**
 * How long a stopping worker is given to answer the requests it holds. A recording going out of view usually has a
 * read in flight, and rejecting it would report a failure for a read nothing is waiting for any more.
 */
const STOP_GRACE_MS = 1000

/** Does any module cache montage signals ahead of a read, which reserves output memory for every montage. */
const precachesMontages = () => {
    const modules = window.__EPICURRENTS__?.RUNTIME?.SETTINGS?.modules
    return !!modules && Object.values(modules).some(
        (m) => (m as unknown as { precacheMontages?: number }).precacheMontages
    )
}

export default class MontageService extends GenericService implements BiosignalMontageService {
    /**
     * Creates the montage worker on demand, or null when the service was given its worker at construction. A service
     * holding a factory starts its worker on the first request that needs one and stops it again when unloaded, so a
     * montage nothing reads from holds no thread.
     */
    private _createWorker: (() => Worker) | null = null
    /**
     * The setup a worker started on demand is given before any request: what the service was asked to set up while
     * it had no worker. The input is kept when the worker stops, so a request after an unload sets it up again.
     */
    private _deferredSetup = {
        /** Were filters set, so that a new worker is given the montage's current ones. */
        filters: false,
        input: null as null
            | { kind: 'cache', cache: SignalDataCache }
            | { kind: 'mutex', props: MutexExportProperties }
            | { kind: 'shared', port: MessagePort },
        interruptions: null as SignalInterruptionMap | null,
        worker: false,
    }
    /** Commissions sent and not yet answered, which a stopping worker is given time to answer. */
    private _inFlight = new Set<Promise<void>>()
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
    /** The worker start in progress, shared by every request that arrives during it. */
    private _starting: Promise<boolean> | null = null
    /** Set by a request that arrives while a stop waits for the requests in flight, which keeps the worker. */
    private _stopCancelled = false
    /** The worker shutdown in progress; a request arriving during it waits for it and starts a new worker. */
    private _stopping: Promise<void> | null = null

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
        let createWorker: (() => Worker) | null = null
        if (manager && overrideWorker !== 'substitute') {
            const getOverrideWorker = window.__EPICURRENTS__.RUNTIME?.WORKERS.get(overrideWorker || 'montage')
            createWorker = getOverrideWorker ? getOverrideWorker : () => new InlineMontageWorker()
            // A precaching montage fills its output buffer whether or not anything reads from it, so it needs its
            // worker from the start.
            if (precachesMontages()) {
                worker = createWorker()
                createWorker = null
            }
        } else {
            worker = new MontageWorkerSubstitute()
        }
        super(SCOPE, worker, false, manager)
        this._montage = montage
        this._createWorker = createWorker
        this._worker?.addEventListener('message', this.handleMessage.bind(this))
    }

    /**
     * Copy montage state for a commission as plain data. A host application may wrap the montage, and the service
     * reached through it, in reactive proxies, and a worker started on demand is set up from inside such a call, where
     * every object read off `this` is a proxy that cannot be posted to a worker. Binary data stays by reference.
     */
    private _plain<T> (value: T): T {
        return toPlainData(value) as T
    }

    protected _commissionWorker (
        action: string,
        props?: Map<string, unknown>,
        callbacks?: { resolve: ((value?: unknown) => void), reject: ((reason?: string) => void) },
        options?: CommissionWorkerOptions
    ): WorkerCommission {
        const commission = super._commissionWorker(action, props, callbacks, options)
        const settled = commission.promise.then(() => undefined, () => undefined)
        this._inFlight.add(settled)
        settled.then(() => {
            this._inFlight.delete(settled)
        })
        return commission
    }

    /** Is the worker yet to be started on demand. */
    private get _deferred () {
        return this._createWorker !== null && this._worker === null
    }

    /**
     * Start a worker created on demand and give it the setup deferred until now, resolving once its input is set up
     * so that the request that started it is answered from a ready processor. A service given its worker at
     * construction resolves at once.
     * @param replayFilters - Give a new worker the montage's filters; false when the caller is about to send them.
     * @returns Whether the service has a worker set up to take requests.
     */
    private async _start (replayFilters = true): Promise<boolean> {
        if (this._stopping) {
            this._stopCancelled = true
            await this._stopping
        }
        if (!this._deferred) {
            return this._worker !== null
        }
        if (this._starting) {
            return this._starting
        }
        this._starting = (async () => {
            const worker = this._createWorker!()
            this._attachWorker(worker)
            worker.addEventListener('message', this.handleMessage.bind(this))
            const setup = this._deferredSetup
            if (setup.worker) {
                // Posted ahead of the input setup and not awaited, as at construction: the worker takes its messages
                // in order.
                this._commissionSetupWorker()
            }
            let ready = true
            try {
                if (setup.input?.kind === 'mutex') {
                    await this._commissionInputMutex(setup.input.props)
                } else if (setup.input?.kind === 'cache') {
                    await this._commissionCache(setup.input.cache)
                } else if (setup.input?.kind === 'shared') {
                    await this._commissionSharedWorker(setup.input.port)
                }
            } catch {
                Log.error(`Setting up montage '${this.name}' in its worker failed.`, SCOPE)
                ready = false
            }
            if (setup.interruptions) {
                this._postInterruptions(setup.interruptions)
            }
            if (ready && replayFilters && setup.filters) {
                await this._commissionFilters()
            }
            return ready
        })().finally(() => {
            this._starting = null
        })
        return this._starting
    }

    /**
     * Shut a worker started on demand down, leaving the service to start a new one for the next request. The memory
     * manager the shutdown lets go of is kept, since the next start commissions against it.
     */
    private async _stop () {
        if (this._stopping) {
            return this._stopping
        }
        if (!this._createWorker || !this._worker) {
            return
        }
        this._stopCancelled = false
        this._stopping = (async () => {
            await this._starting
            if (this._inFlight.size) {
                await Promise.race([
                    Promise.all([...this._inFlight]),
                    new Promise(resolve => setTimeout(resolve, STOP_GRACE_MS)),
                ])
            }
            if (this._stopCancelled) {
                return
            }
            const manager = this._manager
            await this.shutdown()
            this._manager = manager
        })().finally(() => {
            this._stopping = null
        })
        return this._stopping
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
        // A destroyed service starts no worker again, whatever reaches it afterwards.
        this._createWorker = null
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
            await this._start()
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
            this._releaseCommission(message)
            if (!data.success) {
                // See the matching call in `GenericBiosignalService`: the `error` argument takes an
                // `Error`, and a reply carries its cause as text.
                Log.error(`Loading signals failed: ${data.error ?? 'no cause reported'}`, SCOPE)
                commission.resolve({ signals: [], range: data.range })
            } else {
                commission.resolve({ signals: data.signals, range: data.range })
            }
            return true
        } else if (data.action === 'map-channels') {
            this._releaseCommission(message)
            if (data.success) {
                commission.resolve()
            } else {
                Log.error(`Mapping channels in the worker failed.`, SCOPE)
                commission.reject()
            }
            return true
        } else if (data.action === 'set-filters') {
            this._releaseCommission(message)
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
            this._releaseCommission(message)
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
            this._releaseCommission(message)
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
            this._releaseCommission(message)
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

    async mapChannels (): Promise<void> {
        await this._start()
        const channels = this._commissionWorker(
            'map-channels',
            new Map<string, unknown>([
                ['config', this._plain(this._montage.config)]
            ])
        )
        return channels.promise as Promise<void>
    }

    setInterruptions (interruptions: SignalInterruptionMap) {
        if (this._deferred) {
            this._deferredSetup.interruptions = interruptions
            return
        }
        this._postInterruptions(interruptions)
    }

    private _postInterruptions (interruptions: SignalInterruptionMap) {
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

    async invalidateCache () {
        if (this._deferred) {
            // A worker that has not started holds no cache to invalidate.
            return
        }
        const commission = this._commissionWorker('invalidate-cache')
        await commission.promise
    }

    async setFilters () {
        if (this._createWorker) {
            this._deferredSetup.filters = true
        }
        await this._start(false)
        return this._commissionFilters()
    }

    private _commissionFilters () {
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
        if (this._createWorker) {
            this._deferredSetup.input = { kind: 'cache', cache }
            if (this._deferred) {
                return { success: true }
            }
        }
        return this._commissionCache(cache)
    }

    private _commissionCache (cache: SignalDataCache) {
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
        if (this._createWorker) {
            this._deferredSetup.input = { kind: 'mutex', props: inputProps }
            if (this._deferred) {
                return { success: true }
            }
        }
        return this._commissionInputMutex(inputProps)
    }

    private async _commissionInputMutex (inputProps: MutexExportProperties) {
        if (!this._manager?.buffer) {
            Log.error(`Cannot set up montage before manager has been initialized.`, SCOPE)
            return { success: false }
        }
        // We will use the generic setup-cache action to wait for this setup to complete.
        this._initWaiters('setup-cache')
        // Only reserve SAB space when output-side caching is actually enabled.
        // When precacheMontages is falsy every getSignals call recomputes from the input mutex on
        // the fly, so an output buffer would be permanently empty allocation.
        if (precachesMontages()) {
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
                ['config', this._plain(this._montage.config)],
                ['input', this._plain(BiosignalMutex.convertPropertiesForCoupling(inputProps))],
                ['bufferStart', this._memoryRange?.start ?? 0],
                ['dataDuration', this._montage.recording.dataDuration],
                ['recordingDuration', this._montage.recording.totalDuration],
                ['setupChannels', this._plain(this._montage.setup.channels)],
            ])
        )
        return montage.promise as Promise<SetupMutexResponse>
    }

    async setupMontageWithSharedWorker (inputPort: MessagePort) {
        if (!this._montage) {
            Log.error('Cannot set up montage without valid montage configuration.', SCOPE)
            return { success: false }
        }
        if (this._createWorker) {
            this._deferredSetup.input = { kind: 'shared', port: inputPort }
            if (this._deferred) {
                return { success: true }
            }
        }
        return this._commissionSharedWorker(inputPort)
    }

    private _commissionSharedWorker (inputPort: MessagePort) {
        // We will use the generic setup-cache action to wait for this setup to complete.
        this._initWaiters('setup-cache')
        const montage = this._commissionWorker(
            'setup-input-cache',
            new Map<string, unknown>([
                ['montage', this._montage.name],
                ['config', this._plain(this._montage.config)],
                // `port`, as `MontageWorkerCommission['setup-input-cache']` declares and the
                // worker's validation requires. Sent under any other name the property is simply
                // absent, validation refuses the commission, and the shared-worker cache path
                // fails every time it is used.
                ['port', inputPort],
                ['dataDuration', this._montage.recording.dataDuration],
                ['recordingDuration', this._montage.recording.totalDuration],
                ['setupChannels', this._plain(this._montage.setup.channels)],
            ])
        )
        return montage.promise as Promise<SetupSharedWorkerResponse>
    }

    async setupWorker () {
        if (this._createWorker) {
            this._deferredSetup.worker = true
            if (this._deferred) {
                return true
            }
        }
        return this._commissionSetupWorker()
    }

    private _commissionSetupWorker () {
        this._initWaiters('setup-worker')
        const commission = this._commissionWorker(
            'setup-worker',
            new Map<string, unknown>([
                ['config', this._plain(this._montage.config)],
                ['montage', this._montage.name],
                ['namespace', this._montage.modality],
                ['settings', window.__EPICURRENTS__.RUNTIME?.SETTINGS._CLONABLE],
                ['setupChannels', this._plain(this._montage.setup.channels)],
            ])
        )
        return commission.promise as Promise<SetupWorkerResponse>
    }

    async releaseWorker () {
        await this._stop()
    }

    async unload (releaseFromManager = true) {
        await super.unload(releaseFromManager)
        // A worker started on demand goes with the data it was reading; the next request starts another.
        await this._stop()
    }
}
