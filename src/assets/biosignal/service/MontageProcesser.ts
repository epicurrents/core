/**
 * Default biosignal montage computer.
 * @package    @epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalFilters,
    type BiosignalMontage,
    type BiosignalSetup,
    type MontageChannel,
    type SetupChannel,
    type SignalDataCache,
    type SignalPart,
} from '#types/biosignal'
import {
    type CommonBiosignalSettings,
    type ConfigChannelFilter,
    type ConfigMapChannels,
} from '#types/config'
import {
    type SignalCachePart,
} from '#types/service'
import BiosignalMutex from '#assets/biosignal/service/BiosignalMutex'
import GenericBiosignalSetup from '#assets/biosignal/components/GenericBiosignalSetup'
import IOMutex, { type MutexExportProperties } from 'asymmetric-io-mutex'
import {
    concatFloat32Arrays,
    filterSignal,
    getFilterPadding,
    mapMontageChannels,
    shouldDisplayChannel,
    shouldFilterSignal,
} from '#util/signal'
import { NUMERIC_ERROR_VALUE } from '#util/constants'

import SharedWorkerCache from '#assets/biosignal/service/SharedWorkerCache'
import { Log } from 'scoped-ts-log'

const SCOPE = "MontageProcesser"

export default class MontageProcesser {
    protected _cache = null as BiosignalMutex | SignalDataCache | null
    protected _channels = [] as MontageChannel[]
    protected _dataGaps = new Map<number, number>()
    protected _filters = {
        highpass: 0,
        lowpass: 0,
        notch: 0,
    } as BiosignalFilters
    protected _settings: CommonBiosignalSettings
    protected _setup = null as BiosignalSetup | null
    protected _totalCacheLength = 0
    protected _totalRecordingLength = 0

    constructor (settings: CommonBiosignalSettings) {
        this._settings = settings
    }

    get channels () {
        return this._channels
    }
    set channels (value: MontageChannel[]) {
        this._channels = value
    }

    get dataGaps () {
        return this._dataGaps
    }

    get filters () {
        return this._filters
    }

    get settings () {
        return this._settings
    }
    set settings (value: CommonBiosignalSettings) {
        this._settings = value
    }


    /**
     * Convert cache time (i.e. time without data gaps) to recording time.
     * @param time - Cache time without gaps.
     * @return Matching recording time (with gaps).
     */
    cacheTimeToRecordingTime (time: number): number {
        if (!this._cache) {
            Log.error(`Cannot convert cache time to recording time before cache has been set up.`, SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        if (time === NUMERIC_ERROR_VALUE) {
            return time
        }
        if (time < 0) {
            Log.error(`Cannot convert negative cache time to recording time.`, SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        if (time === 0) {
            return 0
        }
        let priorGapsTotal = 0
        for (const gap of this._dataGaps) {
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
    async calculateSignalsForPart (
        start: number,
        end: number,
        cachePart = true,
        config?: ConfigChannelFilter & { excludeActiveFromAvg?: boolean }
    ) {
        // Check that cache is ready.
        if (!this._cache) {
            Log.error("Cannot return signal part, signal cache has not been set up yet.", SCOPE)
            return false
        }
        const cacheStart = this.recordingTimeToCacheTime(start)
        const cacheEnd = this.recordingTimeToCacheTime(end)
        // Check that cache has the part that we need.
        const inputRangeStart = await this._cache.inputRangeStart
        const inputRangeEnd = await this._cache.inputRangeEnd
        if (
            inputRangeStart === null || cacheStart < inputRangeStart ||
            inputRangeEnd === null || (cacheEnd > inputRangeEnd && inputRangeEnd < this._totalCacheLength)
        ) {
            // TODO: Signal that the required part must be loaded by the file loader first.
            Log.error("Cannot return signal part, requested raw signals have not been loaded yet.", SCOPE)
            return false
        }
        const relStart = cacheStart - inputRangeStart
        const relEnd = cacheEnd - inputRangeStart
        const derivedSignals = [] as SignalPart[]
        // Only calculate averages once.
        const avgMap = [] as number[]
        // Filter channels, if needed.
        const channels = (config?.include?.length || config?.exclude?.length)
                        ? [] as MontageChannel[] : this._channels
        // Prioritize include -> only process those channels.
        if (config?.include?.length) {
            for (const c of config.include) {
                channels.push(this._channels[c])
            }
        } else if (config?.exclude?.length) {
            for (let i=0; i<this._channels.length; i++) {
                if (config.exclude.indexOf(i) === -1) {
                    channels.push(this._channels[i])
                }
            }
        }
        // Get the input signals
        const SIGNALS = await this._cache.inputSignals
        const padding = this._settings.filterPaddingSeconds || 0
        // Check for possible gaps in this range.
        const filtStart = cacheStart - padding > 0 ? cacheStart - padding : 0
        const filtEnd = cacheEnd + padding < this._totalCacheLength
                    ? cacheEnd + padding : this._totalCacheLength
        const dataGaps = this.getDataGaps([filtStart, filtEnd], true)
        for (let i=0; i<channels.length; i++) {
            const chan = channels[i]
            const sigProps = {
                data: new Float32Array(),
                samplingRate: chan.samplingRate
            }
            // Remove missing and inactive channels.
            if (!shouldDisplayChannel(chan, false, this._settings)) {
                derivedSignals.push(sigProps)
                continue
            }
            // Check if whole range is just data gap.
            for (const gap of dataGaps) {
                const gapStartRecTime = this.cacheTimeToRecordingTime(gap.start)
                if (gapStartRecTime <= start && gapStartRecTime + gap.duration >= end) {
                    derivedSignals.push(sigProps)
                    continue
                }
            }
            const highpass = chan.highpassFilter !== null ? chan.highpassFilter : this._filters.highpass
            const lowpass = chan.lowpassFilter !== null ? chan.lowpassFilter : this._filters.lowpass
            const notch = chan.notchFilter !== null ? chan.notchFilter : this._filters.notch
            // Get filter padding for the channel.
            const {
                filterLen, filterStart, filterEnd,
                //paddingStart, paddingEnd,
                //rangeStart, rangeEnd,
                //signalStart, signalEnd,
            } = getFilterPadding([relStart, relEnd] || [], SIGNALS[chan.active].length, chan, this._settings, this._filters)
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
            if (shouldFilterSignal(this._filters, chan)) {
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
            await this._cache.insertSignals({
                start: cacheStart,
                end: cacheEnd,
                signals: derivedSignals
            })
            const updated = await this.getSignalUpdatedRange()
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
    getDataGaps (range?: number[], useCacheTime = false): { duration: number, start: number }[] {
        const start = range ? range[0] : 0
        let end = range ? range[1] : (useCacheTime ? this._totalCacheLength : this._totalRecordingLength)
        const dataGaps = [] as { duration: number, start: number }[]
        if (start < 0) {
            Log.error(`Requested data gap range start ${start} is smaller than zero.`, SCOPE)
            return dataGaps
        }
        if (start >= end) {
            Log.error(`Requested data gap range ${start} - ${end} is not valid.`, SCOPE)
            return dataGaps
        }
        if (useCacheTime && end > this._totalCacheLength) {
            end = this._totalCacheLength
        } else if (end > this._totalRecordingLength) {
            end = this._totalRecordingLength
        }
        let priorGapsTotal = 0
        for (const gap of this._dataGaps) {
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

    getGapTimeBetween (start: number, end: number): number {
        if (!this._cache) {
            return 0
        }
        let gapTotal = 0
        for (const gap of this.getDataGaps([start, end])) {
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
    async getSignals (range: number[], config?: ConfigChannelFilter) {
        if (!this._channels) {
            Log.error("Cannot load signals, channels have not been set up yet.", SCOPE)
            return null
        }
        if (!this._cache) {
            Log.error("Cannot load signals, signal cache has not been set up yet.", SCOPE)
            return null
        }
        let requestedSigs: SignalCachePart | null = null
        const cacheStart = await this._cache.outputRangeStart
        const cacheEnd = await this._cache.outputRangeEnd
        if (cacheStart === null || cacheEnd === null) {
            Log.error(`Loading signals for range [${range[0]}, ${range[1]}] failed.`, SCOPE)
            return null
        }
        // If pre-caching is enabled, check the cache for existing signals for this range.
        const updated = this._settings.montages.preCache && await this.getSignalUpdatedRange()
        if (!updated || updated.start === NUMERIC_ERROR_VALUE ||  updated.start > range[0] || updated.end < range[1]) {
            // Retrieve missing signals (result channels will be filtered according to include/exclude).
            const signals = await this.calculateSignalsForPart(range[0], range[1], false, config)
            if (signals) {
                requestedSigs = {
                    start: this.recordingTimeToCacheTime(range[0]),
                    end: this.recordingTimeToCacheTime(range[1]),
                    signals: signals as SignalCachePart['signals']
                }
            } else {
                Log.error(`Cound not cache requested signal range ${range[0]} - ${range[1]}.`, SCOPE)
                return null
            }
        } else {
            // Use cached signals.
            requestedSigs = (await this._cache.asCachePart()) as SignalCachePart
            // Filter channels, if needed.
            if (config?.include?.length || config?.exclude?.length) {
                const filtered = [] as typeof requestedSigs.signals
                // Prioritize include -> only process those channels.
                if (config?.include?.length) {
                    for (const c of config.include) {
                        filtered.push(requestedSigs.signals[c])
                    }
                } else if (config?.exclude?.length) {
                    for (let i=0; i<this._channels.length; i++) {
                        if (config.exclude.indexOf(i) === -1) {
                            filtered.push(requestedSigs.signals[i])
                        }
                    }
                }
                requestedSigs.signals = filtered
            }
        }
        // Find amount of gap time before and within the range.
        const dataGaps = this.getDataGaps(range)
        if (!dataGaps.length) {
            return requestedSigs
        }
        const priorGapsTotal = range[0] > 0 ? this.getGapTimeBetween(0, range[0]) : 0
        const gapsTotal = this.getGapTimeBetween(0, range[1])
        const rangeStart = range[0] - priorGapsTotal
        const rangeEnd = range[1] - gapsTotal
        //const responseSigs = [] as SignalCachePart['signals']
        for (let i=0; i<requestedSigs.signals.length; i++) {
            const signalForRange = new Float32Array(
                                            Math.round((range[1] - range[0])*requestedSigs.signals[i].samplingRate)
                                        ).fill(0.0)
            if (rangeStart === rangeEnd) {
                // The whole range is just gap space.
                requestedSigs.signals[i].data = signalForRange
                continue
            }
            const startSignalIndex = Math.round((rangeStart - requestedSigs.start)*requestedSigs?.signals[i].samplingRate)
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
    async getSignalCacheRange () {
        if (!this._cache) {
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        const rangeStart = await this._cache.outputRangeStart
        const rangeEnd = await this._cache.outputRangeEnd
        if (rangeStart === null || rangeEnd === null) {
            Log.error(`Montage signal mutex did not report a valid range: start (${rangeStart}) or end (${rangeEnd}).`, SCOPE)
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        return { start: rangeStart, end: rangeEnd }
    }
    */

    /**
     * Get the largest start and lowest end updated data range (in seconds) for the signals.
     * @returns Range as { start: number, end: number } measured in seconds or NUMERIC_ERROR_VALUE if an error occurred.
     */
    async getSignalUpdatedRange () {
        if (!this._cache) {
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        const ranges = this._cache.outputSignalUpdatedRanges
        const srs = this._cache.outputSignalSamplingRates
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
                Log.error(`Montage signal mutex did not report a valid updated range for signal at index ${i}.`, SCOPE)
                return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
            }
            const tStart = range.start/sr
            const tEnd = range.end/sr
            if (range.start !== IOMutex.EMPTY_FIELD) {
                highestStart = (highestStart === NUMERIC_ERROR_VALUE || tStart > highestStart) ? tStart : highestStart
            } else {
                Log.warn(`Signal #${i} has not updated start position set.`, SCOPE)
            }
            if (range.end !== IOMutex.EMPTY_FIELD) {
                lowestEnd = (lowestEnd === NUMERIC_ERROR_VALUE || tEnd < lowestEnd) ? tEnd : lowestEnd
            } else {
                Log.warn(`Signal #${i} has not updated end position set.`, SCOPE)
            }
        }
        if (highestStart === NUMERIC_ERROR_VALUE && lowestEnd === NUMERIC_ERROR_VALUE) {
            Log.error(`Cannot get ranges of updated signals, cache has no initialized signals.`, SCOPE)
            return { start: NUMERIC_ERROR_VALUE, end: NUMERIC_ERROR_VALUE }
        }
        return {
            start: this.cacheTimeToRecordingTime(highestStart),
            end: this.cacheTimeToRecordingTime(lowestEnd),
        }
    }
    /**
     * Get a list of only the channels that are visible.
     * @returns Channels that should be displayed.
     *
    const getVisibleChannels = () => {
        return this._channels.filter(c => shouldDisplayChannel(c, false, this._settings))
    }
    */
    /**
     * Map the derived channels in this montage to the signal channels of the given setup.
     * @param config - Either string code of a default config or a config object.
     */
    mapChannels (config: ConfigMapChannels) {
        // Check that we have a valid setup.
        if (!this._setup) {
            Log.error(`Cannot map channels for montage; missing an electrode setup!`, SCOPE)
            return
        }
        // Reset channels for the new mapping.
        const channelConfig = Object.assign({}, this._settings, config)
        this._channels = mapMontageChannels(this._setup, channelConfig)
    }

    /**
     * Convert recording time to cache time (i.e. time without data gaps).
     * @param time - Recording time.
     * @return Matching cache time (without gaps).
     */
    recordingTimeToCacheTime (time: number): number {
        if (!this._cache) {
            Log.error(`Cannot convert recording time to cache time before cache has been set up.`, SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        if (time === NUMERIC_ERROR_VALUE) {
            return time
        }
        if (time < 0) {
            Log.error(`Cannot convert negative recording time to cache time.`, SCOPE)
            return NUMERIC_ERROR_VALUE
        }
        if (time === 0) {
            return 0
        }
        return time - this.getGapTimeBetween(0, time)
    }

    /**
     * Release buffers removing all references to them and decomissioning this worker.
     */
    async releaseCache () {
        this._cache?.releaseBuffers()
        this._cache = null
    }

    /**
     * Set up a simple signal cache as the data source for this montage.
     * @param cache - The data cache to use.
     */
    setupCache (cache: SignalDataCache) {
        this._cache = cache
    }

    /**
     * Set new data gaps for the source data of this montage.
     * @param dataGaps - The new gaps.
     */
    setDataGaps (dataGaps: Map<number, number>) {
        this._dataGaps = dataGaps
    }

    /**
     * Remove all channels from this montage.
     *
    const resetChannels = () => {
        this._channels = []
    }
    */
    /**
     * Set high-pass filter value for given channel. Pass undefined to unset individual filter value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Frequency value or undefined.
     */
    setHighpassFilter (value: number, target?: string | number) {
        if (typeof target === 'number') {
            this._channels[target].highpassFilter = value
            this._cache?.invalidateOutputSignals([value])
        } else {
            this._filters.highpass = value
            this._cache?.invalidateOutputSignals()
        }
    }

    /**
     * Set low-pass filter value for given channel. Pass undefined to unset individual filter value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Frequency value or undefined.
     */
    setLowpassFilter (value: number, target?: string | number) {
        if (typeof target === 'number') {
            this._channels[target].lowpassFilter = value
            this._cache?.invalidateOutputSignals([value])
        } else {
            this._filters.lowpass = value
            this._cache?.invalidateOutputSignals()
        }
    }

    /**
     * Set notch filter value for given channel. Pass undefined to unset individual filter value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Frequency value or undefined.
     */
    setNotchFilter (value: number, target?: string | number) {
        if (typeof target === 'number') {
            this._channels[target].notchFilter = value
            this._cache?.invalidateOutputSignals([value])
        } else {
            this._filters.notch = value
            this._cache?.invalidateOutputSignals()
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
    async setupInputMutex (
        montage: string,
        config: ConfigMapChannels,
        input: MutexExportProperties,
        bufferStart: number,
        dataDuration: number,
        recordingDuration: number,
        setupChannels: SetupChannel[],
        dataGaps = [] as { duration: number, start: number }[]
    ) {
        if (!input.buffer) {
            return false
        }
        this._setup = new GenericBiosignalSetup(montage) as BiosignalSetup
        this._setup.channels = setupChannels
        this.mapChannels(config)
        // Construct a SignalCachePart to initialize the mutex.
        const cacheProps = {
            start: 0,
            end: 0,
            signals: []
        } as SignalCachePart
        for (const chan of this._channels) {
            const samplingRate =  chan?.samplingRate || 0
            cacheProps.signals.push({
                data: new Float32Array(),
                samplingRate: samplingRate
            })
        }
        this._totalCacheLength = dataDuration
        this._totalRecordingLength = recordingDuration
        for (const gap of dataGaps) {
            this._dataGaps.set(gap.start, gap.duration)
        }
        // Use input mutex properties as read buffers.
        this._cache = new BiosignalMutex(
                undefined,
                input
            )
        await this._cache.initSignalBuffers(cacheProps, dataDuration, input.buffer, bufferStart)
        return this._cache.propertiesForCoupling
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
    async setupSharedWorker (
        montage: string,
        config: ConfigMapChannels,
        input: MessagePort,
        dataDuration: number,
        recordingDuration: number,
        setupChannels: SetupChannel[],
        dataGaps = [] as { duration: number, start: number }[]
    ) {
        this._setup = new GenericBiosignalSetup(montage) as BiosignalSetup
        this._setup.channels = setupChannels
        this.mapChannels(config)
        // Construct a SignalCachePart to initialize the mutex.
        const cacheProps = {
            start: 0,
            end: 0,
            signals: []
        } as SignalCachePart
        for (const chan of this._channels) {
            const samplingRate =  chan?.samplingRate || 0
            cacheProps.signals.push({
                data: new Float32Array(),
                samplingRate: samplingRate
            })
        }
        this._totalCacheLength = dataDuration
        this._totalRecordingLength = recordingDuration
        for (const gap of dataGaps) {
            this._dataGaps.set(gap.start, gap.duration)
        }
        this._cache = new SharedWorkerCache(input, postMessage)
        return true
    }
}
