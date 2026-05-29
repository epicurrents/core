/**
 * Epicurrents montage worker substitute. Allows using the montage loader in the main thread without an actual worker.
 * @remarks
 * WORKER SUBSTITUTES ARE SUBJECT TO DEPRECATION.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import ServiceWorkerSubstitute from '#assets/service/ServiceWorkerSubstitute'
import { validateCommissionProps } from '#util'
import MontageProcessor from './MontageProcessor'
import type {
    AppSettings,
    BiosignalFilters,
    BiosignalTrendDerivation,
    BiosignalDownsamplingMethod,
    CommonBiosignalSettings,
    ConfigChannelFilter,
    ConfigMapChannels,
    GetSignalsResponse,
    SetFiltersResponse,
    SetupChannel,
    SignalCacheResponse,
    SignalDataCache,
    SignalInterruptionMap,
    WorkerMessage,
} from '#types'

const SCOPE = 'MontageWorkerSubstitute'

export default class MontageWorkerSubstitute extends ServiceWorkerSubstitute {
    protected _montage = null as MontageProcessor | null
    async postMessage (message: WorkerMessage['data']) {
        if (!message?.action) {
            return
        }
        const action = message.action
        Log.debug(`Received message with action ${action}.`, SCOPE)
        switch (action) {
            case 'get-signals': {
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & { range: number[] },
                    {
                        range: ['Number', 'Number']
                    },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                try {
                    const config = message.config as ConfigChannelFilter | undefined
                    const sigs = await this._montage?.getSignals(data.range, config) as SignalCacheResponse
                    if (sigs) {
                        return this.returnSuccess({
                            ...message,
                            ...sigs
                        } as WorkerMessage['data'] & GetSignalsResponse)
                    } else {
                        return this.returnFailure(message)
                    }
                } catch (e) {
                    return this.returnFailure(message, e as string)
                }
            }
            case 'map-channels': {
                const data = validateCommissionProps(
                    message,
                    {
                        config: 'Object'
                    },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                const config = data.config as ConfigMapChannels
                this._montage?.mapChannels(config)
                Log.debug(`Channel mapping complete.`, SCOPE)
                return this.returnSuccess(message)
            }
            case 'release-cache': {
                await this._montage?.releaseCache()
                Log.debug(`Cache released.`, SCOPE)
                return this.returnSuccess(message)
            }
            case 'release-signal-arrays': {
                await this._montage?.releaseSignalArrays()
                Log.debug(`Signal arrays released.`, SCOPE)
                return this.returnSuccess(message)
            }
            case 'set-filters': {
                const data = validateCommissionProps(
                    message,
                    {
                        filters: 'String'
                    },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                const newFilters = JSON.parse(data.filters as string) as BiosignalFilters
                let someUpdated = false
                // Batch all filter writes with `skipInvalidate=true` and call `invalidateOutputCache`
                // exactly once at the end. See the worker `setFilters` handler for the lock-
                // contention rationale.
                if (newFilters.highpass !== this._montage?.filters.highpass) {
                    this._montage?.setHighpassFilter(newFilters.highpass, undefined, true)
                    someUpdated = true
                }
                if (newFilters.lowpass !== this._montage?.filters.lowpass) {
                    this._montage?.setLowpassFilter(newFilters.lowpass, undefined, true)
                    someUpdated = true
                }
                if (newFilters.notch !== this._montage?.filters.notch) {
                    this._montage?.setNotchFilter(newFilters.notch, undefined, true)
                    someUpdated = true
                }
                if (message.channels) {
                    const channels = message.channels as { highpass: number, lowpass: number, notch: number }[]
                    for (let i=0; i<channels.length; i++) {
                        const chan = channels[i]
                        if (chan.highpass !== this._montage?.channels[i].highpassFilter) {
                            this._montage?.setHighpassFilter(chan.highpass, i, true)
                            someUpdated = true
                        }
                        if (chan.lowpass !== this._montage?.channels[i].lowpassFilter) {
                            this._montage?.setLowpassFilter(chan.lowpass, i, true)
                            someUpdated = true
                        }
                        if (chan.notch !== this._montage?.channels[i].notchFilter) {
                            this._montage?.setNotchFilter(chan.notch, i, true)
                            someUpdated = true
                        }
                    }
                }
                if (someUpdated) {
                    await this._montage?.invalidateOutputCache()
                }
                Log.debug(`Filters updated.`, SCOPE)
                return this.returnSuccess({
                    ...message,
                    updated: someUpdated,
                } as WorkerMessage['data'] & SetFiltersResponse)
            }
            case 'set-interruptions': {
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & {
                        interruptions: { duration: number, start: number }[],
                    },
                    {
                        interruptions: 'Array'
                    },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                const newInterruptions = new Map<number, number>() as SignalInterruptionMap
                for (const intr of data.interruptions) {
                    newInterruptions.set(intr.start, intr.duration)
                }
                this._montage?.setInterruptions(newInterruptions)
                Log.debug(`New interruptions set.`, SCOPE)
                return this.returnSuccess(message)
            }
            case 'setup-cache': {
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & {
                        cache: SignalDataCache
                        dataDuration: number
                        recordingDuration: number
                    },
                    {
                        cache: 'BiosignalCache',
                        dataDuration: 'Number',
                        recordingDuration: 'Number',
                    },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                const setupSuccess = this._montage?.setupCacheWithInput(
                                        data.cache,
                                        data.dataDuration,
                                        data.recordingDuration
                                     )
                if (setupSuccess) {
                    Log.debug(`Cache setup complete.`, SCOPE)
                    return this.returnSuccess(message)
                } else {
                    return this.returnFailure(message)
                }
            }
            case 'setup-worker': {
                if (!window.__EPICURRENTS__?.RUNTIME) {
                    Log.error(`Reference to application runtime was not found.`, SCOPE)
                    return
                }
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & {
                        config: ConfigMapChannels
                        montage: string
                        namespace: string
                        settings: AppSettings
                        setupChannels: SetupChannel[]
                    },
                    {
                        config: 'Object',
                        montage: 'String',
                        namespace: 'String',
                        settings: 'Object',
                        setupChannels: 'Array',
                    },
                    true,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                const MOD_SETTINGS = window
                                     .__EPICURRENTS__.RUNTIME?.SETTINGS
                                     .modules[data.namespace] as unknown as CommonBiosignalSettings
                // Inject our `returnMessage` as the processor's outbound channel — in substitute
                // mode there is no `postMessage` global that routes to the service.
                this._montage = new MontageProcessor(MOD_SETTINGS, (msg) => this.returnMessage(msg))
                this._montage.setupChannels(data.montage, data.config, data.setupChannels)
                Log.debug(`Worker setup complete.`, SCOPE)
                return this.returnSuccess(message)
            }
            case 'shutdown':
            case 'decommission': {
                this._montage?.releaseCache()
                this._montage = null
                super.shutdown()
                Log.debug(`Worker decommissioned.`, SCOPE)
                return this.returnSuccess(message)
            }
            case 'setup-trend': {
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & {
                        derivation: BiosignalTrendDerivation
                        downsamplingMethod: BiosignalDownsamplingMethod
                        epochLength: number
                        name: string
                        samplingRate: number
                    },
                    {
                        derivation: 'Object',
                        downsamplingMethod: 'String',
                        epochLength: 'Number',
                        name: 'String',
                        samplingRate: 'Number',
                    },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                this._montage?.setupTrend(
                    data.name as string,
                    data.derivation,
                    data.samplingRate as number,
                    data.epochLength as number,
                    data.downsamplingMethod,
                )
                Log.debug(`Trend '${data.name}' setup complete.`, SCOPE)
                return this.returnSuccess(message)
            }
            case 'compute-trend': {
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & {
                        name: string
                        range?: number[]
                    },
                    {
                        name: 'String',
                        range: 'Array?',
                    },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                try {
                    await this._montage?.computeTrend(data.name as string, data.range as number[] | undefined)
                    Log.debug(`Trend '${data.name}' computation complete.`, SCOPE)
                    return this.returnSuccess(message)
                } catch (e) {
                    return this.returnFailure(message, (e as Error).message)
                }
            }
            case 'cancel-trend-computation': {
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & { name: string },
                    { name: 'String' },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                this._montage?.cancelTrendComputation(data.name as string)
                Log.debug(`Trend '${data.name}' computation cancellation requested.`, SCOPE)
                return this.returnSuccess(message)
            }
            case 'update-settings': {
                // No need to update settings.
                return this.returnSuccess(message)
            }
            default: {
                super.postMessage(message)
            }
        }
    }
}
