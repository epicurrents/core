import {
    calculateSignalOffsets,
    combineAllSignalParts,
    combineSignalParts,
    concatTypedNumberArrays,
    fftAnalysis,
    filterSignal,
    floatsAreEqual,
    generateSineWave,
    getChannelFilters,
    interpolateSignalValues,
    resampleSignal,
    shouldDisplayChannel,
    shouldFilterSignal,
} from '../../src/util/signal'
import { BiosignalChannelMarker, BiosignalChannelProperties, type BiosignalChannel, type BiosignalFilters } from '../../src/types/biosignal'
import { CommonBiosignalSettings } from '../../src/types/config'

const baseChannel: BiosignalChannel = {
    name: 'test',
    modality: 'eeg',
    visible: true,
    samplingRate: 250,
    amplification: 0,
    averaged: false,
    displayPolarity: 0,
    filters: {
        highpass: null,
        lowpass: null,
        notch: null,
        bandreject: []
    },
    highpassFilter: null,
    label: '',
    laterality: '',
    lowpassFilter: null,
    markers: [],
    notchFilter: null,
    offset: {
        baseline: 0,
        bottom: 0,
        top: 0
    },
    sampleCount: 0,
    sensitivity: 0,
    signal: new Float32Array(),
    unit: '',
    addMarkers: function (..._markers: BiosignalChannelMarker[]): void {
        throw new Error('Function not implemented.')
    },
    setHighpassFilter: function (_value: number | null): void {
        throw new Error('Function not implemented.')
    },
    setLowpassFilter: function (_value: number | null): void {
        throw new Error('Function not implemented.')
    },
    setNotchFilter: function (_value: number | null): void {
        throw new Error('Function not implemented.')
    },
    setSignal: function (_signal: Float32Array): void {
        throw new Error('Function not implemented.')
    },
}

const baseSettings: CommonBiosignalSettings = {
    filterChannelTypes: {
        eeg: ['highpass', 'lowpass', 'notch'],
        ecg: ['lowpass']
    },
    annotations: {
        convertPatterns: [],
        ignorePatterns: []
    },
    defaultMontages: {},
    defaultSetups: [],
    filterPaddingSeconds: 0,
    filters: {
        highpass: {
            availableValues: [],
            default: 0
        },
        lowpass: {
            availableValues: [],
            default: 0
        },
        notch: {
            availableValues: [],
            default: 0
        }
    },
    montages: {
        cacheMax: 0,
        preCache: false
    },
    showHiddenChannels: false,
    showMissingChannels: false
}

describe('Signal utilities', () => {
    describe('combineSignalParts', () => {
        it('should combine consecutive signal parts', () => {
            const partA = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const combined = combineSignalParts(partA, partB)
            expect(combined).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(partA.signals[0].data.length).toBe(10)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        })

        it('should handle overlapping signal parts', () => {
            const partA = {
                start: 0,
                end: 7,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5, 6, 7]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([11, 12, 13, 14, 15]),
                    samplingRate: 1
                }]
            }
            const combined = combineSignalParts(partA, partB)
            expect(combined).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(partA.signals[0].data.length).toBe(10)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 4, 5, 11, 12, 13, 14, 15])
        })

        it('should insert contained signal parts', () => {
            const partA = {
                start: 0,
                end: 10,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 3,
                end: 6,
                signals: [{
                    data: new Float32Array([11, 12, 13]),
                    samplingRate: 1
                }]
            }
            const combined = combineSignalParts(partA, partB)
            expect(combined).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(partA.signals[0].data.length).toBe(10)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 11, 12, 13, 7, 8, 9, 10])
        })

        it('should replacewith overflowing signal part', () => {
            const partA = {
                start: 3,
                end: 6,
                signals: [{
                    data: new Float32Array([11, 12, 13]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 0,
                end: 10,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const combined = combineSignalParts(partA, partB)
            expect(combined).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(partA.signals[0].data.length).toBe(10)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        })

        it('should not combine parts with different sampling rates in data mode', () => {
            const partA = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 2
                }]
            }
            const combined = combineSignalParts(partA, partB)
            expect(combined).toBe(false)
            expect(partA.signals[0].data.length).toBe(5)
        })

        it('should invalidate signals with different sampling rates in shape mode', () => {
            const partA = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 2
                }]
            }
            const combined = combineSignalParts(partA, partB, 'shape')
            expect(combined).toBe(true)
            expect(partA.signals[0].data.length).toBe(0)
        })
    })

    describe('calculateSignalOffsets', () => {
        it('should calculate offsets in raw mode with no config', () => {
            const channels = [
                { ...baseChannel, visible: true },
                { ...baseChannel, visible: true },
                { ...baseChannel, visible: true }
            ]
            calculateSignalOffsets(channels)
            expect(channels[0].offset).toEqual({
                baseline: 0.75,
                bottom: 0.625,
                top: 0.875
            })
            expect(channels[1].offset).toEqual({
                baseline: 0.5,
                bottom: 0.375,
                top: 0.625
            })
            expect(channels[2].offset).toEqual({
                baseline: 0.25,
                bottom: 0.125,
                top: 0.375
            })
        })

        it('should handle empty channels array', () => {
            const channels: BiosignalChannelProperties[] = []
            calculateSignalOffsets(channels)
            expect(channels).toEqual([])
        })

        it('should handle single channel', () => {
            const channels = [{ ...baseChannel, visible: true }]
            calculateSignalOffsets(channels)
            expect(channels[0].offset).toEqual({
                baseline: 0.5,
                bottom: 0,
                top: 1
            })
        })

        it('should respect channel groups with custom spacing', () => {
            const channels = [
                { ...baseChannel, visible: true },
                { ...baseChannel, visible: true },
                { ...baseChannel, visible: true },
                { ...baseChannel, visible: true }
            ]
            // Equal spacing of all elements.
            calculateSignalOffsets(channels, {
                channelSpacing: 1,
                groupSpacing: 1,
                isRaw: false,
                layout: [2, 2],
                yPadding: 1
            })
            // First group.
            expect(channels[0].offset.baseline).toBeCloseTo(0.8, 4)
            expect(channels[1].offset.baseline).toBeCloseTo(0.6, 4)
            // Second group.
            expect(channels[2].offset.baseline).toBeCloseTo(0.4, 4)
            expect(channels[3].offset.baseline).toBeCloseTo(0.2, 4)
            channels.splice(2)
            // Larger group spacing.
            calculateSignalOffsets(channels, {
                channelSpacing: 1,
                groupSpacing: 2,
                isRaw: false,
                layout: [1, 1],
                yPadding: 1
            })
            expect(channels[0].offset.baseline).toBeCloseTo(0.75, 4)
            expect(channels[1].offset.baseline).toBeCloseTo(0.25, 4)
        })

        it('should handle channels with metadata', () => {
            const channels = [
                { ...baseChannel, visible: true, modality: 'eeg' },
                { ...baseChannel, visible: true, modality: 'meta' },
                { ...baseChannel, visible: true, modality: 'eeg' }
            ]
            calculateSignalOffsets(channels)
            expect(channels[0].offset.baseline).toBeCloseTo(0.666667, 3)
            expect(channels[1].offset.baseline).toStrictEqual(0) // Metadata channel is omitted.
            expect(channels[2].offset.baseline).toBeCloseTo(0.333333, 3)
        })

        it('should respect custom y-padding', () => {
            const channels = [
                { ...baseChannel, visible: true },
                { ...baseChannel, visible: true }
            ]
            calculateSignalOffsets(channels, {
                channelSpacing: 1,
                groupSpacing: 1,
                isRaw: false,
                layout: [2],
                yPadding: 2
            })
            // Distance from vieport top/bottom should be twice the distance between channels.
            expect(channels[0].offset.baseline).toBeCloseTo(0.6, 4)
            expect(channels[1].offset.baseline).toBeCloseTo(0.4, 4)
        })
    })

    describe('combineAllSignalParts', () => {
        it('should return empty array for no parts', () => {
            const result = combineAllSignalParts()
            expect(result).toEqual([])
        })

        it('should return single part unchanged', () => {
            const part = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const result = combineAllSignalParts(part)
            expect(result).toEqual([part])
        })

        it('should combine multiple consecutive parts', () => {
            const part1 = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const part2 = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const part3 = {
                start: 10,
                end: 15,
                signals: [{
                    data: new Float32Array([11, 12, 13, 14, 15]),
                    samplingRate: 1
                }]
            }
            const result = combineAllSignalParts(part1, part2, part3)
            expect(result.length).toBe(1)
            expect(result[0].start).toBe(0)
            expect(result[0].end).toBe(15)
            expect(Array.from(result[0].signals[0].data)).toEqual([
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
            ])
        })

        it('should handle overlapping parts', () => {
            const part1 = {
                start: 0,
                end: 7,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5, 6, 7]),
                    samplingRate: 1
                }]
            }
            const part2 = {
                start: 5,
                end: 12,
                signals: [{
                    data: new Float32Array([11, 12, 13, 14, 15, 16, 17]),
                    samplingRate: 1
                }]
            }
            const part3 = {
                start: 10,
                end: 15,
                signals: [{
                    data: new Float32Array([21, 22, 23, 24, 25]),
                    samplingRate: 1
                }]
            }
            const result = combineAllSignalParts(part1, part2, part3)
            expect(result.length).toBe(1)
            expect(result[0].start).toBe(0)
            expect(result[0].end).toBe(15)
        })

        it('should keep non-consecutive parts separate', () => {
            const part1 = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const part2 = {
                start: 10,
                end: 15,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const result = combineAllSignalParts(part1, part2)
            expect(result.length).toBe(2)
            expect(result[0].start).toBe(0)
            expect(result[0].end).toBe(5)
            expect(result[1].start).toBe(10)
            expect(result[1].end).toBe(15)
        })

        it('should handle parts with different sampling rates', () => {
            const part1 = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const part2 = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 2
                }]
            }
            const result = combineAllSignalParts(part1, part2)
            expect(result.length).toBe(1)
            expect(result[0].signals[0].data.length).toBe(0)
        })
    })

    describe('combineSignalParts', () => {
        it('should combine consecutive signal parts', () => {
            const partA = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const result = combineSignalParts(partA, partB)
            expect(result).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        })

        it('should handle overlapping signal parts', () => {
            const partA = {
                start: 0,
                end: 7,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5, 6, 7]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([8, 9, 10, 11, 12]),
                    samplingRate: 1
                }]
            }
            const result = combineSignalParts(partA, partB)
            expect(result).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 4, 5, 8, 9, 10, 11, 12])
        })

        it('should handle contained signal parts', () => {
            const partA = {
                start: 0,
                end: 10,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 3,
                end: 6,
                signals: [{
                    data: new Float32Array([11, 12, 13]),
                    samplingRate: 1
                }]
            }
            const result = combineSignalParts(partA, partB)
            expect(result).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 11, 12, 13, 7, 8, 9, 10])
        })

        it('should handle overflowing signal parts', () => {
            const partA = {
                start: 3,
                end: 6,
                signals: [{
                    data: new Float32Array([11, 12, 13]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 0,
                end: 10,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const result = combineSignalParts(partA, partB)
            expect(result).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        })

        it('should reject parts with different sampling rates', () => {
            const partA = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 2
                }]
            }
            const result = combineSignalParts(partA, partB)
            expect(result).toBe(false)
            expect(partA.signals[0].data.length).toBe(5)
        })

        it('should handle empty signals', () => {
            const partA = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 5,
                end: 10,
                signals: [{
                    data: new Float32Array([6, 7, 8, 9, 10]),
                    samplingRate: 1
                }]
            }
            // In data mode.
            const data = combineSignalParts(partA, partB)
            expect(data).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(partA.signals[0].data.length).toBe(5)
            // In shape mode.
            partA.start = 0
            partA.end = 5
            partA.signals[0].data = new Float32Array([])
            const shape = combineSignalParts(partA, partB, 'shape')
            expect(shape).toBe(true)
            expect(partA.start).toBe(0)
            expect(partA.end).toBe(10)
            expect(partA.signals[0].data.length).toBe(0)
        })

        it('should return false for non-consecutive parts', () => {
            const partA = {
                start: 0,
                end: 5,
                signals: [{
                    data: new Float32Array([1, 2, 3, 4, 5]),
                    samplingRate: 1
                }]
            }
            const partB = {
                start: 7,
                end: 10,
                signals: [{
                    data: new Float32Array([8, 9, 10]),
                    samplingRate: 1
                }]
            }
            const result = combineSignalParts(partA, partB)
            expect(result).toBe(false)
            expect(Array.from(partA.signals[0].data)).toEqual([1, 2, 3, 4, 5])
        })
    })

    describe('concatTypedNumberArrays', () => {
        it('should concatenate Float32Arrays correctly', () => {
            const arr1 = new Float32Array([1, 2, 3])
            const arr2 = new Float32Array([4, 5, 6])
            const arr3 = new Float32Array([7, 8, 9])
            const result = concatTypedNumberArrays(arr1, arr2, arr3)
            expect(result).toBeInstanceOf(Float32Array)
            expect(result.length).toBe(9)
            expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
        })

        it('should handle empty arrays', () => {
            const arr1 = new Float32Array([])
            const arr2 = new Float32Array([1, 2, 3])
            const result = concatTypedNumberArrays(arr1, arr2)
            expect(result.length).toBe(3)
            expect(Array.from(result)).toEqual([1, 2, 3])
        })

        it('should handle single array', () => {
            const arr = new Float32Array([1, 2, 3])
            const result = concatTypedNumberArrays(arr)
            expect(result).toBe(arr)
        })
    })

    describe('fftAnalysis', () => {
        it('should handle empty signal', () => {
            const result = fftAnalysis(new Float32Array([]), 250)
            expect(result.frequencyBins).toEqual([])
            expect(result.magnitudes).toEqual([])
            expect(result.phases).toEqual([])
            expect(result.psds).toEqual([])
            expect(result.resolution).toBe(0)
        })

        it('should handle zero sampling rate', () => {
            const signal = new Float32Array([1, 2, 3, 4, 5])
            const result = fftAnalysis(signal, 0)
            expect(result.frequencyBins).toEqual([])
            expect(result.magnitudes).toEqual([])
            expect(result.phases).toEqual([])
            expect(result.psds).toEqual([])
            expect(result.resolution).toBe(0)
        })

        it('should correctly analyze a simple sine wave', () => {
            const frequency = 10 // 10 Hz.
            const samplingRate = 1000 // 1000 Hz.
            const duration = 1 // 1 second.
            const signal = new Float32Array(generateSineWave(samplingRate, duration, [frequency, 1]))
            const result = fftAnalysis(signal, samplingRate)
            // Find peak frequency.
            const peakIndex = result.magnitudes.indexOf(Math.max(...result.magnitudes))
            const peakFrequency = result.frequencyBins[peakIndex]
            // Check if peak frequency matches input frequency.
            expect(Math.round(peakFrequency)).toBe(frequency)
            // Check if resolution is correct (samplingRate/radix).
            expect(result.resolution).toBeCloseTo(samplingRate/2048, 2) // 2048 is next power of 2 after 2*samplingRate.
            // Check if frequency bins go up to Nyquist frequency (samplingRate/2).
            expect(Math.max(...result.frequencyBins)).toBeLessThanOrEqual(samplingRate/2)
        })

        it('should correctly analyze multiple frequency components', () => {
            const samplingRate = 1000
            const duration = 1
            // Create signal with 10 Hz and 20 Hz components.
            const signal1 = new Float32Array(generateSineWave(samplingRate, duration, [10, 1]))
            const signal2 = new Float32Array(generateSineWave(samplingRate, duration, [20, 0.5]))
            // Combine signals.
            const combinedSignal = new Float32Array(signal1.map((val, idx) => val + signal2[idx]))
            const result = fftAnalysis(combinedSignal, samplingRate)
            // Find highest peaks.
            const sortedMagnitudes = [...result.magnitudes].sort((a, b) => b - a)
            const peakIndices = sortedMagnitudes.slice(0, 5).map(m => result.magnitudes.indexOf(m))
            const peakFrequencies = peakIndices.map(i => Math.round(result.frequencyBins[i]))
            // Check if peaks are at 10 Hz and 20 Hz.
            expect(peakFrequencies).toContain(10)
            expect(peakFrequencies).toContain(20)
            // Check if 20 Hz component has roughly half the magnitude of the 10 Hz component.
            const peak10Amp = sortedMagnitudes[peakFrequencies.indexOf(10)]
            const peak20Amp = sortedMagnitudes[peakFrequencies.indexOf(20)]
            expect(peak20Amp/peak10Amp).toBeCloseTo(0.5, 1)
        })

        it('should output correct array lengths', () => {
            const samplingRate = 1000
            const signal = new Float32Array(generateSineWave(samplingRate, 1, [10, 1]))
            const result = fftAnalysis(signal, samplingRate)
            // All output arrays should have the same length.
            const length = result.frequencyBins.length
            expect(result.magnitudes.length).toBe(length)
            expect(result.phases.length).toBe(length)
            expect(result.psds.length).toBe(length)
            // Length should be power of 2 divided by 2 (up to Nyquist frequency).
            expect(length).toBe(1024) // 2048/2.
        })

        it('should calculate correct PSD values', () => {
            const samplingRate = 1000
            const signal = new Float32Array(generateSineWave(samplingRate, 1, [10, 1]))
            const result = fftAnalysis(signal, samplingRate)
            // Check if PSDs are calculated correctly.
            result.psds.forEach((psd, i) => {
                expect(psd).toBeCloseTo((result.magnitudes[i] ** 2) / (2*result.magnitudes.length))
            })
        })

        it('should handle short signals', () => {
            const samplingRate = 1000
            const shortSignal = new Float32Array(generateSineWave(samplingRate, 0.1, [10, 1]))
            const result = fftAnalysis(shortSignal, samplingRate)
            // Should still produce valid output
            expect(result.frequencyBins.length).toBeGreaterThan(0)
            expect(result.magnitudes.length).toBeGreaterThan(0)
            expect(Math.max(...result.frequencyBins)).toBeLessThanOrEqual(samplingRate/2)
        })
    })

    describe('filterSignal', () => {
        // Test fixtures
        const sampleRate = 1000
        const duration = 1
        const t = Array.from({length: sampleRate * duration}, (_, i) => i / sampleRate)
        beforeEach(() => {
            // Reset any test state if needed
        })

        it('should handle basic lowpass filtering', () => {
            const signal = new Float32Array(t.map(t => (
                Math.sin(2 * Math.PI * 10 * t) + // 10 Hz component.
                0.5 * Math.sin(2 * Math.PI * 100 * t) // 100 Hz noise.
            )))
            const lp = 1
            const filtered = filterSignal(signal, sampleRate, lp, 0, 0)
            expect(filtered.length).toBe(signal.length)
            // Verify high frequency attenuation.
            const maxAmplitude = Math.max(...filtered.map(Math.abs))
            expect(maxAmplitude).toBeLessThan(1.75)
        })

        it('should handle basic highpass filtering', () => {
            const signal = new Float32Array(t.map(t => (
                Math.sin(2 * Math.PI * 10 * t) + // 10 Hz component.
                0.5 * Math.sin(2 * Math.PI * 100 * t) // 100 Hz noise.
            )))
            const hp = 500
            const filtered = filterSignal(signal, sampleRate, 0, hp, 0)
            expect(filtered.length).toBe(signal.length)
            // Verify high frequency attenuation.
            const maxAmplitude = Math.max(...filtered.map(Math.abs))
            expect(maxAmplitude).toBeLessThan(1.5)
        })

        it('should handle basic band-reject filtering', () => {
            const duration = 5
            const combinedSignal = new Float32Array(
                generateSineWave(sampleRate, duration, [8, 0.5], [20, 1], [32, 0.5])
            )
            // Find highest peaks.
            const filtered = filterSignal(combinedSignal, 1000, 0, 0, 20)
            const fft = fftAnalysis(filtered.slice(1000, 4000), sampleRate)
            const fftMagnitudes = [...fft.magnitudes].sort((a, b) => b - a)
            const fftPeaks = fftMagnitudes.slice(0, 5).map(m => fft.magnitudes.indexOf(m))
            const fftFrequencies = fftPeaks.map(i => fft.frequencyBins[i].toFixed(1))
            expect(fftFrequencies).not.toContain('20.0')
        })

        it('should preserve signal length', () => {
            const signal = new Float32Array(t.map(t => Math.sin(2 * Math.PI * 10 * t)))
            const b = 0.5
            const a = 1
            const filtered = filterSignal(signal, b, a, 0, 0)
            expect(filtered.length).toBe(signal.length)
        })

        it('should handle empty signal', () => {
            const emptySignal = new Float32Array([])
            const b = 1
            const a = 1
            const filtered = filterSignal(emptySignal, b, a, 0, 0)
            expect(filtered.length).toEqual(0)
        })

        it('should return the original signal when using invalid coefficients', () => {
            const signal = new Float32Array([1, 2, 3])
            expect(filterSignal(signal, 0, 1, 2, 3)).toEqual(signal)
            expect(filterSignal(signal, 5, 2, 1, 0)).toEqual(signal)
        })

        it('should preserve DC component', () => {
            const dc = 2.5
            const signal = new Float32Array(t.map(() => dc))
            const b = 0.2
            const a = 1
            const filtered = filterSignal(signal, b, a, 0, 0)
            const mean = filtered.reduce((sum, val) => sum + val, 0) / filtered.length
            expect(mean).toBeCloseTo(dc, 2)
        })

        it('should handle impulse response correctly', () => {
            const impulse = new Float32Array([1.0, ...new Array(99).fill(0)])
            const b = 1
            const a = 1
            const filtered = filterSignal(impulse, b, a, 0, 0)
            expect(filtered[0]).toBe(1.0)
            expect(filtered.slice(1).every(x => Math.abs(x) < 1e-10)).toBe(true)
        })
    })

    describe('floatsAreEqual', () => {
        it('should correctly compare equal floats', () => {
            expect(floatsAreEqual(1.0, 1.0)).toBe(true)
            expect(floatsAreEqual(0.1 + 0.2, 0.3)).toBe(true)
            expect(floatsAreEqual(1_000_000.1 + 0.2, 1_000_000.3)).toBe(true)
            expect(floatsAreEqual(1e-10, 1e-10)).toBe(true)
        })

        it('should handle different precisions', () => {
            expect(floatsAreEqual(1.23456789, 1.23456789, 32)).toBe(true)
            expect(floatsAreEqual(1.23456789, 1.23456788, 16)).toBe(true)
            expect(floatsAreEqual(1.23456789, 1.23456788, 64)).toBe(false)
        })

        it('should handle zero and null cases', () => {
            expect(floatsAreEqual(0, 0)).toBe(true)
            expect(floatsAreEqual(0, -0)).toBe(true)
            expect(floatsAreEqual(null as any, null as any)).toBe(true)
        })
    })

    describe('generateSineWave', () => {
        it('should generate a basic sine wave with expected length and amplitude', () => {
            const frequency = 1 // 1 Hz.
            const amplitude = 1
            const samplingRate = 100 // 100 Hz.
            const duration = 1 // 1 second.
            const result = generateSineWave(samplingRate, duration, [frequency, amplitude])
            expect(result.length).toBe(100) // samplingRate * duration.
            expect(Math.max(...result)).toBeCloseTo(amplitude, 4)
            expect(Math.min(...result)).toBeCloseTo(-amplitude, 4)
        })

        it('should generate zero signal with zero amplitude', () => {
            const result = generateSineWave(100, 1, [1, 0])
            expect(result.every(value => value === 0)).toBe(true)
        })

        it('should generate DC signal with zero frequency', () => {
            const amplitude = 1
            const result = generateSineWave(100, 1, [0, amplitude])
            expect(result.every(value => value === 0)).toBe(true)
        })

        it('should respect sampling rate changes', () => {
            const wave1 = generateSineWave(100, 1, [1, 1])
            const wave2 = generateSineWave(200, 1, [1, 1])
            expect(wave1.length).toBe(100)
            expect(wave2.length).toBe(200)
        })

        it('should respect duration changes', () => {
            const wave1 = generateSineWave(100, 1, [1, 1])
            const wave2 = generateSineWave(100, 2, [1, 1])
            expect(wave1.length).toBe(100)
            expect(wave2.length).toBe(200)
        })

        it('should generate correct frequency', () => {
            const frequency = 2 // 2 Hz.
            const samplingRate = 1000 // 1000 Hz.
            const duration = 1 // 1 second.
            const result = generateSineWave(samplingRate, duration, [frequency, 1])
            // For a sine wave, number of zero crossings in a direction should match the frequency.
            // For the negative to positive direction the signal starts from and ends with the crossing, so we will
            // use the positive to negative direction for the count.
            let zeroCrossings = 0
            for (let i=1; i<result.length; i++) {
                if (result[i-1] > 0 && result[i] <= 0) {
                    zeroCrossings++
                }
            }
            expect(zeroCrossings).toBe(frequency)
        })
    })

    describe('getChannelFilters', () => {
        const defaultFilters: BiosignalFilters = {
            bandreject: [],
            highpass: 1,
            lowpass: 70,
            notch: 50
        }

        it('should apply correct filters based on channel type', () => {
            const eegChannel: BiosignalChannel = {
                ...baseChannel,
                name: 'EEG1',
                modality: 'eeg',
            }
            const ecgChannel: BiosignalChannel = {
                ...baseChannel,
                name: 'ECG',
                modality: 'ecg',
            }
            const eegFilters = getChannelFilters(eegChannel, defaultFilters, baseSettings)
            const ecgFilters = getChannelFilters(ecgChannel, defaultFilters, baseSettings)
            expect(eegFilters).toEqual(defaultFilters)
            expect(ecgFilters).toEqual({
                bandreject: [],
                highpass: 0,
                lowpass: 70,
                notch: 0
            })
        })

        it('should prioritize channel-specific filters', () => {
            const channelWithCustomFilters: BiosignalChannel = {
                ...baseChannel,
                name: 'EEG1',
                modality: 'eeg',
                samplingRate: 250,
                highpassFilter: 0.5,
                lowpassFilter: 100,
                notchFilter: 60
            }
            const filters = getChannelFilters(channelWithCustomFilters, defaultFilters, baseSettings)
            expect(filters).toEqual({
                bandreject: [],
                highpass: 0.5,
                lowpass: 100,
                notch: 60
            })
        })
    })

    describe('interpolateSignalValues', () => {
        it('should handle empty signal', () => {
            const result = interpolateSignalValues(new Float32Array(), 0, 0, 1, 1)
            expect(result.length).toEqual(0)
        })

        it('should handle single value signal', () => {
            const result = interpolateSignalValues(new Float32Array([1]), 2, 0, 1, 2)
            expect(Array.from(result)).toEqual([1, 1])
        })

        it('should interpolate linearly between two points', () => {
            const result = interpolateSignalValues(new Float32Array([1, 3, 1]), 4, 0, 2, 4)
            expect(Array.from(result)).toEqual([1, 2, 3, 2])
        })

        it('should interpolate with different step sizes', () => {
            const result = interpolateSignalValues(new Float32Array([1, 3, 1]), 5, 0, 2, 8)
            expect(Array.from(result)).toEqual([1, 1.5, 2, 2.5, 3])
        })

        it('should interpolate non-uniformly spaced data', () => {
            const result = interpolateSignalValues(new Float32Array([1, 4, 9, 4]), 5, 0, 2, 4)
            expect(Array.from(result)).toEqual([1, 2.5, 4, 6.5, 9])
        })

        it('should handle negative values', () => {
            const result = interpolateSignalValues(new Float32Array([-1, -3, -1]), 4, 0, 2, 4)
            expect(Array.from(result)).toEqual([-1, -2, -3, -2])
        })

        it('should handle crossing zero', () => {
            const result = interpolateSignalValues(new Float32Array([-1, 1, -1]), 4, 0, 2, 4)
            expect(Array.from(result)).toEqual([-1, 0, 1, 0])
        })
    })

    describe('shouldDisplayChannel', () => {

        it('should return false for null or meta channels', () => {
            expect(shouldDisplayChannel(null, false)).toBe(false)
            expect(shouldDisplayChannel({ ...baseChannel, modality: 'meta' }, false)).toBe(false)
        })

        it('should return true for valid channels in raw mode', () => {
            expect(shouldDisplayChannel(baseChannel, true)).toBe(true)
            expect(shouldDisplayChannel({ ...baseChannel, visible: false }, true)).toBe(true)
        })

        it('should respect visibility settings in non-raw mode', () => {
            expect(shouldDisplayChannel({ ...baseChannel, visible: false }, false)).toBe(false)
            expect(shouldDisplayChannel(baseChannel, false)).toBe(true)
        })

        it('should handle missing channels based on config', () => {
            const missingChannel = { ...baseChannel, active: -1 }
            expect(shouldDisplayChannel(missingChannel, false)).toBe(false)
            expect(shouldDisplayChannel(missingChannel, false, { showMissingChannels: true, showHiddenChannels: false })).toBe(true)
        })
    })

    describe('resampleSignal', () => {
        it('should handle empty signal', () => {
            const result = resampleSignal(new Float32Array(), 100)
            expect(result.length).toBe(0)
        })

        it('should maintain signal length when source and target rates are equal', () => {
            const signal = new Float32Array([1, 2, 3, 4, 5])
            const result = resampleSignal(signal, 5)
            expect(result).toEqual(signal)
        })

        it('should correctly downsample signal', () => {
            const signal = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
            const result = resampleSignal(signal, 6)
            expect(result.length).toBe(6)
            expect(result.every((v) => signal.includes(v)))
        })

        it('should preserve signal characteristics when resampling', () => {
            const frequency = 10    // 10 Hz
            const samplingRate = 1000
            const duration = 1
            const signal = new Float32Array(generateSineWave(samplingRate, duration, [frequency, 1]))
            const resampled = resampleSignal(signal, samplingRate/2)
            // Check frequency content remains similar
            const originalFFT = fftAnalysis(signal, samplingRate)
            const resampledFFT = fftAnalysis(resampled, samplingRate/2)
            const findPeakFreq = (fft: any) => {
                const peakIdx = fft.magnitudes.indexOf(Math.max(...fft.magnitudes))
                return Math.round(fft.frequencyBins[peakIdx])
            }
            expect(findPeakFreq(originalFFT)).toBe(findPeakFreq(resampledFFT))
        })

        it('should preserve DC offset', () => {
            const dc = 2.5
            const signal = new Float32Array([2.5, 2.5, 2.5, 2.5])
            const result = resampleSignal(signal, 8)
            const mean = result.reduce((sum, val) => sum + val) / result.length
            expect(mean).toBeCloseTo(dc, 4)
        })
    })

    describe('shouldFilterSignal', () => {
        const defaultFilters: BiosignalFilters = {
            bandreject: [],
            highpass: 1,
            lowpass: 70,
            notch: 50
        }
        const settings: CommonBiosignalSettings = {
            ...baseSettings,
            filterChannelTypes: {
                eeg: ['highpass', 'lowpass', 'notch'],
                ecg: ['lowpass']
            }
        }

        it('should return true when filters should be applied', () => {
            const channel: BiosignalChannel = {
                ...baseChannel,
                name: 'EEG1',
                modality: 'eeg',
                samplingRate: 250,
            }
            expect(shouldFilterSignal(channel, defaultFilters, settings)).toBe(true)
        })

        it('should return false when no filters should be applied', () => {
            const channel: BiosignalChannel = {
                ...baseChannel,
                name: 'Other',
                modality: 'other',
                samplingRate: 250,
            }
            expect(shouldFilterSignal(channel, {
                bandreject: [],
                highpass: 0,
                lowpass: 0,
                notch: 0
            }, settings)).toBe(false)
        })
    })
})
