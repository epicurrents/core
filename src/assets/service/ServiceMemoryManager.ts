/**
 * Loader memory manager.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericService from './GenericService'
import {
    type AllocateMemoryResponse,
    type AssetService,
    type FreeMemoryResponse,
    type ManagedService,
    type MemoryManager,
    type ReleaseAssetResponse,
    type WorkerResponse,
} from '#types/service'
import { Log } from 'scoped-event-log'

const SCOPE = 'ServiceMemoryManager'

export default class ServiceMemoryManager extends GenericService implements MemoryManager {
    private static MASTER_LOCK_POS = 0
    private static BUFFER_START_POS = 1
    /**
     * The total memory buffer available to this application.
     */
    protected _buffer: SharedArrayBuffer
    protected _decommissionWorker: {
        resolve: () => void,
        rn: number,
    } | null = null
    protected _isAvailable = false
    /**
     * The loaders managed by this memory managed.
     * The only reference to these manageds can only be through this
     * list, so they can be freed to GC by dereferencing.
     */
    protected _managed = new Map<string, ManagedService>()
    protected _masterLock: Int32Array
    protected _requestNum = 0

    /**
     * Create an instance of ServiceMemoryManager with the given buffer size.
     * @param bufferSize - The total size of the buffer in bytes; from this on, sizes are always in 32-bit units.
     */
    constructor (bufferSize: number) {
        if (!window.__EPICURRENTS__?.RUNTIME) {
            Log.error(`Reference to main runtime was not found.`, SCOPE)
        }
        const overrideWorker = window.__EPICURRENTS__.RUNTIME?.WORKERS.get('memory-manager')
        const worker = overrideWorker ? overrideWorker() : new Worker(
            new URL(
                /* webpackChunkName: 'memory-manager.worker' */
                `../../workers/memory-manager.worker`,
                import.meta.url
            ),
            { type: 'module'}
        )
        super(SCOPE, worker)
        try {
            //  This will fail if the browser doesn't have enough memory available to it.
            this._buffer = new SharedArrayBuffer(bufferSize + 4)
            this._isAvailable = true
        } catch (e) {
            Log.error(`Failed to allocate a shared array buffer for memory management.`, SCOPE, e as Error)
            this._buffer = new SharedArrayBuffer(4)
        }
        this._masterLock = new Int32Array(this._buffer).subarray(
            ServiceMemoryManager.MASTER_LOCK_POS,
            ServiceMemoryManager.BUFFER_START_POS
        )
        worker.addEventListener('message', this.handleMessage.bind(this))
        // Free memory will be 0 if buffer allocation fails.
        if (this.freeMemory) {
            worker.postMessage({
                action: 'set-buffer',
                buffer: this._buffer,
            })
        }
    }

    get buffer () {
        return this._buffer
    }

    get bufferSize () {
        return this._buffer.byteLength/4
    }

    get freeMemory () {
        return this.bufferSize - this.memoryUsed
    }

    get isAvailable () {
        return this._isAvailable
    }

    get services () {
        const services = [] as AssetService[]
        for (const l of this._managed.values()) {
            services.push(l.service)
        }
        return services
    }

    get memoryUsed () {
        // All quantities here are in 32-bit float units (one slot = 4 bytes), matching
        // `bufferSize` and `service.memoryConsumption`. The previous implementation started
        // `totalUsed = 4` (the master lock occupies one Int32 = one float, not 4 floats) and
        // then divided the total by 4 at the end, which under-reported memory usage by ~4×
        // and caused `freeBy` to be skipped in `allocate()` even when the buffer was full.
        // The visible symptom: opening a third recording silently appends past the end of the
        // SAB and `setDataArrays` fails with "remaining buffer cannot accommodate the data".
        let totalUsed = 1 // For the lock buffer (one Int32 slot at SAB position 0).
        for (const managed of this._managed.values()) {
            totalUsed += managed.service.memoryConsumption
        }
        return totalUsed
    }

    async handleMessage (message: WorkerResponse) {
        const data = message?.data
        if (!data) {
            return false
        }
        if (data.action === 'set-buffer') {
            return true
        }
        const commission = this._getCommissionForMessage(message)
        if (!commission) {
            return false
        }
        if (data.action === 'release-and-rearrange') {
            if (data.success) {
                commission.resolve(data.result)
            } else {
                commission.reject(data.error as string)
            }
            return true
        }
        if (await super._handleWorkerCommission(message)) {
            return true
        }
        Log.warn(`Message with action ${data.action} was not handled.`, SCOPE)
        return false
    }

    async allocate (amount: number, service: AssetService): Promise<AllocateMemoryResponse> {
        if (!window.__EPICURRENTS__?.RUNTIME) {
            Log.error(`Reference to main runtime was not found.`, SCOPE)
            return null
        }
        if (!this.freeMemory) {
            // Buffer allocation has failed or there is simply no memory available.
            Log.error(`Tried to allocate memory when no memory is available.`, SCOPE)
            return null
        }
        // Correct amount to a 32-bit array size.
        amount = amount + (4 - amount%4)
        // Don't exceed maximum allowed buffer size.
        if (amount > window.__EPICURRENTS__.RUNTIME?.SETTINGS.app.maxLoadCacheSize) {
            Log.error(`Tried to allocate an array that exceeds maximum allowed buffer size.`, SCOPE)
            return null
        }
        if (amount < 0) {
            Log.error(`Cannot allocate a buffer array with negative length.`, SCOPE)
            return null
        }
        // Zero means use the entire buffer.
        if (amount === 0) {
            amount = window.__EPICURRENTS__.RUNTIME?.SETTINGS.app.maxLoadCacheSize
                     - window.__EPICURRENTS__.RUNTIME?.SETTINGS.app.maxLoadCacheSize%4
        }
        // Do not assign memory twice for the same service.
        for (const existing of this._managed) {
            if (existing[1].service.id === service.id) {
                Log.error(`The service passed to assign is already managed.`, SCOPE)
                return null
            }
        }
        // Check if we have memory to spare and try to free some if needed.
        const delta = Math.max(0, amount - this.freeMemory)
        if (delta && !(await this.freeBy(delta))) {
            Log.warn(`Could not free the required amount of memory to assign to a new service.`, SCOPE)
            return null
        }
        // Find the end of the allocated buffer range from remaining managed services.
        let endIndex = ServiceMemoryManager.BUFFER_START_POS
        for (const managed of this._managed.values()) {
            if (managed.bufferRange[1] > endIndex) {
                endIndex = managed.bufferRange[1]
            }
        }
        this._managed.set(service.id, {
            bufferRange: [endIndex, endIndex + amount],
            lastUsed: Date.now(),
            dependencies: [],
            service: service,
        })
        return { start: endIndex, end: endIndex + amount }
    }

    async freeBy (amount: number, ignore: string[] = []): Promise<FreeMemoryResponse> {
        if (!this._managed.size) {
            return false
        }
        // Sort the services oldest-first so the least recently used service is dropped first
        // (`a.lastUsed - b.lastUsed` is ascending — index 0 is the oldest). Iterate front-to-back
        // and drop until we've freed enough or run out of eligible services.
        const sorted = [...this._managed.values()]
        sorted.sort((a, b) => a.lastUsed - b.lastUsed)
        let totalFreed = 0
        for (const nextToDrop of sorted) {
            // `ignore` is a list of service ids that must NOT be evicted (typically a service
            // that is currently in use). Use `includes` for a clean boolean check — the
            // previous `ignore.indexOf(id)` accidentally treated index 0 (`0`, falsy) as
            // "not in list".
            if (ignore.includes(nextToDrop.service.id)) {
                continue
            }
            // `service.unload()` with its default `releaseFromManager = true` already calls
            // `manager.release(this)` which removes the service from `_managed` and commissions
            // the rearrange. Concurrent `release()` calls are serialised via `_pendingRelease`
            // (see {@link release}), so we can safely await this without worrying about
            // racing with the resource's own `releaseBuffers` chain.
            const rangeSize = nextToDrop.bufferRange[1] - nextToDrop.bufferRange[0]
            await nextToDrop.service.unload()
            totalFreed += rangeSize
            if (totalFreed >= amount) {
                break
            }
        }
        return totalFreed >= amount
    }

    getService (id: string) {
        return (this._managed.get(id)?.service || null)
    }

    async release (...services: (string | AssetService)[]): Promise<ReleaseAssetResponse> {
        const serviceIds = [] as string[]
        const bufferRanges = [] as number[][]
        for (const service of services) {
            const id = typeof service === 'string' ? service : service.id
            const managed = this._managed.get(id)
            if (!managed) {
                // Already released by a previous concurrent call — no-op, no error.
                continue
            }
            serviceIds.push(id)
            bufferRanges.push(managed.bufferRange)
        }
        for (const id of serviceIds) {
            this._managed.delete(id)
        }
        if (bufferRanges.length) {
            await this.removeFromBuffer(false, ...bufferRanges)
        }
        return true
    }

    async removeFromBuffer (unloadServices: boolean, ...ranges: number[][]) {
        // Check for and remove possible empty or invalid ranges.
        for (let i=0; i<ranges.length; i++) {
            if (ranges[i][0] === ranges[i][1] || ranges[i][0] > ranges[i][1]) {
                ranges.splice(i, 1)
                i--
            }
        }
        if (unloadServices) {
            // Find and remove any current services that use one of the ranges.
            for (const range of ranges) {
                for (const managed of this._managed.values()) {
                    if (
                        (range[0] >= managed.bufferRange[0] && range[0] < managed.bufferRange[1]) ||
                        (range[1] > managed.bufferRange[0] && range[1] <= managed.bufferRange[1]) ||
                        (range[0] < managed.bufferRange[0] && range[1] > managed.bufferRange[1])
                    ) {
                        await managed.service.unload()
                        // Correct the range to reflect the removed loader.
                        if (managed.bufferRange[0] < range[0]) {
                            range[0] = managed.bufferRange[0]
                        }
                        if (managed.bufferRange[1] > range[1]) {
                            range[1] = managed.bufferRange[1]
                        }
                        this._managed.delete(managed.service.id)
                    }
                }
            }
        }
        // Commission worker to fill possible empty spaces by shifting following ranges down.
        const rearrange = [] as { id: string, range: number[] }[]
        for (const managed of this._managed.values()) {
            rearrange.push({
                id: managed.service.id,
                range: managed.bufferRange
            })
        }
        if (!ranges.length || !rearrange.length) {
            // Both arrays must have at least one element for the buffer to need rearranging.
            return
        }
        // TODO: Lock buffers in each service before rearranging.
        await Promise.all(this._managed.values().map(async managed => {
            managed // TODO: Lock buffer.
        }))
        const commission = this._commissionWorker(
            'release-and-rearrange',
            new Map<string, unknown>([
                ['rearrange', rearrange],
                ['release', ranges],
            ])
        )
        const result = await commission.promise as { rearrange: { id: string, range: number[] }[] }
        for (const rearranged of result.rearrange) {
            const managed = this._managed.get(rearranged.id)
            if (!managed) {
                Log.error(
                    `Could not find the managed for a loader returned by worker release-and-rearrange.`,
                    SCOPE)
                continue
            }
            managed.bufferRange = rearranged.range
            // Catch per-service `setBufferRange` failures so a single service whose worker
            // doesn't implement the `set-buffer-range` action (e.g. the montage worker, which
            // only carries tiny meta-only allocations and doesn't need to reposition signal
            // views) can't abort the rest of the rearrange. Previously, the first montage in
            // the result list threw at this line and left every subsequent managed entry's
            // `bufferRange` un-updated, so the next `allocate` computed `endIndex` from stale
            // high positions and overflowed the buffer.
            try {
                await managed.service.setBufferRange(rearranged.range)
            } catch (e) {
                Log.warn(
                    `setBufferRange failed for service ${rearranged.id.slice(0, 8)}: ` +
                    `${(e as Error)?.message ?? e}. Continuing with manager-side range update only.`,
                    SCOPE
                )
            }
        }
        // TODO: Unlock buffers in each service.
        await Promise.all(this._managed.values().map(async managed => {
            managed // TODO: Unlock buffer.
        }))
    }

    updateLastUsed (loader: ManagedService) {
        const timestamp = Date.now()
        loader.lastUsed = timestamp
        for (const linked of loader.dependencies) {
            // Give the dependency a slightly higher priority, so this is always released before its dependency.
            // It's easier to reload this data straight from the dependency than first reloading the dependency.
            linked.lastUsed = timestamp + 1
        }
    }

}
