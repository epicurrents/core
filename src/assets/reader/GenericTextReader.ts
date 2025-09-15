/**
 * Epicurrents text file reader. This class can be used inside a worker or the main thread.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import GenericDataProcessor from './GenericDataProcessor'
import type {
    ReadFileFromUrlOptions,
    TextDataReader,
    TypedNumberArrayConstructor,
    UrlAccessOptions,
} from '#types'

const SCOPE = 'GenericTextFileReader'

export default abstract class GenericTextReader extends GenericDataProcessor implements TextDataReader {
    protected _awaitData = null as null | {
        range: number[],
        resolve: () => void,
        timeout: unknown,
    }
    /** Should we continue the ongoing cache process. */
    protected _continue = false
    /** Number of bytes to load as a chunk. */
    protected _chunkLoadSize = 0
    /** Encoding label for TextDecoder. */
    protected _encodingLabel = 'utf-8'
    /** The file to load. Text files are usually small enough to fit into memory all at once. */
    protected _file = null as File | null
    /** Byte position of the next data chunk to load. */
    protected _filePos = 0
    /** Is the mutex fully setup and ready. */
    protected _isMutexReady = false
    /** Loading process start time (for debugging). */
    protected _startTime = 0
    /** File data url. */
    protected _url = ''

    constructor (dataEncoding: TypedNumberArrayConstructor) {
        // These values are only used if the file is set directly, not loaded from URL.
        super(dataEncoding)
        if (dataEncoding.BYTES_PER_ELEMENT === 2) {
            this._encodingLabel = 'utf-16'
        } else if (dataEncoding.BYTES_PER_ELEMENT === 4) {
            this._encodingLabel = 'utf-32'
        }
    }

    get file () {
        return this._file
    }
    set file (file: File | null) {
        this._file = file
    }

    get url () {
        return this._url
    }
    set url (url: string) {
        this._url = url
    }

    /**
     * Cancel an ongoing file loading process.
     */
    protected _cancelLoading () {
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        Log.info(`File loading canceled, managed to load ${this._filePos} bytes in ${loadTime} seconds.`, SCOPE)
        this._continue = false
        this._chunkLoadSize = 0
        this._file = null
        this._filePos = 0
    }
    /**
     * Check the encoding of the currently loaded file.
     */
    protected async _checkFileEncoding (fileStart?: ArrayBuffer) {
        const buffer = fileStart || await this._file?.arrayBuffer()
        if (!buffer) {
            Log.error(`No file has been set for checking encoding.`, SCOPE)
            return
        }
        // Detect the correct encoding by checking for byte order mark.
        const firstBytes = new Uint8Array(buffer.slice(0, 4))
        if (
            // UTF-16 big endian and little endian.
            (firstBytes[0] === 0xFE && firstBytes[1] === 0xFF) ||
            (firstBytes[0] === 0xFF && firstBytes[1] === 0xFE && firstBytes[2] !== 0x00)
        ) {
            if (this._encodingLabel !== 'utf-16') {
                Log.debug(`Changing file encoding to UTF-16.`, SCOPE)
            }
            this._encodingLabel = 'utf-16'
            this._dataEncoding = Uint16Array
        } else if (
            // UTF-32 big endian and little endian
            (firstBytes[0] === 0x00 && firstBytes[1] === 0x00 && firstBytes[2] === 0xFE && firstBytes[3] === 0xFF) ||
            (firstBytes[0] === 0xFF && firstBytes[1] === 0xFE && firstBytes[2] === 0x00 && firstBytes[3] === 0x00)
        ) {
            if (this._encodingLabel !== 'utf-32') {
                Log.debug(`Changing file encoding to UTF-32.`, SCOPE)
            }
            this._encodingLabel = 'utf-32'
            this._dataEncoding = Uint32Array
        } else {
            // No BOM, assume utf-8.
            if (this._encodingLabel !== 'utf-8') {
                Log.debug(`Setting encoding to default UTF-8.`, SCOPE)
            }
            this._encodingLabel = 'utf-8'
            this._dataEncoding = Uint8Array
        }
    }
    /**
     * Wrap up after file loading has finished.
     */
    protected _finishLoading () {
        // Log message
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        Log.debug(`File loading complete, ${this._filePos} bytes loaded in ${loadTime} seconds.`, SCOPE)
        this._chunkLoadSize = 0
        this._file = null
        this._filePos = 0
    }
    /**
     * Load the next part from the cached file. This method merely sets up the properties for loading the part, it does
     * not do any actual loading (that must be handled by the child class).
     * @returns True if part can be loaded, false if no data is available.
     */
    protected _loadNextPart () {
        if (!this._file) {
            Log.error(`No file has been set for loading.`, SCOPE)
            return false
        }
        const partEnd = this._file.size > this._filePos + this._chunkLoadSize
                      ? this._filePos + this._chunkLoadSize
                      : this._file.size
        if (partEnd <= this._filePos) {
            Log.error(`Requested file part has not been cached.`, SCOPE)
            return false
        } else {
            this._filePos = partEnd
            return true
        }
    }
    /**
     * Stop current loading process, but don't reset cached file data.
     * @remarks
     * This method doesn't seem to actually do anything?
     */
    protected _stopLoading () {
        const loadTime = ((Date.now() - this._startTime)/1000).toFixed(2)
        Log.info(`File loading stopped after loading ${this._filePos} bytes in ${loadTime} seconds.`, SCOPE)
        this._continue = false
    }

    async destroy () {
        this._file = null
        this._url = ''
        super.destroy()
    }

    async readFileFromUrl (url?: string, options?: ReadFileFromUrlOptions) {
        const source = url || this._url
        if (!source) {
            Log.error(`No URL has been set for loading.`, SCOPE)
            return false
        }
        const headers = new Headers()
        if (options?.authHeader) {
            headers.append("Authorization", options.authHeader)
        }
        const startTime = Date.now()
        // First fetch the file size using a HEAD request.
        headers.append('X-HTTP-Method-Override', 'HEAD')
        const headResponse = await fetch(source, { headers })
        let fileSize = parseInt(headResponse.headers.get('Content-Length') || '0', 10)
        if (isNaN(fileSize) || fileSize <= 0) {
            Log.warn(`Could not determine file size from URL '${source}', loading entire file.`, SCOPE)
            fileSize = 0
        }
        // Remove the override header for the actual GET requests.
        headers.delete('X-HTTP-Method-Override')
        if (fileSize < this._chunkLoadSize) {
            // File is smaller than chunk size, load it all at once.
            return await fetch(source, { headers })
                .then(response => response.blob())
                .then(async blobFile => {
                    this._file = new File([blobFile], "recording")
                    const timeTaken = ((Date.now() - startTime)/1000).toFixed(1)
                    Log.debug(
                        `File loaded from URL '${source}', size ${this._file.size} bytes, took ${timeTaken} s.`,
                        SCOPE
                    )
                    await this._checkFileEncoding()
                    return true
                }).catch((reason: Error) => {
                    Log.error(`Error loading file from URL '${source}':`, SCOPE, reason)
                    return false
                })
        } else {
            // File is larger than chunk size, must load in parts.
            let nextPos = options?.startFrom || 0
            const fileParts = [] as Blob[]
            while (this._cache && this._continue && nextPos < fileSize) {
                // Continue loading records, but don't hog the entire thread.
                const rangeEnd = Math.min(nextPos + this._chunkLoadSize - 1, fileSize - 1)
                headers.set('range', `bytes=${nextPos}-${rangeEnd}`)
                Log.debug(`Attempting to load part ${nextPos}-${rangeEnd} from URL.`, SCOPE)
                await fetch(source, { headers }).then(response => response.blob()).then(async blobPart => {
                    fileParts.push(blobPart)
                    nextPos = Math.min(nextPos + this._chunkLoadSize, fileSize)
                    let decoder
                    if (nextPos === options?.startFrom || 0) {
                        if (!nextPos) {
                            // Check encoding if we just loaded the start of the file.
                            await this._checkFileEncoding(await blobPart.arrayBuffer())
                        }
                        decoder = new TextDecoder(this._encodingLabel)
                    }
                    if (options?.callbackOnProgress && decoder) {
                        const filePart = await blobPart.arrayBuffer()
                        const content = decoder.decode(filePart)
                        options.callbackOnProgress(content, nextPos, fileSize)
                    }
                    Log.debug(
                        `Loaded part of file, ` +
                        `${nextPos} bytes (${(100*nextPos/fileSize).toFixed(1)}%) of ${fileSize} loaded.`,
                        SCOPE
                    )
                }).catch((reason: Error) => {
                    Log.error(`Error loading file part from URL '${source}':`, SCOPE, reason)
                    this._continue = false
                })
            }
            if (fileParts.length > 0) {
                this._file = new File(fileParts, "recording")
                const timeTaken = ((Date.now() - startTime)/1000).toFixed(1)
                Log.debug(
                    `File loaded from URL '${source}' in ${fileParts.length} parts, ` +
                    `total size ${this._file.size} bytes, ` +
                    `took ${timeTaken} s.`,
                    SCOPE
                )
                return true
            } else {
                Log.error(`Error loading file from URL '${source}': no data loaded.`, SCOPE)
                return false
            }
        }
    }

    async readPartFromFile (startFrom: number, dataLength: number, options?: UrlAccessOptions): Promise<string | null> {
        if (!this._file && !this._url) {
            Log.error(`No source available for reading part from file.`, SCOPE)
            return null
        }
        // Start reading from the specified offset; this must be the start of a character.
        if (startFrom % this._dataEncoding.BYTES_PER_ELEMENT !== 0) {
            Log.error(
                `Invalid startFrom offset for readPartFromFile; `+ 
                `${startFrom} is not divisible by character byte size ${this._dataEncoding.BYTES_PER_ELEMENT}.`,
                SCOPE
            )
            return null
        }
        // Make sure dataLength is a multiple of the character byte size.
        if (dataLength % this._dataEncoding.BYTES_PER_ELEMENT !== 0) {
            Log.warn(
                `dataLength of ${
                    dataLength
                } is not divisible by character byte size ${
                    this._dataEncoding.BYTES_PER_ELEMENT
                }; rounding down to nearest full character.`,
                SCOPE
            )
            dataLength -= dataLength % this._dataEncoding.BYTES_PER_ELEMENT
        }
        // Read from the cached file if available.
        if (this._file) {
            const decoder = new TextDecoder(this._encodingLabel)
            const text = decoder.decode(await this._file.slice(startFrom, startFrom + dataLength).arrayBuffer())
            return text
        }
        // Must read from URL.
        const headers = new Headers()
        headers.set('range', `bytes=${startFrom}-${startFrom + dataLength - 1}`)
        if (options?.authHeader) {
            headers.append("Authorization", options.authHeader)
        }
        return (await fetch(this._url, { headers })).text()
    }
}
