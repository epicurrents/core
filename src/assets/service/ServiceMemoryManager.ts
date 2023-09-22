/**
 * Loader memory managed.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type ManagedService, type MemoryManager } from "TYPES/assets"
import { type WorkerCommission, type WorkerMessage } from "TYPES/service"
import Log from "scoped-ts-log"
import SETTINGS from "CONFIG/Settings"
import { AssetService } from "TYPES/service"
import { GB_BYTES, NUMERIC_ERROR_VALUE } from "UTIL/constants"
import { nullPromise } from "UTIL/general"

const SCOPE = 'ServiceMemoryManager'

let totalBuf = 0
export default class ServiceMemoryManager implements MemoryManager {
    private static MASTER_LOCK_POS = 0
    private static BUFFER_START_POS = 1
    /**
     * The total memory buffer available to this application.
     */
    protected _buffer: SharedArrayBuffer
    protected _commissions = {
        'release-and-rearrange': null,
    } as {
        [action: string]: { rn: number, resolve: (value?: any) => any,  reject?: (reason: any) => void } | null
    }
    protected _decommissionWorker: {
        resolve: () => void,
        rn: number,
    } | null = null
    /**
     * The loaders managed by this memory managed.
     * The only reference to these manageds can only be through this
     * list, so they can be freed to GC by dereferencing.
     */
    protected _managed = new Map<string, ManagedService>()
    protected _masterLock: Int32Array
    protected _requestNum = 0
    /**
     * Worker assigned to execute atomic operations on the memory buffer.
     */
    protected _worker: Worker

    /**
     * Create an instance of ServiceMemoryManager with the given buffer size.
     * @param bufferSize - The total size of the buffer in bytes; from this on, sizes are always in 32-bit units.
     */
    constructor (bufferSize: number) {
        totalBuf += bufferSize + 4
        console.warn(bufferSize + 4, totalBuf/(GB_BYTES))
        this._buffer = new SharedArrayBuffer(bufferSize + 4)
        this._masterLock = new Int32Array(this._buffer).subarray(
            ServiceMemoryManager.MASTER_LOCK_POS,
            ServiceMemoryManager.BUFFER_START_POS
        )
        this._worker = new Worker(new URL(`./MemoryManagerWorker.ts`, import.meta.url))
        this._worker.addEventListener('message', this._handleMessage.bind(this))
        this._worker.postMessage({
            action: 'set-buffer',
            buffer: this._buffer,
        })
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

    get services () {
        const services = [] as AssetService[]
        for (const l of this._managed.values()) {
            services.push(l.service)
        }
        return services
    }

    get memoryUsed () {
        let totalUsed = 0
        for (const loader of this._managed.values()) {
            totalUsed += loader.service.memoryConsumption
        }
        return totalUsed/4
    }

    protected _commissionWorker (
        action: string,
        props?: Map<string, any>,
        callbacks?: { resolve: ((value?: any) => void), reject?: ((reason: string) => void) },
    ): WorkerCommission {
        if (!this._worker) {
            return {
                promise: nullPromise,
                requestNum: NUMERIC_ERROR_VALUE
            }
        }
        const commission = callbacks ? callbacks : {
            reject: (reason: string) => {},
            resolve: (value: unknown) => {},
        }
        // Use custom callbacks if they have been given.
        const returnPromise = new Promise<any>((resolve, reject) => {
            commission.resolve = resolve
            commission.reject = reject
        })
        const requestNum = this._requestNum++
        const msgData = {
            action: action,
            rn: requestNum
        } as WorkerMessage
        if (props) {
            for (const [key, value] of props)  {
                // Check for underscore in key.
                if (key.includes('__proto__')) {
                    Log.warn(
                        `Commission prop name ${key} contains insecure field '_proto__', property was ignored.`,
                        SCOPE)
                    continue
                }
                msgData[key] = value
            }
        }
        this._worker.postMessage(msgData)
        return {
            promise: returnPromise,
            requestNum: requestNum
        }
    }

    protected _handleMessage (message: any) {
        const action = message?.data?.action
        if (!action || action === 'set-buffer') {
            return
        }
        if (action === 'log') {
            Log.add(message.data.level, message.data.message, SCOPE)
            return
        }
        const commission = this._commissions[action]
        if (!commission) {
            Log.error(`Received a message from the worker, but no commission matched the action '${action}'.`, SCOPE)
            return
        }
        if (message.data.rn !== commission.rn) {
            Log.debug(`Ignoring a response from the worker with outdated request number '${message.data.rn}'.`, SCOPE)
            return
        }
        if (message.data.success) {
            commission.resolve(message.data.result)
        } else {
            if (commission.reject) {
                commission.reject(message.data.reason)
            } else {
                commission.resolve(null)
            }
        }
    }

    async allocate (amount: number, service: AssetService): Promise<{ start: number, end: number } | null> {
        // Correct amount to a 32-bit array size.
        amount = amount + (4 - amount%4)
        // Don't exceed maximum allowed buffer size.
        if (amount > SETTINGS.app.maxLoadCacheSize) {
            Log.error(`Tried to allocate an array that exceeds maximum allowed buffer size.`, SCOPE)
            return null
        }
        if (amount < 0) {
            Log.error(`Cannot allocate a buffer array with negative length.`, SCOPE)
            return null
        }
        // Zero means use the entire buffer.
        if (amount === 0) {
            amount = SETTINGS.app.maxLoadCacheSize - SETTINGS.app.maxLoadCacheSize%4
        }
        // Do not assign memory twice for the same service.
        for (const existing of this._managed) {
            if (existing[1].service.id === service.id) {
                Log.error(`The service passed to assign is already managed.`, SCOPE)
                return null
            }
        }
        // Check if we have memory to spare and try to free some if needed.
        let totalUsed = 0
        for (const managed of this._managed.values()) {
            totalUsed += managed.bufferRange[1] - managed.bufferRange[0]
        }
        const delta = Math.max(0, amount - (this.bufferSize - totalUsed))
        if (delta && !(await this.freeBy(delta))) {
            Log.warn(`Could not free the required amount of memory to assign to a new service.`, SCOPE)
            return null
        }
        // Find the end of the allocated buffer range from remaining manageds.
        let endIndex = 0
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

    async freeBy (amount: number, ignore: string[] = []): Promise<boolean> {
        if (this._managed.size < 2) {
            return false
        }
        // Sort the services from most to least recently used.
        const sorted = [...this._managed.values()]
        sorted.sort((a, b) => a.lastUsed - b.lastUsed)
        let totalFreed = 0
        const rangesFreed = [] as number[][]
        while (sorted.length > 1) {
            const nextToDrop = sorted.pop() as ManagedService
            if (!ignore.length || ignore.indexOf(nextToDrop.service.id)) {
                await nextToDrop.service.unload()
                rangesFreed.push(nextToDrop.bufferRange)
                this._managed.delete(nextToDrop.service.id)
                if (totalFreed >= amount) {
                    // Rearrange buffer and report success.
                    this.removeFromBuffer(...rangesFreed)
                    return true
                }
            }
        }
        // Rearrange buffer and report failure to free the requested space.
        if (rangesFreed.length) {
            this.removeFromBuffer(...rangesFreed)
        }
        return false
    }

    getService (id: string) {
        return (this._managed.get(id)?.service || null)
    }

    async release (service: string | AssetService): Promise<boolean> {
        if (typeof service === 'string') {
            const managed = this._managed.get(service)
            if (!managed) {
                Log.error(`Could not release asset; no service with given id was found.`, SCOPE)
                return false
            }
            await this.removeFromBuffer(managed.bufferRange)
        } else {
            const managed = this._managed.get(service.id)
            if (!managed) {
                Log.error(`Could not release loader; the given loader was not among managed loaders.`, SCOPE)
                return false
            }
            await this.removeFromBuffer(managed.bufferRange)
        }
        return true
    }

    async removeFromBuffer (...ranges: number[][]) {
        // Check for and remove possible empty or invalid ranges.
        for (let i=0; i<ranges.length; i++) {
            if (ranges[i][0] === ranges[i][1] || ranges[i][0] > ranges[i][1]) {
                ranges.splice(i, 1)
                i--
            }
        }
        // Find and remove any current loaders that use one of the ranges.
        for (const range of ranges) {
            for (const managed of this._managed.values()) {
                if (
                    (range[0] > managed.bufferRange[0] && range[0] < managed.bufferRange[1]) ||
                    (range[1] > managed.bufferRange[0] && range[1] < managed.bufferRange[1]) ||
                    (range[0] <= managed.bufferRange[0] && range[1] >= managed.bufferRange[1])
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
        // Commission worker to fill possible empty spaces by shifting following ranges down.
        const loaderRanges = [] as { id: string, range: number[] }[]
        for (const managed of this._managed.values()) {
            loaderRanges.push({
                id: managed.service.id,
                range: managed.bufferRange
            })
        }
        const commission = this._commissionWorker(
            'release-and-rearrange',
            new Map<string, any>([
                ['rearrange', loaderRanges],
                ['release', ranges],
            ])
        )
        const result = await commission.promise
        if (result?.success) {
            for (const rearranged of result.rearrange) {
                const managed = this._managed.get(rearranged.id)
                if (!managed) {
                    Log.error(
                        `Could not find the managed for a loader returned by worker release-and-rearrange.`,
                        SCOPE)
                    continue
                }
                managed.bufferRange = rearranged.range
                await managed.service.setBufferRange(rearranged.range)
                // TODO: Relay the new range to the loader as well.
            }
        }
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
