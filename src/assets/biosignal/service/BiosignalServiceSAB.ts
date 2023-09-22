/**
 * Biosignal service using SharedArrayBuffers.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalDataService,
    type BiosignalHeaderRecord,
    type BiosignalResource,
    type BiosignalSetupResponse,
} from "TYPES/biosignal"
import { type MemoryManager } from "TYPES/assets"
import { type SignalCacheResponse, type WorkerMessage } from "TYPES/service"
import { type StudyContext } from "TYPES/study"
import Log from 'scoped-ts-log'
import SETTINGS from "CONFIG/Settings"
import GenericService from "ASSETS/service/GenericService"
import { NUMERIC_ERROR_VALUE } from "UTIL/constants"
import { ConfigChannelFilter } from "TYPES/config"

const SCOPE = "BiosignalService"

export default class BiosignalServiceSAB extends GenericService implements BiosignalDataService {
    protected _awaitStudySetup: ((success: boolean) => void)[] = []
    /** Is the study still loading. */
    protected _loadingStudy = false
    /** Parent recording of this loader. */
    protected _recording: BiosignalResource
    /** Resolved or rejected based on the success of worker setup. */
    protected _setupWorker: Promise<BiosignalSetupResponse> | null = null
    protected _signalBufferStart = NUMERIC_ERROR_VALUE

    get isReady () {
        return super.isReady && this._workerReady
    }
    get signalBufferStart () {
        return this._signalBufferStart
    }
    set signalBufferStart (value: number) {
        this._signalBufferStart = value
    }
    get worker () {
        return this._worker
    }

    constructor (recording: BiosignalResource, worker: Worker, manager: MemoryManager) {
        super (SCOPE, worker)
        this._recording = recording
        this._manager = manager
        this._worker?.postMessage({
            action: 'update-settings',
            settings: SETTINGS._CLONABLE,
        })
        /*
        // Check if we have a worker constructor for this file type.
        const createWorker = this._app.getFileWorkerSource(fileType)
        if (createWorker) {
            this.setupWorker(createWorker())
            this._worker?.postMessage({
                action: 'update-settings',
                settings: SETTINGS._CLONABLE,
            })
        } else {
            Log.warn(`No worker source was found for file type '${fileType}'.`, SCOPE)
        }
        */
    }

    protected async _isStudyReady (): Promise<boolean> {
        if (this._loadingStudy) {
            const studyLoad = new Promise<boolean>(success => {
                this._awaitStudySetup.push(success)
            })
            if (!(await studyLoad)) {
                return false
            }
        }
        return true
    }

    /**
     * Start the process of caching raw signals from the preset URL.
     */
    async cacheSignalsFromUrl (): Promise<SignalCacheResponse> {
        if (!(await this._isStudyReady())) {
            return null
        }
        const commission = this._commissionWorker('cache-signals-from-url')
        return commission.promise
    }

    async getSignals (range: number[], config?: ConfigChannelFilter): Promise<SignalCacheResponse> {
        if (!(await this._isStudyReady())) {
            return null
        }
        const commission = this._commissionWorker(
            'get-signals',
            new Map<string, unknown>([
                ['range', range],
                ['config', config],
            ])
        )
        return commission.promise
    }

    async handleMessage (message: { data: WorkerMessage }) {
        const data = message.data
        if (!data) {
            return false
        }
        // Cache signals is called from the worker, it has no commission.
        if (data.action === 'cache-signals') {
            this._recording.signalCacheStatus = [...data.range]
            if (data.annotations?.length) {
                this._recording.addAnnotations(...data.annotations)
            }
            if (data.dataGaps?.length) {
                const newGaps = new Map<number, number>()
                for (const gap of data.dataGaps) {
                    newGaps.set(gap.start, gap.duration)
                }
                // Data gap information can change as the file is loaded,
                // they must be reset when caching new data.
                this._recording.dataGaps = newGaps
            }
            return true
        }
        // Other responses must have a matching commission.
        const commission = this._getCommissionForMessage(message)
        if (!commission) {
            return false
        }
        if (data.action === 'get-signals') {
            if (!data.success) {
                Log.error("Loading signals failed!", SCOPE, data.error)
                commission.resolve(null)
            } else {
                commission.resolve({
                    start: data.start,
                    end: data.end,
                    signals: data.signals,
                    annotations: data.annotations,
                    dataGaps: data.dataGaps,
                } as SignalCacheResponse)
            }
            return true
        } else if (data.action === 'setup-study') {
            if (data.success) {
                commission.resolve(data.recordingLength)
            } else {
                commission.resolve(0)
            }
            this._notifyWaiters(this._awaitStudySetup, data.success)
            return true
        }
        return super._handleWorkerResponse(message)
    }

    async prepareWorker (header: BiosignalHeaderRecord, study: StudyContext) {
        this._loadingStudy = true
        // Find biosignal files.
        const fileUrls = study.files.filter(file => file.role === 'data').map(file => file.url)
        Log.info(`Loading study ${study.name} in worker.`, SCOPE)
        const commission = this._commissionWorker(
            'setup-study',
            new Map<string, unknown>([
                ['header', header.serializable],
                ['urls', fileUrls],
            ])
        )
        return commission.promise
    }
}