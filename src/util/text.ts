/**
 * Text-file utilities shared by readers that consume textual sources (CSV, JSON,
 * tab-separated, log files, etc.). These were originally collected on the
 * `GenericTextReader` abstract class; since no consumer ever extended that class
 * the utilities are exposed as free functions instead — encoding detection and
 * character-boundary-respecting Range reads are useful without a class wrapper.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import type { UrlAccessOptions } from '#types/config'
import type { ReadTextFromUrlOptions } from '#types/reader'
import type { TypedNumberArrayConstructor } from '#types/util'

const SCOPE = 'util/text'

/**
 * The character-byte-size encodings the BOM sniffer recognises.
 */
export type TextEncodingLabel = 'utf-8' | 'utf-16' | 'utf-32'

/**
 * Result of {@link detectTextEncoding}: the encoding label suitable for
 * `new TextDecoder(label)` and the typed-array constructor whose
 * `BYTES_PER_ELEMENT` matches one character.
 */
export type TextEncodingInfo = {
    constructor: TypedNumberArrayConstructor
    label: TextEncodingLabel
}

/**
 * Sniff the text encoding of a buffer from its first 4 bytes. Recognises UTF-16
 * (BE/LE) and UTF-32 (BE/LE) byte-order marks; falls back to UTF-8 when no BOM
 * is present (which also handles ASCII).
 *
 * Pure function — call once on the head of a buffer before constructing the
 * `TextDecoder` for chunked reads.
 */
export function detectTextEncoding (buffer: ArrayBuffer): TextEncodingInfo {
    const firstBytes = new Uint8Array(buffer.slice(0, 4))
    if (
        // UTF-16 big endian and little endian.
        (firstBytes[0] === 0xFE && firstBytes[1] === 0xFF) ||
        (firstBytes[0] === 0xFF && firstBytes[1] === 0xFE && firstBytes[2] !== 0x00)
    ) {
        return { label: 'utf-16', constructor: Uint16Array }
    }
    if (
        // UTF-32 big endian and little endian.
        (firstBytes[0] === 0x00 && firstBytes[1] === 0x00 && firstBytes[2] === 0xFE && firstBytes[3] === 0xFF) ||
        (firstBytes[0] === 0xFF && firstBytes[1] === 0xFE && firstBytes[2] === 0x00 && firstBytes[3] === 0x00)
    ) {
        return { label: 'utf-32', constructor: Uint32Array }
    }
    return { label: 'utf-8', constructor: Uint8Array }
}

/**
 * Fetch a text file from a URL into an in-memory `File`. Uses a HEAD request to
 * size the file, then either fetches the whole thing in one shot (when smaller
 * than `options.chunkSize`) or pages through it with HTTP `Range:` requests.
 *
 * Encoding is detected from the BOM in the first chunk; the caller can then
 * decode the returned `File` with the matching `TextDecoder`. The detected
 * encoding is returned alongside the file so the caller doesn't have to sniff
 * it again.
 *
 * Auth header is forwarded when provided. The returned `File` is unnamed
 * (`"recording"`) because the URL is the source of truth for identification.
 */
export async function fetchTextFile (
    url: string,
    options?: ReadTextFromUrlOptions,
): Promise<{ file: File, encoding: TextEncodingInfo } | null> {
    if (!url) {
        Log.error(`No URL provided to fetchTextFile.`, SCOPE)
        return null
    }
    const headers = new Headers()
    if (options?.authHeader) {
        headers.append('Authorization', options.authHeader)
    }
    const startTime = Date.now()
    // First fetch the file size using a HEAD request.
    headers.append('X-HTTP-Method-Override', 'HEAD')
    const headResponse = await fetch(url, { headers })
    let fileSize = parseInt(headResponse.headers.get('Content-Length') || '0', 10)
    if (isNaN(fileSize) || fileSize <= 0) {
        Log.warn(`Could not determine file size from URL '${url}', loading entire file.`, SCOPE)
        fileSize = 0
    }
    headers.delete('X-HTTP-Method-Override')
    const chunkSize = options?.chunkSize ?? 0
    if (chunkSize === 0 || fileSize === 0 || fileSize < chunkSize) {
        // Single-shot load — file is small, chunkSize wasn't requested, or HEAD
        // didn't return a usable Content-Length.
        try {
            const response = await fetch(url, { headers })
            const blob = await response.blob()
            const file = new File([blob], 'recording')
            const head = await file.slice(0, Math.min(file.size, 4)).arrayBuffer()
            const encoding = detectTextEncoding(head)
            const timeTaken = ((Date.now() - startTime)/1000).toFixed(1)
            Log.debug(
                `Text file loaded from URL '${url}', size ${file.size} bytes, took ${timeTaken} s.`,
                SCOPE,
            )
            return { file, encoding }
        } catch (e) {
            Log.error(`Error loading text file from URL '${url}':`, SCOPE, e as Error)
            return null
        }
    }
    // Chunked load — page through with Range requests so very large files don't
    // hog memory in one big blob fetch.
    let nextPos = options?.startFrom || 0
    const fileParts: Blob[] = []
    let encoding: TextEncodingInfo | null = null
    let decoder: TextDecoder | null = null
    while (nextPos < fileSize) {
        const rangeEnd = Math.min(nextPos + chunkSize - 1, fileSize - 1)
        headers.set('range', `bytes=${nextPos}-${rangeEnd}`)
        Log.debug(`Loading text range ${nextPos}-${rangeEnd} from URL.`, SCOPE)
        try {
            const response = await fetch(url, { headers })
            const blob = await response.blob()
            fileParts.push(blob)
            if (!encoding) {
                // First chunk includes the BOM; sniff it before constructing
                // the decoder for progress callbacks.
                encoding = detectTextEncoding(await blob.arrayBuffer())
                decoder = new TextDecoder(encoding.label)
            }
            nextPos = Math.min(nextPos + chunkSize, fileSize)
            if (options?.callbackOnProgress && decoder) {
                const partBuffer = await blob.arrayBuffer()
                options.callbackOnProgress(decoder.decode(partBuffer), nextPos, fileSize)
            }
        } catch (e) {
            Log.error(`Error loading text part from URL '${url}':`, SCOPE, e as Error)
            // Abort with whatever we got rather than returning partial garbage.
            return null
        }
    }
    if (!fileParts.length) {
        Log.error(`Error loading text file from URL '${url}': no data loaded.`, SCOPE)
        return null
    }
    const file = new File(fileParts, 'recording')
    const finalEncoding = encoding ?? detectTextEncoding(await file.slice(0, 4).arrayBuffer())
    const timeTaken = ((Date.now() - startTime)/1000).toFixed(1)
    Log.debug(
        `Text file loaded from URL '${url}' in ${fileParts.length} parts, ` +
        `total size ${file.size} bytes, took ${timeTaken} s.`,
        SCOPE,
    )
    return { file, encoding: finalEncoding }
}

/**
 * Read a slice of a text source. The `source` is either a `File` (cached
 * locally — fastest path, no network) or a URL string (issues an HTTP `Range:`
 * request against the source).
 *
 * `start` and `length` are validated against the encoding's character byte size
 * — the slice would be malformed if either fell mid-character. When `length`
 * doesn't align, the function rounds it down to the nearest full character and
 * warns; an unaligned `start` is a hard error and returns `null`.
 *
 * `options.authHeader` is forwarded on URL reads.
 */
export async function readTextPart (
    source: File | string,
    start: number,
    length: number,
    encoding: TextEncodingInfo,
    options?: UrlAccessOptions,
): Promise<string | null> {
    if (!source) {
        Log.error(`No source provided to readTextPart.`, SCOPE)
        return null
    }
    const charSize = encoding.constructor.BYTES_PER_ELEMENT
    if (start % charSize !== 0) {
        Log.error(
            `Invalid start offset for readTextPart; ` +
            `${start} is not divisible by character byte size ${charSize}.`,
            SCOPE,
        )
        return null
    }
    if (length % charSize !== 0) {
        Log.warn(
            `Length of ${length} is not divisible by character byte size ${charSize}; ` +
            `rounding down to nearest full character.`,
            SCOPE,
        )
        length -= length % charSize
    }
    const decoder = new TextDecoder(encoding.label)
    if (typeof source === 'string') {
        const headers = new Headers()
        headers.set('range', `bytes=${start}-${start + length - 1}`)
        if (options?.authHeader) {
            headers.append('Authorization', options.authHeader)
        }
        try {
            return await (await fetch(source, { headers })).text()
        } catch (e) {
            Log.error(`Error reading text part from URL '${source}':`, SCOPE, e as Error)
            return null
        }
    }
    return decoder.decode(await source.slice(start, start + length).arrayBuffer())
}
