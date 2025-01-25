/**
 * Service types.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type AsymmetricMutex, type MutexExportProperties } from 'asymmetric-io-mutex'
import { BaseAsset } from './application'
import { ReadDirection } from './reader'
import { SignalPart } from './biosignal'

export type ActionWatcher = {
    actions: string[]
    handler: (update: { action: string, [param: string]: unknown }) => unknown
    caller?: string
}
/**
 * Returned an object holding the byte index of allocated memory range `start` and `end` if allocation was successful,
 * and `null` otherwise.
 */
export type AllocateMemoryResponse = { start: number, end: number } | null
/**
 * Basic service type that all media and resource services should extend.
 */
export interface AssetService extends BaseAsset {
    /** Starting index of the reserved buffer range (-1 if no range is reserved). */
    bufferRangeStart: number
    /**
     * Returns a promise that resolves with the setup result or `undefined` if setup state cannot be determied.
     */
    initialSetup: Promise<unknown|undefined>
    /**
     * A loader may need various steps of initial setup before it is ready
     * to load its target asset. This property indicates if all the necessary
     * setup is complete and the loader ready to load the target asset.
     */
    isReady: boolean
    /** The amount of memory (in bytes) the asset in this loader consumes when fully loaded. */
    memoryConsumption: number
    /** Message port to the data cache, if using shared workers. */
    port: MessagePort | null
    /**
     * Add a watcher to the give `action`. The watcher will call the given `handler` each time
     * the action is performed.
     * @param action - Action to watch.
     * @param handler - Handler to call on action.
     * @param caller - Optional name of the caller (for bulk-removing all watchers).
     */
    addActionWatcher (action: string, handler: ActionWatcher['handler'], caller?: string): void
    /**
     * Await for the given action to complete and get the result.
     * @param action - Name of the action.
     * @returns Promise that resolves with the action result or undefined, if action is not underway.
     */
    awaitAction (action: string): Promise<unknown>
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
    requestMemory (amount: number): Promise<RequestMemoryResponse>
    /**
     * Set the byte range allocated to this service in the shared buffer.
     * @param range - Allocated byte range.
     * @returns Promise that fulfills when worker has acknowledged the change.
     */
    setBufferRange: (range: number[]) => Promise<void>
    /**
     * Set up the mutex in the web worker cache, returning the created mutex export properties or null if
     * an error occurred.
     */
    setupMutex (): Promise<MutexExportProperties|null>
    /**
     * Perform necessary setup in the worker handling commissions for this service.
     * @param params - Any parameters required for the setup.
     * @return Promise that resolves with the success of the setup operation.
     */
    setupWorker (...params: unknown[]): Promise<SetupWorkerResponse>
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
export type CommissionMap = Map<number, CommissionPromise>
/**
 * Commission promise properties.
 */
export type CommissionPromise = {
    /** Unique request number for this commission. */
    rn: number
    /** Callback for commission completion. */
    resolve: (value?: unknown) => unknown
    /** Callback for an unexpected error. */
    reject: (reason?: string) => void
}
/** Returned value is `true` if requested amount of memory was freed, `false` otherwise. */
export type FreeMemoryResponse = boolean
/**
 * A service that is managed by the application memory manager.
 */
export type ManagedService = {
    /**
     * The range of indices this loader occupies in the buffer.
     * @example
     * [start (included), end (excluded)]
     */
    bufferRange: number[]
    /**
     * Loaders that this loader depends on. When a loader is used, both
     * its and all of its dependencies' last used timestamps are updated.
     *
     * #### Example:
     * Loader-B is dependent on Loader-A as a data source. Loader-B will
     * have Loader-A as it's dependency, so its source will not be
     * removed from cache just because it hasn't been directly accessed.
     */
    dependencies: ManagedService[]
    /** Timestamp of the last time this loader was used. */
    lastUsed: number
    /** The actual service instance. */
    service: AssetService
}
/**
 * The memory manager is responsible for managing the master buffer and
 * allocating parts of it to loaders as needed. The most recently used
 * loaders are kept in the buffer and least recently used ones removed
 * if memory needs to be freed.
 *
 * Since the buffer is used to store typed 32-bit numbers, all memory values
 * are presented in 32-bit units (except for the initial size of the master
 * buffer given at the time of instance creation).
 */
export interface MemoryManager {
    /** The shared array buffer used as master buffer by this manager. */
    buffer: SharedArrayBuffer
    /** Size of the allocated buffer (in 32-bit units). */
    bufferSize: number
    /** The amount of memory (in 32-bit units) not yet allocated. */
    freeMemory: number
    /** Is the manager available for memory allocation. */
    isAvailable: boolean
    /**The amount of memory (in 32-bit units) allocated to services.*/
    memoryUsed: number
    /** All the services managed by this manager. */
    services: AssetService[]
    /**
     * Attempt to allocate the given `amount` to the given `loaders`.
     * Will try to free up space if not enough is available.
     * @param amount - Amount of memory to allocate (in 32-bit units).
     * @param service - The service to allocate the memory to.
     * @return An object holding the reserved range's start and end or null if unsuccessful.
     */
    allocate (amount: number, service: AssetService): Promise<AllocateMemoryResponse>
    /**
     * Free memory by given amount.
     * @param amount - Amount of memory to free (in 32-bit units).
     */
    freeBy (amount: number): void
    /**
     * Get the manged service with the given `id`.
     * @param id - ID of the service.
     * @return Matching service or null if not found.
     */
    getService (id: string): AssetService | null
    /**
     * Remove the given loader, releasing its memory in the process.
     * @param service - Either the service to remove or its id.
     */
    release (service: AssetService | string): void
    /**
     * Remove the given ranges from the manager's buffer.
     * @param ranges - Array of ranges to remove as [start, end].
     */
    removeFromBuffer (...ranges: number[][]): Promise<void>
    /**
     * Update the last used manager.
     * @param manager - New last used manager.
     */
    updateLastUsed (loader: ManagedService): void
}
/**
 * Commission types for a memory manager worker with the action name as key and property types as value.
 */
export type MemoryManagerWorkerCommission = {
    'release-and-rearrange': WorkerMessage['data'] & {
        rearrange: { id: string, range: number[] }[]
        release: number[][]
    }
    'set-buffer': WorkerMessage['data'] & {
        buffer: SharedArrayBuffer
    }
}
export type MemoryManagerWorkerCommissionAction = keyof MemoryManagerWorkerCommission
/**
 * Returned value is `true` if the message was handled by the service, and `false` otherwise.
 */
export type MessageHandled = boolean
/**
 * TODO: Expand the types related to pyodide interactions.
 */
export type PythonResponse = {
    result: unknown
    success: true
} | {
    error: string
    success: false
}
/**
 * Returned value is `true` if memory allocated to the asset was freed, `false` otherwise.
 */
export type ReleaseAssetResponse = boolean
/**
 * Returned value is `true`, if request was fulfilled, `false` otherwise.
 */
export type RequestMemoryResponse = boolean
/**
 * Response from the worker when study setup is complete.
 * Returned value is the total length of the study recording in seconds, or 0 on failure.
 */
export type SetupStudyResponse = number
/**
 * Response from the worker when initial worker setup is complete.
 * Returns a context-specific value, usually true on success, false on failure.
 */
export type SetupWorkerResponse = unknown
/**
 * A mutex responsible for caching signal data.
 */
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
     * Contains sampling rates for each of the input signals.
     */
    readonly inputSignalSamplingRates: Promise<number>[]
    /**
     * Get up-to-date input signal data.
     */
    readonly inputSignals: Promise<Float32Array[]>
    /**
     * Get the entire data arrays holding input signal properties and data.
     */
    readonly inputSignalViews: Promise<Float32Array[]| null>
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
    ): void | Promise<void>
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
    setSignalRange(rangeStart: number, rangeEnd: number): void
    /**
     * Replace the buffered signals with new signal arrays. Both the number of signals and
     * the length of individual signal arrays must match those of the existing signals.
     * @param signals New signals as Float32Arrays.
     * @returns Promise that resolves with the success of the operation (true/false).
     */
    writeSignals(signals: Float32Array[]): Promise<boolean>
}

/**
 * A single continuous part of signal data in the cache.
 */
export type SignalCachePart = {
    /** In seconds. */
    start: number
    /** In seconds. */
    end: number
    signals: (SignalPart & {
        originalSamplingRate?: number
        /** As array index. */
        start?: number
        /** As array index. */
        end?: number
    })[]
}

export type SignalCacheProcess = {
    /** Should we continue this loading process. */
    continue: boolean
    /** Load direction (1 forward, -1 backward, 0 alternate between following and preceding part). */
    direction: ReadDirection
    /** Start time of LOADED DATA in recording. */
    start: number
    /** End time of LOADED data in recording. */
    end: number
    /** Just for compatibility with SignalCachePart type, not supposed to contain anything. */
    signals: never[],
    /** Target start and end times of the loading process. */
    target: SignalCachePart
}

export type SignalCacheResponse = SignalCachePart | null
/**
 * Details of the commission given to the worker.
 */
export type WorkerCommission = {
    /** The Promise that will be fulfilled when the commission is complete. */
    promise: Promise<unknown>
    /** Unique number to identify this commission by. */
    rn: number
    /**
     * Method to call if the commission fails.
     * @param reason - Reason for the failure.
     */
    reject (reason?: string): void
    /**
     * Method to call if the commission succeeds.
     * @param value - The results of the commission.
     */
    resolve (value: unknown): void
}
/** Required data properties for a worker message. */
export type WorkerMessage = {
    data: {
        /** Name of the action to perform. */
        action: string
        /** Request number. */
        rn: number
        /** Possible other parameters. */
        [prop: string]: unknown
    }
}
/** A response to a worker message/commission. */
export type WorkerResponse = {
    data: {
        /** Name of the action that was performed. */
        action: string
        /** Request number. */
        rn: number
        /** Was the task successful or not. */
        success: boolean
        /** Possible reason for failure. */
        reason?: string
        /** Other returned parameters. */
        [prop: string]: unknown
    }
}
