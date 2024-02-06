/**
 * EpiCurrents montage worker substitute. Allows using the montage loader in the main thread without an actual worker.
 * @package    @epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-ts-log'
import ServiceWorkerSubstitute from '#assets/service/ServiceWorkerSubstitute'
import { validateCommissionProps } from '#util'
import { SETTINGS } from '#config'
import MontageProcesser from './MontageProcesser'
import {
    type BiosignalFilters,
    type CommonBiosignalSettings,
    type ConfigChannelFilter,
    type ConfigMapChannels,
    type GetSignalsResponse,
    type ReleaseCacheResponse,
    type SetFiltersResponse,
    type SignalCacheResponse,
    type WorkerCommissionResponse,
} from '#types'

const SCOPE = 'MontageWorkerSubstitute'

export default class MontageWorkerSubstitute extends ServiceWorkerSubstitute {
    protected _montage = null as MontageProcesser | null
    async postMessage (message: any) {
        if (!message?.action) {
            return
        }
        const action = message.action
        Log.debug(`Received message with action ${action}.`, SCOPE)
        if (action === 'setup-worker') {
            const data = validateCommissionProps(
                message,
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
            this._montage = new MontageProcesser(SETTINGS.modules[data.namespace] as CommonBiosignalSettings)
            this._montage.setupChannels(data.montage, data.config, data.setupChannels)
            Log.debug(`Worker setup complete.`, SCOPE)
            this.returnMessage({
                action: action,
                success: true,
                rn: message.rn,
            } as WorkerCommissionResponse)
        } else if (action === 'update-settings') {
            // No need to update settings.
            this.returnMessage({
                action: action,
                success: true,
                rn: message.rn,
            } as WorkerCommissionResponse)
        } else if (action === 'get-signals') {
            const data = validateCommissionProps(
                message,
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
                    this.returnMessage({
                        action: action,
                        success: true,
                        rn: message.rn,
                        ...sigs
                    } as GetSignalsResponse)
                } else {
                    this.returnMessage({
                        action: action,
                        success: false,
                        rn: message.rn,
                    } as GetSignalsResponse)
                }
            } catch (e) {
                this.returnMessage({
                    action: action,
                    success: false,
                    rn: data.rn,
                    reason: e,
                })
            }
        } else if (action === 'map-channels') {
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
            this.returnMessage({
                action: action,
                success: true,
                rn: data.rn,
            } as WorkerCommissionResponse)
        } else if (action === 'release-cache') {
            await this._montage?.releaseCache()
            Log.debug(`Cache released.`, SCOPE)
            this.returnMessage({
                action: action,
                success: true,
                rn: message.rn,
            } as ReleaseCacheResponse)
        } else if (action === 'set-data-gaps') {
            const data = validateCommissionProps(
                message,
                {
                    dataGaps: 'Object'
                },
                this._montage !== null,
                this.returnMessage.bind(this)
            )
            if (!data) {
                return
            }
            const newGaps = new Map<number, number>()
            for (const gap of data.dataGaps) {
                newGaps.set(gap.start, gap.duration)
            }
            this._montage?.setDataGaps(newGaps)
            Log.debug(`New data gaps set.`, SCOPE)
            this.returnMessage({
                action: action,
                success: true,
                rn: data.rn,
            } as WorkerCommissionResponse)
        } else if (action === 'set-filters') {
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
            this.returnMessage({
                action: action,
                success: true,
                updated: someUpdated,
                rn: data.rn,
            } as SetFiltersResponse)
        } else if (action === 'setup-cache') {
            const data = validateCommissionProps(
                message,
                {
                    cache: 'BiosignalCache'
                },
                this._montage !== null,
                this.returnMessage.bind(this)
            )
            if (!data) {
                return
            }
            const setupSuccess = await this._montage?.setupCache(data.cache)
            if (setupSuccess) {
                Log.debug(`Cache setup complete.`, SCOPE)
                this.returnMessage({
                    action: action,
                    success: true,
                    rn: data.rn,
                } as WorkerCommissionResponse)
            } else {
                this.returnMessage({
                    action: action,
                    success: false,
                    rn: data.rn,
                } as WorkerCommissionResponse)
            }
        } else {
            super.postMessage(message)
        }
    }
}