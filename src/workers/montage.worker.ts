/**
 * Default biosignal montage worker.
 * @package    @epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalFilters,
    type GetSignalsResponse,
    type ReleaseCacheResponse,
    type SetFiltersResponse,
    type SetupChannel,
    type SetupMutexResponse,
    type SetupSharedWorkerResponse,
} from '#types/biosignal'
import {
    type AppSettings,
    type CommonBiosignalSettings,
    type ConfigChannelFilter,
    type ConfigMapChannels,
} from '#types/config'
import {
    type SignalCacheResponse,
    type WorkerCommissionResponse,
    type WorkerMessage,
} from '#types/service'
import { type MutexExportProperties } from 'asymmetric-io-mutex'
import MontageProcesser from '../assets/biosignal/service/MontageProcesser'
import { validateCommissionProps } from '../util'
import { Log } from 'scoped-ts-log'

const SCOPE = "MontageWorker"
let NAMESPACE = ''
let MONTAGE = null as MontageProcesser | null
let SETTINGS = null as AppSettings | null

onmessage = async (message: WorkerMessage) => {
    if (!message?.data?.action) {
        return
    }
    const action = message.data.action
    if (action === 'setup-worker') {
        const data = validateCommissionProps(
            message.data,
            {
                namespace: 'String',
                settings: 'Object',
            }
        )
        if (!data) {
            return
        }
        NAMESPACE = data.namespace as string
        const settings = (data.settings as AppSettings).modules[NAMESPACE] as CommonBiosignalSettings
        MONTAGE = new MontageProcesser(settings)
        Log.debug(`Worker setup complete.`, SCOPE)
        postMessage({
            action: action,
            success: true,
            rn: message.data.rn,
        } as WorkerCommissionResponse)
    } else if (action === 'update-settings') {
        const data = validateCommissionProps(message.data, { settings: 'Object' })
        if (!data) {
            return
        }
        SETTINGS = data.settings as AppSettings
        if (NAMESPACE && MONTAGE) {
            // Only update settings after initial setup.
            MONTAGE.settings = (data.settings as AppSettings).modules[NAMESPACE] as CommonBiosignalSettings
        }
        Log.debug(`Settings updated in worker.`, SCOPE)
        postMessage({
            action: action,
            success: true,
            rn: message.data.rn,
        } as WorkerCommissionResponse)
    } else if (action === 'get-signals') {
        const data = validateCommissionProps(
            message.data,
            {
                range: ['Number', 'Number']
            },
            MONTAGE !== null
        )
        if (!data) {
            return
        }
        try {
            const config = message.data.config as ConfigChannelFilter | undefined
            const sigs = await MONTAGE?.getSignals(data.range, config) as SignalCacheResponse
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
            postMessage({
                action: action,
                success: false,
                rn: data.rn,
                reason: e,
            })
        }
    } else if (action === 'map-channels') {
        const data = validateCommissionProps(
            message.data,
            {
                config: 'Object'
            },
            MONTAGE !== null
        )
        if (!data) {
            return
        }
        const config = data.config as ConfigMapChannels
        MONTAGE?.mapChannels(config)
        Log.debug(`Channel mapping complete.`, SCOPE)
        postMessage({
            action: action,
            success: true,
            rn: data.rn,
        } as WorkerCommissionResponse)
    } else if (action === 'release-cache') {
        await MONTAGE?.releaseCache()
        Log.debug(`Cache released.`, SCOPE)
        postMessage({
            action: action,
            success: true,
            rn: message.data.rn,
        } as ReleaseCacheResponse)
    } else if (action === 'set-data-gaps') {
        const data = validateCommissionProps(
            message.data,
            {
                dataGaps: 'Object'
            },
            MONTAGE !== null
        )
        if (!data || !MONTAGE) {
            return
        }
        const newGaps = new Map<number, number>()
        for (const gap of data.dataGaps) {
            newGaps.set(gap.start, gap.duration)
        }
        MONTAGE?.setDataGaps(newGaps)
        Log.debug(`New data gaps set.`, SCOPE)
        postMessage({
            action: action,
            success: true,
            rn: data.rn,
        } as WorkerCommissionResponse)
    } else if (action === 'set-filters') {
        const data = validateCommissionProps(
            message.data,
            {
                filters: 'String'
            },
            MONTAGE !== null
        )
        if (!data) {
            return
        }
        const newFilters = JSON.parse(data.filters as string) as BiosignalFilters
        let someUpdated = false
        if (newFilters.highpass !== MONTAGE?.filters.highpass) {
            MONTAGE?.setHighpassFilter(newFilters.highpass)
            someUpdated = true
        }
        if (newFilters.lowpass !== MONTAGE?.filters.lowpass) {
            MONTAGE?.setLowpassFilter(newFilters.lowpass)
            someUpdated = true
        }
        if (newFilters.notch !== MONTAGE?.filters.notch) {
            MONTAGE?.setNotchFilter(newFilters.notch)
            someUpdated = true
        }
        if (message.data.channels) {
            const channels = message.data.channels as { highpass: number, lowpass: number, notch: number }[]
            for (let i=0; i<channels.length; i++) {
                const chan = channels[i]
                if (chan.highpass !== MONTAGE?.channels[i].highpassFilter) {
                    MONTAGE?.setHighpassFilter(chan.highpass, i)
                    someUpdated = true
                }
                if (chan.lowpass !== MONTAGE?.channels[i].lowpassFilter) {
                    MONTAGE?.setLowpassFilter(chan.lowpass, i)
                    someUpdated = true
                }
                if (chan.notch !== MONTAGE?.channels[i].notchFilter) {
                    MONTAGE?.setNotchFilter(chan.notch, i)
                    someUpdated = true
                }
            }
        }
        Log.debug(`Filters updated.`, SCOPE)
        postMessage({
            action: action,
            success: true,
            updated: someUpdated,
            rn: data.rn,
        } as SetFiltersResponse)
    } else if (action === 'setup-input-mutex') {
        const data = validateCommissionProps(
            message.data,
            {
                bufferStart: 'Number',
                config: 'Object',
                dataDuration: 'Number',
                input: 'Object',
                montage: 'String',
                recordingDuration: 'Number',
                setupChannels: 'Array',
            },
            MONTAGE !== null
        )
        if (!data || !MONTAGE) {
            return
        }
        const cacheSetup = await MONTAGE.setupInputMutex(
            data.montage as string,
            data.config as ConfigMapChannels,
            data.input as MutexExportProperties,
            data.bufferStart as number,
            data.dataDuration as number,
            data.recordingDuration as number,
            data.setupChannels as SetupChannel[]
        )
        if (cacheSetup) {
            Log.debug(`Mutex setup complete.`, SCOPE)
            // Pass the generated shared buffers back to main thread.
            postMessage({
                action: action,
                cacheProperties: cacheSetup,
                success: true,
                rn: data.rn,
            } as SetupMutexResponse)
        } else {
            postMessage({
                action: action,
                success: false,
                rn: data.rn,
            } as SetupMutexResponse)
        }
    } else if (action === 'setup-shared-worker') {
        const data = validateCommissionProps(
            message.data,
            {
                config: 'Object',
                dataDuration: 'Number',
                montage: 'String',
                port: 'MessagePort',
                recordingDuration: 'Number',
                setupChannels: 'Array',
            },
            MONTAGE !== null
        )
        if (!data) {
            return
        }
        const setupSuccess = await MONTAGE?.setupSharedWorker(
            data.montage as string,
            data.config as ConfigMapChannels,
            data.port as MessagePort,
            data.dataDuration as number,
            data.recordingDuration as number,
            data.setupChannels as SetupChannel[]
        )
        if (setupSuccess) {
            Log.debug(`Shared worker setup complete.`, SCOPE)
            postMessage({
                action: action,
                success: true,
                rn: data.rn,
            } as SetupSharedWorkerResponse)
        } else {
            postMessage({
                action: action,
                success: false,
                rn: data.rn,
            } as SetupSharedWorkerResponse)
        }
    }
}