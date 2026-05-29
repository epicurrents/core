/**
 * Trend worker substitute — runs TrendProcessor in-process when SharedArrayBuffer
 * is unavailable, providing the same BiosignalTrendService interface as TrendService.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import TrendProcessor from './TrendProcessor'
import type {
    BiosignalDownsamplingMethod,
    BiosignalTrendDerivation,
    BiosignalTrendService,
    SetupCacheResponse,
} from '#types/biosignal'
import type { CommonBiosignalSettings } from '#types/config'
import type { SetupWorkerResponse } from '#types/service'
import { Log } from 'scoped-event-log'
import type { MutexExportProperties } from 'asymmetric-io-mutex'

const SCOPE = 'TrendWorkerSubstitute'

type TrendComputationProps = {
    cancel: () => void
    name: string
    onEpochReady: (signal: number[], epochIndex: number, totalEpochs: number) => void
    reject: (reason: string) => void
    resolve: (value: unknown) => void
}

export default class TrendWorkerSubstitute implements BiosignalTrendService {
    // Minimal AssetService surface (id, name) so callers that check these fields work.
    readonly id = `trend-substitute-${Math.random().toString(36).slice(2)}`
    readonly name = 'TrendWorkerSubstitute'

    protected _processor: TrendProcessor | null = null
    protected _trendComputations = new Map<string, TrendComputationProps>()

    protected _handleWorkerMessage (data: { action: string;[k: string]: unknown }) {
        if (data.action === 'trend-epoch') {
            const { name, epochIndex, signal, totalEpochs } =
                data as unknown as { name: string; epochIndex: number; signal: number[]; totalEpochs: number }
            this._trendComputations.get(name)?.onEpochReady(signal, epochIndex, totalEpochs)
            return
        }
        if (data.action === 'trend-complete') {
            const { name } = data as unknown as { name: string }
            this._trendComputations.get(name)?.resolve(undefined)
            this._trendComputations.delete(name)
            return
        }
        if (data.action === 'trend-cancelled') {
            const { name } = data as unknown as { name: string }
            this._trendComputations.delete(name)
            return
        }
        if (data.action === 'trend-error') {
            const { name, error } = data as unknown as { name: string; error: string }
            this._trendComputations.get(name)?.reject(error)
            this._trendComputations.delete(name)
        }
    }

    computeTrend (name: string, range?: number[]) {
        let resolveFn!: (value: unknown) => void
        let rejectFn!: (reason: string) => void
        const result = new Promise<unknown>((res, rej) => {
            resolveFn = res
            rejectFn = rej
        })
        const props: TrendComputationProps = {
            cancel: () => this._processor?.cancelTrendComputation(name),
            name,
            onEpochReady: () => {},
            reject: rejectFn,
            resolve: resolveFn,
        }
        this._trendComputations.set(name, props)
        // Run asynchronously so the caller can register `onEpochReady` before epochs fire.
        setTimeout(() => {
            this._processor?.computeTrend(name, range).catch((e: unknown) => {
                this._trendComputations.get(name)?.reject(String(e))
                this._trendComputations.delete(name)
            })
        }, 0)
        return {
            cancel: props.cancel,
            onEpochReady: (
                callback: (signal: number[], epochIndex: number, totalEpochs: number) => void
            ) => {
                props.onEpochReady = callback
            },
            result,
        }
    }

    async destroy () {
        await this._processor?.destroy()
        this._processor = null
        this._trendComputations.clear()
    }

    setInterruptions (interruptions: import('#types/biosignal').SignalInterruptionMap) {
        this._processor?.setInterruptions(interruptions)
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
        if (!this._processor) {
            return { success: false }
        }
        const { downsamplingMethod = 'average', maxFreqHz, numeratorBand, denominatorBand, band } = options
        this._processor.setupTrend(name, {
            derivation,
            samplingRate,
            epochLength,
            downsamplingMethod,
            maxFreqHz,
            numeratorBand,
            denominatorBand,
            band,
        })
        return { success: true }
    }

    async setupWithCache (
        cache: import('#types/biosignal').SignalDataCache,
        dataDuration: number,
        recordingDuration: number,
        settings: CommonBiosignalSettings
    ): Promise<SetupCacheResponse> {
        this._processor = new TrendProcessor(settings, (msg: unknown) => {
            this._handleWorkerMessage(msg as { action: string;[k: string]: unknown })
        })
        this._processor.setupWithCache(cache, dataDuration, recordingDuration)
        Log.debug(`TrendWorkerSubstitute set up with plain cache.`, SCOPE)
        return { success: true, cacheProperties: cache }
    }

    async setupWorker (
        inputProps: MutexExportProperties,
        dataDuration: number,
        recordingDuration: number,
        namespace: string,
        appSettings?: import('#types').AppSettings,
        signalModalities?: string[],
    ): Promise<SetupWorkerResponse> {
        const settingsRaw = appSettings?.modules?.[namespace]
            ?? window.__EPICURRENTS__?.RUNTIME?.SETTINGS?.modules?.[namespace]
        const settings = (settingsRaw as CommonBiosignalSettings | undefined) ?? {} as CommonBiosignalSettings
        this._processor = new TrendProcessor(settings, (msg: unknown) => {
            this._handleWorkerMessage(msg as { action: string;[k: string]: unknown })
        })
        const ok = await this._processor.setupWithInputMutex(inputProps, dataDuration, recordingDuration, signalModalities)
        if (!ok) {
            Log.warn(`TrendWorkerSubstitute: input mutex setup failed; trying cache fallback.`, SCOPE)
            this._processor = null
            return { success: false }
        }
        Log.debug(`TrendWorkerSubstitute set up.`, SCOPE)
        return { success: true }
    }
}
