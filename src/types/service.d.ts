/**
 * Service types.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type AsymmetricMutex, type MutexExportProperties } from "asymmetric-io-mutex"
import { BaseAsset } from "./assets"
import { LoadDirection } from "./loader"

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
    success?: boolean
    /** Any other props returned by the worker. */

    /** Callback for commission completion. */
    resolve: (value?: unknown) => unknown
    /** Possible callback for an unexpected error. */
    reject?: (reason: string) => void
}
export type PythonResponse = {
    result: any
    success: true
} | {
    error: any
    success: false
}

export interface SignalCacheMutex extends AsymmetricMutex {
    /**
     * The input signals allocated range.
     */
    readonly inputRangeAllocated: Promise<number | null>
    /**
     * The input signals range end.
     */
    readonly inputRangeEnd: Promise<number | null>
    /**
     * The input signals range start.
     */
    readonly inputRangeStart: Promise<number | null>
    /**
     * The output signals allocated range.
     */
    readonly outputRangeAllocated: Promise<number | null>
    /**
     * The output signals range end.
     */
    readonly outputRangeEnd: Promise<number | null>
    /**
     * The output signals range start.
     */
    readonly outputRangeStart: Promise<number | null>
    /**
     * Properties of the input signals.
     */
    readonly inputSignalProperties: Promise<{ [field: string]: number }[] | null>
    /**
     * Get up-to-date input signal data.
     */
    readonly inputSignals: Promise<Float32Array[]>
    /**
     * Get the entire data arrays holding input signal properties and data.
     */
    readonly inputSignalViews: Promise<Float32Array[]| null>
    /**
     * The raw buffers holding the output signals.
     */
    readonly outputSignalArrays: SharedArrayBuffer
    /**
     * Properties of the output signals.
     */
    readonly outputSignalProperties: Promise<{ [field: string]: number }[] | null>
    /**
     * Contains up-to-date output signal data.
     */
    readonly outputSignals: Promise<Float32Array[]>
    /**
     * Contains sampling rates for each of the output signals.
     */
    readonly outputSignalSamplingRates: Promise<number>[]
    /**
     * Contains the updated ranges for each of the output signals.
     */
    readonly outputSignalUpdatedRanges: Promise<{ start: number, end: number }>[]
    /**
     * Entire data arrays holding output signal properties and data.
     */
    readonly outputSingalViews: Promise<Float32Array[] | null>
    /**
     * Properties of this mutex needed to be used as input for another mutex.
     */
    readonly propertiesForCoupling: MutexExportProperties
    /**
     * Get the output signal properties and cached signal data formatted as
     * a SignalCachePart object.
     * @returns SignalCachePart object, where
     *          - start is the buffer range start (in seconds)
     *          - end is the buffer range end (in seconds)
     *          - signals[i].start is the updated signal data start index
     *          - signals[i].end is the updated signal data end index
     */
    asCachePart(): Promise<SignalCachePart>
    /**
     * Clear the cached signals, setting all data values to zero.
     * @remarks
     * Public methods can only access the output signals.
     */
    clearSignals(): void
    /**
     * Initialize the signal buffers. Possible signal data contained in the SignalCachePart is ignored
     * here and must be passed again with insertSignals to be saved.
     * @param cacheProps - an object containing the signal cache properties.
     * @param dataLength - length of the signal data in seconds.
     * @param buffer - Data buffer.
     * @param bufferStart - 32-bit starting index of this mutex withing the buffer (optional, defaults to zero).
     */
    initSignalBuffers(
        cacheProps: SignalCachePart,
        dataLength: number,
        buffer: SharedArrayBuffer,
        bufferStart?: number
    ): void
    /**
     * Insert new signal data to the existing buffer.
     * This will overwrite possible overlapping signal data.
     * @param signalPart - Cache part with new signals to insert.
     */
    insertSignals(signalPart: SignalCachePart): Promise<void>
    /**
     * Invalidate all output signals by setting the updated ranges to 0-0.
     * @param channels - Array of channels to invalidate (default all).
     */
    invalidateOutputSignals(channels?: number[]): Promise<void>
    /**
     * Get the buffered signals as Float32Arrays.
     * @return Promise containing the signals.
     */
    readSignals(): Promise<Float32Array[]>
    /**
     * Set buffered signal range start and end. Possible already buffered signals will
     * be adjusted into the new range.
     *
     * If there is pre-existing data in the buffer, this method must be called before
     * assigning new signals!
     *
     * @param rangeStart - Start of the buffered singal range (in seconds).
     * @param rangeEnd - End of the buffered singal range (in seconds).
     */
    setSignalRange(rangeStart: number, rangeEnd: number): any;
    /**
     * Replace the buffered signals with new signal arrays. Both the number of signals and
     * the length of individual signal arrays must match those of the existing signals.
     * @param signals New signals as Float32Arrays.
     * @returns success of the operation as true/false
     */
    writeSignals(signals: Float32Array[]): {};
}

/**
 * A single continuous part of signal data in the cache.
 */
export type SignalCachePart = {
    /** In seconds. */
    start: number
    /** In seconds. */
    end: number
    signals: {
        data: Float32Array
        samplingRate: number
        originalSamplingRate?: number
        /** As array index. */
        start?: number
        /** As array index. */
        end?: number
    }[]
}

export type SignalCacheProcess = {
    /** Should we continue this loading process. */
    continue: boolean
    /** Load direction (1 forward, -1 backward, 0 alternate between following and preceding part). */
    direction: LoadDirection
    /** Start time of LOADED DATA in recording. */
    start: number
    /** End time of LOADED data in recording. */
    end: number
    /** Just for compatibility with SignalCachePart type, not supposed to contain anything. */
    signals: any[],
    /** Target start and end times of the loading process. */
    target: SignalCachePart
}

export type SignalCacheResponse = SignalCachePart | null
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
export type WorkerMessage = {
    action: string
    rn: number
    [prop: string]: any
}
export type WorkerResponse = {
    promise: Promise<any>
    rn: number
    reject: (reason: string) => void
    resolve: (value: any) => void
}
