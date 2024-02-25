/**
 * Generic ONNX service.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type BaseAsset } from '#types/application'
import { type BiosignalResource } from '#types/biosignal'
import { type OnnxService, type AvailableOnnxModel } from '#types/onnx'
import { SetupWorkerResponse, type WorkerResponse } from '#types/service'
import { Log } from 'scoped-ts-log'
import GenericService from '#assets/service/GenericService'

const SCOPE = 'GenericOnnxService'

export class GenericOnnxService extends GenericService implements OnnxService {

    protected _activeModel: string | null = null
    protected _availableModels = new Map<string, AvailableOnnxModel>()
    protected _modelLoading = false
    protected _progress = {
        complete: 0,
        startIndex: 0,
        target: 0,
    }
    protected _runInProgress = false
    protected _source = null as BiosignalResource | null

    constructor (model?: string) {
        super(SCOPE)
        if (model) {
            this.loadModel(model)
        }
    }

    get activeModel () {
        return this._activeModel
    }
    protected set activeModel (value: string|null) {
        this._activeModel = value
        this.onPropertyUpdate('active-model', value)
    }

    get availableModels () {
        const models = new Map() as OnnxService['availableModels']
        for (const [key, value] of this._availableModels) {
            models.set(key, {
                name: value.name,
                supportsStudy: (study: BaseAsset) => value.supportedStudyTypes
                                                          .includes(`${study.scope}:${study.type}`),
            })
        }
        return models
    }

    get isReady () {
        // TODO: Replace these separate properties by single modelState property.
        return super.isReady
               && (this._source !== null)
               && (this._activeModel !== null)
               && !this._modelLoading
    }

    get modelLoading () {
        return this._modelLoading
    }
    set modelLoading (value: boolean) {
        this._modelLoading = value
        this.onPropertyUpdate('model-loading', value)
    }

    get runInProgress () {
        return this._runInProgress
    }
    protected set runInProgress (value: boolean) {
        this._runInProgress = value
        this.onPropertyUpdate('run-in-progress', value)
    }

    get runProgress () {
        return this._progress.target ? this._progress.complete/this._progress.target : 0
    }

    async handleMessage (message: WorkerResponse) {
        const data = message.data
        if (!data) {
            return false
        }
        if (super._handleWorkerUpdate(message)) {
            return true
        }
        if (data.action === 'progress') {
            // Progress is a special update that is sent to 'run' action watchers,
            // it has no commission associated to it.
            this._progress.complete = this._progress.startIndex + (data.complete as number)
            this.onPropertyUpdate('progress')
            return true
        }
        for (const upd of this._actionWatchers) {
            if (upd.actions.includes(data.action)) {
                upd.handler({ ...data, action: data.action })
            }
        }
        const commission = this._getCommissionForMessage(message)
        if (!commission) {
            return false
        }
        if (data.action === 'prepare') {
            this._name = data.name as string
            this.onPropertyUpdate('name')
            commission.resolve(data.success)
            return true
        }
        if (await super._handleWorkerCommission(message)) {
            return true
        }
        Log.warn(`Message with action ${data.action} was not handled.`, SCOPE)
        return false
     }

    async loadModel (model: string | null) {
        if (model === this._activeModel) {
            return false
        }
        if (!this._source) {
            Log.error(`Cannot load model without an active data source.`, SCOPE)
            return false
        }
        if (this._source) {
            this.resetProgress()
        }
        if (model === null) {
            this.activeModel = null
            this.onPropertyUpdate('is-ready')
            return false
        }
        const modelProps = this._availableModels.get(model.toLowerCase())
        if (modelProps) {
            // Reject source if it is not of supported type.
            if (!modelProps.supportedStudyTypes.includes(`${this._source.scope}:${this._source.type}`)) {
                Log.warn(
                    `Resource ${this._source.name} type ${this._source.scope}:${this._source.type} ` +
                    `is not supported by ONNX model ${modelProps.name} (` +
                    (modelProps.supportedStudyTypes.length
                        ? `supported types are ${modelProps.supportedStudyTypes.join(', ')}`
                        : `loader has no supported types set`
                    ) + `).`,
                    this._scope
                )
                return false
            }
            this.modelLoading = true
            try {
                if (this._worker) {
                    this._worker.removeEventListener('message', this.handleMessage)
                }
                this._worker = modelProps.worker
                this._worker.addEventListener('message', this.handleMessage.bind(this))
                await this.prepareWorker()
                Log.debug(`Loaded ONNX model ${model}.`, SCOPE)
                this.activeModel = model
                return true
            } catch (error) {
                Log.error(`Creating a web worker for ONNX model ${model} failed.`, SCOPE, error as Error)
                return false
            } finally {
                this.modelLoading = false
                this.onPropertyUpdate('is-ready')
            }
        }
        Log.error(`The given ONNX model ${model} was not found in available models ` +
                  `(${Array.from(this._availableModels.keys()).join(',')}).`, SCOPE)
        return false
    }

    pauseRun () {
        this.runInProgress = false
    }

    async prepareWorker () {
        const path = window.location.pathname
        const dir = path.substring(0, path.lastIndexOf('/')) + '/onnx'
        const commission = this._commissionWorker(
            'prepare',
            new Map<string, number|string>([
                ['path', dir],// WebWorker doesn't know HTML file path.
            ])
        )
        return commission.promise as Promise<SetupWorkerResponse>
    }

    resetProgress () {
        if (this._runInProgress) {
            this.pauseRun()
        }
        this._progress.complete = 0
        this._progress.startIndex = 0
        this._progress.target = 0
        for (const upd of this._actionWatchers) {
            // Inform all progress action watchers of the reset
            if (upd.actions.includes('run')) {
                upd.handler(
                    { ...this._progress, action: 'run', update: 'progress' }
                )
            }
        }
        this.onPropertyUpdate('progress')
    }

    async run () {
        // This method must be overridden in the child class!
    }

    setProgressTarget (target: number) {
        this._progress.target = target
        this.onPropertyUpdate('progress')
    }

    setSourceResource (resource: BiosignalResource | null, childScope?: string): boolean {
        Log.info(
            resource ? `Settings data source to ${resource.name}.`
                     : `Clearing source resource.`
            , childScope || SCOPE
        )
        if (this._source) {
            this.resetProgress()
            this._source.removeAllPropertyUpdateHandlersFor(childScope || SCOPE)
        }
        if (this._runInProgress) {
            Log.debug(`Aborting run; new resource set.`, childScope || SCOPE)
            this.runInProgress = false
            this._commissionWorker('abort')
        }
        this._source = resource
        this.onPropertyUpdate('is-ready')
        return true
    }
}
