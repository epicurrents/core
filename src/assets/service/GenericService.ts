/**
 * Generic service.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    ActionWatcher,
    AssetService,
    CommissionMap,
    CommissionPromise,
    CommissionWorkerOptions,
    MemoryManager,
    RequestMemoryResponse,
    SetupWorkerResponse,
    WorkerCommission,
    WorkerMessage,
    WorkerResponse,
} from '#types/service'
import { Log } from 'scoped-event-log'
import GenericAsset from '#assets/GenericAsset'
import { NUMERIC_ERROR_VALUE } from '#util/constants'
import { getOrSetValue, nullPromise, safeObjectFrom } from '#util/general'
import { MutexExportProperties } from 'asymmetric-io-mutex'

const SCOPE = 'GenericService'

/**
 * Services work as interfaces to web workers. They give commissions for any tasks that need to be performed
 * outside the main thread and return promises that are fulfilled once the task completes.
 */
export default abstract class GenericService extends GenericAsset implements AssetService {
    private _requestNumber: number = 1
    /** Watchers for worker actions (not yet fully implemented). */
    protected _actionWatchers = [] as ActionWatcher[]
    /** On-going worker commissions waiting to be resolved. */
    protected _commissions = new Map<string, CommissionMap>()
    /** Has cache setup been completed. */
    protected _isCacheSetup = false
    /** Has worker setup been complete. */
    protected _isWorkerSetup = false
    /** Message port of a shared worker (as an alternative to a dedicated worker). */
    protected _port: MessagePort | null = null
    protected _manager: MemoryManager | null
    protected _memoryRange: { start: number, end: number } | null = null
    /**
     * A map with actions as keys and an array of callbacks to call when that action completes.
     * Some generic actions are used to check if the service is ready:
     * - `setup-worker` - General worker setup.
     * - `setup-cache` - Data cache setup.
     */
    protected _waiters = new Map<string, ((result: boolean) => void)[]>()
    protected _worker: Worker | null = null

    constructor (name: string, worker?: Worker | MessagePort, shared?: boolean, manager?: MemoryManager) {
        super(name, 'service')
        this._manager = manager || null
        if (worker) {
            if (shared) {
                // It is a message port to a shared worker.
                this._port = worker as MessagePort
            } else {
                // Only Worker has the onerror property.
                this._worker = worker as Worker
                Log.registerWorker(this._worker)
            }
        }
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
    get initialSetup () {
        if (this._isWorkerSetup) {
            return Promise.resolve(true)
        }
        if (!this._waiters.get('setup-worker')) {
            // The setup process hasn't begun yet or has failed.
            return Promise.resolve(undefined)
        }
        return this.awaitAction('setup-worker') as Promise<SetupWorkerResponse>
    }
    get isReady () {
        if (!this._isWorkerSetup || !this._isCacheSetup) {
            return false
        }
        if (this._manager && !this._memoryRange) {
            return false
        }
        return true
    }
    /**
     * The next unique request number.
     */
    protected get _nextRequestNumber () {
        return this._requestNumber++
    }
    get port () {
        return this._port
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
        options?: CommissionWorkerOptions
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
        // Use custom callbacks if they have been given.
        const commission = callbacks ? callbacks : {
            reject: () => {},
            resolve: () => {},
        }
        const returnPromise = new Promise<unknown>((resolve, reject) => {
            commission.resolve = resolve
            commission.reject = reject
        })
        const requestNum = this._nextRequestNumber
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
        if (options?.overwriteRequest) {
            // Remove references to any previous requests
            commMap.clear()
        }
        commMap.set(requestNum, {
            rn: requestNum,
            reject: commission.reject,
            resolve: commission.resolve,
        })
        if (options?.transferList) {
            // Transferable objects must be added as individual properties.
            this._worker.postMessage({ ...msgData, ...options.transferList }, options.transferList)
        } else {
            this._worker.postMessage(msgData)
        }
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
            if (data.action === 'setup-worker') {
                const prevState = this.isReady
                this._isWorkerSetup = data.success
                if (data.success) {
                    Log.debug(`Worker setup complete.`, SCOPE)
                    commission.resolve(data.success)
                    this.dispatchPropertyChangeEvent('isReady', this.isReady, prevState)
                } else if (commission.reject) {
                    commission.reject(data.error as string)
                }
                this._notifyWaiters('setup-worker', data.success)
                return true
            } else if (data.action === 'setup-cache') {
                const prevState = this.isReady
                this._isCacheSetup = data.success
                commission.resolve(data.success)
                this.dispatchPropertyChangeEvent('isReady', this.isReady, prevState)
                this._notifyWaiters('setup-cache', data.success)
                return true
            } else if (message.data.action === 'release-cache' || message.data.action === 'shutdown') {
                if (commission && data.success) {
                    const prevState = this.memoryConsumption
                    this._memoryRange = null
                    this.dispatchPropertyChangeEvent('memoryConsumption', this.memoryConsumption, prevState)
                }
                commission.resolve(data.success)
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
        if (!window.__EPICURRENTS__?.RUNTIME) {
            Log.error(`Reference to application runtime was not found.`, SCOPE)
            return false
        }
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
                window.__EPICURRENTS__.RUNTIME?.SETTINGS.addPropertyUpdateHandler(field, () => {
                    this._worker?.postMessage({
                        action: 'update-settings',
                        field: field,
                        value: window.__EPICURRENTS__?.RUNTIME?.SETTINGS.getFieldValue(field)
                    })
                }, this._name)
            }
            return true
        }
        return false
    }

    /**
     * Initialize an array of waiters for the given action to complete.
     * @param action - Name of the action.
     */
    protected _initWaiters (action: string) {
        this._waiters.set(action, [])
    }

    /**
     * Check if the buffer is ready for use. Will wait for buffer modifying operations to complete before resolving.
     * @returns Promise that resolves with boolean once buffer is available.
     */
    protected async _isBufferReady (): Promise<boolean> {
        const setupCache = this._waiters.get('setup-cache')
        if (setupCache) {
            const bufferSetup = new Promise<boolean>(success => {
                setupCache.push(success)
            })
            if (!(await bufferSetup)) {
                return false
            }
        }
        const shiftBuffer = this._waiters.get('set-buffer-range')
        if (shiftBuffer) {
            const bufferShift = new Promise<boolean>(success => {
                shiftBuffer.push(success)
            })
            if (!(await bufferShift)) {
                return false
            }
        }
        return true
    }

    /**
     * Notify any waiters for the given action with the result.
     * Removes the action entry from the waiters map afterwards.
     * @param action - Name of the action.
     * @param result - Result of the action (success as boolean).
     */
    protected _notifyWaiters (action: string, result: boolean) {
        const waiters = this._waiters.get(action) || []
        while (waiters.length) {
            const waiter = waiters.shift()
            if (!waiter) {
                Log.error(`Waiters array for ${action} contained an empty element.`, SCOPE)
                break
            }
            waiter(result)
        }
        // Remove the entry to signify that this action has been completed.
        this._waiters.delete(action)
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

    async awaitAction (action: string): Promise<unknown> {
        const actionWaiters = this._waiters.get(action)
        if (!actionWaiters) {
            return Promise.resolve(undefined)
        }
        const waiter = new Promise(resolve => {
            actionWaiters.push(resolve)
        })
        return waiter
    }

    async destroy () {
        await this.shutdown()
        this._commissions.clear()
        this._waiters.clear()
        this._actionWatchers.length = 0
        this._manager = null
        this._memoryRange = null
        this._port = null
        super.destroy()
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
        if (!this._manager.freeMemory) {
            Log.error(`Memory manager has no memory available.`, SCOPE)
            return false
        }
        Log.debug(`Requesting to allocate ${amount*4} bytes of memory.`, SCOPE)
        const prevState = this.memoryConsumption
        this._memoryRange = await this._manager.allocate(amount, this)
        this.dispatchPropertyChangeEvent('memoryConsumption', this.memoryConsumption, prevState)
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
        this._initWaiters('set-buffer-range')
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
            Log.debug(`Buffer range shift successful, new range is ${range.join('-')}.`, SCOPE)
        } else {
            Log.debug(`Buffer range shift failed: ${response.reason}`, SCOPE)
        }
    }

    async setupMutex (): Promise<MutexExportProperties|null> {
        if (!this._manager) {
            Log.error(`Cannot initialize buffer, memory manager has not been set up.`, SCOPE)
            return null
        }
        if (!this._memoryRange) {
            Log.error(`Cannot initialize buffer, loader doesn't have any allocated memory.`, SCOPE)
            return null
        }
        Log.debug(`Initiating buffers in worker.`, SCOPE)
        this._initWaiters('setup-cache')
        const commission = this._commissionWorker(
            'setup-cache',
            new Map<string, unknown>([
                ['buffer', this._manager.buffer],
                ['range', this._memoryRange],
                ['useMemoryManager', true],
            ])
        )
        const initResult = await commission.promise as MutexExportProperties | null
        if (!initResult) {
            Log.error(`Initializing memory buffer in the worker failed.`, SCOPE)
            return null
        }
        return initResult
    }

    async setupWorker (..._params: unknown[]): Promise<SetupWorkerResponse> {
        Log.debug(`Setting up worker.`, SCOPE)
        this._initWaiters('setup-worker')
        const commission = this._commissionWorker('setup-worker')
        return commission.promise as Promise<SetupWorkerResponse>
    }

    async shutdown () {
        if (!window.__EPICURRENTS__?.RUNTIME) {
            Log.error(`Reference to application runtime was not found.`, SCOPE)
            return Promise.reject()
        }
        const prevState = this.isReady
        window.__EPICURRENTS__.RUNTIME?.SETTINGS.removeAllPropertyUpdateHandlersFor(this._name)
        const response = this._commissionWorker('shutdown')
        if (await response.promise) {
            this._commissions.clear()
            this._waiters.clear()
            this._actionWatchers.length = 0
            this._isCacheSetup = false
            this._isWorkerSetup = false
            this._manager = null
            this._memoryRange = null
            this._port = null
            this._worker?.terminate()
            this._worker = null
            this.dispatchPropertyChangeEvent('isReady', this.isReady, prevState)
        }
    }

    async unload (releaseFromManager = true) {
        const prevState = this.isReady
        const commission = this._commissionWorker('release-cache')
        await commission.promise
        if (this._manager && releaseFromManager) {
            this._manager.release(this)
        }
        this._isCacheSetup = false
        this.dispatchPropertyChangeEvent('isReady', this.isReady, prevState)
    }
}
