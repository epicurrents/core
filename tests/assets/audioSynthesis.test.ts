/**
 * Unit tests for the audio synthesis methods.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import DirectSynthesizer, { mintDirectBuffer, normalizeChannels } from '../../src/assets/media/synthesizers/direct'
import SpectralToneSynthesizer, {
    pickTopPeaks,
    spectralSpeedUp,
} from '../../src/assets/media/synthesizers/spectralTone'
import StethoscopeSynthesizer, {
    envelopeCurve,
    mapToBand,
    zeroCrossingFrequencyCurve,
} from '../../src/assets/media/synthesizers/stethoscope'
import { getSynthesizer, listSynthesizers, registerSynthesizer } from '../../src/assets/media/synthesizers/registry'
import { renderOffline } from '../../src/assets/media/synthesizers/renderOffline'
import { generateSineWave } from '../../src/util/signal'

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

/** Install a mock OfflineAudioContext that records the oscillator and gain nodes it creates. */
function mockOfflineContext (rendered: unknown) {
    const oscillators: any[] = []
    const gains: any[] = []
    const context = {
        destination: {},
        createOscillator: vi.fn(() => {
            const oscillator = {
                frequency: { value: 0, setValueCurveAtTime: vi.fn() },
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
            }
            oscillators.push(oscillator)
            return oscillator
        }),
        createGain: vi.fn(() => {
            const gain = { gain: { value: 1, setValueCurveAtTime: vi.fn() }, connect: vi.fn() }
            gains.push(gain)
            return gain
        }),
        startRendering: vi.fn().mockResolvedValue(rendered),
    }
    ;(globalThis as any).OfflineAudioContext = vi.fn(function () {
        return context
    })
    return { context, gains, oscillators }
}

describe('pickTopPeaks', () => {
    it('selects interior local maxima sorted by magnitude, limited to peakCount', () => {
        const magnitudes = [0, 1, 5, 1, 3, 1]
        const bins = [0, 1, 2, 3, 4, 5]
        expect(pickTopPeaks(magnitudes, bins, 2)).toEqual([
            { frequency: 2, magnitude: 5 },
            { frequency: 4, magnitude: 3 },
        ])
        expect(pickTopPeaks(magnitudes, bins, 1)).toEqual([{ frequency: 2, magnitude: 5 }])
    })

    it('skips the DC bin even when it is the largest', () => {
        const peaks = pickTopPeaks([10, 1, 2, 1], [0, 1, 2, 3], 5)
        expect(peaks).toEqual([{ frequency: 2, magnitude: 2 }])
    })

    it('falls back to the largest non-DC bin when there is no interior maximum', () => {
        const peaks = pickTopPeaks([0, 1, 2, 3], [0, 1, 2, 3], 5)
        expect(peaks).toEqual([{ frequency: 3, magnitude: 3 }])
    })
})

describe('spectralSpeedUp', () => {
    it('returns the explicit factor when given', () => {
        expect(spectralSpeedUp(10, 440, 50)).toBe(50)
    })

    it('derives the factor from target over dominant frequency', () => {
        expect(spectralSpeedUp(10, 440)).toBe(44)
    })

    it('returns 1 when the dominant frequency is zero', () => {
        expect(spectralSpeedUp(0, 440)).toBe(1)
    })
})

describe('spectral analysis end to end', () => {
    it('finds the dominant frequency of a generated sine via fftAnalysis + pickTopPeaks', async () => {
        const { fftAnalysis } = await import('../../src/util/signal')
        const signal = new Float32Array(generateSineWave(1000, 1, [10, 1]))
        const { frequencyBins, magnitudes } = fftAnalysis(signal, 1000)
        const [dominant] = pickTopPeaks(magnitudes, frequencyBins, 3)
        expect(dominant.frequency).toBeGreaterThan(8)
        expect(dominant.frequency).toBeLessThan(12)
    })
})

describe('envelopeCurve', () => {
    it('returns a curve normalised to [0, 1] against its peak', () => {
        const signal = new Float32Array([1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5])
        const curve = envelopeCurve(signal, 4, 1)
        expect(Array.from(curve)).toEqual([1, 0.5])
    })
})

describe('zeroCrossingFrequencyCurve', () => {
    it('estimates a sine wave frequency from its zero crossings', () => {
        const signal = new Float32Array(generateSineWave(1000, 1, [10, 1]))
        const curve = zeroCrossingFrequencyCurve(signal, 1000, 10)
        expect(curve.length).toBe(10)
        const mean = curve.reduce((sum, value) => sum + value, 0)/curve.length
        expect(Math.abs(mean - 10)).toBeLessThan(1)
    })

    it('reports zero frequency for silence', () => {
        const curve = zeroCrossingFrequencyCurve(new Float32Array(1000), 1000, 10)
        expect(Array.from(curve).every(value => value === 0)).toBe(true)
    })
})

describe('mapToBand', () => {
    it('maps the curve range onto the band', () => {
        const out = mapToBand(new Float32Array([0, 5, 10]), [100, 200])
        expect(Array.from(out)).toEqual([100, 150, 200])
    })

    it('maps a flat curve to the band midpoint', () => {
        const out = mapToBand(new Float32Array([5, 5]), [100, 200])
        expect(Array.from(out)).toEqual([150, 150])
    })
})

describe('SpectralToneSynthesizer', () => {
    afterEach(() => {
        delete (globalThis as any).OfflineAudioContext
    })

    it('renders the dominant peak onto the target frequency via additive oscillators', async () => {
        const rendered = {}
        const { context, oscillators } = mockOfflineContext(rendered)
        const signal = new Float32Array(generateSineWave(1000, 1, [10, 1]))
        const out = await new SpectralToneSynthesizer().synthesize([signal], 1000, {
            peakCount: 3,
            targetFundamentalHz: 440,
            durationSeconds: 1,
        })
        expect(oscillators.length).toBeGreaterThanOrEqual(1)
        expect(oscillators.length).toBeLessThanOrEqual(3)
        expect(oscillators[0].frequency.value).toBeCloseTo(440, 3)
        expect(context.startRendering).toHaveBeenCalled()
        expect(out).toBe(rendered)
    })
})

describe('StethoscopeSynthesizer', () => {
    afterEach(() => {
        delete (globalThis as any).OfflineAudioContext
    })

    it('automates carrier frequency and gain from the signal curves', async () => {
        const rendered = {}
        const { context, gains, oscillators } = mockOfflineContext(rendered)
        const signal = new Float32Array(generateSineWave(1000, 1, [10, 1]))
        const out = await new StethoscopeSynthesizer().synthesize([signal], 1000, {
            controlRateHz: 10,
            durationSeconds: 1,
        })
        expect(oscillators.length).toBe(1)
        expect(oscillators[0].frequency.setValueCurveAtTime).toHaveBeenCalled()
        expect(gains[0].gain.setValueCurveAtTime).toHaveBeenCalled()
        expect(gains[gains.length - 1].gain.value).toBe(0.8)
        expect(context.startRendering).toHaveBeenCalled()
        expect(out).toBe(rendered)
    })
})

describe('synthesizer registry', () => {
    it('resolves the three built-in methods to their synthesizers', () => {
        expect(getSynthesizer('direct')).toBeInstanceOf(DirectSynthesizer)
        expect(getSynthesizer('spectral-tone')).toBeInstanceOf(SpectralToneSynthesizer)
        expect(getSynthesizer('stethoscope')).toBeInstanceOf(StethoscopeSynthesizer)
    })

    it('returns undefined for an unknown method', () => {
        expect(getSynthesizer('does-not-exist')).toBeUndefined()
    })

    it('lists the built-in methods', () => {
        expect(listSynthesizers()).toEqual(expect.arrayContaining(['direct', 'spectral-tone', 'stethoscope']))
    })

    it('registers a custom synthesizer under a new key', () => {
        const custom = { synthesize: vi.fn() }
        registerSynthesizer('custom-test', custom)
        expect(getSynthesizer('custom-test')).toBe(custom)
    })
})
