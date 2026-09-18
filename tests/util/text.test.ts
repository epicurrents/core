/**
 * Unit tests for the text-handling utility functions.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import {
    detectTextEncoding,
    fetchTextFile,
    readTextPart,
    type TextEncodingInfo,
} from '../../src/util/text'

import { TextDecoder, TextEncoder } from 'util'
;(global as any).TextDecoder = TextDecoder
;(global as any).TextEncoder = TextEncoder

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

const UTF8_INFO: TextEncodingInfo = { label: 'utf-8', constructor: Uint8Array }
const UTF16_INFO: TextEncodingInfo = { label: 'utf-16le', constructor: Uint16Array }

describe('detectTextEncoding', () => {
    it('returns utf-8 when no BOM is present', () => {
        const buffer = new TextEncoder().encode('plain ascii').buffer
        const info = detectTextEncoding(buffer)
        expect(info.label).toBe('utf-8')
        expect(info.constructor).toBe(Uint8Array)
    })

    it('detects UTF-16 big-endian BOM', () => {
        // The endianness has to be in the label. Plain 'utf-16' means little-endian to TextDecoder,
        // so a big-endian source labelled that way decodes every character byte-swapped.
        const buffer = new Uint8Array([0xFE, 0xFF, 0x00, 0x41]).buffer
        const info = detectTextEncoding(buffer)
        expect(info.label).toBe('utf-16be')
        expect(info.constructor).toBe(Uint16Array)
        expect(new TextDecoder(info.label).decode(new Uint8Array([0x00, 0x41, 0x00, 0x42]))).toBe('AB')
    })

    it('detects UTF-16 little-endian BOM', () => {
        const buffer = new Uint8Array([0xFF, 0xFE, 0x41, 0x00]).buffer
        const info = detectTextEncoding(buffer)
        expect(info.label).toBe('utf-16le')
        expect(new TextDecoder(info.label).decode(new Uint8Array([0x41, 0x00, 0x42, 0x00]))).toBe('AB')
    })

    it('detects UTF-16 little-endian when the first character has a zero low byte', () => {
        // Only the UTF-32 mark continues with two zero bytes. Rejecting a single zero third byte
        // classified most of the non-Latin range as UTF-8.
        const buffer = new Uint8Array([0xFF, 0xFE, 0x00, 0x4E]).buffer
        expect(detectTextEncoding(buffer).label).toBe('utf-16le')
    })

    it('does NOT misclassify UTF-32 LE BOM as UTF-16', () => {
        // UTF-32 LE BOM is FF FE 00 00 — first two bytes match UTF-16 LE,
        // so the UTF-16 LE branch must require firstBytes[2] !== 0x00.
        const buffer = new Uint8Array([0xFF, 0xFE, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00]).buffer
        const info = detectTextEncoding(buffer)
        expect(info.label).toBe('utf-32')
        expect(info.constructor).toBe(Uint32Array)
    })

    it('detects UTF-32 big-endian BOM', () => {
        const buffer = new Uint8Array([0x00, 0x00, 0xFE, 0xFF]).buffer
        const info = detectTextEncoding(buffer)
        expect(info.label).toBe('utf-32')
    })
})

describe('readTextPart', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('returns null on empty source', async () => {
        const result = await readTextPart('', 0, 10, UTF8_INFO)
        expect(result).toBeNull()
        expect(Log.error).toHaveBeenCalled()
    })

    it('rejects an unaligned start offset for multi-byte encodings', async () => {
        const file = new File(['hello'], 'x.txt')
        const result = await readTextPart(file, 3, 10, UTF16_INFO)
        expect(result).toBeNull()
        expect(Log.error).toHaveBeenCalled()
    })

    it('rounds an unaligned length down and warns', async () => {
        const buffer = new TextEncoder().encode('he').buffer
        const slice = { arrayBuffer: vi.fn().mockResolvedValue(buffer) }
        const file = { slice: vi.fn().mockReturnValue(slice) } as unknown as File
        await readTextPart(file, 0, 5, UTF16_INFO)
        expect(Log.warn).toHaveBeenCalled()
        // Should have rounded 5 → 4 (4 % 2 === 0).
        expect((file.slice as any)).toHaveBeenCalledWith(0, 4)
    })

    it('decodes a slice from a cached File source', async () => {
        const encoded = new TextEncoder().encode('hello')
        const slice = { arrayBuffer: vi.fn().mockResolvedValue(encoded.buffer) }
        const file = { slice: vi.fn().mockReturnValue(slice) } as unknown as File
        const result = await readTextPart(file, 0, 5, UTF8_INFO)
        expect(result).toBe('hello')
    })

    it('issues a Range request against a URL source', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(new TextEncoder().encode('hello').buffer),
        })
        ;(global as any).fetch = fetchSpy
        const result = await readTextPart('https://example.com/data.csv', 0, 5, UTF8_INFO)
        expect(result).toBe('hello')
        const [, init] = fetchSpy.mock.calls[0]
        expect((init.headers as Headers).get('range')).toBe('bytes=0-4')
    })

    it('decodes a URL source with the detected encoding', async () => {
        // Response.text() decodes by the response's own charset and defaults to UTF-8, so the
        // encoding the caller detected was discarded and a UTF-16 source came back as mojibake
        // over HTTP while decoding correctly from a File.
        const utf16Bytes = new Uint8Array([0x68, 0x00, 0x65, 0x00, 0x6C, 0x00, 0x6C, 0x00, 0x6F, 0x00])
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(utf16Bytes.buffer),
            text: () => Promise.resolve('WRONG'),
        })
        ;(global as any).fetch = fetchSpy
        const result = await readTextPart('https://example.com/data.csv', 0, 10, UTF16_INFO)
        expect(result).toBe('hello')
    })

    it('returns null for an encoding the platform cannot decode', async () => {
        // No TextDecoder can be constructed for UTF-32, and constructing one threw out of a
        // function documented to return null on failure.
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        })
        ;(global as any).fetch = fetchSpy
        const utf32: TextEncodingInfo = { label: 'utf-32', constructor: Uint32Array }
        await expect(readTextPart('https://example.com/data.csv', 0, 8, utf32)).resolves.toBeNull()
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('forwards an auth header on URL reads', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        })
        ;(global as any).fetch = fetchSpy
        await readTextPart('https://x', 0, 4, UTF8_INFO, { authHeader: 'Bearer abc' })
        const [, init] = fetchSpy.mock.calls[0]
        expect((init.headers as Headers).get('Authorization')).toBe('Bearer abc')
    })
})

describe('fetchTextFile', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('returns null when given an empty URL', async () => {
        const result = await fetchTextFile('')
        expect(result).toBeNull()
        expect(Log.error).toHaveBeenCalled()
    })

    it('single-shot loads a small file and reports the detected encoding', async () => {
        const body = 'time,x,y,z\n0,1,2,3\n'
        const blob = new Blob([body], { type: 'text/csv' })
        ;(blob as any).arrayBuffer = () => Promise.resolve(new TextEncoder().encode(body).buffer)
        const fetchSpy = vi.fn().mockImplementation((_url: string, init: any) => {
            // First call (HEAD via override) sizes the file; second call returns the body.
            if ((init.headers as Headers).get('X-HTTP-Method-Override') === 'HEAD') {
                return Promise.resolve({ ok: true, headers: new Headers({ 'Content-Length': String(body.length) }) })
            }
            return Promise.resolve({ ok: true, blob: () => Promise.resolve(blob) })
        })
        ;(global as any).fetch = fetchSpy
        const result = await fetchTextFile('https://example.com/x.csv')
        expect(result).not.toBeNull()
        expect(result!.encoding.label).toBe('utf-8')
        expect(result!.file).toBeInstanceOf(File)
    })
})
