/**
 * Default biosignal montage worker.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalFilters,
    type MontageWorkerCommission,
    type MontageWorkerCommissionAction,
    type SetFiltersResponse,
    type SetupMutexResponse,
    type SignalDataGapMap,
} from '#types/biosignal'
import { type CommonBiosignalSettings } from '#types/config'
import { type WorkerMessage } from '#types/service'
import MontageProcesser from '#assets/biosignal/service/MontageProcesser'
import { validateCommissionProps } from '#util'
import { Log } from 'scoped-event-log'
import { BaseWorker } from './base.worker'

const SCOPE = "MontageWorker"

export class MontageWorker extends BaseWorker {
    protected _actionMap = new Map<
        MontageWorkerCommissionAction,
        (message: WorkerMessage['data']) => Promise<boolean>
    >([
        ['get-signals', this.getSignals],
        ['map-channels', this.mapChannels],
        ['release-cache', this.releaseCache],
        ['set-data-gaps', this.setDataGaps],
        ['set-filters', this.setFilters],
        ['setup-input-cache', this.setInputCache],
        ['setup-input-mutex', this.setupInputMutex],
        ['setup-worker', this.setupWorker],
        ['update-settings', this.updateSettings],
    ])
    /** Montage processer. */
    protected _montage = null as MontageProcesser | null
    protected _name = ''
    constructor () {
        super()
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async getSignals (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['get-signals'],
            {
                range: ['Number', 'Number'],
                config: ['Object', 'undefined'],
                montage: ['String', 'undefined'],
            },
            this._montage !== null
        )
        if (!data) {
            return this._failure(msgData)
        }
        try {
            const config = data.config
            const sigs = await this._montage?.getSignals(data.range, config)
            if (sigs) {
                // This has to be posted separately because of the spread operator.
                return this._success(msgData, sigs)
            } else {
                return this._failure(msgData, 'Failed to get signals from the montage worker.')
            }
        } catch (e) {
            return this._failure(msgData, e as string)
        }
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async mapChannels (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['map-channels'],
            {
                config: 'Object'
            },
            this._montage !== null
        )
        if (!data) {
            return this._failure(msgData)
        }
        this._montage?.mapChannels(data.config)
        Log.debug(`Channel mapping complete.`, SCOPE)
        return this._success(msgData)        
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async releaseCache (msgData: WorkerMessage['data']) {
        await this._montage?.releaseCache()
        Log.debug(`Cache released.`, SCOPE)
        return this._success(msgData)
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setDataGaps (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['set-data-gaps'],
            {
                dataGaps: 'Array'
            },
            this._montage !== null
        )
        if (!data) {
            return this._failure(msgData)
        }
        const newGaps = new Map<number, number>() as SignalDataGapMap
        for (const gap of data.dataGaps) {
            newGaps.set(gap.start, gap.duration)
        }
        this._montage?.setDataGaps(newGaps)
        Log.debug(`New data gaps set.`, SCOPE)
        return this._success(msgData)
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setFilters (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['set-filters'],
            {
                filters: 'String',
                name: 'String',
                channels: ['Array', 'undefined'],
            },
            this._montage !== null
        )
        if (!data || !this._montage) {
            return this._failure(msgData)
        }
        if (this._name !== data.name)  {
            // This event may trigger before the montage itself has been updated.
            Log.debug(`Received set-filters commission for a different montage.`, SCOPE)
            // TODO: Prevent this from happening in the first place, but don't throw an error for now.
            return this._success(msgData)
        }
        const newFilters = JSON.parse(data.filters as string) as BiosignalFilters
        let someUpdated = false
        if (newFilters.highpass !== this._montage.filters.highpass) {
            this._montage.setHighpassFilter(newFilters.highpass)
            someUpdated = true
        }
        if (newFilters.lowpass !== this._montage.filters.lowpass) {
            this._montage.setLowpassFilter(newFilters.lowpass)
            someUpdated = true
        }
        if (newFilters.notch !== this._montage.filters.notch) {
            this._montage.setNotchFilter(newFilters.notch)
            someUpdated = true
        }
        if (data.channels && data.channels.length === this._montage.channels.length) {
            const channels = data.channels as { highpass: number, lowpass: number, notch: number }[]
            for (let i=0; i<channels.length; i++) {
                const chan = channels[i]
                if (chan.highpass !== this._montage.channels[i].highpassFilter) {
                    this._montage.setHighpassFilter(chan.highpass, i)
                    someUpdated = true
                }
                if (chan.lowpass !== this._montage.channels[i].lowpassFilter) {
                    this._montage.setLowpassFilter(chan.lowpass, i)
                    someUpdated = true
                }
                if (chan.notch !== this._montage.channels[i].notchFilter) {
                    this._montage.setNotchFilter(chan.notch, i)
                    someUpdated = true
                }
            }
        }
        Log.debug(`Filters updated.`, SCOPE)
        return this._success(msgData, { updated: someUpdated } as SetFiltersResponse)
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setInputCache (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['setup-input-cache'],
            {
                dataDuration: 'Number',
                port: 'MessagePort',
                recordingDuration: 'Number',
            },
            this._montage !== null
        )
        if (!data) {
            return this._failure(msgData)
        }
        const setupSuccess = await this._montage?.setupSharedWorkerWithInput(
            data.port as MessagePort,
            data.dataDuration as number,
            data.recordingDuration as number
        )
        if (setupSuccess) {
            Log.debug(`Shared worker setup complete.`, SCOPE)
            return this._success(msgData)
        } else {
            return this._failure(msgData, `Setting up shared worker cache in the montage worker failed.`)
        }
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setupInputMutex (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['setup-input-mutex'],
            {
                bufferStart: 'Number',
                dataDuration: 'Number',
                input: 'Object',
                recordingDuration: 'Number',
            },
            this._montage !== null
        )
        if (!data) {
            return this._failure(msgData)
        }
        const cacheSetup = await this._montage?.setupMutexWithInput(
            data.input,
            data.bufferStart,
            data.dataDuration,
            data.recordingDuration
        )
        if (cacheSetup) {
            Log.debug(`Mutex setup complete.`, SCOPE)
            // Pass the generated shared buffers back to main thread.
            return this._success(msgData, { cacheProperties: cacheSetup } as SetupMutexResponse)
        } else {
            return this._failure(msgData, `Failed to set up input mutex in the montage worker.`)
        }
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async setupWorker (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['setup-worker'],
            {
                config: 'Object',
                montage: 'String',
                namespace: 'String',
                settings: 'Object',
                setupChannels: 'Array',
            }
        )
        if (!data) {
            return this._failure(msgData)
        }
        this._namespace = data.namespace as string
        const settings = data.settings.modules[this._namespace] as CommonBiosignalSettings
        this._montage = new MontageProcesser(settings)
        this._montage.setupChannels(data.montage, data.config, data.setupChannels)
        this._name = data.montage
        Log.debug(`Worker setup complete.`, SCOPE)
        return this._success(msgData)
    }
    /**
     * 
     * @param msgData - Data property from the message to the worker.
     * @returns True if action was successful, false otherwise.
     */
    async updateSettings (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MontageWorkerCommission['update-settings'],
            { settings: 'Object' }
        )
        if (!data) {
            return this._failure(msgData)
        }
        if (this._namespace && this._montage) {
            // Only update settings after initial setup.
            this._montage.settings = data.settings.modules[this._namespace] as CommonBiosignalSettings
        }
        Log.debug(`Settings updated in worker.`, SCOPE)
        return this._success(msgData)
    }
}

const MONTAGE = new MontageWorker()

onmessage = async (message: WorkerMessage) => {
    MONTAGE.handleMessage(message)
}