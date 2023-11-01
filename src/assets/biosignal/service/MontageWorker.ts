/**
 * Default biosignal montage worker.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalSetup,
    type GetSignalsResponse,
    type MontageChannel,
    type ReleaseBuffersResponse,
    type SetFiltersResponse,
    type SetupChannel,
    type SetupMutexResponse,
    type SetupSharedWorkerResponse,
    type WorkerSignalCache,
} from '#types/biosignal'
import {
    type CommonBiosignalSettings,
    type ConfigChannelFilter,
    type ConfigMapChannels,
} from '#types/config'
import {
    type SignalCachePart,
    type SignalCacheResponse,
    type WorkerMessage,
} from '#types/service'
import BiosignalMutex from '../service/BiosignalMutex'
import GenericBiosignalSetup from '../components/GenericBiosignalSetup'
import IOMutex, { MutexExportProperties } from 'asymmetric-io-mutex'
import { concatFloat32Arrays, filterSignal, getFilterPadding, mapMontageChannels, shouldDisplayChannel, shouldFilterSignal } from '#util/signal'
import { NUMERIC_ERROR_VALUE } from '#util/constants'
import { log } from '#util/worker'

const SCOPE = "MontageWorker"

let CACHE: BiosignalMutex | WorkerSignalCache | null = null
let CHANNELS = [] as MontageChannel[]
//let MONTAGE: BiosignalMontage | null = null
let SETUP: BiosignalSetup | null = null
let TOTAL_CACHE_LENGTH = 0
let TOTAL_RECORDING_LENGTH = 0
const CONFIG = {}
const DATA_GAPS = new Map<number, number>()
const FILTERS = {
    highpass: 0,
    lowpass: 0,
    notch: 0,
}
const SETTINGS = {
    modules: {},
} as {
    modules: {
        [key: string]: CommonBiosignalSettings
    }
}
let NAMESPACE = ''

onmessage = async (message: WorkerMessage) => {
    if (!message?.data?.action) {
        return
    }
    const action = message.data.action
    if (action === 'settings-namespace') {
        const namespace = message.data.value as string
        if (!namespace) {
            return
        }
        NAMESPACE = namespace
        // Add settings to keep in sync.
        // TODO: Send these properties to main thread and only update them if needed.
        // UPDATES.push(`modules.${NAMESPACE}.channelSpacing`)
        // UPDATES.push(`modules.${NAMESPACE}.filterPaddingSeconds`)
        // UPDATES.push(`modules.${NAMESPACE}.groupSpacing`)
        // UPDATES.push(`modules.${NAMESPACE}.montages.precache`)
        // UPDATES.push(`modules.${NAMESPACE}.showHiddenChannels`)
        // UPDATES.push(`modules.${NAMESPACE}.showMissingChannels`)
        // UPDATES.push(`modules.${NAMESPACE}.yPadding`)
        // syncSettings(UPDATES, postMessage)
        return
    } else if (action === 'update-settings') {
        Object.assign(SETTINGS, message.data.settings)
    } //else if (syncSettings(SETTINGS, message)) {
    //    return
    //}
    if (action === 'get-signals') {
        if (!CACHE) {
            log(postMessage, 'ERROR', `Requested signals when signal cache is not yet initialized.`, SCOPE)
            postMessage({
                action: 'get-signals',
                success: false,
                rn: message.data.rn,
            })
            return
        }
        try {
            const range = message.data.range as number[]
            const config = message.data.config as ConfigChannelFilter | undefined
            const sigs = await getSignals(range, config) as SignalCacheResponse
            if (sigs) {
                postMessage({
                    action: action,
                    success: true,
                    rn: message.data.rn,
                    ...sigs
                } as GetSignalsResponse)
            } else {
                postMessage({
                    action: action,
                    success: false,
                    rn: message.data.rn,
                } as GetSignalsResponse)
            }
        } catch (e) {
            console.error(e)
        }
    } else if (action === 'map-channels') {
        const config = message.data.config as ConfigMapChannels
        mapChannels(config)
    } else if (action === 'release-buffer') {
        await releaseBuffers()
        postMessage({
            action: action,
            success: true,
            rn: message.data.rn,
        } as ReleaseBuffersResponse)
    } else if (action === 'set-data-gaps') {
        DATA_GAPS.clear()
        const dataGaps = message.data.dataGaps as { start: number, duration: number }[]
        for (const gap of dataGaps) {
            DATA_GAPS.set(gap.start, gap.duration)
        }
    } else if (action === 'set-filters') {
        const newFilters = JSON.parse(message.data.filters as string) as typeof FILTERS
        let someUpdated = false
        if (newFilters.highpass !== FILTERS.highpass) {
            setHighpassFilter('eeg', newFilters.highpass)
            someUpdated = true
        }
        if (newFilters.lowpass !== FILTERS.lowpass) {
            setLowpassFilter('eeg', newFilters.lowpass)
            someUpdated = true
        }
        if (newFilters.notch !== FILTERS.notch) {
            setNotchFilter('eeg', newFilters.notch)
            someUpdated = true
        }
        if (message.data.channels) {
            const channels = message.data.channels as { highpass: number, lowpass: number, notch: number }[]
            for (let i=0; i<channels.length; i++) {
                const chan = channels[i]
                if (chan.highpass !== CHANNELS[i].highpassFilter) {
                    setHighpassFilter(i, chan.highpass)
                    someUpdated = true
                }
                if (chan.lowpass !== CHANNELS[i].lowpassFilter) {
                    setLowpassFilter(i, chan.lowpass)
                    someUpdated = true
                }
                if (chan.notch !== CHANNELS[i].notchFilter) {
                    setNotchFilter(i, chan.notch)
                    someUpdated = true
                }
            }
        }
        postMessage({
            action: action,
            success: true,
            updated: someUpdated,
            rn: message.data.rn,
        } as SetFiltersResponse)
    } else if (action === 'setup-input-mutex') {
        if (await setupInputMutex(
                message.data.montage as string,
                message.data.config as ConfigMapChannels,
                message.data.input as MutexExportProperties,
                message.data.bufferStart as number,
                message.data.dataDuration as number,
                message.data.recordingDuration as number,
                message.data.setupChannels as SetupChannel[]
            )
        ) {
            // Pass the generated shared buffers back to main thread.
            postMessage({
                action: action,
                cacheProperties: (CACHE as BiosignalMutex)?.propertiesForCoupling,
                success: true,
                rn: message.data.rn,
            } as SetupMutexResponse)
        } else {
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            } as SetupMutexResponse)
        }
    } else if (action === 'setup-shared-worker') {
        const setupSuccess = await setupSharedWorker(
            message.data.montage as string,
            message.data.config as ConfigMapChannels,
            message.data.port as MessagePort,
            message.data.dataDuration as number,
            message.data.recordingDuration as number,
            message.data.setupChannels as SetupChannel[]
        )
        if (setupSuccess) {
            postMessage({
                action: action,
                success: true,
                rn: message.data.rn,
            } as SetupSharedWorkerResponse)
        } else {
            postMessage({
                action: action,
                success: false,
                rn: message.data.rn,
            } as SetupSharedWorkerResponse)
        }
    }
}

/**
 * Convert cache time (i.e. time without data gaps) to recording time.
 * @param time - Cache time without gaps.
 * @return Matching recording time (with gaps).
 */
const cacheTimeToRecordingTime = (time: number): number => {
    if (!CACHE) {
        log(postMessage, 'ERROR', `Cannot convert cache time to recording time before cache has been set up.`, SCOPE)
        return NUMERIC_ERROR_VALUE
    }
    if (time === NUMERIC_ERROR_VALUE) {
        return time
    }
    if (time < 0) {
        log(postMessage, 'ERROR', `Cannot convert negative cache time to recording time.`, SCOPE)
        return NUMERIC_ERROR_VALUE
    }
    if (time === 0) {
        return 0
    }
    let priorGapsTotal = 0
    for (const gap of DATA_GAPS) {
        if (gap[0] < time) {
            priorGapsTotal += gap[1]
        }
    }
    return time + priorGapsTotal
}

/**
 * Get montage signals for the given part.
 * @param start - Part start (in seconds, included).
 * @param end - Part end (in seconds, excluded).
 * @param cachePart - Should the caculated signals be cached (default true).
 * @param config - Additional configuration (optional).
 * @returns False if an error occurred and depending on the value of parameter `cachePart`:
 *          - If true, returns true if caching was successful.
 *          - If false, calculated signals as SignalCachePart.
 */
const calculateSignalsForPart = async (
    start: number,
    end: number,
    cachePart = true,
    config?: ConfigChannelFilter & { excludeActiveFromAvg?: boolean }
) => {
    // Check that cache is ready.
    if (!CACHE) {
        log(postMessage, 'ERROR', "Cannot return signal part, signal buffers have not been set up yet.", SCOPE)
        return false
    }
    const cacheStart = recordingTimeToCacheTime(start)
    const cacheEnd = recordingTimeToCacheTime(end)
    // Check that cache has the part that we need.
    const inputRangeStart = await CACHE.inputRangeStart
    const inputRangeEnd = await CACHE.inputRangeEnd
    if (
        inputRangeStart === null || cacheStart < inputRangeStart ||
        inputRangeEnd === null || (cacheEnd > inputRangeEnd && inputRangeEnd < TOTAL_CACHE_LENGTH)
    ) {
        // TODO: Signal that the required part must be loaded by the file loader first.
        log(postMessage, 'ERROR', "Cannot return signal part, requested raw signals have not been loaded yet.", SCOPE)
        return false
    }
    const relStart = cacheStart - inputRangeStart
    const relEnd = cacheEnd - inputRangeStart
    const derivedSignals = [] as { data: Float32Array, samplingRate: number }[]
    // Only calculate averages once.
    const avgMap = [] as number[]
    // Filter channels, if needed.
    const channels = (config?.include?.length || config?.exclude?.length)
                     ? [] as MontageChannel[] : CHANNELS
    // Prioritize include -> only process those channels.
    if (config?.include?.length) {
        for (const c of config.include) {
            channels.push(CHANNELS[c])
        }
    } else if (config?.exclude?.length) {
        for (let i=0; i<CHANNELS.length; i++) {
            if (config.exclude.indexOf(i) === -1) {
                channels.push(CHANNELS[i])
            }
        }
    }
    // Get the input signals
    const SIGNALS = await CACHE.inputSignals
    const padding = SETTINGS.modules[`${NAMESPACE}`].filterPaddingSeconds || 0
    // Check for possible gaps in this range.
    const filtStart = cacheStart - padding > 0 ? cacheStart - padding : 0
    const filtEnd = cacheEnd + padding < TOTAL_CACHE_LENGTH
                   ? cacheEnd + padding : TOTAL_CACHE_LENGTH
    const dataGaps = getDataGaps([filtStart, filtEnd], true)
    for (let i=0; i<channels.length; i++) {
        const chan = channels[i]
        const sigProps = {
            data: new Float32Array(),
            samplingRate: chan.samplingRate
        }
        // Remove missing and inactive channels.
        if (!shouldDisplayChannel(chan, false, SETTINGS.modules[`${NAMESPACE}`])) {
            derivedSignals.push(sigProps)
            continue
        }
        // Check if whole range is just data gap.
        for (const gap of dataGaps) {
            const gapStartRecTime = cacheTimeToRecordingTime(gap.start)
            if (gapStartRecTime <= start && gapStartRecTime + gap.duration >= end) {
                derivedSignals.push(sigProps)
                continue
            }
        }
        const highpass = chan.highpassFilter !== null ? chan.highpassFilter : FILTERS.highpass
        const lowpass = chan.lowpassFilter !== null ? chan.lowpassFilter : FILTERS.lowpass
        const notch = chan.notchFilter !== null ? chan.notchFilter : FILTERS.notch
        // Get filter padding for the channel.
        const {
            filterLen, filterStart, filterEnd,
            //paddingStart, paddingEnd,
            //rangeStart, rangeEnd,
            //signalStart, signalEnd,
        } = getFilterPadding([relStart, relEnd] || [], SIGNALS[chan.active].length, chan, SETTINGS.modules[`${NAMESPACE}`], FILTERS)
        // Calculate signal indices for data gaps.
        const gapIndices = [] as number[][]
        let totalGapLen = 0
        for (const gap of dataGaps) {
            const gapStart = totalGapLen + Math.round((gap.start - filtStart)*chan.samplingRate)
            if (gapStart > filterEnd - filterStart) {
                continue
            }
            // Apply a maximum of filter padding length of gap.
            const gapEnd = gapStart + Math.round(
                Math.min(
                    gap.duration*chan.samplingRate,
                    padding*chan.samplingRate,
                )
            )
            gapIndices.push([gapStart, gapEnd])
            totalGapLen += gapEnd - gapStart
        }
        // Need to calculate signal relative to reference(s), one datapoint at a time.
        // Check that active signal and all reference signals have the same length.
        const refs = [] as number[]
        for (const ref of chan.reference) {
            if (SIGNALS[chan.active].length === SIGNALS[ref].length) {
                refs.push(ref)
            }
        }
        // We must preserve space for padding on both ends of the signal array.
        const padded = new Float32Array(filterEnd - filterStart)
        let j = 0
        for (let n=filterStart; n<filterEnd; n++) {
            let refAvg = 0
            // Just add zero if we are outside tha actual signal range.
            if (n < 0 || n >= SIGNALS[chan.active].length) {
                padded.set([0], j)
                j++
                continue
            }
            // Check if the average for this particular datapoint has already been calculated.
            if (chan.averaged && avgMap[j] !== undefined) {
                refAvg = avgMap[j]
            } else {
                if (refs.length > 1) {
                    // Calculate average reference and cache it.
                    for (const ref of refs) {
                        refAvg += SIGNALS[ref][n]
                    }
                    refAvg /= refs.length
                    avgMap[j] = refAvg
                } else if (!refs.length) {
                    refAvg = 0
                } else {
                    refAvg = SIGNALS[refs[0]][n]
                }
            }
            if (config?.excludeActiveFromAvg) {
                // Doing this correction separately may seem overly complicated, but if we want
                // to cache the average value, it must contain values from all channels.
                refAvg -= SIGNALS[chan.active][n]/refs.length
                refAvg *= refs.length/(refs.length - 1)
            }
            padded.set([(SIGNALS[chan.active][n] - refAvg)], j)
            j++
        }
        if (shouldFilterSignal(FILTERS, chan)) {
            // Add possible data gaps.
            let gapped = padded
            let lastGapEnd = 0
            const sigParts = [] as Float32Array[]
            for (const gap of gapIndices) {
                if (lastGapEnd < gap[0]) {
                    sigParts.push(gapped.slice(lastGapEnd, gap[0]))
                }
                const gapSig = new Float32Array(gap[1] - gap[0])
                gapSig.fill(0.0)
                sigParts.push(gapSig)
                sigParts.push(gapped.slice(gap[0]))
                gapped = concatFloat32Arrays(...sigParts)
                lastGapEnd = gap[1]
            }
            sigProps.data = filterSignal(
                gapped,
                chan.samplingRate,
                highpass,
                lowpass,
                notch,
            )
            // Remove the gap parts in reverse order.
            for (const gap of gapIndices.reverse()) {
                sigProps.data = concatFloat32Arrays(
                    sigProps.data.slice(0, gap[0]),
                    sigProps.data.slice(gap[1])
                )
            }
            sigProps.data = sigProps.data.slice(filterLen, sigProps.data.length - filterLen)
        } else {
            sigProps.data = padded
        }
        derivedSignals.push(sigProps)
    }
    if (cachePart) {
        // Finally, assign the signals to out montage mutex.
        await CACHE.insertSignals({
            start: cacheStart,
            end: cacheEnd,
            signals: derivedSignals
        })
        const updated = await getSignalUpdatedRange()
        postMessage({
            action: 'cache-signals',
            range: [updated.start, updated.end]
        })
        return true
    } else {
        return derivedSignals as SignalCachePart['signals']
    }
}
/**
 * Retrieve data gaps in the given `range`.
 * @param range - time range to check in seconds
 * @param useCacheTime - consider range in cache time (without data gaps, default false)
 * @returns
 */
const getDataGaps = (range?: number[], useCacheTime = false): { duration: number, start: number }[] => {
    const start = range ? range[0] : 0
    let end = range ? range[1] : (useCacheTime ? TOTAL_CACHE_LENGTH : TOTAL_RECORDING_LENGTH)
    const dataGaps = [] as { duration: number, start: number }[]
    if (start < 0) {
        log(postMessage, 'ERROR', `Requested data gap range start ${start} is smaller than zero.`, SCOPE)
        return dataGaps
    }
    if (start >= end) {
        log(postMessage, 'ERROR', `Requested data gap range ${start} - ${end} is not valid.`, SCOPE)
        return dataGaps
    }
    if (useCacheTime && end > TOTAL_CACHE_LENGTH) {
        end = TOTAL_CACHE_LENGTH
    } else if (end > TOTAL_RECORDING_LENGTH) {
        end = TOTAL_RECORDING_LENGTH
    }
    let priorGapsTotal = 0
    for (const gap of DATA_GAPS) {
        const gapTime = useCacheTime ? gap[0] - priorGapsTotal : gap[0]
        priorGapsTotal += gap[1]
        if ((useCacheTime ? gapTime : gapTime + gap[1]) <= start) {
            continue
        } else if (!useCacheTime && gapTime < start && gapTime + gap[1] > start) {
            // Prior gap partially extends to the checked range
            if (gapTime + gap[1] < end) {
                dataGaps.push({ start: start, duration: gapTime + gap[1] - start })
            } else {
                dataGaps.push({ start: start, duration: end - start })
                break
            }
        } else if (gapTime >= start && gapTime < end) {
            if (useCacheTime || gapTime + gap[1] < end) {
                dataGaps.push({ start: gapTime, duration: gap[1] })
            } else {
                dataGaps.push({ start: gapTime, duration: end - gapTime })
                break
            }
        } else {
            break
        }
    }
    return dataGaps
}

const getGapTimeBetween = (start: number, end: number): number => {
    if (!CACHE) {
        return 0
    }
    let gapTotal = 0
    for (const gap of getDataGaps([start, end])) {
        gapTotal += gap.duration
    }
    return gapTotal
}

/**
 * Get signals for the given part.
 * @param range - Range in seconds as [start (included), end (excluded)].
 * @param config - Optional configuration.
 * @returns
 */
const getSignals = async (range: number[], config?: ConfigChannelFilter) => {
    if (!CHANNELS) {
        log(postMessage, 'ERROR', "Cannot load signals, channels have not been set up yet.", SCOPE)
        return null
    }
    if (!CACHE) {
        log(postMessage, 'ERROR', "Cannot load signals, signal buffers have not been set up yet.", SCOPE)
        return null
    }
    let requestedSigs: SignalCachePart | null = null
    const cacheStart = await CACHE.outputRangeStart
    const cacheEnd = await CACHE.outputRangeEnd
    if (cacheStart === null || cacheEnd === null) {
        log(postMessage, 'ERROR', `Loading signals for range [${range[0]}, ${range[1]}] failed.`, SCOPE)
        return null
    }
    // If pre-caching is enabled, check the cache for existing signals for this range.
    const updated = SETTINGS.modules[`${NAMESPACE}`].montages.preCache && await getSignalUpdatedRange()
    if (!updated || updated.start === NUMERIC_ERROR_VALUE ||  updated.start > range[0] || updated.end < range[1]) {
        // Retrieve missing signals (result channels will be filtered according to include/exclude).
        const signals = await calculateSignalsForPart(range[0], range[1], false, config)
        if (signals) {
            requestedSigs = {
                start: recordingTimeToCacheTime(range[0]),
                end: recordingTimeToCacheTime(range[1]),
                signals: signals as SignalCachePart['signals']
            }
        } else {
            log(postMessage, 'ERROR', `Cound not cache requested signal range ${range[0]} - ${range[1]}.`, SCOPE)
            return null
        }
    } else {
        // Use cached signals.
        requestedSigs = await CACHE.asCachePart()
        // Filter channels, if needed.
        if (config?.include?.length || config?.exclude?.length) {
            const filtered = [] as typeof requestedSigs.signals
            // Prioritize include -> only process those channels.
            if (config?.include?.length) {
                for (const c of config.include) {
                    filtered.push(requestedSigs.signals[c])
                }
            } else if (config?.exclude?.length) {
                for (let i=0; i<CHANNELS.length; i++) {
                    if (config.exclude.indexOf(i) === -1) {
                        filtered.push(requestedSigs.signals[i])
                    }
                }
            }
            requestedSigs.signals = filtered
        }
    }
    // Find amount of gap time before and within the range.
    const dataGaps = getDataGaps(range)
    if (!dataGaps.length) {
        return requestedSigs
    }
    const priorGapsTotal = range[0] > 0 ? getGapTimeBetween(0, range[0]) : 0
    const gapsTotal = getGapTimeBetween(0, range[1])
    const rangeStart = range[0] - priorGapsTotal
    const rangeEnd = range[1] - gapsTotal
    const responseSigs = [] as SignalCachePart['signals']
    for (let i=0; i<requestedSigs.signals.length; i++) {
        const signalForRange = new Float32Array(Math.round((range[1] - range[0])*requestedSigs.signals[i].samplingRate)).fill(0.0)
        if (rangeStart === rangeEnd) {
            // The whole range is just gap space.
            requestedSigs.signals[i].data = signalForRange
            continue
        }
        const startSignalIndex = Math.round((rangeStart - requestedSigs.start)*requestedSigs.signals[i].samplingRate)
        const endSignalIndex = Math.round((rangeEnd - requestedSigs.start)*requestedSigs.signals[i].samplingRate)
        signalForRange.set(requestedSigs.signals[i].data.slice(startSignalIndex, endSignalIndex))
        for (const gap of dataGaps) {
            const startPos = Math.round((gap.start - range[0])*requestedSigs.signals[i].samplingRate)
            const endPos = Math.min(
                startPos + Math.round(gap.duration*requestedSigs.signals[i].samplingRate),
                startPos + signalForRange.length
            )
            // Move the existing array members upward.
            const remainder = signalForRange.slice(
                startPos,
                startPos + signalForRange.length - endPos
            )
            if (endPos < signalForRange.length) {
                signalForRange.set(remainder, endPos)
            }
            // Replace with zeroes.
            signalForRange.set(
                new Float32Array(endPos - startPos).fill(0.0),
                startPos
            )
        }
        requestedSigs.signals[i].data = signalForRange
    }
    return requestedSigs
}

/**
 * Get current signal cache range.
 * @returns Range as { start: number, end: number } measured in seconds >= 0 or NUMERIC_ERROR_VALUE if an error occurred.
 *
const getSignalCacheRange = async () => {
    if (!CACHE) {
        return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
    }
    const rangeStart = await CACHE.outputRangeStart
    const rangeEnd = await CACHE.outputRangeEnd
    if (rangeStart === null || rangeEnd === null) {
        log(postMessage, 'ERROR', `Montage signal mutex did not report a valid range: start (${rangeStart}) or end (${rangeEnd}).`, SCOPE)
        return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
    }
    return { start: rangeStart, end: rangeEnd }
}
*/

/**
 * Get the largest start and lowest end updated data range (in seconds) for the signals.
 * @returns Range as { start: number, end: number } measured in seconds or NUMERIC_ERROR_VALUE if an error occurred.
 */
 const getSignalUpdatedRange = async () => {
    if (!CACHE) {
        return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
    }
    const ranges = CACHE.outputSignalUpdatedRanges
    const srs = CACHE.outputSignalSamplingRates
    let highestStart = NUMERIC_ERROR_VALUE
    let lowestEnd = NUMERIC_ERROR_VALUE
    for (let i=0; i<ranges.length; i++) {
        const sr = await srs[i]
        if (!sr) {
            // Empty or missing channel, skip
            continue
        }
        const range = await ranges[i]
        if (!range) {
            log(postMessage, 'ERROR', `Montage signal mutex did not report a valid updated range for signal at index ${i}.`, SCOPE)
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        const tStart = range.start/sr
        const tEnd = range.end/sr
        if (range.start !== IOMutex.EMPTY_FIELD) {
            highestStart = (highestStart === NUMERIC_ERROR_VALUE || tStart > highestStart) ? tStart : highestStart
        } else {
            log(postMessage, 'WARN', `Signal #${i} has not updated start position set.`, SCOPE)
        }
        if (range.end !== IOMutex.EMPTY_FIELD) {
            lowestEnd = (lowestEnd === NUMERIC_ERROR_VALUE || tEnd < lowestEnd) ? tEnd : lowestEnd
        } else {
            log(postMessage, 'WARN', `Signal #${i} has not updated end position set.`, SCOPE)
        }
    }
    if (highestStart === NUMERIC_ERROR_VALUE && lowestEnd === NUMERIC_ERROR_VALUE) {
        log(postMessage, 'ERROR', `Cannot get ranges of updated signals, cache has no initialized signals.`, SCOPE)
        return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
    }
    return { start: cacheTimeToRecordingTime(highestStart), end: cacheTimeToRecordingTime(lowestEnd) }
}
/**
 * Get a list of only the channels that are visible.
 * @returns Channels that should be displayed.
 *
const getVisibleChannels = () => {
    return CHANNELS.filter(c => shouldDisplayChannel(c, false, SETTINGS.modules[`${NAMESPACE}`]))
}
*/
/**
 * Map the derived channels in this montage to the signal channels of the given setup.
 * @param config - Either string code of a default config or a config object.
 */
const mapChannels = (config: ConfigMapChannels) => {
    // Check that we have a valid setup.
    if (!SETUP) {
        log(postMessage, 'ERROR', `Cannot map channels for montage; missing an electrode setup!`, SCOPE)
        return
    }
    // Reset channels for the new mapping.
    const channelConfig = Object.assign({}, SETTINGS.modules[`${NAMESPACE}`], config)
    CHANNELS = mapMontageChannels(SETUP, channelConfig)
    if (config) {
        // Save config for later offset calculation etc.
        Object.assign(CONFIG, config)
    }
}

/**
 * Convert recording time to cache time (i.e. time without data gaps).
 * @param time - Recording time.
 * @return Matching cache time (without gaps).
 */
const recordingTimeToCacheTime = (time: number): number => {
    if (!CACHE) {
        log(postMessage, 'ERROR', `Cannot convert recording time to cache time before cache has been set up.`, SCOPE)
        return NUMERIC_ERROR_VALUE
    }
    if (time === NUMERIC_ERROR_VALUE) {
        return time
    }
    if (time < 0) {
        log(postMessage, 'ERROR', `Cannot convert negative recording time to cache time.`, SCOPE)
        return NUMERIC_ERROR_VALUE
    }
    if (time === 0) {
        return 0
    }
    return time - getGapTimeBetween(0, time)
}

/**
 * Release buffers removing all references to them and decomissioning this worker.
 */
const releaseBuffers = async () => {
    CACHE?.releaseBuffers()
    CACHE = null
}

/**
 * Remove all channels from this montage.
 *
const resetChannels = () => {
    CHANNELS = []
}
*/
/**
 * Set high-pass filter value for given channel. Pass undefined to unset individual filter value.
 * @param target - Channel index or type (applies too all channels of the given type).
 * @param value - Frequency value or undefined.
 */
const setHighpassFilter = (target: string | number, value: number) => {
    if (typeof target === 'number') {
        CHANNELS[target].highpassFilter = value
        CACHE?.invalidateOutputSignals([value])
    } else {
        FILTERS.highpass = value
        CACHE?.invalidateOutputSignals()
    }
}

/**
 * Set low-pass filter value for given channel. Pass undefined to unset individual filter value.
 * @param target - Channel index or type (applies too all channels of the given type).
 * @param value - Frequency value or undefined.
 */
const setLowpassFilter = (target: string | number, value: number) => {
    if (typeof target === 'number') {
        CHANNELS[target].lowpassFilter = value
        CACHE?.invalidateOutputSignals([value])
    } else {
        FILTERS.lowpass = value
        CACHE?.invalidateOutputSignals()
    }
}

/**
 * Set notch filter value for given channel. Pass undefined to unset individual filter value.
 * @param target - Channel index or type (applies too all channels of the given type).
 * @param value - Frequency value or undefined.
 */
const setNotchFilter = (target: string | number, value: number) => {
    if (typeof target === 'number') {
        CHANNELS[target].notchFilter = value
        CACHE?.invalidateOutputSignals([value])
    } else {
        FILTERS.notch = value
        CACHE?.invalidateOutputSignals()
    }
}

/**
 * Set study params for file loading. This will format the shared array buffer for storing
 * the signal data and can only be done once.
 * @param montage - Montage name.
 * @param config - Montage configuration.
 * @param input - Properties of the input data mutex.
 * @param bufferStart - Starting index of the montage mutex array in the buffer.
 * @param dataDuration - duration of actual signal data in seconds
 * @param recordingDuration - total duration of the recording (including gaps) in seconds
 * @param setupChannels - channel configuration of the montage setup
 * @param dataGaps - possible data gaps in the recording
 */
const setupInputMutex = async (
    montage: string,
    config: ConfigMapChannels,
    input: MutexExportProperties,
    bufferStart: number,
    dataDuration: number,
    recordingDuration: number,
    setupChannels: SetupChannel[],
    dataGaps = [] as { duration: number, start: number }[]
) => {
    SETUP = new GenericBiosignalSetup(montage)
    SETUP.channels = setupChannels
    mapChannels(config)
    // Construct a SignalCachePart to initialize the mutex.
    const cacheProps = {
        start: 0,
        end: 0,
        signals: []
    } as SignalCachePart
    for (const chan of CHANNELS) {
        const samplingRate =  chan?.samplingRate || 0
        cacheProps.signals.push({
            data: new Float32Array(),
            samplingRate: samplingRate
        })
    }
    TOTAL_CACHE_LENGTH = dataDuration
    TOTAL_RECORDING_LENGTH = recordingDuration
    for (const gap of dataGaps) {
        DATA_GAPS.set(gap.start, gap.duration)
    }
    // Use input mutex properties as read buffers.
    CACHE = new BiosignalMutex(
            undefined,
            input
        )
    await CACHE.initSignalBuffers(cacheProps, dataDuration, input.buffer, bufferStart)
    return true
}

/**
 * Set study params for file loading. This will use a shared worker to query for raw signal data.
 * @param montage - Montage name.
 * @param config - Montage configuration.
 * @param input - Message port from the input worker.
 * @param dataDuration - duration of actual signal data in seconds
 * @param recordingDuration - total duration of the recording (including gaps) in seconds
 * @param setupChannels - channel configuration of the montage setup
 * @param dataGaps - possible data gaps in the recording
 */
const setupSharedWorker = async (
    montage: string,
    config: ConfigMapChannels,
    input: MessagePort,
    dataDuration: number,
    recordingDuration: number,
    setupChannels: SetupChannel[],
    dataGaps = [] as { duration: number, start: number }[]
) => {
    SETUP = new GenericBiosignalSetup(montage)
    SETUP.channels = setupChannels
    mapChannels(config)
    // Construct a SignalCachePart to initialize the mutex.
    const cacheProps = {
        start: 0,
        end: 0,
        signals: []
    } as SignalCachePart
    for (const chan of CHANNELS) {
        const samplingRate =  chan?.samplingRate || 0
        cacheProps.signals.push({
            data: new Float32Array(),
            samplingRate: samplingRate
        })
    }
    TOTAL_CACHE_LENGTH = dataDuration
    TOTAL_RECORDING_LENGTH = recordingDuration
    for (const gap of dataGaps) {
        DATA_GAPS.set(gap.start, gap.duration)
    }
    CACHE = new (await import("./SharedWorkerCache")).default(input, postMessage)
    return true
}