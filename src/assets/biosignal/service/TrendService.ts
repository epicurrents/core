/**
 * Trend service — manages the dedicated trend worker.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericService from '#assets/service/GenericService'
import type {
    BiosignalDownsamplingMethod,
    BiosignalTrendDerivation,
    BiosignalTrendService,
} from '#types/biosignal'
import type { AppSettings } from '#types/config'
import type {
    MemoryManager,
    SetupWorkerResponse,
    WorkerResponse,
} from '#types/service'
import type { SetupCacheResponse } from '#types/biosignal'
import { Log } from 'scoped-event-log'
import type { MutexExportProperties } from 'asymmetric-io-mutex'

const SCOPE = 'TrendService'

type TrendComputationProps = {
    cancel: () => void
    name: string
    onEpochReady: (signal: number[], epochIndex: number, totalEpochs: number) => void
    reject: (reason: string) => void
    resolve: (value: unknown) => void
}

export default class TrendService extends GenericService implements BiosignalTrendService {
    protected _trendComputations = new Map<string, TrendComputationProps>()

    constructor (manager?: MemoryManager) {
        // Fetch the trend worker from the runtime workers registry (registered by the
        // interface app at start-up, the same mechanism as the montage worker).
        const getWorker = window.__EPICURRENTS__?.RUNTIME?.WORKERS.get('trend')
        const worker = getWorker?.() ?? null
        super(SCOPE, worker ?? undefined, false, manager)
        if (this._worker) {
            this._worker.addEventListener('message', this.handleMessage.bind(this))
        } else {
            Log.warn(`Trend worker not found in RUNTIME.WORKERS; TrendService will not compute.`, SCOPE)
        }
    }

    computeTrend (name: string, range?: number[]) {
        // Cancel any in-flight computation for the same name before starting a new one.
        const prior = this._trendComputations.get(name)
        if (prior) {
            prior.cancel()
            prior.reject('Superseded by a new computation.')
            this._trendComputations.delete(name)
        }
        let resolveFn!: (value: unknown) => void
        let rejectFn!:  (reason: string) => void
        const result = new Promise<unknown>((res, rej) => {
            resolveFn = res
            rejectFn  = rej
        })
        const props: TrendComputationProps = {
            cancel: () => {
                this._commissionWorker(
                    'cancel-trend-computation',
                    new Map([['name', name]])
                )
            },
            name,
            onEpochReady: () => {},
            reject: rejectFn,
            resolve: resolveFn,
        }
        this._trendComputations.set(name, props)
        const args = new Map<string, unknown>([['name', name]])
        if (range) {
            args.set('range', range)
        }
        this._commissionWorker('compute-trend', args)
        return {
            cancel: props.cancel,
            onEpochReady: (
                cb: (signal: number[], epochIndex: number, totalEpochs: number) => void
            ) => {
                props.onEpochReady = cb
            },
            result,
        }
    }

    async handleMessage (message: WorkerResponse) {
        const data = message.data
        if (!data) {
            return false
        }
        // Forward log / settings-update messages to the generic handler first.
        if (super._handleWorkerUpdate(message)) {
            return true
        }
        // Out-of-band trend messages — no commission rn to match.
        if (data.action === 'trend-epoch') {
            const trendName = data.name as string
            this._trendComputations.get(trendName)?.onEpochReady(
                data.signal as number[],
                data.epochIndex as number,
                data.totalEpochs as number
            )
            return true
        }
        if (data.action === 'trend-complete') {
            const trendName = data.name as string
            const comp = this._trendComputations.get(trendName)
            comp?.resolve(undefined)
            this._trendComputations.delete(trendName)
            return true
        }
        if (data.action === 'trend-cancelled') {
            this._trendComputations.delete(data.name as string)
            return true
        }
        if (data.action === 'trend-error') {
            const trendName = data.name as string
            const comp = this._trendComputations.get(trendName)
            comp?.reject(data.error as string)
            this._trendComputations.delete(trendName)
            return true
        }
        // Fall back to commission-response handling (setup-worker, setup-trend, etc.).
        return this._handleWorkerCommission(message)
    }

    setInterruptions (interruptions: import('#types').SignalInterruptionMap) {
        if (!interruptions.size) {
            return
        }
        // Map is serialized as an array of [start, duration] pairs for postMessage.
        this._commissionWorker(
            'set-interruptions',
            new Map([['interruptions', [...interruptions.entries()]]])
        )
    }

    async setupTrend (
        name: string,
        derivation: BiosignalTrendDerivation,
        samplingRate: number,
        epochLength: number,
        options: {
            downsamplingMethod?: BiosignalDownsamplingMethod
            maxFreqHz?: number
            numeratorBand?: [number, number]
            denominatorBand?: [number, number]
            band?: [number, number]
        } = {}
    ): Promise<SetupWorkerResponse> {
        const { downsamplingMethod = 'average', maxFreqHz, numeratorBand, denominatorBand, band } = options
        const fields: [string, unknown][] = [
            ['derivation',         derivation],
            ['downsamplingMethod', downsamplingMethod],
            ['epochLength',        epochLength],
            ['name',               name],
            ['samplingRate',       samplingRate],
        ]
        if (maxFreqHz !== undefined)       fields.push(['maxFreqHz',       maxFreqHz])
        if (numeratorBand !== undefined)   fields.push(['numeratorBand',   numeratorBand])
        if (denominatorBand !== undefined) fields.push(['denominatorBand', denominatorBand])
        if (band !== undefined)            fields.push(['band',            band])
        const commission = this._commissionWorker('setup-trend', new Map(fields))
        return commission.promise as Promise<SetupWorkerResponse>
    }

    async setupWithCache (): Promise<SetupCacheResponse> {
        Log.error(`TrendService requires SharedArrayBuffer; use TrendWorkerSubstitute for the no-SAB path.`, SCOPE)
        return { success: false }
    }

    async setupWorker (
        inputProps: MutexExportProperties,
        dataDuration: number,
        recordingDuration: number,
        namespace: string,
        _settings?: AppSettings,
        signalModalities?: string[],
    ): Promise<SetupWorkerResponse> {
        this._initWaiters('setup-worker')
        const fields: [string, unknown][] = [
            ['dataDuration',      dataDuration],
            ['input',             inputProps],
            ['interruptions',     []],
            ['namespace',         namespace],
            ['recordingDuration', recordingDuration],
            // Send the clonable settings snapshot — reactive proxies cannot be
            // transferred via postMessage, _CLONABLE is a plain serialisable object.
            ['settings', window.__EPICURRENTS__?.RUNTIME?.SETTINGS._CLONABLE],
        ]
        if (signalModalities) {
            // Copy into a plain array — modalities likely originate from a reactive store.
            fields.push(['signalModalities', signalModalities.slice()])
        }
        const commission = this._commissionWorker('setup-worker', new Map(fields))
        return commission.promise as Promise<SetupWorkerResponse>
    }
}
