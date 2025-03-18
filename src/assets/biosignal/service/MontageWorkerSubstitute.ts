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
import MontageProcesser from './MontageProcesser'
import type {
    AppSettings,
    BiosignalFilters,
    CommonBiosignalSettings,
    ConfigChannelFilter,
    ConfigMapChannels,
    GetSignalsResponse,
    SetFiltersResponse,
    SetupChannel,
    SignalCacheResponse,
    SignalDataCache,
    SignalDataGapMap,
    WorkerMessage,
} from '#types'

const SCOPE = 'MontageWorkerSubstitute'

export default class MontageWorkerSubstitute extends ServiceWorkerSubstitute {
    protected _montage = null as MontageProcesser | null
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
            case 'set-data-gaps': {
                const data = validateCommissionProps(
                    message as WorkerMessage['data'] & {
                        dataGaps: { duration: number, start: number }[],
                    },
                    {
                        dataGaps: 'Array'
                    },
                    this._montage !== null,
                    this.returnMessage.bind(this)
                )
                if (!data) {
                    return
                }
                const newGaps = new Map<number, number>() as SignalDataGapMap
                for (const gap of data.dataGaps) {
                    newGaps.set(gap.start, gap.duration)
                }
                this._montage?.setDataGaps(newGaps)
                Log.debug(`New data gaps set.`, SCOPE)
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
                if (newFilters.highpass !== this._montage?.filters.highpass) {
                    this._montage?.setHighpassFilter(newFilters.highpass)
                    someUpdated = true
                }
                if (newFilters.lowpass !== this._montage?.filters.lowpass) {
                    this._montage?.setLowpassFilter(newFilters.lowpass)
                    someUpdated = true
                }
                if (newFilters.notch !== this._montage?.filters.notch) {
                    this._montage?.setNotchFilter(newFilters.notch)
                    someUpdated = true
                }
                if (message.channels) {
                    const channels = message.channels as { highpass: number, lowpass: number, notch: number }[]
                    for (let i=0; i<channels.length; i++) {
                        const chan = channels[i]
                        if (chan.highpass !== this._montage?.channels[i].highpassFilter) {
                            this._montage?.setHighpassFilter(chan.highpass, i)
                            someUpdated = true
                        }
                        if (chan.lowpass !== this._montage?.channels[i].lowpassFilter) {
                            this._montage?.setLowpassFilter(chan.lowpass, i)
                            someUpdated = true
                        }
                        if (chan.notch !== this._montage?.channels[i].notchFilter) {
                            this._montage?.setNotchFilter(chan.notch, i)
                            someUpdated = true
                        }
                    }
                }
                Log.debug(`Filters updated.`, SCOPE)
                return this.returnSuccess({
                    ...message,
                    updated: someUpdated,
                } as WorkerMessage['data'] & SetFiltersResponse)
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
                                     .modules[data.namespace] as CommonBiosignalSettings
                this._montage = new MontageProcesser(MOD_SETTINGS)
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
