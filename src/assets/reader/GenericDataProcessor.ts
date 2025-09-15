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

    async releaseCache () {
        this._cache?.releaseBuffers()
        if (this._mutex) {
            this._mutex = null
        } else if (this._fallbackCache) {
            this._fallbackCache = null
        }
        Log.debug(`Data cache released.`, SCOPE)
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
