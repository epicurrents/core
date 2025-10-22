/**
 * Signal utilities.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    DerivedChannelProperties,
    BiosignalChannel,
    BiosignalChannelProperties,
    BiosignalFilters,
    BiosignalSetup,
    FftAnalysisResult,
    MontageChannel,
    SetupChannel,
} from '#types/biosignal'
import { CommonBiosignalSettings, type ConfigChannelLayout } from '../types/config'
import { type SignalCachePart } from '#types/service'
import { type TypedNumberArray, type TypedNumberArrayConstructor } from '#types/util'
import Fili from 'fili'
import { EPS as FLOAT16_EPS } from '@stdlib/constants-float16'
import { EPS as FLOAT32_EPS } from '@stdlib/constants-float32'
import { EPS as FLOAT64_EPS } from '@stdlib/constants-float64'
import { Log } from 'scoped-event-log'
//import { BiosignalMutex } from '#assets/biosignal'
import { LTTB } from 'downsample'
import { NUMERIC_ERROR_VALUE } from './constants'
import { deepClone } from './general'

const SCOPE = 'util:signal'
const iirCalculator = new Fili.CalcCascades()

/**
 * Get the list of active channels from raw source channels.
 * @param source - Source mutex.
 * @param sourceChannels - Raw source recording channels.
 * @param start - Range start in seconds.
 * @param end - Range end in seconds.
 * @param config - Possible configuration.
 * @remarks
 * This used to be a helper method in a removed feature. It is kept here in case the feature
 * in question or a similar feature is added.

const calculateReferencedSignals = async (
    source: BiosignalMutex,
    sourceChannels: BiosignalChannel[],
    start: number,
    end: number,
    config: {
        filterPaddingSeconds: number
        exclude?: number[]
        include?: number[]
    }
) => {
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
        } = getFilterPadding([relStart, relEnd] || [], activeSig.length, chan, config)
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
*/

/**
 * Calculate and update signal offsets (from trace baseline) for given channels using the given layout configuration.
 * Will place each channel an equal distance from each other if configuration is omitted.
 * @param config - Optional layout configuration in the form of
 *
 *               ```
 *               {
 *                  channelSpacing: number,
 *                  groupSpacing: number,
 *                  layout: number[],
 *                  yPadding: number,
 *               }
 *               ```
 *
 *               `channelSpacing` and `groupSpacing` values are used to calculate padding between individual channels
 *                 and logical channel groups. The values of these two parameters are normalized, so only their
 *                 relative difference matters.\
 *               `yPadding` is the extra amount of padding (relative to channelSpacing) to add above the first channel
 *                 and below the last channel.\
 *               `layout` is an array of logical channel group sizes. The number of channels in each element are
 *                 considered a part of the same group.
 *
 * @example
 * calculateSignalOffsets({
 *      channelSpacing: 1,
 *      groupSpacing: 2,
 *      yPadding: 1,
 *      layout: [ 4, 4, 4, 4, 2]
 * })
 * // will produce five logical groups, the first four containing four channels and the last two channels,
 * // with each group separated by 2 times the amount of spacing of the individual channels inside each group.
 */
export const calculateSignalOffsets = (
    channels: (BiosignalChannelProperties | MontageChannel)[],
    config?: ConfigChannelLayout
) => {
    // Check if this is an 'as recorded' montage.
    if (!config || config?.isRaw) {
        // Remove channels that are not displayed.
        channels = channels.filter(chan => shouldDisplayChannel(chan, true))
        const layoutH = channels.length + 1
        // Single channel can take up all the space but multiple channels cannot cannot without overlapping
        // (if they are placed at equidistantly from each other and viewport top/bottom).
        const chanHeight = 1/(channels.length > 1 ? layoutH : 1)
        let i = 0
        for (const chan of channels) {
            const baseline = 1.0 - ((i + 1)/layoutH)
            chan.offset = {
                baseline: baseline,
                bottom: baseline - 0.5*chanHeight,
                top: baseline + 0.5*chanHeight
            }
            i++
        }
        return
    }
    const requiredConfig = Object.assign(
        {
            channelSpacing: 1,
            groupSpacing: 1,
            isRaw: false, // We checked for this above.
            layout: [],
            yPadding: 1,
        } as Required<typeof config>,
        config
    )
    // Calculate channel offsets from the provided config.
    let nGroups = 0
    let nChannels = 0
    let nChanTotal = 0
    // Grab layout from default config if not provided.
    const configLayout = requiredConfig.layout
    const layout = []
    for (const group of configLayout) {
        let nGroup = 0
        // Remove missing and hidden channels from the layout.
        for (let i=nChanTotal; i<nChanTotal+group; i++) {
            if (shouldDisplayChannel(channels[i], false)) {
                nGroup++
            }
        }
        nChannels += nGroup
        nChanTotal += group
        // Don't add empty groups.
        if (nGroup) {
            nGroups++
            layout.push(nGroup)
        }
    }
    // Check if the number of non-meta channels matches the constructed layout.
    const nSignalChannels = channels.filter(
        (chan) => { return (chan.modality && chan.modality !== 'meta' && chan.active !== -1) }
    ).length
    if (nChannels !== nSignalChannels) {
        Log.warn(`The number of channels does not match config layout.`, SCOPE)
    }
    // Calculate total trace height, starting with top and bottom margins.
    let layoutH = 2*requiredConfig.yPadding
    // Add channel heights.
    layoutH += (nChannels - (nGroups - 1) - 1)*requiredConfig.channelSpacing
    // Add group heights.
    layoutH += (nGroups - 1)*requiredConfig.groupSpacing
    // Go through the signals and add their respective offsets.
    // First trace is y-padding away from the top.
    let yPos = 1.0 - requiredConfig.yPadding/layoutH
    let chanIdx = 0
    const chanHeight = requiredConfig.channelSpacing/layoutH
    // Save into a variable if group spacing has been applied.
    // We cannot determine it by checking if this is the first channel in the group, because
    // the first channel may be missing or hidden for some other reason.
    let groupSpacing = true
    for (let i=0; i<configLayout.length; i++) {
        // Top and bottom margins are applied automatically, so skip first visible group spacing.
        if (i && !groupSpacing) {
            yPos -= (1/layoutH)*requiredConfig.groupSpacing
            groupSpacing = true
        }
        for (let j=0; j<configLayout[i]; j++) {
            const chan = channels[chanIdx]
            // Check that number of layout channels hasn't exceeded number of actual channels.
            if (chan === undefined) {
                Log.warn(
                    `Number of layout channels (${chanIdx + 1}) exceeds the number of channels in the EEG record ` +
                    `(${channels.length}).`,
                SCOPE)
                continue
            }
            chanIdx++
            if (!shouldDisplayChannel(chan, false)) {
                continue
            }
            if (!groupSpacing) {
                yPos -= (1/layoutH)*requiredConfig.channelSpacing
            } else {
                // Skip the first channel (group spacing has already been applied).
                groupSpacing = false
            }
            chan.offset = {
                baseline: yPos,
                bottom: yPos - 0.5*chanHeight,
                top: yPos + 0.5*chanHeight,
            }
            // Check if a meta channel has slipped into the visible layout.
            if (chan.modality === 'meta') {
                Log.warn(`Metadata channel ${chan.label} has been included into visbile layout.`, SCOPE)
            }
        }
    }
}

/**
 * Combine the given signal parts into as few as possible parts. This method will prioritize combining the parts and
 * will invalidate data on channels that have incompatible sampling rates.
 * @param signalParts - A list of any compatible signal parts.
 * @returns combined parts as an array
 */
export const combineAllSignalParts = (...signalParts: SignalCachePart[]): SignalCachePart[] => {
    for (let i=0; i<signalParts.length; i++) {
        for (let j=i+1; j<signalParts.length; j++) {
            if (combineSignalParts(signalParts[i], signalParts[j], 'shape')) {
                // Remove the combined part.
                signalParts.splice(j, 1)
                j--
            }
        }
    }
    return signalParts
}

/**
 * See if two signal parts can be combined into one and combine them if so. The latter part has priority on overlapping
 * samples (will replace samples from first part).
 *
 * This method has two modes of operation that can be set with the `prioritize` parameter:
 * - `data`: The two parts will only be combined if they are consecutive and all signals have the same sampling rates.
 *           In this mode the user can be confident that no signal data is lost.
 * - `shape`: The two parts will be combined if they are consecutive, even if some or all of the signals have different
 *            sampling rates. In this case, the signal will be set to an empty array. In this mode the user can be
 *            confident that the combined part always have the expected shape (e.g. for displaying).
 * @param partA First part to compare against.
 * @param partB New part to combine into the first part.
 * @returns True if combined, false if not.
 */
export const combineSignalParts = (
    partA: SignalCachePart,
    partB: SignalCachePart,
    prioritize = 'data' as 'data' | 'shape'
) => {
    // Check that parts are consecutive or overlapping.
    if (
        (partA.start < partB.start && partA.end < partB.start) ||
        (partA.start > partB.start && partA.start > partB.end )
    ) {
        Log.debug(`Cannot combine non-consecutive signal parts.`, SCOPE)
        return false
    }
    // Check if one of the ranges is empty.
    if (partA.start === partA.end && partB.start !== partB.end) {
        partA.start = partB.start
        partA.end = partB.end
        partA.signals = partB.signals
        return true
    } else if (partB.start === partB.end) {
        return true
    }
    // Check that the two parts have the same number of signals.
    if (partA.signals.length !== partB.signals.length) {
        Log.debug(
            `Cannot combine signal parts with different number of signals ` +
            `(${partA.signals.length} != ${partB.signals.length}).`,
        SCOPE)
        return false
    }
    // If mode is data, check that signals within the parts have the same sampling rates.
    if (prioritize === 'data' &&
        partA.signals.some((signal, idx) => signal.samplingRate !== partB.signals[idx].samplingRate)
    ) {
        Log.debug(
            `Cannot combine signal parts with different sampling rates ` +
            `(${partA.signals.map((s) => s.samplingRate).join(', ')} != ` +
            `${partB.signals.map((s) => s.samplingRate).join(', ')}).`,
        SCOPE)
        return false
    }
    // Simple cases of one part containing the other.
    if (partB.start >= partA.start && partB.end <= partA.end) {
        // partA contains partB: replace partA samples with partB samples.
        for (let i=0; i<partA.signals.length; i++) {
            partA.signals[i].data.set(
                partB.signals[i].data,
                Math.round((partB.start - partA.start)*partA.signals[i].samplingRate)
            )
        }
        return true
    }
    if (partA.start >= partB.start && partA.end <= partB.end) {
        // partB contains partA: replace partA with partB.
        partA.start = partB.start
        partA.end = partB.end
        partA.signals = partB.signals
        return true
    }
    // Combine the parts.
    for (let i=0; i<partA.signals.length; i++) {
        // Signals with missing samples should be discarded in shape mode.
        if (prioritize === 'shape' && (
            !partA.signals[i].data.length && partA.signals[i].samplingRate && partA.end !== partA.start ||
            !partB.signals[i].data.length && partB.signals[i].samplingRate && partB.end !== partB.start
        )) {
            Log.debug(`Signal at index ${i} has missing data.`, SCOPE)
            partA.signals[i].data = new Float32Array()
            continue
        }
        if (partA.signals[i].samplingRate !== partB.signals[i].samplingRate) {
            Log.error(
                `Cannot combine signals with different sampling rates ` +
                `(${partB.signals[i].samplingRate} != ${partA.signals[i].samplingRate}).`,
            SCOPE)
            // Replace the signal data with an empty array, since it is no longer valid.
            // An empty signal is easier to identify visually for debugging purposes, but this could also
            // return false.
            partA.signals[i].data = new Float32Array()
            continue
        }
        if (partA.signals[i].data.length || partB.signals[i].data.length) {
            if (partA.start <= partB.start && partA.end >= partB.end) {
                // partA contains partB: insert partB.
                partA.signals[i].data.set(
                    partB.signals[i].data,
                    Math.floor((partB.start - partA.start)*partA.signals[i].samplingRate)
                )
            } else if (partA.end >= partB.start) {
                // New part extends partA at the end.
                partA.signals[i].data = concatTypedNumberArrays(
                    partA.signals[i].data.slice(
                        0,
                        Math.floor((partB.start - partA.start)*partA.signals[i].samplingRate)
                    ),
                    partB.signals[i].data
                )
            } else {
                // New part extends partA at the start.
                partA.signals[i].data = concatTypedNumberArrays(
                    partB.signals[i].data,
                    partA.signals[i].data.slice(
                        Math.floor((partA.start - partB.start)*partA.signals[i].samplingRate)
                    )
                )
            }
        }
    }
    // Adjust start or end point accordingly.
    partA.start = Math.min(partA.start, partB.start)
    partA.end = Math.max(partA.end, partB.end)
    return true
}

/**
 * Concatenate a set of Float32Arrays into a single Float32Array.
 * @param parts array parts to concatenate
 * @returns concatenated Float32Array
 */
export const concatTypedNumberArrays = <T extends TypedNumberArray>(...parts: T[]): T => {
    if (parts.length < 2) {
        return parts ? parts[0] : parts
    }
    let totalLen = 0
    const TypedConstructor = Object.getPrototypeOf(parts[0]).constructor as TypedNumberArrayConstructor
    parts.map((arr) => { totalLen += arr.length })
    const finalArr = new TypedConstructor(totalLen) as T
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
        sigBlocks.push(concatTypedNumberArrays(signal, new Float32Array(padLen).fill(0.0)))
        sigBlocks.push(concatTypedNumberArrays(padStart, signal, padEnd))
        sigBlocks.push(concatTypedNumberArrays(new Float32Array(padLen).fill(0.0), signal))
    } else {
        // Create segments with 0.5 seconds of overlap on both sides
        // (so that each signal segment is essentially analyzed twice).
        const nBlocks = Math.floor(signal.length/blockLen)*2 + 1
        sigBlocks.push(concatTypedNumberArrays(padStart, signal.subarray(0, blockLen - padStart.length)))
        for (let i=1; i<(nBlocks-1); i++) {
            sigBlocks.push(signal.subarray(
                (i/2)*blockLen - padStart.length,
                ((i/2)+1)*blockLen - padStart.length
            ))
        }
        sigBlocks.push(concatTypedNumberArrays(signal.subarray(
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
    // Calculate signal frequency equivalents for each magnitude bin and add estimated power spectral densities.
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
 * Apply bandpass/highpass/lowpass and/or notch filters to the given `signal`.
 * @param signal - The signal to filter.
 * @param fs - Sampling frequency of the signal.
 * @param hp - High-pass threshold.
 * @param lp - Low-pass threshold.
 * @param nf - Notch filter frequency.
 * @returns The filtered signal as Float32Array.
 */
export const filterSignal = (
    signal: Float32Array,
    fs: number,
    hp: number,
    lp: number,
    nf: number
): Float32Array => {
    // Check basic requirements for filtering.
    if (!fs || !signal.length) {
        return signal
    }
    // Fili returns NaNs if lp is over half the sampling rate, so consider that the maximum.
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
    if (lp && hp && lp <= hp) {
        Log.debug(`Low-pass threshold must be higher than high-pass threshold, ignoring band-pass.`, SCOPE)
    } else  {
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
        if (lp && (!hp || lp > hp)) {
            const lpFilterCoeffs = iirCalculator.lowpass({
                order: 2,
                characteristic: 'butterworth',
                Fs: fs,
                Fc: lp,
            })
            const lpFilter = new Fili.IirFilter(lpFilterCoeffs)
            signal = lpFilter.filtfilt(signal)
        }
    }
    // TODO: Ability to apply more than one notch filter?
    if (nf) {
        const f0 = nf/(fs/2)
        const Qfactor = 10 // Higher Q-factor makes the filter more narrow.
        const bw = f0/Qfactor
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
    // Convert into a Float32Array.
    signal = new Float32Array(signal)
    return signal
}

/**
 * See if two floats are equal to the given bit precision.
 * @param float1 - One of the floats to test.
 * @param float2 - The other float to test.
 * @param bits - Float bits (either `16`, `32` or default `64`).
 * @returns True/false.
 */
export const floatsAreEqual = (float1: number, float2: number, bits: 16 | 32 | 64 = 64) => {
    if (float1 === float2 || (!float1 && !float2)) {
        return true
    }
    const sigEps = bits === 16 ? FLOAT16_EPS
                 : bits === 32 ? FLOAT32_EPS
                 : FLOAT64_EPS
    const exp1 = Math.max(1, 10**Math.floor(Math.log10(float1)))
    const exp2 = Math.max(1, 10**Math.floor(Math.log10(float2)))
    return Math.abs(float1/exp1 - float2/exp2) < sigEps
}

/**
 * Generate a compound sine wave singal with the given parameters.
 * @param samplingRate - Sampling rate of the signal in Hz.
 * @param duration - Duration of the signal in seconds.
 * @param components - List of waveform components as [`frequency`, `amplitude`].
 * @returns An array of signal data points.
 */
export const generateSineWave = (samplingRate: number, duration: number, ...components: [number, number][]) => {
    const signal = new Array(Math.floor(samplingRate*duration)).fill(0)
    for (const [frequency, amplitude] of components) {
        for (let i=0; i<signal.length; i++) {
            signal[i] += amplitude*Math.sin(i*(frequency/samplingRate)*2*Math.PI)
        }
    }
    return signal
}

/**
 * Get the filters to apply to the signal in this `channel`.
 * @param channel - Signal channel.
 * @param defaultFilters - Recording default filters.
 * @param settings - Module settings.
 * @returns Standard biosignal filters.
 */
export const getChannelFilters = (
    channel: BiosignalChannel,
    defaultFilters: BiosignalFilters,
    settings: CommonBiosignalSettings
): BiosignalFilters => {
    const applyDefaults = settings.filterChannelTypes?.[channel.modality]
    const highpass = channel.highpassFilter
                     || (applyDefaults?.includes('highpass') ? defaultFilters.highpass : 0) || 0
    const lowpass = channel.lowpassFilter
                    || (applyDefaults?.includes('lowpass') ? defaultFilters.lowpass : 0) || 0
    const notch = channel.notchFilter
                  || (applyDefaults?.includes('notch') ? defaultFilters.notch : 0) || 0
    return {
        bandreject: [],
        highpass: highpass,
        lowpass: lowpass,
        notch: notch
    }
}

/**
 * Get filter properties for the given signal range.
 * @param range - Requested signal range in seconds.
 * @param sigLen - Total signal length.
 * @param channel - Channel properties.
 * @param config - Configuration properties for the biosignal in question.
 * @param filters - Active default filters to check if signal should be filtered (optional).
 * @returns Padding properties as
 * ```
 * Object<{
 *      filterLen: number // Number of filter-added datapoints
 *      filterStart: number // Signal index of filter start point
 *      filterEnd: number // Signal index of filter end point
 *      paddingStart: number // Length of possible additional padding to the start of the signal
 *      paddingEnd: number // Length of possible additional padding to the end of the signal
 *      rangeStart: number // Starting index of the requested range
 *      rangeEnd: number // Ending index of the requested range
 *      signalStart: number // Starting index of the signal data
 *      signalEnd: number // Ending index of the signal data
 *  }>
 * // Where
 * filterStart = rangeStart - filterLen // Negative if filter range extends beyond data start.
 * filterEnd = rangeEnd + filterLen // Greater than signal length if filter range exceeds signal data.
 * // Padding represents filter range that exceed actual signal data and must be ignored or complemented.
 * signalStart - paddingStart = filterStart
 * signalEnd + paddingEnd = filterEnd // or
 * (rangeStart - signalStart) + paddingStart = filterLen
 * (signalEnd - rangeStart) + paddingEnd = filterLen
 * ```
 */
export const getFilterPadding = (
    range: number[],
    sigLen: number,
    channel: BiosignalChannel,
    settings: CommonBiosignalSettings,
    filters?: BiosignalFilters,
) => {
    // If range is falsy, use the whole signal.
    const dataRange = !range || range.length !== 2 ? null
                      // Convert range from seconds to current channel datapoint indices.
                      : [
                          // If range start is between two datapoints, we need the previous point to intrapolate.
                          Math.floor(range[0]*channel.samplingRate),
                          // Same logic for range ends between two data points.
                          Math.ceil((range[1] || 0)*channel.samplingRate)
                        ]
    // Check that possible calculated range is valid.
    if (dataRange) {
        dataRange[0] = Math.max(Math.min(dataRange[0], sigLen), 0)
        dataRange[1] = Math.max(Math.min(dataRange[1], sigLen), dataRange[0])
    }
    // Apply padding to channel if it has any filters set
    let filtSize = 0
    let filtPad = [0, 0]
    if (!filters // Padding information is wanted if these are omitted.
        || shouldFilterSignal(channel, filters, settings)
    ) {
        filtSize = Math.round(channel.samplingRate*(settings.filterPaddingSeconds || 0))
        filtPad = dataRange === null
                  // Always add full padding on both ends if the whole signal is requested.
                  ? [filtSize, filtSize]
                  // Add padding for the parts that cannot be filled with actual signal data.
                  : [
                        Math.max(filtSize - dataRange[0], 0),
                        Math.max(filtSize - (sigLen - dataRange[1]), 0),
                    ]
    }
    return {
        /** Length of the filter padding in signal data points. */
        filterLen: filtSize,
        /** Starting index of the padded range; may be negative by `paddingStart` amount. */
        filterStart: dataRange ? dataRange[0] - filtSize : -filtSize,
        /** Starting index of the padded range; may exceed actual signal length by `paddingEnd` amount. */
        filterEnd:  dataRange ? dataRange[1] + filtSize : sigLen + filtSize,
        /** The amount of additional padding (e.g. zeroes) needed to add before the actual signal data. */
        paddingStart: filtPad[0],
        /** The amount of additional padding (e.g. zeroes) needed to add after the actual signal data. */
        paddingEnd: filtPad[1],
        /** Starting position of the requested range as signal data point index. */
        rangeStart: dataRange ? dataRange[0] : 0,
        /** Ending position of the requested range as signal data point index. */
        rangeEnd: dataRange ? dataRange[1] : sigLen,
        /** Starting position of the filter padded range as signal data point index. */
        signalStart: dataRange ? Math.max(dataRange[0] - filtSize, 0) : 0,
        /** Ending position of the filter padded range as signal data point index. */
        signalEnd: dataRange ? Math.min(dataRange[1] + filtSize, sigLen) : sigLen,
    }
}

/**
 * Filter an array of channels to contain only the included ones.
 * @param channels - List of channels to filter.
 * @param config - Configuration containing include and/or exclude directions as arrays of channel indices.
 * @returns Array containing the included channels.
 */
export const getIncludedChannels = <T extends Array<unknown>>(
    channels: T,
    config: { exclude?: number[], include?: number[] } = {}
): T => {
    // Filter channels, if needed.
    const included = [] as unknown as T
    // Prioritize include -> only process those channels.
    for (let i=0; i<channels.length; i++) {
        if (
            (!config.include && !config.exclude) ||
            // Prioritize includes.
            config.include?.includes(i) ||
            !config.exclude?.includes(i)
        ) {
            included.push(channels[i])
        }
    }
    return included
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
export const interpolateSignalValues = (
    signal: Float32Array,
    targetLen: number,
    start: number,
    sigSR: number,
    targetSR: number
)=> {
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
    const interpolate = (a: number, b: number, v: number) => {
        return a*(1 - v) + b*v
    }
    const interpolatedSig = [] as number[]
    let floor = Math.floor(start)
    const srFactor = sigSR/targetSR
    for (let i=0; i<targetLen; i++) {
        const pos = start + i*srFactor
        if (Math.floor(pos) !== floor && signal.length > Math.floor(pos) + 1) {
            // New interpolation bounds
            floor = Math.floor(pos)
            interpolatedSig.push(signal[floor])
            continue
        }
        if (signal[floor] === signal[floor + 1] || signal.length <= floor + 1) {
            // Both bounds are same or we're past the last datapoint
            interpolatedSig.push(signal[floor])
        } else {
            interpolatedSig.push(interpolate(signal[floor], signal[floor + 1], pos%1))
        }
    }
    return new Float32Array(interpolatedSig)
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
 * Map the derived channels in this montage to the signal channels of the given setup.
 * @param setup - Setup describing the data source.
 * @param config - Biosignal config of the appropriate type and channel layout properties. Expected fields are:
 * *               - `channels` SetupChannel[] - List of channels to include in the montage.
 *                 - `channelSpacing` number - Relative spacing between consecutive channels (default 1).
 *                 - `groupSpacing` number - Relative spacing between consecutive groups (default 1).
 *                 - `isRaw` boolean - Is this a raw setup (default yes).
 *                 - `layout` number[] - Channel layout as number of channels per each group (default no layout).
 *                 - `yPadding` number - Relative extra padding at the ends of the y-axis (default 0).
 */
export const mapMontageChannels = (
    setup: BiosignalSetup,
    config?: {
        channels: SetupChannel[]
        channelSpacing: number
        electrodes: string[]
        groupSpacing: number
        isRaw: boolean
        layout: number[]
        yPadding: number
    }
): MontageChannel[] => {
    /**
     * Helper method for producing a prototype channel and injecting any available properties into it.
     */
    const getChannel = (props?: BiosignalChannelProperties): BiosignalChannelProperties => {
        // If visibility is set in config, use it. Otherwise hide if meta channel.
        const visible = props?.visible !== undefined ? props.visible
                        : props?.modality === 'meta' ? false : true
        const newChan = {
            name: props?.name || '--',
            label: props?.label || '',
            modality: props?.modality || '',
            laterality: props?.laterality || '',
            active: props?.active ?? NUMERIC_ERROR_VALUE,
            reference: props?.reference || [],
            averaged: props?.averaged || false,
            samplingRate: props?.samplingRate || 0,
            sampleCount: props?.sampleCount || 0,
            contralateralChannel: props?.contralateralChannel,
            scale: props?.scale || 0,
            sensitivity: props?.sensitivity || 0,
            displayPolarity: props?.displayPolarity || 0,
            offset: props?.offset || 0.5,
            visible: visible,
            unit: props?.unit || '?',
        } as BiosignalChannelProperties
        return newChan
    }
    /**
     * Helper method for converting biosignal channel properties into montage channels.
     */
    const convertToMontageChannel = (...channels: BiosignalChannelProperties[]): MontageChannel | MontageChannel[] => {
        const montageChannels = channels.map(c => { return {...c, contralateralChannel: null } }) as MontageChannel[]
        for (let i=0; i<montageChannels.length; i++) {
            const contralateral = montageChannels.find(
                c => c.name && c.name === channels[i].contralateralChannel
            ) || null
            montageChannels[i].contralateralChannel = contralateral
        }
        return montageChannels.length === 1 ? montageChannels[0] : montageChannels
    }
    // Check that we have a valid setup.
    if (!setup) {
        Log.error(`Cannot map channels for montage; missing an electrode setup.`, SCOPE)
        return []
    }
    const channels = [] as BiosignalChannelProperties[]
    if (!config) {
        // Construct an 'as recorded' montage.
        for (const chan of setup.channels) {
            channels.push(
                getChannel({
                    label: chan.label,
                    name: chan.name,
                    modality: chan.modality,
                    laterality: chan.laterality,
                    active: chan.index,
                    samplingRate: chan.samplingRate,
                    contralateralChannel: chan.contralateralChannel,
                    scale: chan.scale,
                    displayPolarity: chan.displayPolarity,
                    unit: chan.unit,
                })
            )
        }
        calculateSignalOffsets(channels)
        // Find contralateral channels and convert into montage channel type.
        return convertToMontageChannel(...channels) as MontageChannel[]
    } else {
        // This method makes alterations to the configuration object so clone it to avoid side effects.
        const configClone = deepClone(config)
        if (!configClone) {
            Log.error(`Cannot map montage channels; configuration is not a serializable object.`, SCOPE)
            return []
        }
        config = configClone
    }
    const channelMap: { [name: string]: SetupChannel | null } = {}
    // First map names to correct channel indices.
    name_loop:
    for (const lbl of config.electrodes) {
        for (const sChan of setup.channels) {
            if (lbl === sChan.name) {
                if (lbl.includes('__proto__')) {
                    Log.warn(`Channel label ${lbl} contains insecure field '_proto__', channel was ignored.`, SCOPE)
                    continue
                }
                channelMap[lbl] = sChan
                continue name_loop
            }
        }
        channelMap[lbl] = null // Not found.
    }
    // Next, map active and reference electrodes to correct signal channels.
    config_loop:
    for (const chan of config.channels) {
        // Check that all active channels can be found and have compatible properties.
        let actSR = 0
        let actUnit = ''
        let active = null as number | DerivedChannelProperties | null
        for (const actProps of Array.isArray(chan.active) ? chan.active : [chan.active]) {
            const actIdx = Array.isArray(actProps) ? actProps[0] : actProps
            const actChan = channelMap[actIdx]
            if (actChan === null || actChan === undefined) {
                channels.push(
                    getChannel({
                        label: chan.label,
                        modality: chan.modality,
                        name: chan.name,
                    })
                )
                continue config_loop
            }
            // Check modalities.
            if (actChan.modality !== chan.modality) {
                Log.warn(
                    `Channel '${actChan.name}' has modality '${actChan.modality}' ` +
                    `but montage channel '${chan.label}' has modality '${chan.modality}'.`,
                SCOPE)
                continue config_loop
            }
            // Check sampling rates.
            if (actSR && actSR !== actChan.samplingRate) {
                Log.warn(
                    `Channel '${actChan.name}' has sampling rate '${actChan.samplingRate}' but at least one of the ` +
                    `active channels in montage channel '${chan.label}' has sampling rate '${actSR}'.`,
                SCOPE)
                continue config_loop
            } else if (actSR && chan.samplingRate && actSR !== chan.samplingRate) {
                Log.warn(
                    `Channel '${actChan.name}' has sampling rate '${actChan.samplingRate}' but montage channel ` +
                    `'${chan.label}' has sampling rate '${chan.samplingRate}'.`,
                SCOPE)
                continue config_loop
            } else if (!actSR) {
                // Set the sampling rate for the first active channel.
                actSR = actChan.samplingRate || 0
            }
            // Check units.
            if (actUnit && actUnit !== actChan.unit) {
                Log.warn(
                    `Channel '${actChan.name}' has unit '${actChan.unit}' but at least of of the active channels ` +
                    `in montage channel' ${chan.label}' has unit '${actUnit}'.`,
                SCOPE)
                continue config_loop
            } else if (chan.unit && actChan.unit && chan.unit !== actChan.unit) {
                Log.warn(
                    `Channel '${actChan.name}' has unit '${actChan.unit}' but montage channel ` +
                    `'${chan.label}' has unit '${chan.unit}'.`,
                SCOPE)
                continue config_loop
            } else if (!actUnit && actChan.unit) {
                // Set the unit for the first active channel.
                actUnit = actChan.unit
            }
            if (Array.isArray(chan.active)) {
                // If active is an array, store the channel index and its properties.
                if (active === null) {
                    // Create a new active channel array.
                    active = Array.isArray(actProps) ? [[actChan.index, actProps[1]]] : [actChan.index]
                } else if (Array.isArray(active)) {
                    // If active is an array, add the new channel to it.
                    if (Array.isArray(actProps)) {
                        active.push([actChan.index, actProps[1]])
                    } else {
                        active.push(actChan.index)
                    }
                }
            } else {
                // If active is not an array, just set it to the current channel.
                active = actChan.index
            }
            // Replace possibly empty properties from the source channel if there is only one active source.
            if (!Array.isArray(actProps)) {
                chan.laterality ||= actChan.laterality
                chan.polarity ||= actChan.displayPolarity
                chan.samplingRate ||= actChan.samplingRate
                chan.scale ||= actChan.scale
                chan.unit ||= actChan.unit
            }
        }
        const refs = [] as DerivedChannelProperties
        if (chan.reference.length) {
            for (const ref of chan.reference) {
                // Check that all reference channels can be found and have the right sampling rate.
                const refIdx = Array.isArray(ref) ? ref[0] : ref
                // Store this in a separate const to avoid Typescript linter errors.
                const refChan = channelMap[refIdx]
                if (refChan === null || refChan === undefined) {
                    Log.warn(
                        `Reference channel ${refIdx} for montage channel ${chan.label} not found in setup.`,
                    SCOPE)
                    continue
                }
                if (refChan.modality !== chan.modality) {
                    Log.warn(
                        `Reference channel ${refChan.name} has modality ${refChan.modality} ` +
                        `but montage channel ${chan.label} has modality ${chan.modality}.`,
                    SCOPE)
                    continue
                }
                if (refChan.samplingRate && refChan.samplingRate !== actSR) {
                    Log.warn(
                        `Reference channel ${refChan.name} has sampling rate ${refChan.samplingRate} ` +
                        `but montage channel ${chan.label} has active channel sampling rate ${actSR}.`,
                    SCOPE)
                    continue
                }
                refs.push(Array.isArray(ref) ? [refChan.index, ref[1]] : refChan.index)
            }
            if (!refs.length) {
                // Not a single reference channel found.
                channels.push(
                    getChannel({
                        label: chan.label,
                        name: chan.name,
                    })
                )
            } else {
                // Construct the channel.
                channels.push(
                    getChannel({
                        label: chan.label,
                        name: chan.name,
                        modality: chan.modality,
                        laterality: chan.laterality,
                        active: active ?? undefined,
                        reference: refs,
                        averaged: chan.averaged,
                        samplingRate: chan.samplingRate || actSR,
                        contralateralChannel: chan.contralateralChannel,
                        scale: chan.scale,
                        displayPolarity: chan.polarity,
                        unit: chan.unit || actUnit,
                    })
                )
            }
        } else {
            // This is an as-recorded channel without a reference.
            channels.push(
                getChannel({
                    label: chan.label,
                    name: chan.name,
                    modality: chan.modality,
                    laterality: chan.laterality,
                    active: active ?? undefined,
                    samplingRate: actSR,
                    contralateralChannel: chan.contralateralChannel,
                    scale: chan.scale,
                    displayPolarity: chan.polarity,
                    unit: chan.unit || actUnit,
                })
            )
        }
    }
    // Calculate signal offsets for the loaded channels.
    calculateSignalOffsets(
        channels,
        {
            channelSpacing: config.channelSpacing || 1,
            groupSpacing: config.groupSpacing || 1,
            isRaw: false,
            layout: config.layout || [],
            yPadding: config.yPadding || 1,
        }
    )
    return convertToMontageChannel(...channels) as MontageChannel[]
}

/**
 * Maps given signals to corresponding sampling rates.
 * @param signals - Signals as Float32Array.
 * @param channels - Montage channels.
 * @returns ```
 * { data: signals[i], samplingRate: channelSamplingRate[i] }
 * ```
 */
export const mapSignalsToSamplingRates = (signals: Float32Array[], channels: BiosignalChannel[]) => {
    let i = 0
    return signals.map((sig) => {
        return { data: sig, samplingRate: channels[i++]?.samplingRate || 0 }
    })
}

/**
 * Check which part of the range in a given signal cache part is not already covered by the given set of already cached
 * signal parts.
 * This method does not check the already cached parts for overlap.
 * @param partToCheck part to check the not cached range of
 * @param cachedParts already cached signal parts
 * @return SignalCacheParts with the range and signal data adjusted
 */
export const partsNotCached = (partToCheck: SignalCachePart, ...cachedParts: SignalCachePart[]): SignalCachePart[] => {
    const notCached = [{ start: partToCheck.start, end: partToCheck.end }] as SignalCachePart[]
    for (const cached of cachedParts.sort((a, b) => a.start - b.start)) {
        // First check if the entire part has already been cached.
        if (cached.start <= partToCheck.start && cached.end >= partToCheck.end) {
            return []
        }
        for (let i=0; i<notCached.length; i++) {
            const part = notCached[i]
            if (cached.start <= part.start && cached.end >= part.end) {
                // Entire part has already been cached, remove it.
                notCached.splice(i, 1)
                if (!notCached.length) {
                    // Nothing left to check.
                    return notCached
                }
                i--
            } else if (cached.start > part.start && cached.end < part.end) {
                // A portion in the middle has been already cached, so split the part in two.
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
                // End of the part has not been cached.
                part.start = cached.end
            } else if (cached.start > part.start && cached.start < part.end) {
                // Start of the part has not been cached.
                part.end = cached.start
            }
        }
    }
    // Finally, add actual signal data to notCached parts.
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
 *
 * **Note**: This method can currently only downsample signals.
 * @param signal - Original signal to resample.
 * @param targetLen - Desired length (number of samples) for the signal; must be less than original signal length.
 * @returns Float32Array with the original signal resampled to target length.
 */
export const resampleSignal = (signal: Float32Array, targetLen: number) => {
    if (targetLen > signal.length) {
        Log.error(`Cannot resample to a higher sampling rate.`, SCOPE)
        return signal
    }
    let i = 0
    const data = [] as { x: number, y: number}[]
    for (const sample of signal) {
        data.push({ x: i, y: sample})
        i++
    }
    return Float32Array.from(
        (LTTB(data, targetLen) as unknown as Array<{ y: number }>).map((p) => p.y)
    )
}

/**
 * A helper method to determine if the signal on the given `channel` should be filtered or not.
 * @param channel - Channel containing the signal.
 * @param defaultFilters - Default filters for this recording.
 * @param settings - Settings for the recording type.
 * @returns True/false.
 */
export const shouldFilterSignal = (
    channel: BiosignalChannel,
    defaultFilters: BiosignalFilters,
    settings: CommonBiosignalSettings
) => {
    return Object.values(getChannelFilters(channel, defaultFilters, settings)).some(v => {
        if (Array.isArray(v)) {
            // There are bandreject filters to apply.
            return v.length > 0
        }
        // There is a highpass, lowpass or notch filter to apply.
        return v > 0
    })
}

/**
 * Check if the given channel should be displayed on the trace.
 * @param channel - The channel to check.
 * @param useRaw - Consider the montage to contain raw signals.
 * @param config - Additional configuration, specifically:
 *                 - `showHiddenChannels` boolean - Show an empty space where a hidden channel should be.
 *                 - `showMissingChannels` boolean - Show an empty space where a missing channel should be.
 */
export const shouldDisplayChannel = (
    channel: BiosignalChannelProperties | MontageChannel | null,
    useRaw: boolean,
    config?: {
        showHiddenChannels: boolean
        showMissingChannels: boolean
    }
) => {
    if (!channel || !channel.modality || channel.modality === 'meta') {
        return false
    } else if (useRaw) {
        return true
    } else if (channel.active === NUMERIC_ERROR_VALUE && !config?.showMissingChannels) {
        return false
    } else if (!channel.visible && !config?.showHiddenChannels) {
        return false
    }
    return true
}
