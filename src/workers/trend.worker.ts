/**
 * Dedicated trend worker.
 *
 * Runs a `TrendProcessor` that couples to the EDF reader's output SAB as an
 * input-only reader and computes trend epochs in the background. Epoch results
 * are forwarded to the main thread via `postMessage` (notification only — bulk
 * data will go through the output SAB once `TrendProcessor._outputMutex` is wired).
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    CommonBiosignalSettings,
    TrendWorkerCommission,
    TrendWorkerCommissionAction,
} from '#types'
import type { AppSettings } from '#types/config'
import type { WorkerMessage } from '#types/service'
import TrendProcessor from '#assets/biosignal/service/TrendProcessor'
import { validateCommissionProps } from '#util'
import { Log } from 'scoped-event-log'
import { BaseWorker } from './base.worker'

const SCOPE = 'TrendWorker'

export class TrendWorker extends BaseWorker {
    protected _actionMap = new Map<
        TrendWorkerCommissionAction,
        (message: WorkerMessage['data']) => Promise<boolean>
    >([
        ['cancel-trend-computation', this.cancelTrendComputation.bind(this)],
        ['compute-trend',            this.computeTrend.bind(this)],
        ['set-interruptions',        this.setInterruptions.bind(this)],
        ['setup-trend',              this.setupTrend.bind(this)],
        ['setup-worker',             this.setupWorker.bind(this)],
        ['shutdown',                 this.shutdown.bind(this)],
        ['update-settings',          this.updateSettings.bind(this)],
    ])

    protected _namespace = ''
    protected _processor: TrendProcessor | null = null

    async cancelTrendComputation (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as TrendWorkerCommission['cancel-trend-computation'],
            { name: 'String' },
            this._processor !== null
        )
        if (!data) {
            return this._failure(msgData)
        }
        this._processor?.cancelTrendComputation(data.name as string)
        Log.debug(`Trend '${data.name}' cancellation requested.`, SCOPE)
        return this._success(msgData)
    }

    async computeTrend (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as TrendWorkerCommission['compute-trend'],
            { name: 'String', range: 'Array?' },
            this._processor !== null
        )
        if (!data || !this._processor) {
            return this._failure(msgData)
        }
        try {
            const range = data.range as number[] | undefined
            await this._processor.computeTrend(data.name as string, range)
            return this._success(msgData)
        } catch (e) {
            return this._failure(msgData, e as string)
        }
    }

    async setupTrend (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as TrendWorkerCommission['setup-trend'],
            {
                derivation: 'Object',
                downsamplingMethod: 'String',
                epochLength: 'Number',
                name: 'String',
                samplingRate: 'Number',
            }
        )
        if (!data || !this._processor) {
            return this._failure(msgData)
        }
        this._processor.setupTrend(data.name as string, {
            derivation:        data.derivation        as TrendWorkerCommission['setup-trend']['derivation'],
            downsamplingMethod: data.downsamplingMethod as TrendWorkerCommission['setup-trend']['downsamplingMethod'],
            epochLength:       data.epochLength       as number,
            samplingRate:      data.samplingRate      as number,
            maxFreqHz:         data.maxFreqHz         as number | undefined,
            numeratorBand:     data.numeratorBand     as [number, number] | undefined,
            denominatorBand:   data.denominatorBand   as [number, number] | undefined,
            band:              data.band              as [number, number] | undefined,
        })
        Log.debug(`Trend '${data.name}' set up.`, SCOPE)
        return this._success(msgData)
    }

    async setupWorker (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as TrendWorkerCommission['setup-worker'],
            {
                dataDuration:      'Number',
                input:             'Object',
                interruptions:     'Array',
                namespace:         'String',
                recordingDuration: 'Number',
                settings:          'Object',
            }
        )
        if (!data) {
            return this._failure(msgData)
        }
        // Extract module settings from the clonable snapshot sent by TrendService.
        // Same pattern as MontageWorker: the main thread sends SETTINGS._CLONABLE so
        // the reactive proxy is never put through postMessage.
        const namespace = data.namespace as string
        const allSettings = data.settings as AppSettings | undefined
        const settings = allSettings?.modules?.[namespace] as CommonBiosignalSettings | undefined
        if (!settings) {
            Log.error(`TrendWorker: settings not found for namespace '${namespace}'.`, SCOPE)
            return this._failure(msgData)
        }
        this._namespace = namespace
        this._processor = new TrendProcessor(settings, (msg) => postMessage(msg))
        const ok = await this._processor.setupWithInputMutex(
            data.input as TrendWorkerCommission['setup-worker']['input'],
            data.dataDuration as number,
            data.recordingDuration as number,
            data.signalModalities as string[] | undefined,
        )
        if (!ok) {
            this._processor = null
            return this._failure(msgData)
        }
        Log.debug(`TrendWorker set up (namespace=${namespace}).`, SCOPE)
        return this._success(msgData)
    }

    async setInterruptions (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as TrendWorkerCommission['set-interruptions'],
            { interruptions: 'Array' },
            this._processor !== null
        )
        if (!data || !this._processor) {
            return this._failure(msgData)
        }
        const interruptions = new Map<number, number>(
            data.interruptions as [number, number][]
        )
        this._processor.setInterruptions(interruptions)
        Log.debug(`TrendWorker: ${interruptions.size} interruption(s) set.`, SCOPE)
        return this._success(msgData)
    }

    async updateSettings (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as TrendWorkerCommission['update-settings'],
            { settings: 'Object' }
        )
        if (!data) {
            return this._failure(msgData)
        }
        if (this._namespace && this._processor) {
            this._processor.settings = data.settings.modules[this._namespace] as unknown as CommonBiosignalSettings
        }
        Log.debug(`TrendWorker: settings updated.`, SCOPE)
        return this._success(msgData)
    }

    async shutdown (msgData: WorkerMessage['data']) {
        await this._processor?.destroy()
        this._processor = null
        Log.debug(`TrendWorker shut down.`, SCOPE)
        return this._success(msgData)
    }
}

const WORKER = new TrendWorker()
onmessage = async (message: MessageEvent) => {
    WORKER.handleMessage(message)
}
