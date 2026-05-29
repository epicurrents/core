/**
 * Epicurrents generic data processor. This class can be used inside a worker or the main thread.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    NUMERIC_ERROR_VALUE,
} from '#util'
import type {
    DataProcessorCache,
    SignalCacheMutex,
    SignalDataCache,
    TypedNumberArrayConstructor,
} from '#types'
import { type MutexExportProperties } from 'asymmetric-io-mutex'
import { Log } from 'scoped-event-log'

const SCOPE = 'SignalFileReader'

export default abstract class GenericDataProcessor implements DataProcessorCache {

    protected _dataEncoding: TypedNumberArrayConstructor
    /** A plain fallback data cache in case mutex is not usable. */
    protected _fallbackCache = null as SignalDataCache | null
    /** Data source mutex. */
    protected _mutex = null as SignalCacheMutex | null
    protected _sourceBuffer: ArrayBuffer | null = null
    protected _totalDataLength = 0

    constructor (dataEncoding: TypedNumberArrayConstructor) {
        this._dataEncoding = dataEncoding
    }

    protected get _cache (): SignalCacheMutex | SignalDataCache | null {
        if (this._mutex) {
            return this._mutex
        } else if (this._fallbackCache) {
            return this._fallbackCache
        }
        return null
    }

    get cacheReady () {
        return this._cache !== null
    }

    get dataEncoding () {
        return this._dataEncoding
    }

    get dataLength () {
        return this._totalDataLength
    }

    /**
     * Extend the given blob into a file-like object.
     * @param blob - Blob to extend.
     * @param name - Name of the file.
     * @param path - Path of the file, if applicable.
     * @returns Pseudo-file created from the blob.
     */
    protected _blobToFile (blob: Blob | File, name: string, path = ""): File {
        if (blob instanceof File || (blob as File).lastModified) {
            // If the blob is already a file, just return it.
            return blob as File
        }
        // Import properties expected of a file object.
        Object.assign(blob, {
            lastModified: Date.now(),
            name: name,
            webkitRelativePath: path,
        })
        return <File>blob
    }
    /**
     * Get current signal cache range.
     * @returns Range as `{ start: number, end: number }` measured in seconds or `NUMERIC_ERROR_VALUE` if an error occurred.
     */
    protected async _getSignalCacheRange () {
        if (!this._cache) {
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        const rangeStart = await this._cache.outputRangeStart
        const rangeEnd = await this._cache.outputRangeEnd
        if (rangeStart === null || rangeEnd === null) {
            Log.error(
                `Signal cache did not report a valid range: start (${rangeStart}) or end (${rangeEnd}).`,
            SCOPE)
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        return { start: rangeStart, end: rangeEnd }
    }

    async cacheFile (_file: File, _startFrom?: number): Promise<void> {
        Log.error(`cacheFile has not been overridden by child class.`, SCOPE)
    }

    async destroy () {
        await this.releaseCache()
        this._sourceBuffer = null
        Log.debug(`Data processor destroyed.`, SCOPE)
    }

    /**
     * Level 2: full cache teardown — performs Level 1 first, then drops the
     * mutex reference entirely. After this, `setupCache` must be re-run before
     * the cache can be used again.
     */
    async releaseCache () {
        await this.releaseSignalArrays()
        this._cache?.releaseBuffers()
        if (this._mutex) {
            this._mutex = null
        } else if (this._fallbackCache) {
            this._fallbackCache = null
        }
        Log.debug(`Data cache released.`, SCOPE)
    }

    /**
     * Level 1 of the three-level cache lifecycle: release the mutex's
     * signal-array views while preserving its layout (so the same mutex shell
     * can be cheaply rebound to a fresh buffer). Subclasses with in-flight
     * caching processes should override this to cancel them first; the base
     * implementation just delegates to the mutex.
     */
    async releaseSignalArrays () {
        // Only meaningful on the SAB path — a fallback cache is a plain JS
        // object with no buffer-views distinction between Level 1 and Level 2.
        if (this._mutex && typeof (this._mutex as { releaseSignalArrays?: () => void }).releaseSignalArrays === 'function') {
            (this._mutex as unknown as { releaseSignalArrays: () => void }).releaseSignalArrays()
        }
        Log.debug(`Signal arrays released.`, SCOPE)
    }

    setupCache (_bufferSize?: number): SignalDataCache | null {
        Log.error(`setupCache has not been overridden in the child class.`, SCOPE)
        return null
    }

    setupCacheWithInput (..._params: unknown[]): void {
        Log.error(`setupCacheWithInput must be overridden in the child class.`, SCOPE)
    }

    async setupMutex (
        _buffer: SharedArrayBuffer,
        _bufferStart: number,
        _bufferSize?: number
    ): Promise<MutexExportProperties|null> {
        Log.error(`setupMutex has not been overridden in the child class.`, SCOPE)
        return null
    }

    async setupMutexWithInput (..._params: unknown[]): Promise<MutexExportProperties|null> {
        Log.error(`setupMutexWithInput must be overridden in the child class.`, SCOPE)
        return null
    }

    async setupSharedWorkerWithInput (..._params: unknown[]): Promise<boolean> {
        Log.error(`setupSharedWorkerWithInput must be overridden in the child class.`, SCOPE)
        return false
    }
}
