/**
 * Service types.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type MutexExportProperties } from "asymmetric-io-mutex"
import { BaseAsset } from "./core"

type ActionWatcher = {
    actions: string[]
    handler: (update: any) => any
    caller?: string
}
/**
 * Basic service type that all media and resource services should extend.
 */
export interface AssetService extends BaseAsset {
    /** Starting index of the reserved buffer range (-1 if no range is reserved). */
    bufferRangeStart: number
    /**
     * A loader may need various steps of initial setup before it is ready
     * to load its target asset. This property indicates if all the necessary
     * setup is complete and the loader ready to load the target asset.
     */
    isReady: boolean
    /** The amount of memory (in bytes) the asset in this loader consumes when fully loaded. */
    memoryConsumption: number
    /** A unique request number for a worker request. */
    nextRequestNumber: number
    /**
     * Add a watcher to the give `action`. The watcher will call the given `handler` each time
     * the action is performed.
     * @param action - Action to watch.
     * @param handler - Handler to call on action.
     * @param caller - Optional name of the caller (for bulk-removing all watchers).
     */
    addActionWatcher (action: string, handler: ActionWatcher['handler'], caller?: string): void
    /**
     * Remove the given action watcher (handler) from this service.
     * @param handler - The handler to remove.
     */
    removeActionWatcher (handler: ActionWatcher['handler']): void
    /**
     * Remove all action watchers by the given caller from this service.
     * @param caller - Name of the caller.
     */
    removeAllActionWatchersFor (caller: string): void
    /**
     * Remove all action watchers from this service.
     */
    removeAllActionWatchers (): void
    /**
     * Request the amount of memory to be allocated for this service.
     * @param amount - Amount of memory in bytes.
     * @returns Promise that resolves with true on success, false on failure.
     */
    requestMemory (amount: number): Promise<boolean>
    /**
     * Set the byte range allocated to this service in the shared buffer.
     * @param range - Allocated byte range.
     * @returns Promise that fulfills when worker has acknowledged the change.
     */
    setBufferRange: (range: number[]) => Promise<void>
    /**
     * Set up the buffer in the web worker, returning the created buffer's export properties or null if
     * an error occurred.
     */
    setupBuffer (): Promise<MutexExportProperties|null>
    /**
     * Set the given `worker` to this worker and run any required initialization to make this service ready for use.
     * @param worker - Worker to use in this service.
     */
    setupWorker (worker: Worker): void
    /**
     * Shut down this service, releasing any allocated memory and destroying the web worker.
     * @returns Promise that fulfills when shutdown is complete.
     */
    shutdown (): Promise<void>
    /**
     * Unload the asset, releasing any allocated memory.
     * @return Promise that fulfills when unloading is complete.
     */
    unload (): Promise<void>
}
/**
 * Map of all commissions waiting to be fulfilled.
 */
type CommissionMap = Map<number, CommissionPromise>
/**
 * Commission promise properties.
 */
type CommissionPromise = Omit<{ [prop: string]: any}, "rn" | "success" | "reject" | "resolve">  & {
    /** Unique request number for this commission. */
    rn: number
    /** Was the commission success or not. */
    success: boolean
    /** Any other props returned by the worker. */

    /** Callback for commission completion. */
    resolve: (value?: any) => any
    /** Possible callback for an unexpected error. */
    reject?: (reason: any) => void
} | null
/**
 * Details of the commission given to the worker.
 */
export type WorkerCommission = {
    /** The Promise that will be fulfilled when the commission is complete. */
    promise: Promise<CommissionPromise>
    /** Unique number to identify this commission by. */
    requestNum: number
    /**
     * Method to call if the commission fails.
     * @param reason - Reason for the failure.
     */
    reject? (reason: string): void
    /**
     * Method to call if the commission succeeds.
     * @param value - The results of the commission.
     */
    resolve? (value: any): void
}
type WorkerMessage = {
    action: string
    rn: number
    [prop: string]: any
}
type WorkerResponse = {
    promise: Promise<any>
    rn: number
    reject: (reason: string) => void
    resolve: (value: any) => void
}
