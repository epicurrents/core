/**
 * Unit tests for the audio synthesis methods.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import DirectSynthesizer, { mintDirectBuffer, normalizeChannels } from '../../src/assets/media/synthesizers/direct'
import { renderOffline } from '../../src/assets/media/synthesizers/renderOffline'

/** Minimal stand-in for the Web Audio `AudioBuffer`, which jsdom does not provide. */
class MockAudioBuffer {
    numberOfChannels: number
    length: number
    sampleRate: number
    protected _channels: Float32Array[]
    constructor (opts: { numberOfChannels: number, length: number, sampleRate: number }) {
        this.numberOfChannels = opts.numberOfChannels
        this.length = opts.length
        this.sampleRate = opts.sampleRate
        this._channels = Array.from({ length: opts.numberOfChannels }, () => new Float32Array(opts.length))
    }
    get duration () {
        return this.length/this.sampleRate
    }
    getChannelData (index: number) {
        return this._channels[index]
    }
}

describe('normalizeChannels', () => {
    it('normalises against sampleMaxAbsValue and clips to [-1, 1]', () => {
        const channel = new Float32Array([0, 16384, -65536, 32768])
        const [out] = normalizeChannels([channel], 4, 32768)
        expect(Array.from(out)).toEqual([0, 0.5, -1, 1])
    })

    it('leaves data unscaled (but clipped) when sampleMaxAbsValue is falsy', () => {
        const channel = new Float32Array([0, 0.5, -0.5, 2])
        const [out] = normalizeChannels([channel], 4, 0)
        expect(Array.from(out)).toEqual([0, 0.5, -0.5, 1])
    })

    it('resamples by nearest-neighbour pick when output is shorter than input', () => {
        const channel = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7])
        // dsFactor 2 -> source indices 0, 2, 4, 6; values clipped to [-1, 1].
        const [out] = normalizeChannels([channel], 4, 0)
        expect(Array.from(out)).toEqual([0, 1, 1, 1])
    })

    it('normalises each channel independently', () => {
        const a = new Float32Array([1, 2])
        const b = new Float32Array([-1, -2])
        const out = normalizeChannels([a, b], 2, 2)
        expect(Array.from(out[0])).toEqual([0.5, 1])
        expect(Array.from(out[1])).toEqual([-0.5, -1])
    })
})

describe('mintDirectBuffer', () => {
    beforeEach(() => {
        ;(globalThis as any).AudioBuffer = MockAudioBuffer
    })
    afterEach(() => {
        delete (globalThis as any).AudioBuffer
    })

    it('creates a buffer of the expected shape with normalised data', () => {
        const channel = new Float32Array([0, 50, -100, 100])
        const buffer = mintDirectBuffer([channel], 4, { sampleMaxAbsValue: 100, durationSeconds: 1 })
        expect(buffer.numberOfChannels).toBe(1)
        expect(buffer.length).toBe(4)
        expect(buffer.sampleRate).toBe(4)
        expect(Array.from(buffer.getChannelData(0))).toEqual([0, 0.5, -1, 1])
    })

    it('derives the sample count from signal length when durationSeconds is omitted', () => {
        const channel = new Float32Array(8)
        const buffer = mintDirectBuffer([channel], 8, { sampleMaxAbsValue: 1 })
        expect(buffer.length).toBe(8)
    })
})

describe('DirectSynthesizer', () => {
    beforeEach(() => {
        ;(globalThis as any).AudioBuffer = MockAudioBuffer
    })
    afterEach(() => {
        delete (globalThis as any).AudioBuffer
        delete (globalThis as any).OfflineAudioContext
    })

    it('returns the dry normalised buffer when no EQ is given', async () => {
        const synth = new DirectSynthesizer()
        const buffer = await synth.synthesize([new Float32Array([0, 100])], 2, { sampleMaxAbsValue: 100 })
        expect(buffer.length).toBe(2)
        expect(Array.from(buffer.getChannelData(0))).toEqual([0, 1])
        expect((globalThis as any).OfflineAudioContext).toBeUndefined()
    })

    it('routes through an offline render when EQ bands are given', async () => {
        const rendered = new MockAudioBuffer({ numberOfChannels: 1, length: 2, sampleRate: 2 })
        const startRendering = vi.fn().mockResolvedValue(rendered)
        const filter = { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: vi.fn() }
        const createBiquadFilter = vi.fn(() => filter)
        const source = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() }
        ;(globalThis as any).OfflineAudioContext = vi.fn(function () {
            return {
                destination: {},
                createBufferSource: () => source,
                createBiquadFilter,
                startRendering,
            }
        })
        const synth = new DirectSynthesizer()
        const out = await synth.synthesize([new Float32Array([0, 100])], 2, {
            sampleMaxAbsValue: 100,
            eq: [{ type: 'highpass', frequency: 100 }],
        })
        expect(createBiquadFilter).toHaveBeenCalledTimes(1)
        expect(filter.type).toBe('highpass')
        expect(filter.frequency.value).toBe(100)
        expect(startRendering).toHaveBeenCalled()
        expect(out).toBe(rendered)
    })
})

describe('renderOffline', () => {
    afterEach(() => {
        delete (globalThis as any).OfflineAudioContext
    })

    it('builds a source from the given buffer and renders to the destination', async () => {
        const source = new MockAudioBuffer({ numberOfChannels: 2, length: 4, sampleRate: 8 })
        const rendered = new MockAudioBuffer({ numberOfChannels: 2, length: 4, sampleRate: 8 })
        const node = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() }
        const destination = {}
        const ctor = vi.fn(function () {
            return {
                destination,
                createBufferSource: () => node,
                startRendering: vi.fn().mockResolvedValue(rendered),
            }
        })
        ;(globalThis as any).OfflineAudioContext = ctor
        const out = await renderOffline(source as unknown as AudioBuffer)
        expect(ctor).toHaveBeenCalledWith(2, 4, 8)
        expect(node.buffer).toBe(source)
        expect(node.connect).toHaveBeenCalledWith(destination)
        expect(node.start).toHaveBeenCalled()
        expect(out).toBe(rendered)
    })
})
