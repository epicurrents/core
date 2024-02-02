/**
 * Default biosignal montage worker.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    BiosignalFilters,
    type GetSignalsResponse,
    type ReleaseCacheResponse,
    type SetFiltersResponse,
    type SetupChannel,
    type SetupMutexResponse,
    type SetupSharedWorkerResponse,
} from '#types/biosignal'
import { AppSettings, CommonBiosignalSettings, type ConfigChannelFilter, type ConfigMapChannels } from '#types/config'
import { type SignalCacheResponse, type WorkerMessage } from '#types/service'
import { type MutexExportProperties } from 'asymmetric-io-mutex'
import { Log } from 'scoped-ts-log'
import MontageProcesser from '../assets/biosignal/service/MontageProcesser'

const SCOPE = "MontageWorker"
let NAMESPACE = ''
let MONTAGE = null as MontageProcesser | null

onmessage = async (message: WorkerMessage) => {
    if (!message?.data?.action) {
        return
    }
    const action = message.data.action
    if (action === 'setup-worker') {
        if (!message.data.namespace || !message.data.settings) {
            Log.error(`Cannot set up worker without namespace and settings.`, SCOPE)
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            })
            return
        }
        NAMESPACE = message.data.namespace as string
        const settings = (message.data.settings as AppSettings).modules[NAMESPACE] as CommonBiosignalSettings
        MONTAGE = new MontageProcesser(settings)
        postMessage({
            action: action,
            success: true,
            rn: message.data.rn,
        })
    } else if (action === 'update-settings') {
        if (!NAMESPACE || !MONTAGE) {
            Log.error(`Received commission '${action}' when before namespace and montage were set.`, SCOPE)
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            })
            return
        }
        MONTAGE.settings = (message.data.settings as AppSettings).modules[NAMESPACE] as CommonBiosignalSettings
    } else if (action === 'get-signals') {
        if (!MONTAGE) {
            Log.error(`Received commission '${action}' when montage processer wasn't set up yet.`, SCOPE)
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            })
            return
        }
        try {
            const range = message.data.range as number[]
            const config = message.data.config as ConfigChannelFilter | undefined
            const sigs = await MONTAGE.getSignals(range, config) as SignalCacheResponse
            if (sigs) {
                postMessage({
                    action: action,
                    success: true,
                    rn: message.data.rn,
                    ...sigs
                } as GetSignalsResponse)
            } else {
                postMessage({
                    action: action,
                    success: false,
                    rn: message.data.rn,
                } as GetSignalsResponse)
            }
        } catch (e) {
            console.error(e)
        }
    } else if (action === 'map-channels') {
        const config = message.data.config as ConfigMapChannels
        MONTAGE?.mapChannels(config)
    } else if (action === 'release-cache') {
        await MONTAGE?.releaseCache()
        postMessage({
            action: action,
            success: true,
            rn: message.data.rn,
        } as ReleaseCacheResponse)
    } else if (action === 'set-data-gaps') {
        if (!MONTAGE) {
            Log.error(`Received commission '${action}' when montage processer wasn't set up yet.`, SCOPE)
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            })
            return
        }
        const newGaps = new Map<number, number>()
        const dataGaps = message.data.dataGaps as { start: number, duration: number }[]
        for (const gap of dataGaps) {
            newGaps.set(gap.start, gap.duration)
        }
        MONTAGE.dataGaps = newGaps
    } else if (action === 'set-filters') {
        if (!MONTAGE) {
            Log.error(`Received commission '${action}' when montage processer wasn't set up yet.`, SCOPE)
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            })
            return
        }
        const newFilters = JSON.parse(message.data.filters as string) as BiosignalFilters
        let someUpdated = false
        if (newFilters.highpass !== MONTAGE.filters.highpass) {
            MONTAGE.setHighpassFilter(newFilters.highpass)
            someUpdated = true
        }
        if (newFilters.lowpass !== MONTAGE.filters.lowpass) {
            MONTAGE.setLowpassFilter(newFilters.lowpass)
            someUpdated = true
        }
        if (newFilters.notch !== MONTAGE.filters.notch) {
            MONTAGE.setNotchFilter(newFilters.notch)
            someUpdated = true
        }
        if (message.data.channels) {
            const channels = message.data.channels as { highpass: number, lowpass: number, notch: number }[]
            for (let i=0; i<channels.length; i++) {
                const chan = channels[i]
                if (chan.highpass !== MONTAGE.channels[i].highpassFilter) {
                    MONTAGE.setHighpassFilter(chan.highpass, i)
                    someUpdated = true
                }
                if (chan.lowpass !== MONTAGE.channels[i].lowpassFilter) {
                    MONTAGE.setLowpassFilter(chan.lowpass, i)
                    someUpdated = true
                }
                if (chan.notch !== MONTAGE.channels[i].notchFilter) {
                    MONTAGE.setNotchFilter(chan.notch, i)
                    someUpdated = true
                }
            }
        }
        postMessage({
            action: action,
            success: true,
            updated: someUpdated,
            rn: message.data.rn,
        } as SetFiltersResponse)
    } else if (action === 'setup-input-mutex') {
        if (!MONTAGE) {
            Log.error(`Received commission '${action}' when montage processer wasn't set up yet.`, SCOPE)
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            })
            return
        }
        const cacheSetup = await MONTAGE.setupInputMutex(
            message.data.montage as string,
            message.data.config as ConfigMapChannels,
            message.data.input as MutexExportProperties,
            message.data.bufferStart as number,
            message.data.dataDuration as number,
            message.data.recordingDuration as number,
            message.data.setupChannels as SetupChannel[]
        )
        if (cacheSetup) {
            // Pass the generated shared buffers back to main thread.
            postMessage({
                action: action,
                cacheProperties: cacheSetup,
                success: true,
                rn: message.data.rn,
            } as SetupMutexResponse)
        } else {
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            } as SetupMutexResponse)
        }
    } else if (action === 'setup-shared-worker') {
        if (!MONTAGE) {
            Log.error(`Received commission '${action}' when montage processer wasn't set up yet.`, SCOPE)
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            })
            return
        }
        const setupSuccess = await MONTAGE.setupSharedWorker(
            message.data.montage as string,
            message.data.config as ConfigMapChannels,
            message.data.port as MessagePort,
            message.data.dataDuration as number,
            message.data.recordingDuration as number,
            message.data.setupChannels as SetupChannel[]
        )
        if (setupSuccess) {
            postMessage({
                action: action,
                success: true,
                rn: message.data.rn,
            } as SetupSharedWorkerResponse)
        } else {
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            } as SetupSharedWorkerResponse)
        }
    }
}