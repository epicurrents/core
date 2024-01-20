/**
 * Biosignal montage service.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalMontage,
    type BiosignalMontageService,
    type GetSignalsResponse,
    type MontageChannel,
    type SetupMutexResponse,
    type SetupSharedWorkerResponse,
    type SetFiltersResponse,
} from '#types/biosignal'
import { type ConfigChannelFilter } from '#types/config'
import {
    type MemoryManager,
    type WorkerResponse,
} from '#types/service'
import { Log } from 'scoped-ts-log'
import BiosignalMutex from './BiosignalMutex'
import GenericService from '#assets/service/GenericService'
import { MutexExportProperties } from 'asymmetric-io-mutex'
import { mapSignalsToSamplingRates } from '#util/signal'
// TODO: Provide access to the root application instance so this hasn't to be accessed directly.
import { state as runtimeState } from '#runtime'

const SCOPE = "MontageService"

export default class MontageService extends GenericService implements BiosignalMontageService {
    private _mutex = null as null | BiosignalMutex
    private _montage: BiosignalMontage

    get mutex () {
        return this._mutex
    }
    get name () {
        return this._montage.name
    }

    constructor (namespace: string, montage: BiosignalMontage, manager?: MemoryManager) {
        const overrideWorker = runtimeState.WORKERS.get('montage')
        const worker = overrideWorker ? overrideWorker() : new Worker(
            new URL(
                /* webpackChunkName: 'montage.worker' */
                `../../../workers/montage.worker`,
                import.meta.url
            ),
            { type: 'module'}
        )
        super(SCOPE, worker, manager)
        this._worker?.postMessage({
            action: 'settings-namespace',
            value: namespace,
        })
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

    async getSignals (range: number[], config?: ConfigChannelFilter & { overwriteRequest?: boolean }) {
        const signals = this._commissionWorker(
            'get-signals',
            new Map<string, unknown>([
                ['range', range],
                ['config', config],
            ]),
            undefined,
            config?.overwriteRequest === true ? true : false
        )
        return signals.promise as Promise<GetSignalsResponse>
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
            if (data.success && data.updated) {
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
            if (data.success) {
                commission.resolve()
            } else {
                Log.error(`Setting up montage in the worker failed.`, SCOPE)
                commission.reject()
            }
            return true
        } else if (data.action === 'setup-shared-worker') {
            if (data.success) {
                commission.resolve(true)
            } else {
                Log.error(`Setting up montage in the worker failed.`, SCOPE)
                commission.reject()
            }
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

    setDataGaps (gaps: Map<number, number>) {
        // Convert gaps into a JSON friendly format.
        const gapList = []
        for (const gap of gaps.entries()) {
            gapList.push({ start: gap[0], duration: gap[1] })
        }
        this._worker?.postMessage({
            action: 'set-data-gaps',
            dataGaps: gapList
        })
    }

    async setFilters () {
        // TODO: Don't flood the worker with multiple requests for the same thing.
        // This can happen when changing filters on multiple channels at the same time.
        const channelFilters = this._montage.channels.map(c => {
            return {
                highpass: c?.highpassFilter || 0,
                lowpass: c?.lowpassFilter || 0,
                notch: c?.notchFilter || 0,
            }
        })
        const filters = this._commissionWorker(
            'set-filters',
            new Map<string, unknown>([
                ['filters', JSON.stringify(this._montage.filters)],
                ['channels', channelFilters],
            ])
        )
        return filters.promise as Promise<SetFiltersResponse>
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
        // Calculate needed mermory to load the entire recording.
        let totalMem = 4 // From lock and meta fields.
        const dataFieldsLen = BiosignalMutex.SIGNAL_DATA_POS
        for (const chan of this._montage.channels) {
            if (chan) {
                // TODO: allocate memory for channel signals as well.
            }
            totalMem += dataFieldsLen
        }
        const bufferPart =  await this.requestMemory(totalMem)
        if (!bufferPart || !this._memoryRange) {
            Log.error(`Aloocating memory for montage failed.`, SCOPE)
            return { success: false }
        }
        // Save the buffers in local scope and send them to worker.
        this._mutex = new BiosignalMutex(
            undefined,
            inputProps
        )
        const montage = this._commissionWorker(
            'setup-input-mutex',
            new Map<string, unknown>([
                ['montage', this._montage.name],
                ['config', this._montage.config],
                ['input', BiosignalMutex.convertPropertiesForCoupling(inputProps)],
                //['buffer', this._manager.buffer],
                ['bufferStart', this._memoryRange.start],
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
        const montage = this._commissionWorker(
            'setup-shared-worker',
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
}