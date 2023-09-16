/**
 * Biosignal montage service.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    SignaCacheResponse,
    type BiosignalMontageService,
    type MontageChannel,
} from "TYPES/lib/biosignal"
import { MemoryManager } from "TYPES/lib/core"
import Log from 'scoped-ts-log'
import BiosignalMutex from "./BiosignalMutex"
import GenericService from "LIB/core/service/GenericService"
import { MutexExportProperties } from "asymmetric-io-mutex"
import { GenericBiosignalMontage } from "LIB/core/biosignal"
import { mapSignalsToSamplingRates } from "LIB/util/signal"

const SCOPE = "MontageService"

export default class MontageServiceSAB extends GenericService implements BiosignalMontageService {
    private _mutex = null as null | BiosignalMutex
    private _montage: GenericBiosignalMontage

    get instance () {
        return this._montage.name
    }

    constructor (namespace: string, montage: GenericBiosignalMontage, manager: MemoryManager) {
        super(SCOPE, new Worker(new URL(`LIB/workers/MontageWorkerSAB.ts`, import.meta.url)), manager)
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
        const channels = JSON.stringify(([] as MontageChannel[]).concat(this._montage.channels))
        const filters = JSON.stringify(this._montage.filters)
        this._worker?.postMessage({
            action: 'cache-montage-signals',
            cache: cache,
            channels: channels,
            filters: filters,
            montage: this._montage.name,
        })
    }

    async getSignals (range: number[], config?: any) {
        //if (SETTINGS.eeg.filters.usePython && store?.state.PYODIDE && this._mutex) {
            /*****************
             *     BROKEN
            const derivedSignals = [] as { data: Float32Array, samplingRate: number }[]
            await calculateReferencedSignals(this._mutex, this._montage.channels, range[0], range[1], config)
            for (let i=0; i<this._montage.channels.length; i++) {
                const chan = this._montage.channels[i]
                const emptySig = {
                    data: new Float32Array(),
                    samplingRate: chan.samplingRate
                }
                // Remove missing and inactive channels
                if (chan.active === NUMERIC_ERROR_VALUE) {
                    derivedSignals.push(emptySig)
                    continue
                }
                const highpass = chan.highpassFilter
                const lowpass = chan.lowpassFilter
                const notch = chan.notchFilter
                // Pass the request to python worker
                await (self as any).PYODIDE?.runCode('construct_filter()', {
                    order: 6,
                    cf: highpass && lowpass ? [highpass, lowpass]
                        : highpass ? highpass
                        : lowpass ? lowpass
                        : 0,
                    fs: chan.samplingRate,
                    kind: highpass && lowpass ? 'bandpass'
                        : highpass ? 'highpass'
                        : lowpass ? 'lowpass'
                        : '',
                })
                const output = await (self as any).PYODIDE?.runCode('filter_signal()', {
                    output: null,
                    source: chan.signal,
                })
                if (output?.success) {
                    chan.signal.set(output.results)
                }
            }
             ******************/
        //} else {
            const signals = this._commissionWorker(
                'get-signals',
                new Map<string, any>([
                    ['range', range],
                    ['config', config],
                ]),
                undefined,
                config?.overwriteRequest === true ? true : false
            )
            return signals.promise as Promise<SignaCacheResponse>
        //}
    }

    async handleMessage (message: any) {
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
                this._montage?.saveSignalsToCache({
                    start: data.range[0],
                    end: data.range[1],
                    signals: mapSignalsToSamplingRates(data.signals, this._montage as any)
                })
            }
            return true
        } else if (data.action === 'get-signals') {
            if (!data.success) {
                Log.error("Loading signals failed!", SCOPE, data.error)
                commission.resolve({ signals: [], range: data.range })
            } else {
                commission.resolve({ signals: data.signals, range: data.range })
            }
            return true
        } else if (data.action === 'map-channels') {
            if (data.success) {
                commission.resolve(data)
            } else {
                commission.resolve(false)
            }
            return true
        } else if (data.action === 'set-filters') {
            if (data.success && data.updated) {
                commission.resolve(true)
            } else {
                commission.resolve(false)
            }
            return true
        } else if (data.action === 'setup-montage') {
            if (data.success) {
                commission.resolve({
                    lockBuffer: data.lockBuffer,
                    metaBuffer: data.metaBuffer,
                    signalBuffers: data.signalBuffers,
                })
            } else {
                commission.resolve(false)
            }
            return true
        }
        if (await super._handleWorkerResponse(message)) {
            return true
        }
        Log.warn(`Message with action ${data.action} was not handled.`, SCOPE)
        return false
    }

    mapChannels (): Promise<void> {
        const channels = this._commissionWorker(
            'map-channels',
            new Map<string, any>([
                ['config', this._montage.config]
            ])
        )
        return channels.promise
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
                highpass: c.highpassFilter,
                lowpass: c.lowpassFilter,
                notch: c.notchFilter,
            }
        })
        const filters = this._commissionWorker(
            'set-filters',
            new Map<string, any>([
                ['filters', JSON.stringify(this._montage.filters)],
                ['channels', channelFilters],
            ])
        )
        return filters.promise
    }

    async setupMontage (inputProps: MutexExportProperties) {
        if (!this._montage) {
            Log.error('Cannot set up montage without valid montage configuration.', SCOPE)
            return
        }
        if (!this._manager?.buffer) {
            Log.error(`Cannot set up montage before manager has been initialized.`, SCOPE)
            return
        }
        // Calculate needed mermory to load the entire recording.
        let totalMem = 4 // From lock and meta fields.
        const dataFieldsLen = BiosignalMutex.SIGNAL_DATA_POS
        for (const chan of this._montage.channels) {
            // TODO allocate data for channel signals as well.
            totalMem += dataFieldsLen
        }
        const bufferPart =  await this.requestMemory(totalMem)
        if (!bufferPart || !this._memoryRange) {
            Log.error(`Aloocating memory for montage failed.`, SCOPE)
            return
        }
        // Save the buffers in local scope and send them to worker.
        this._mutex = new BiosignalMutex(
            undefined,
            inputProps
        )
        const montage = this._commissionWorker(
            'setup-montage',
            new Map<string, any>([
                ['montage', this._montage.name],
                ['config', this._montage.config],
                ['input', BiosignalMutex.convertPropertiesForCoupling(inputProps)],
                ['buffer', this._manager.buffer], // this._manager.buffer
                ['bufferStart', this._memoryRange.start], // this._memoryRange.start
                ['dataDuration', this._montage.recording.dataDuration],
                ['recordingDuration', this._montage.recording.totalDuration],
                ['setupChannels', this._montage.setup.channels],
            ])
        )
        return montage.promise
    }
}

export { MontageServiceSAB }
