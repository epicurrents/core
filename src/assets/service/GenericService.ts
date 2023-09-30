/**
 * Generic service.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { MemoryManager } from "#types/assets"
import {
    type ActionWatcher,
    type AssetService,
    type CommissionMap,
    type CommissionPromise,
    type RequestMemoryResponse,
    type WorkerCommission,
    type WorkerMessage,
    type WorkerResponse,
} from "#types/service"
import { Log } from 'scoped-ts-log'
import SETTINGS from "#config/Settings"
import GenericAsset from "#assets/GenericAsset"
import { NUMERIC_ERROR_VALUE } from "#util/constants"
import { getOrSetValue, nullPromise, safeObjectFrom } from "#util/general"
import { MutexExportProperties } from "asymmetric-io-mutex"

const SCOPE = 'GenericService'

/**
 * Services work as interfaces to web workers. They give commissions for any tasks that need to be performed
 * outside the main thread and return promises that are fulfilled once the task completes.
 */
export default class GenericService extends GenericAsset implements AssetService {
    private _requestNumber: number = 1
    protected _actionWatchers = [] as ActionWatcher[]
    protected _awaitBufferSetup: ((success: boolean) => void)[] = []
    protected _awaitBufferShift: ((success: boolean) => void)[] = []
    /** On-going worker commissions waiting to be resolved. */
    protected _commissions = new Map<string, CommissionMap>()
    /** Is buffer initiation underway. */
    protected _setupBuffer = false
    /** Is buffer shifting. */
    protected _shiftBuffer = false
    protected _manager: MemoryManager | null
    protected _memoryRange: { start: number, end: number } | null = null
    protected _scope: string
    protected _worker: Worker | null = null
    /** Set to true when the worker is done setting up. */
    protected _workerReady = false

    constructor (scope: string, worker?: Worker, manager?: MemoryManager) {
        super(scope, GenericAsset.SCOPES.LOADER, '')
        this._scope = scope
        this._manager = manager || null
        if (worker) {
            this.setupWorker(worker)
            const updateSettings = () => {
                worker.postMessage({
                    action: 'update-settings',
                    settings: SETTINGS._CLONABLE,
                })
            }
            updateSettings()
        }
    }

    protected async _isBufferReady (): Promise<boolean> {
        if (this._setupBuffer) {
            const bufferSetup = new Promise<boolean>(success => {
                this._awaitBufferSetup.push(success)
            })
            if (!(await bufferSetup)) {
                return false
            }
        }
        if (this._shiftBuffer) {
            const bufferShift = new Promise<boolean>(success => {
                this._awaitBufferShift.push(success)
            })
            if (!(await bufferShift)) {
                return false
            }
        }
        return true
    }

    get bufferRangeStart () {
        if (!this._memoryRange) {
            return -1
        }
        return this._memoryRange.start
    }
    get memoryConsumption () {
        if (!this._memoryRange) {
            return 0
        }
        return this._memoryRange.end - this._memoryRange.start
    }
    get isReady () {
        if (!this._manager) {
            return (this._worker !== null)
        } else {
            if (!this._memoryRange) {
                return false
            } else if (this._setupBuffer) {
                return false
            }
            return true
        }
    }
    get nextRequestNumber () {
        return this._requestNumber++
    }

    /**
     * Commission the worker to perform an action.
     * @param action - Name of the action to perform.
     * @param props - Additional properties to inject into the message (optional).
     * @param callbacks - Optional custom callbacks for resolving (and possibly rejecting) the action.
     * @param overwriteRequest - Overwrite any previous requests with the same action, discarding responses to any but the most recent request (default false).
     */
     protected _commissionWorker (
        action: string,
        props?: Map<string, unknown>,
        callbacks?: { resolve: ((value?: unknown) => void), reject: ((reason?: string) => void) },
        overwriteRequest = false
    ): WorkerCommission {
        if (!this._worker) {
            callbacks?.reject(`Worker has not been set up.`)
            return {
                promise: nullPromise,
                reject: () => {},
                resolve: () => {},
                rn: NUMERIC_ERROR_VALUE,
            }
        }
        const commission = callbacks ? callbacks : {
            reject: () => {},
            resolve: () => {},
        }
        // Use custom callbacks if they have been given.
        const returnPromise = new Promise<unknown>((resolve, reject) => {
            commission.resolve = resolve
            commission.reject = reject
        })
        const requestNum = this.nextRequestNumber
        const msgData = safeObjectFrom({
            action: action,
            rn: requestNum
        }) as WorkerMessage["data"]
        if (props) {
            for (const [key, value] of props)  {
                msgData[key] = value
            }
        }
        const commMap = getOrSetValue(
            this._commissions, action,
            new Map<number, CommissionPromise>()
        ) as CommissionMap
        if (overwriteRequest) {
            // Remove references to any previous requests
            commMap.clear()
        }
        commMap.set(requestNum, {
            rn: requestNum,
            reject: commission.reject,
            resolve: commission.resolve,
        })
        this._worker.postMessage(msgData)
        return {
            promise: returnPromise,
            reject: commission.reject,
            resolve: commission.resolve,
            rn: requestNum,
        }
    }

    /**
     * Get the awaiting commission matching the given worker message.
     * @param message - Message containing a possible commission.
     * @returns WorkerCommission or undefined if no commission found.
     */
    protected _getCommissionForMessage (message: WorkerResponse) {
        const commMap = this._commissions.get(message?.data?.action)
        if (commMap) {
            // Messages that arrive from the worker without a commission
            // (such as progress reports) may not have an RN.
            return commMap.get(message.data.rn || 0)
        } else {
            return undefined
        }
    }

    /**
     * Handle a response message from the worker. Will check if a matching commission can be found and either
     * resolves or rejects it based on the value of the success property in the message. This method expects that:
     * - The message has an `action` property.
     * - The message has an `rn` (request number) property.
     * - A successful message has a `result` property.
     * - A non-successful message has a `reason` property.
     *
     * Optionally:
     * - The message has a `success` property.
     *
     * @param message - Message object from worker.
     * @returns True if handled, false otherwise.
     */
    protected async _handleWorkerCommission (message: WorkerResponse) {
        const data = message.data
        if (!data || !data.action) {
            return false
        }
        const commission = this._getCommissionForMessage(message)
        if (commission) {
            if (data.action === 'setup-buffer') {
                if (data.success) {
                    Log.debug(`Buffer initiation complete in biosignal loader worker.`, SCOPE)
                    commission.resolve(data.cacheProperties)
                    this._workerReady = true
                    this.onPropertyUpdate('is-ready')
                } else if (commission.reject) {
                    commission.reject(data.error as string)
                }
                return true
            } else if (
                message.data.action === 'release-buffer' ||
                message.data.action === 'shutdown'
            ) {
                const decommission = this._commissions.get('decommission')
                if (decommission && message.data.success === true) {
                    this._memoryRange = null
                    this.onPropertyUpdate('memory-consumption')
                    decommission.get(0)?.resolve()
                    if (message.data.action === 'shutdown') {
                        this._worker?.terminate()
                        this._worker = null
                        this.onPropertyUpdate('is-ready')
                    }
                }
                return true
            } else if (message.data.success === true) {
                commission.resolve(message.data.result)
                return true
            } else if (message.data.success === false && commission.reject) {
                commission.reject(message.data.reason || '')
                return false
            } else {
                commission.resolve() // Same as undefined result
                return true
            }
        }
        return false
    }

    /**
     * Handle an update message from the worker. No matching commission is expected and thus no waiting promises
     * will be resolved with these checks.
     * @param message - An update message without a matching commission.
     * @returns true if handled, false otherwise.
     */
    protected _handleWorkerUpdate (message: WorkerResponse): boolean {
        const data = message.data
        if (!data || !data.action) {
            return false
        }
        if (data.action === 'log') {
            const { event, extra, level, scope } = message.data
            if (event && level && scope) {
                Log.add(level as keyof typeof Log.LEVELS, event as string, scope as string, extra)
            }
            return true
        } else if (data.action === 'update-settings') {
            const fields =  data.fields as string[] | undefined
            for (const field of (fields || [])) {
                // Watch changes in SETTINGS and relay changes to worker.
                SETTINGS.addPropertyUpdateHandler(field, () => {
                    this._worker?.postMessage({
                        action: 'update-settings',
                        field: field,
                        value: SETTINGS.getFieldValue(field)
                    })
                }, this._scope)
            }
            return true
        }
        return false
    }

    protected _notifyWaiters (waiters: ((success: boolean) => void)[], result: boolean) {
        while (waiters.length) {
            const waiter = waiters.shift()
            if (!waiter) {
                break
            }
            waiter(result)
        }
    }

    addActionWatcher (action: string, handler: ActionWatcher['handler'], caller?: string) {
        for (const prev of this._actionWatchers) {
            if (prev.handler === handler) {
                if (!prev.actions.includes(action)) {
                    prev.actions.push(action)
                }
                return
            }
        }
        this._actionWatchers.push({
            actions: [action],
            handler: handler,
            caller: caller,
        })
    }

    removeActionWatcher (handler: ActionWatcher['handler']) {
        for (let i=0; i<this._actionWatchers.length; i++) {
            if (this._actionWatchers[i].handler === handler) {
                this._actionWatchers.splice(i, 1)
                return
            }
        }
    }
    removeAllActionWatchersFor (caller: string) {
        for (let i=0; i<this._actionWatchers.length; i++) {
            if (
                this._actionWatchers[i].caller &&
                this._actionWatchers[i].caller === caller
            ) {
                this._actionWatchers.splice(i, 1)
                i--
            }
        }
    }
    removeAllActionWatchers () {
        this._actionWatchers.splice(0)
    }

    async requestMemory (amount: number): Promise<RequestMemoryResponse> {
        if (!this._manager) {
            Log.error(`Too early to request memory, manager is not set yet.`, SCOPE)
            return false
        }
        Log.debug(`Requesting to allocate ${amount*4} bytes of memory.`, SCOPE)
        this._memoryRange = await this._manager.allocate(amount, this)
        this.onPropertyUpdate('memory-consumption')
        return true
    }

    async setBufferRange (range: number[]): Promise<void> {
        if (!this._manager) {
            Log.error(`Cannot initialize buffer, memory manager has not been set up.`, SCOPE)
            return
        }
        if (!this._memoryRange) {
            Log.error(`Cannot initialize buffer, loader doesn't have any allocated memory.`, SCOPE)
            return
        }
        if (!(await this._isBufferReady())) {
            Log.error(`Could not set buffer range, buffer setup was not successful.`, SCOPE)
            return
        }
        Log.debug(`Initiating buffer range shift.`, SCOPE)
        this._shiftBuffer = true
        const commission = this._commissionWorker(
            'set-buffer-range',
            new Map<string, unknown>([
                ['range', range],
            ])
        )
        const response = await commission.promise as WorkerResponse["data"]
        if (response.success) {
            this._memoryRange.start = range[0]
            this._memoryRange.end = range[1]
            Log.debug(`Buffer range shift successful, new range is ${range[0]}-${range[1]}.`, SCOPE)
        } else {
            Log.debug(`Buffer range shift failed: ${response.reason}`, SCOPE)
        }
        this._shiftBuffer = false
    }

    async setupBuffer (): Promise<MutexExportProperties|null> {
        if (!this._manager) {
            Log.error(`Cannot initialize buffer, memory manager has not been set up.`, SCOPE)
            return null
        }
        if (!this._memoryRange) {
            Log.error(`Cannot initialize buffer, loader doesn't have any allocated memory.`, SCOPE)
            return null
        }
        Log.debug(`Initiating buffers in biosignal loader worker.`, SCOPE)
        this._setupBuffer = true
        const commission = this._commissionWorker(
            'setup-buffer',
            new Map<string, unknown>([
                ['buffer', this._manager.buffer],
                ['range', this._memoryRange],
            ])
        )
        const initResult = await commission.promise as boolean
        this._notifyWaiters(this._awaitBufferSetup, initResult)
        this._setupBuffer = false
        if (!initResult) {
            Log.error(`Initializing memory buffer in the worker failed.`, SCOPE)
            return null
        }
        return initResult
    }

    setupWorker (worker: Worker) {
        this._worker = worker
        if (!this._manager) {
            this.onPropertyUpdate('is-ready')
        }
    }

    shutdown () {
        SETTINGS.removeAllPropertyUpdateHandlersFor(this._scope)
        const response = this._commissionWorker('shutdown')
        // Shutdown doesn't need a request number
        const shutdown = getOrSetValue(
            this._commissions, 'shutdown',
            new Map<number, CommissionPromise>()
        )
        shutdown.set(0, response)
        return response.promise as Promise<void>
    }

    unload () {
        const response = this._commissionWorker('release-buffer')
        // Decommission doesn't need a request number
        const decommission = getOrSetValue(
            this._commissions, 'decommission',
            new Map<number, WorkerCommission>()
        )
        decommission.set(0, response)
        return response.promise as Promise<void>
    }
}
