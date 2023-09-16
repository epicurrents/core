/**
 * Signal utilities.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { 
    type BiosignalChannel,
    type BiosignalFilters,
    type FftAnalysisResult,
    type MontageChannel,
    type SignalCachePart 
} from 'TYPES/lib/biosignal'
import * as d3 from 'd3-interpolate'
import Fili from 'fili'
import Log from 'scoped-ts-log'
import SETTINGS from "CONFIG/Settings"
import BiosignalMutex from 'LIB/mutexes/BiosignalMutex'
import { LTTB } from 'downsample'
import { EegMontage } from 'LIB/eeg'
import { NUMERIC_ERROR_VALUE } from './constants'

const SCOPE = 'util:signal'
const iirCalculator = new Fili.CalcCascades()


/**
 * Combine the given signal parts into as few as possible parts.
 * @param signalParts - A list of any compatible signal parts.
 * @returns combined parts as an array
 */
export const combineAllSignalParts = (...signalParts: SignalCachePart[]): SignalCachePart[] => {
    for (let i=0; i<signalParts.length; i++) {
        for (let j=0; j<signalParts.length; j++) {
            if (i === j) {
                continue
            }
            if (combineSignalParts(signalParts[i], signalParts[j])) {
                // Remove the combined part
                signalParts.splice(j, 1)
                j--
            }
        }
    }
    return signalParts
}

/**
 * See if two signal parts can be combined into one and combine them if so.
 * @param partA first part to compare against
 * @param partB new part to combine into the first part
 * @returns true if combined, false if not
 */
export const combineSignalParts = (partA: SignalCachePart, partB: SignalCachePart) => {
    if (partA.start <= partB.start && partA.end >= partB.end) {
        // partA contains partB: we can just ignore partB
        return true
    } else if (partA.start > partB.start && partA.end < partB.end) {
        // partB contains partA: replace partA with partB
        partA.start = partB.start
        partA.end = partB.end
        partA.signals = partB.signals
        return true
    } else {
        // This should only return one part for now, but I think I may change this in the future
        const notCachedParts = partsNotCached(partB, partA)
        for (const newPart of notCachedParts) {
            // Check if parts are consecutive
            if (partA.start === newPart.end || partA.end === newPart.start) {
                for (let i=0; i<partA.signals.length; i++) {
                    // Empty signals in an already cached part with non-empty length should be skipped (see below)
                    if (!partA.signals[i].data.length && partA.end !== partA.start) {
                        continue
                    }
                    if (partA.signals[i].samplingRate !== newPart.signals[i].samplingRate) {
                        Log.error(`Cannot combine signals with different sampling rates (${newPart.signals[i].samplingRate} <> ${partA.signals[i].samplingRate})!`, SCOPE)
                        // Replace the signal data with an empty array, since it is no longer valid
                        partA.signals[i].data = new Float32Array()
                        continue
                    }
                    if (partA.signals[i].data.length || newPart.signals[i].data.length) {
                        if (partA.end === newPart.start) {
                            // New part extends partA at the end
                            partA.signals[i].data = concatFloat32Arrays(
                                partA.signals[i].data.slice(0, Math.floor((newPart.start - partA.start)*partA.signals[i].samplingRate)),
                                newPart.signals[i].data
                            )
                        } else {
                            // New part extends partA at the start
                            partA.signals[i].data = concatFloat32Arrays(
                                newPart.signals[i].data,
                                partA.signals[i].data.slice(Math.floor((partA.start - newPart.start)*partA.signals[i].samplingRate))
                            )
                        }
                    }
                }
                // Adjust start or end point accordingly
                if (partA.end === newPart.start) {
                    partA.end = newPart.end
                } else {
                    partA.start = newPart.start
                }
                return true
            }
        }
    }
    return false
}

/**
 * Concatenate a set of Float32Arrays into a single Float32Array.
 * @param parts array parts to concatenate
 * @returns concatenated Float32Array
 */
export const concatFloat32Arrays = (...parts: Float32Array[]) => {
    if (parts.length < 2) {
        return parts ? parts[0] : parts
    }
    let totalLen = 0
    parts.map((arr) => { totalLen += arr.length })
    const finalArr = new Float32Array(totalLen)
    let curPos = 0
    // Append each part to the final array
    for (const arr of parts) {
        finalArr.set(arr, curPos)
        curPos += arr.length
    }
    return finalArr
}

/**
 * Perform an FFT analysis on the given signal sample.
 * @param signal - signal data as Float32Array
 * @param samplingRate - sampling rate of the signal data
 * @returns an object containing the resolution, frequency bins, magnitudes and phases from the analysis
 * @example
 * // Run FFT analysis on a signal sample with sampling rate of 500
 * const fft = fftAnalysis(signal, 500)
 * // Next valid radix 2*samplingRate is 1024. FFT can only theoretically be used to
 * // analyze frequencies up to 1/2 * samplingRate, so only the first half of the radix
 * // amount of frequency bins is returned.
 * fft = {
 *   frequencyBins: number[512],
 *   magnitudes: number[512],
 *   phases: number[512],
 *   resolution: samplingRate/radix = 500/1024 ~ 0.4883
 * }
 * const fftMagnitudes = [] as { band: number, magnitude: number }[]
 * for (let i=0; i<fft.frequencyBins.length; i++) {
 *   fftMagnitudes[i] = { band: fft.frequencyBins[i], magnitude: fft.magnitudes[i] }
 * }
 * @remarks
 * This function uses Welch's method with D = M/2 for noise reduction.
 * https://en.wikipedia.org/wiki/Welch%27s_method
 */
export const fftAnalysis = (signal: Float32Array, samplingRate: number): FftAnalysisResult => {
    // Check that input is valid
    if (!signal.length || !samplingRate) {
        return {
            frequencyBins: [],
            magnitudes: [],
            phases: [],
            psds: [],
            resolution: 0,
        }
    }
    // Radix must be a power of two and we want at least two seconds of signal data
    // to achieve a 0.5 Hz resolution (or better).
    const radixBase = Math.ceil(Math.log2(2*samplingRate))
    const blockLen = 2**radixBase
    const padLen = blockLen - signal.length%blockLen
    const padStart = new Float32Array(Math.floor(padLen/2)).fill(0.0)
    const padEnd =  new Float32Array(padLen - Math.floor(padLen/2)).fill(0.0)
    const sigBlocks = [] as Float32Array[]
    // If there are blockLen or fewer datapoints, create three blocks with the
    // actual data in the start, in the middle and in the end.
    if (signal.length < blockLen) {
        sigBlocks.push(concatFloat32Arrays(signal, new Float32Array(padLen).fill(0.0)))
        sigBlocks.push(concatFloat32Arrays(padStart, signal, padEnd))
        sigBlocks.push(concatFloat32Arrays(new Float32Array(padLen).fill(0.0), signal))
    } else {
        // Create segments with 0.5 seconds of overlap on both sides
        // (so that each signal segment is essentially analyzed twice).
        const nBlocks = Math.floor(signal.length/blockLen)*2 + 1
        sigBlocks.push(concatFloat32Arrays(padStart, signal.subarray(0, blockLen - padStart.length)))
        for (let i=1; i<(nBlocks-1); i++) {
            sigBlocks.push(signal.subarray(
                (i/2)*blockLen - padStart.length,
                ((i/2)+1)*blockLen - padStart.length
            ))
        }
        sigBlocks.push(concatFloat32Arrays(signal.subarray(
            ((nBlocks-1)/2)*blockLen - padStart.length
        ), padEnd))
    }
    const magnitudes = new Array(blockLen).fill(0)
    const phases = new Array(blockLen).fill(0)
    // Run the blocks through FFT analysis and take a mean of the different component values
    for (const block of sigBlocks) {
        const fft = new Fili.Fft(blockLen)
        const result = fft.forward(block, 'hanning')
        const blockMags = fft.magnitude(result)
        const blockPhases = fft.phase(result)
        for (let i=0; i<blockLen; i++) {
            magnitudes[i] += blockMags[i]
            phases[i] += blockPhases[i]
        }
    }
    for (let i=0; i<blockLen; i++) {
        magnitudes[i] /= sigBlocks.length
        phases[i] /= sigBlocks.length
    }
    // FFT can only provide information up to 1/2 signal sampling rate, so scrap the rest
    const resolution = samplingRate/magnitudes.length
    const finalIndex = Math.floor((0.5*samplingRate)/resolution)
    // Calculate signal frequency equivalents for each magnitude bin and add estimated
    // power spectral desities.
    const freqEqvs = [] as number[]
    const psds = [] as number[]
    for (let i=0; i<finalIndex; i++) {
        freqEqvs.push(i*resolution)
        psds.push((magnitudes[i]**2)/magnitudes.length)
    }
    return {
        frequencyBins: freqEqvs,
        magnitudes: magnitudes.slice(0, finalIndex),
        phases: phases.slice(0, finalIndex),
        psds: psds,
        resolution: resolution,
    }
}

/**
 * Get the list of active channels from raw source channels.
 * @param source - source mutex
 * @param sourceChannels - raw source recording channels
 * @param start - range start in seconds
 * @param end - range end in seconds
 * @param config - possible configuration
 */
export const calculateReferencedSignals = async (source: BiosignalMutex, sourceChannels: BiosignalChannel[], start: number, end: number, config?: any) => {
    // Check that cache has the part that we need
    const inputRangeStart = await source.inputRangeStart
    const inputRangeEnd = await source.inputRangeEnd
    if (
        inputRangeStart === null || start < inputRangeStart ||
        inputRangeEnd === null || end > inputRangeEnd
    ) {
        // TODO: Signal that the required part must be loaded by the file loader first
        Log.error("Cannot return signal part, requested raw signals have not been loaded yet.", SCOPE)
        return
    }
    const relStart = start - inputRangeStart
    const relEnd = end - inputRangeStart
    // Only calculate avera once
    const avgMap = null as null | Float32Array
    // Filter channels, if needed
    const channels = (config?.include?.length || config?.exclude?.length)
                     ? [] as MontageChannel[] : sourceChannels
    // Prioritize include -> only process those channels
    if (config?.include?.length) {
        for (const c of config.include) {
            if (sourceChannels[c].active !== NUMERIC_ERROR_VALUE) {
                channels.push(sourceChannels[c])
            }
        }
    } else if (config?.exclude?.length) {
        for (let i=0; i<sourceChannels.length; i++) {
            if (config.exclude.indexOf(i) === -1 && sourceChannels[i].active !== NUMERIC_ERROR_VALUE) {
                channels.push(sourceChannels[i])
            }
        }
    }
    for (const chan of channels) {
        const activeSig = (await source.inputSignals)[chan.active]
        const {
            filterLen, filterStart, filterEnd,
            paddingStart, paddingEnd,
            rangeStart, rangeEnd,
            signalStart, signalEnd,
        } = getFilterPadding([relStart, relEnd] || [], activeSig.length, chan)
        const activeRange = activeSig.subarray(signalStart, signalEnd)
        // Need to calculate signal relative to reference(s), one datapoint at a time.
        // Check that active signal and all reference signals have the same length.
        const refSignals = [] as Float32Array[]
        for (const ref of chan.reference) {
            const refSig = (await source.inputSignals)[chan.active]
            if (activeSig.length === refSig.length) {
                refSignals.push(refSig.subarray(signalStart, signalEnd))
            }
        }
        // We must preserve space for padding on both ends of the signal array.
        const derivSig = new Float32Array(filterEnd - filterStart)
        let j = 0
        for (let n=filterStart; n<filterEnd; n++) {
            // Just add zero if we are outside tha actual signal range
            if (n < 0 || n >= activeRange.length) {
                derivSig.set([0], j)
                j++
                continue
            }
            // Check if the average for this particular datapoint has already been calculated
            if (!avgMap) {
                const avgMap = new Float32Array(derivSig.length).fill(0.0)
                for (const ref of refSignals) {
                    if (refSignals.length > 1) {
                        // Calculate average reference and cache it
                        for (let i=0; i<ref.length; i++) {
                            avgMap[i] += ref[i]/refSignals.length
                        }
                    } else if (refSignals.length === 1) {
                        avgMap.set(ref)
                    }
                }
            }
            j++
        }
        chan.signal = new Float32Array(activeRange.map((val: number, idx: number) => {
            return val - (avgMap ? avgMap[idx] : 0)
        }))
    }
}

/**
 * Apply bandpass/highpass/lowpass and/or notch filters to the given signal.
 * @param signal the signal to filter
 * @param fs sampling frequency of the signal
 * @param hp high-pass threshold
 * @param lp low-pass threshold
 * @param nf notch filter frequency
 * @returns filtered signal as Float32Array
 */
export const filterSignal = (signal: Float32Array, fs: number, hp: number, lp: number, nf: number) => {
    // Fili returns NaNs if lp as over half the sampling rate, so consider that the maximum.
    lp = Math.min(lp, fs/2)
    // Can have either bandpass, highpass or lowpass filter.
    // The highpass and lowpass filters give identical results to SciPy Butterworth filter,
    // but the bandpass filter does not, so I'm going to avoid using it for now.
    /*
    if (hp && lp) {
        const f0 = Math.sqrt(hp*lp)
        const bw = Math.log2(lp/hp)
        passFilterCoeffs = iirCalculator.bandpass({
            order: 2,
            characteristic: 'butterworth',
            Fs: fs,
            Fc: f0,
            BW: bw,
        })
    */
    if (hp) {
        const hpFilterCoeffs = iirCalculator.highpass({
            // Fili order is actually twice the "traditional" order value, as it
            // instructs how many biquad filters to cascade (and each Fili biquad
            // corresponds to two steps of order in SciPy Butterworth filter).
            // The order is moreover doubled when using a forward-backward filter.
            order: 2,
            characteristic: 'butterworth',
            Fs: fs,
            Fc: hp,
        })
        const hpFilter = new Fili.IirFilter(hpFilterCoeffs)
        signal = hpFilter.filtfilt(signal)
    }
    if (lp) {
        const lpFilterCoeffs = iirCalculator.lowpass({
            order: 2,
            characteristic: 'butterworth',
            Fs: fs,
            Fc: lp,
        })
        const lpFilter = new Fili.IirFilter(lpFilterCoeffs)
        signal = lpFilter.filtfilt(signal)
    }
    // TODO: Ability to apply more than one notch filter?
    if (nf) {
        // Parameters take from
        // https://www.mathworks.com/help/dsp/ref/iirnotch.html
        const f0 = nf/(fs/2)
        const bw = f0/35
        //const fc = (lp-hp)/2 + hp
        const stopFilterCoeffs = iirCalculator.bandstop({
            order: 6,
            characteristic: 'butterworth',
            Fs: fs,
            Fc: nf,
            BW: bw,
        })
        const stopFilter = new Fili.IirFilter(stopFilterCoeffs)
        signal = stopFilter.filtfilt(signal)
    }
    // Convert into a Float32Array
    signal = new Float32Array(signal)
    return signal
}

/**
 * Get filter properties for the given signal range.
 * @param range - requested signal range in seconds
 * @param sigLen - total signal length
 * @param channel - channel properties
 * @param filters - active general filters as BiosignalFilters (optional)
 * @returns padding properties as
 * ```
 * Object<{
 *      // Number of filter-added datapoints
 *      filterLen: number
 *      // Signal index of filter start point
 *      filterStart: number
 *      // Signal index of filter end point
 *      filterEnd: number
 *      // Length of possible additional padding to the start of the signal
 *      paddingStart: number
 *      // Length of possible additional padding to the end of the signal
 *      paddingEnd: number
 *      // Starting index of the requested range
 *      rangeStart: number
 *      // Ending index of the requested range
 *      rangeEnd: number
 *      // Starting index of the signal data
 *      signalStart: number
 *      // Ending index of the signal data
 *      signalEnd: number
 *  }>
 * ```
 */
export const getFilterPadding = (
    range: number[],
    sigLen: number,
    channel: BiosignalChannel,
    filters?: BiosignalFilters,
) => {
    // If range is falsy, just use the whole signal
    const chanRange = !range || range.length !== 2 ? null
                      // Convert range from seconds to current channel datapoint indices
                      : [
                          Math.floor(range[0]*channel.samplingRate),
                          Math.ceil((range[1] || 0)*channel.samplingRate)
                        ]
    // Check that possible calculated range is valid
    if (chanRange) {
        if (chanRange[0] < 0 || chanRange[0] > sigLen) {
            // TODO: Need a better way to handle invalid input
            chanRange[0] = 0
        }
        if (chanRange[1] < 0 || chanRange[1] > sigLen || chanRange[1] < chanRange[0]) {
            chanRange[1] = sigLen
        }
    }
    // Apply padding to channel if it has any filters set
    let filtSize = 0
    let filtPad = [0, 0]
    if (!filters || shouldFilterSignal(filters, channel)) {
        filtSize = Math.round(channel.samplingRate*SETTINGS.eeg.filterPaddingSeconds)
        filtPad = chanRange === null
                  // Always add full padding on both ends if the whole signal is requested
                  ? [filtSize, filtSize]
                  // Add padding for the parts that cannot be filled with actual signal data
                  : [
                        Math.max(filtSize - chanRange[0], 0),
                        Math.max(filtSize - (sigLen - chanRange[1]), 0),
                    ]
    }
    return {
        filterLen: filtSize,
        filterStart: chanRange ? chanRange[0] - filtSize : -filtSize,
        filterEnd:  chanRange ? chanRange[1] + filtSize : sigLen + filtSize,
        paddingStart: filtPad[0],
        paddingEnd: filtPad[1],
        rangeStart: chanRange ? chanRange[0] : 0,
        rangeEnd: chanRange ? chanRange[1] : sigLen,
        signalStart: chanRange ? Math.max(chanRange[0] - filtSize, 0) : 0,
        signalEnd: chanRange ? Math.min(chanRange[1] + filtSize, sigLen) : sigLen,
    }
}

/**
 * Interpolate missing datapoints in sparsely sampled signals.
 * @param signal signal as Float32Array
 * @param targetLen desired signal length (as count of datapoints)
 * @param start starting point (as a fraction of signal datapoints)
 * @param sigSR signal sampling rate
 * @param targetSR target sampling rate
 * @returns signal with interpolated datapoints as Float32Array
 *
 * @example
 * // To interpolate a 1Hz signal to 10Hz signal between 2.5 and 7.5 seconds
 * interpolateSignalValues(
 *      originalSignal = Float32Array, // Full original signal
 *      targetLen = 50, // 2.5 (incl) - 7.5 (excl)
 *      start = 2.5, // halfway between datapoints 2 and 3 (0 being the first)
 *      sigSR = 1,
 *      targetSR = 10
 * )
 */
export const interpolateSignalValues = (signal: Float32Array, targetLen: number, start: number, sigSR: number, targetSR: number) => {
    // Cannot interpolate from fewer than 2 values, so in that case just fill the array with the same value
    if (signal.length === 0) {
        const sig = new Float32Array(targetLen)
        sig.fill(0.0)
        return sig
    } else if (signal.length === 1) {
        const sig = new Float32Array(targetLen)
        sig.fill(signal[0])
        return sig
    }
    const interpolatedSig = [] as number[]
    let floor = Math.floor(start)
    let interpolate = d3.interpolateNumber(signal[floor], signal[floor + 1])
    const srFactor = sigSR/targetSR
    for (let i=0; i<targetLen; i++) {
        const pos = start + i*srFactor
        if (Math.floor(pos) !== floor && signal.length > Math.floor(pos) + 1) {
            // New interpolation bounds
            floor = Math.floor(pos)
            interpolate = d3.interpolateNumber(signal[floor], signal[floor + 1])
            interpolatedSig.push(signal[floor])
            continue
        }
        if (signal[floor] === signal[floor + 1] || signal.length <= floor + 1) {
            // Both bounds are same or we're past the last datapoint
            interpolatedSig.push(signal[floor])
        } else {
            interpolatedSig.push(interpolate(pos%1))
        }
    }
    return new Float32Array(interpolatedSig)
}

/**
 * Check if the given signal is an annotation signal.
 * @param channel - Channel info from EDF header.
 * @returns true/false
 */
export const isAnnotationSignal = (format: string, channel: { label: string }) => {
    return format.toLowerCase() === 'edf+' && channel.label === 'EDF Annotations'
}

/**
 * Check if the given signal cache parts form one continuous signal.
 * @param signalParts parts to check
 * @returns boolean
 */
export const isContinuousSignal = (...signalParts: SignalCachePart[]) => {
    const partRanges = signalParts.map((part) => {
        return { start: part.start, end: part.end, signals: [] }
    })
    return (combineAllSignalParts(...partRanges).length === 1)
}

/**
 * Maps given signals to corresponding sampling rates.
 * @param signals signals as Float32Array
 * @param montage montage name
 * @returns ```
 * { data: signals[i], samplingRate: channelSamplingRate[i] }
 * ```
 */
export const mapSignalsToSamplingRates = (signals: Float32Array[], montage: EegMontage) => {
    let i = 0
    return signals.map((sig) => {
        return { data: sig, samplingRate: montage.channels[i++].samplingRate }
    })
}

/**
 * Check which part of the range in a given signal cache part is not already covered by
 * the given set of already cached parts.
 * This method does not check the already cached parts for overlap.
 * @param partToCheck part to check the not cached range of
 * @param cachedParts already cached signal parts
 * @return SignalCacheParts with the range and signal data adjusted
 */
export const partsNotCached = (partToCheck: SignalCachePart, ...cachedParts: SignalCachePart[]): SignalCachePart[] => {
    /*const notCached = [{
        start: partToCheck.start,
        end: partToCheck.end,
        signals: partToCheck.signals.map((sig) => { return {...sig} })
    }] as SignalCachePart[]*/
    const notCached = [{ start: partToCheck.start, end: partToCheck.end }] as SignalCachePart[]
    for (const cached of cachedParts) {
        // First check if the entire part has already been cached
        if (cached.start <= partToCheck.start && cached.end >= partToCheck.end) {
            return []
        }
        for (let i=0; i<notCached.length; i++) {
            const part = notCached[i]
            if (cached.start <= part.start && cached.end >= part.end) {
                // Entire part has already been cached, remove it
                notCached.splice(i, 1)
                if (!notCached.length) {
                    // Nothing left to check
                    return notCached
                }
                i--
            } else if (cached.start > part.start && cached.end < part.end) {
                // A portion in the middle has been already cached, so split the part in two
                const partToSplit = notCached.splice(i, 1)[0]
                const firstPart = {
                    start: partToSplit.start,
                    end: cached.start,
                    signals: []
                } as SignalCachePart
                notCached.push(firstPart)
                const secondPart = {
                    start: cached.end,
                    end: partToSplit.end,
                    signals: []
                } as SignalCachePart
                notCached.push(secondPart)
            } else if (cached.end < part.end && cached.end > part.start) {
                // End of the part has not been cached
                part.start = cached.end
            } else if (cached.start > part.start && cached.start < part.end) {
                // Start of the part has not been cached
                part.end = cached.start
            }
        }
    }
    // Finally, add actual signal data to notCached parts
    for (const part of notCached) {
        for (const sig of partToCheck.signals) {
            if (!part.signals) {
                part.signals = []
            }
            part.signals.push({
                data: sig.data.slice(
                    Math.round((part.start - partToCheck.start)*sig.samplingRate),
                    Math.round((part.end - partToCheck.start)*sig.samplingRate)
                ),
                samplingRate: sig.samplingRate
            })
        }
    }
    return notCached
}

/**
 * Resample a given signal to target length. Utilizes the Largest-Triangle-Three-Buckets algorithm.
 * @param signal - Original signal to resample.
 * @param targetLen - Desired length (number of samples) for the signal; must be less than original signal length.
 * @returns Float32Array with the original signal resampled to target length.
 */
export const resampleSignal = (signal: Float32Array, targetLen: number) => {
    if (targetLen > signal.length) {
        Log.error(`Cannot resample to a higher sampling rate.`, SCOPE)
    }
    let i = 0
    const data = [] as { x: number, y: number}[]
    for (const sample of signal) {
        data.push({ x: i, y: sample})
        i++
    }
    return Float32Array.from((LTTB(data, targetLen) as any).map((p: { y: number }) => p.y))
}

export const shouldFilterSignal = (filters: BiosignalFilters, channel: BiosignalChannel) => {
    return (
        (
            (filters.highpass || filters.lowpass || filters.notch) &&
            (channel.type === 'eeg' || channel.type === 'ekg' || channel.type === 'eog' || channel.type === 'meg')
        ) ||
        channel.highpassFilter || channel.lowpassFilter || channel.notchFilter
    )
}
