/**
 * Biosignal service.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalDataService,
    type BiosignalHeaderRecord,
    type BiosignalResource,
} from "TYPES/biosignal"
import { type MemoryManager } from "TYPES/core"
import { type SignalCacheResponse } from "TYPES/service"
import { type StudyContext } from "TYPES/study"
import Log from 'scoped-ts-log'
import GenericService from "CORE/service/GenericService"
import { NUMERIC_ERROR_VALUE } from "UTIL/constants"

const SCOPE = "BiosignalService"

export default class BiosignalService extends GenericService implements BiosignalDataService {
    protected _awaitStudySetup: ((success: boolean) => void)[] = []
    /** Is the study still loading. */
    protected _loadingStudy = false
    /** Parent recording of this loader. */
    protected _recording: BiosignalResource

    get signalBufferStart () {
        // This is not supposed to be used in the simple loader.
        return NUMERIC_ERROR_VALUE
    }
    get worker () {
        return this._worker
    }

    constructor (recording: BiosignalResource, worker: Worker, memoryManager?: MemoryManager) {
        super(SCOPE, worker, memoryManager)
        this._recording = recording
    }

    protected async _handleWorkerResponse (message: any) {
        const data = message.data
        if (!data) {
            return false
        }
        // Cache signals is called from the worker, it has no commission.
        if (data.action === 'cache-signals') {
            this._recording.signalCacheStatus = [...data.range]
            if (data.annotations?.length) {
                this._recording.addAnnotations(data.annoations)
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
            return false
        }
        const commission = this._getCommissionForMessage(message)
        if (!commission) {
            return false
        }
        if (data.action === 'cache-signals-from-url') {
            if (!data.success) {
                Log.error("Caching signals from URL failed!", SCOPE, data.error)
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
        } else if (data.action === 'get-signals') {
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
            this._loadingStudy = false
            return true
        } else if (await super._handleWorkerResponse(message)) {
            return true
        }
        Log.warn(`Message with action ${data.action} was not handled.`, SCOPE)
        return false
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

    async cacheSignalsFromUrl (): Promise<SignalCacheResponse> {
        if (this._loadingStudy) {
            const studyLoad = new Promise<boolean>(success => {
                this._awaitStudySetup.push(success)
            })
            if (!(await studyLoad)) {
                return null
            }
        }
        const commission = this._commissionWorker('cache-signals-from-url')
        return commission.promise
    }

    async getSignals (range: number[], config?: any): Promise<SignalCacheResponse> {
        if (!(await this._isStudyReady())) {
            return null
        }
        const commission = this._commissionWorker(
            'get-signals',
            new Map<string, any>([
                ['range', range],
                ['config', config],
            ])
        )
        return commission.promise
    }

    async handleMessage (message: any): Promise<boolean> {
        return super._handleWorkerUpdate(message) || this._handleWorkerResponse(message)
    }

    async prepareWorker (header: BiosignalHeaderRecord, study: StudyContext) {
        this._loadingStudy = true
        // Find data files.
        const fileUrls = study.files.filter(file => file.role === 'data').map(file => file.url)
        Log.info(`Loading study ${study.name} in worker.`, SCOPE)
        const commission = this._commissionWorker(
            'setup-study',
            new Map<string, any>([
                ['header', header.serializable],
                ['urls', fileUrls],
            ])
        )
        return commission.promise
    }
}
