/**
 * Biosignal service base class.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type AnnotationTemplate,
    type BiosignalDataService,
    type BiosignalHeaderRecord,
    type BiosignalResource,
    type BiosignalSetupResponse,
    type SignalDataCache,
    type SignalDataGap,
    type SignalDataGapMap,
} from '#types/biosignal'
import {
    CacheSignalsResponse,
    type MemoryManager,
    type SetupStudyResponse,
    type SignalCacheResponse,
    type WorkerResponse,
} from '#types/service'
import { type StudyContext } from '#types/study'
import { INDEX_NOT_ASSIGNED } from '#util/constants'
import { ConfigChannelFilter } from '#types/config'
import GenericService from '#assets/service/GenericService'
import Log from 'scoped-event-log'

const SCOPE = "GenericBiosignalService"

export default abstract class GenericBiosignalService extends GenericService implements BiosignalDataService {
    /** Parent recording of this loader. */
    protected _recording: BiosignalResource
    /** Resolved or rejected based on the success of worker setup. */
    protected _setupWorker: Promise<BiosignalSetupResponse> | null = null
    protected _signalBufferStart = INDEX_NOT_ASSIGNED

    get signalBufferStart () {
        return this._signalBufferStart
    }
    set signalBufferStart (value: number) {
        this._setPropertyValue('signalBufferStart', value)
    }

    get worker () {
        return this._worker
    }

    constructor (recording: BiosignalResource, worker?: Worker, manager?: MemoryManager) {
        super(SCOPE, worker)
        this._recording = recording
        if (manager) {
            this._manager = manager
        }
    }

    protected async _isStudyReady (): Promise<boolean> {
        const studySetup = this._waiters.get('setup-worker')
        if (studySetup !== undefined) {
            const studyLoad = new Promise<boolean>(success => {
                studySetup.push(success)
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
    async cacheSignalsFromUrl (): Promise<CacheSignalsResponse> {
        if (!(await this._isStudyReady())) {
            return false
        }
        const commission = this._commissionWorker('cache-signals-from-url')
        return commission.promise as Promise<CacheSignalsResponse>
    }

    destroy (): void {
        // Clear the recording reference.
        this._recording = null as unknown as BiosignalResource
        this._setupWorker = null
        this._signalBufferStart = INDEX_NOT_ASSIGNED
        super.destroy()
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
        return commission.promise as Promise<SignalCacheResponse>
    }

    async handleMessage (message: WorkerResponse) {
        const data = message.data
        if (!data) {
            return false
        }
        // Cache signals is called from the worker, it has no commission.
        if (data.action === 'cache-signals') {
            const range = data.range as number[]
            this._recording.signalCacheStatus = [...range]
            const annotations = data.annotations as AnnotationTemplate[] | undefined
            if (annotations?.length) {
                this._recording.addAnnotationsFromTemplates(...annotations)
            }
            const dataGaps = data.dataGaps as SignalDataGap[] | undefined
            if (dataGaps?.length) {
                const newGaps = new Map<number, number>() as SignalDataGapMap
                for (const gap of dataGaps) {
                    newGaps.set(gap.start, gap.duration)
                }
                // Data gap information can change as the file is loaded,
                // they must be reset when caching new data.
                this._recording.setDataGaps(newGaps)
            }
            return true
        }
        // Other responses must have a matching commission.
        const commission = this._getCommissionForMessage(message)
        if (!commission) {
            return false
        }
        if (data.action === 'cache-signals-from-url') {
            if (data.success) {
                Log.debug(`Finished caching signals from URL.`, SCOPE)
            } else {
                Log.error(`Caching signals from URL failed.`, SCOPE)
            }
            commission.resolve(data.success as CacheSignalsResponse)
            return true
        } else if (data.action === 'get-signals') {
            if (!data.success) {
                Log.error("Loading signals failed!", SCOPE, data.error as Error)
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
        } else if (data.action === 'setup-cache') {
            this._isCacheSetup = data.success
            if (data.success) {
                commission.resolve(data.cacheProperties)
            } else {
                commission.resolve(null)
            }
            this._notifyWaiters('setup-cache', data.success)
            return true
        } else if (data.action === 'setup-worker') {
            this._isWorkerSetup = data.success
            if (data.success) {
                commission.resolve(data.recordingLength)
            } else {
                commission.resolve(0)
            }
            this._notifyWaiters('setup-worker', data.success)
            return true
        }
        return super._handleWorkerCommission(message)
    }

    async setupCache (dataDuration: number): Promise<SignalDataCache|null> {
        this._initWaiters('setup-cache')
        const commission = this._commissionWorker(
            'setup-cache',
            new Map([['dataDuration', dataDuration]]),
        )
        return commission.promise as Promise<SignalDataCache|null>
    }

    async setupWorker (header: BiosignalHeaderRecord, study: StudyContext) {
        // Find biosignal files.
        const fileUrls = study.files.filter(file => file.role === 'data').map(file => file.url)
        Log.info(`Loading study ${study.name} in worker.`, SCOPE)
        this._initWaiters('setup-worker')
        const commission = this._commissionWorker(
            'setup-worker',
            new Map<string, unknown>([
                ['header', header.serializable],
                ['urls', fileUrls],
            ])
        )
        return commission.promise as Promise<SetupStudyResponse>
    }
}
