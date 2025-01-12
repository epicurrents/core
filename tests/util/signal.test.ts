import {
    //calculateSignalOffsets,
    combineSignalParts,
    concatTypedNumberArrays,
    floatsAreEqual,
    generateSineWave,
    getChannelFilters,
    shouldDisplayChannel,
    shouldFilterSignal,
} from '../../src/util/signal'
import { BiosignalChannelMarker, type BiosignalChannel, type BiosignalFilters } from '../../src/types/biosignal'
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

        it('should not combine parts with different sampling rates', () => {
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
            expect(combined).toBe(true)
            expect(partA.signals[0].data.length).toBe(0)
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
            const result = generateSineWave(frequency, amplitude, samplingRate, duration)
            expect(result.length).toBe(100) // samplingRate * duration.
            expect(Math.max(...result)).toBeCloseTo(amplitude, 4)
            expect(Math.min(...result)).toBeCloseTo(-amplitude, 4)
        })
    
        it('should generate zero signal with zero amplitude', () => {
            const result = generateSineWave(1, 0, 100, 1)
            expect(result.every(value => value === 0)).toBe(true)
        })
    
        it('should generate DC signal with zero frequency', () => {
            const amplitude = 1
            const result = generateSineWave(0, amplitude, 100, 1)
            expect(result.every(value => value === 0)).toBe(true)
        })
    
        it('should respect sampling rate changes', () => {
            const wave1 = generateSineWave(1, 1, 100, 1)
            const wave2 = generateSineWave(1, 1, 200, 1)
            expect(wave1.length).toBe(100)
            expect(wave2.length).toBe(200)
        })
    
        it('should respect duration changes', () => {
            const wave1 = generateSineWave(1, 1, 100, 1)
            const wave2 = generateSineWave(1, 1, 100, 2)
            expect(wave1.length).toBe(100)
            expect(wave2.length).toBe(200)
        })
    
        it('should generate correct frequency', () => {
            const frequency = 2 // 2 Hz.
            const samplingRate = 1000 // 1000 Hz.
            const duration = 1 // 1 second.
            const result = generateSineWave(frequency, 1, samplingRate, duration)
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