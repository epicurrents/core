/**
 * Default biosignal montage computer.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import BiosignalCache from './BiosignalCache'
import BiosignalMutex from '#assets/biosignal/service/BiosignalMutex'
import GenericBiosignalSetup from '#assets/biosignal/components/GenericBiosignalSetup'
import {
    concatTypedNumberArrays,
    filterSignal,
    getFilterPadding,
    mapMontageChannels,
    shouldDisplayChannel,
    shouldFilterSignal,
} from '#util/signal'
import { NUMERIC_ERROR_VALUE } from '#util/constants'
import SharedWorkerCache from '#assets/biosignal/service/SharedWorkerCache'
import { SignalFileReader } from '#assets/reader'
import {
    type BiosignalFilters,
    type BiosignalSetup,
    type MontageChannel,
    type SetupChannel,
    type SignalDataCache,
    type SignalDataGap,
    type SignalDataGapMap,
    type SignalPart,
} from '#types/biosignal'
import {
    type CommonBiosignalSettings,
    type ConfigChannelFilter,
    type ConfigMapChannels,
} from '#types/config'
import { type SignalDataReader } from '#types/reader'
import {
    type SignalCachePart,
} from '#types/service'

import { Log } from 'scoped-ts-log'
import { type MutexExportProperties } from 'asymmetric-io-mutex'

const SCOPE = "MontageProcesser"

export default class MontageProcesser extends SignalFileReader implements SignalDataReader {
    protected _channels = [] as MontageChannel[]
    protected _dataGaps: SignalDataGapMap = new Map<number, number>()
    protected _filters = {
        highpass: 0,
        lowpass: 0,
        notch: 0,
    } as BiosignalFilters
    protected _settings: CommonBiosignalSettings
    protected _setup = null as BiosignalSetup | null

    constructor (settings: CommonBiosignalSettings) {
        super()
        this._settings = settings
        // Set some parent class properties to avoid errors.
        this._dataUnitDuration = 1
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
        const cacheStart = this._recordingTimeToCacheTime(Math.max(0, start))
        const cacheEnd = this._recordingTimeToCacheTime(Math.min(end, this._totalRecordingLength))
        // Check that cache has the part that we need.
        const inputRangeStart = await this._cache.inputRangeStart
        const inputRangeEnd = await this._cache.inputRangeEnd
        if (
            inputRangeStart === null || cacheStart < inputRangeStart ||
            inputRangeEnd === null || (cacheEnd > inputRangeEnd && inputRangeEnd < this._totalDataLength)
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
        const filtEnd = cacheEnd + padding < this._totalDataLength
                    ? cacheEnd + padding : this._totalDataLength
        const dataGaps = this.getDataGaps([filtStart, filtEnd], true)
        channel_loop:
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
                const gapStartRecTime = this._cacheTimeToRecordingTime(gap.start)
                if (gapStartRecTime <= start && gapStartRecTime + gap.duration >= end) {
                    derivedSignals.push(sigProps)
                    continue channel_loop
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
            // Calculate signal indices (relative to the retrieved data part) for data gaps.
            const gapIndices = [] as number[][]
            let totalGapLen = 0
            for (const gap of dataGaps) {
                const gapStart = totalGapLen + Math.round((gap.start - filtStart)*chan.samplingRate)
                if (gapStart + gap.duration < 0 || gapStart > filterLen) {
                    totalGapLen += gap.duration
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
                    gapped = concatTypedNumberArrays(...sigParts)
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
                    sigProps.data = concatTypedNumberArrays(
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
     * Get signals for the given part.
     * @param range - Range in seconds as [start (included), end (excluded)].
     * @param config - Optional configuration.
     * @returns SignalCachePart or null, if an error occurred.
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
                    start: this._recordingTimeToCacheTime(Math.max(0, range[0])),
                    end: this._recordingTimeToCacheTime(Math.min(range[1], this._totalRecordingLength)),
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
        const priorGapsTotal = range[0] > 0 ? this._getGapTimeBetween(0, range[0]) : 0
        const gapsTotal = this._getGapTimeBetween(0, range[1])
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
     * Set up montage channels.
     * @param montage - Montage name.
     * @param config - Montage configuration.
     * @param setupChannels - Channel configuration of the montage setup.
     */
    setupChannels (montage: string, config: ConfigMapChannels, setupChannels: SetupChannel[]) {
        this._setup = new GenericBiosignalSetup(montage) as BiosignalSetup
        this._setup.channels = setupChannels
        this.mapChannels(config)
    }

    /**
     * Set up a simple signal cache as the data source for this montage.
     * @param cache - The data cache to use.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including gaps) in seconds.
     * @param dataGaps - Possible data gaps in the recording.
     */
    setupCacheWithInput (
        cache: SignalDataCache,
        dataDuration: number,
        recordingDuration: number,
        dataGaps = [] as SignalDataGap[]
    ) {
        if (this._cache) {
            Log.error(`Montage cache is already set up.`, SCOPE)
            return
        }
        this._totalDataLength = dataDuration
        // Some calculations require data unit count, consider each second as a data unit in montages.
        this._dataUnitCount = dataDuration
        this._totalRecordingLength = recordingDuration
        if (recordingDuration > dataDuration) {
            this._discontinuous = true
        } else {
            this._discontinuous =  false
        }
        for (const gap of dataGaps) {
            this._dataGaps.set(gap.start, gap.duration)
        }
        this._fallbackCache = new BiosignalCache(cache)
    }

    /**
     * Set up input mutex as the source for signal data loading. This will format the shared array buffer for storing
     * the signal data and can only be done once.
     * @param input - Properties of the input data mutex.
     * @param bufferStart - Starting index of the montage mutex array in the buffer.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including gaps) in seconds.
     * @param dataGaps - Possible data gaps in the recording.
     */
    async setupMutexWithInput (
        input: MutexExportProperties,
        bufferStart: number,
        dataDuration: number,
        recordingDuration: number,
        dataGaps = [] as SignalDataGap[]
    ) {
        if (!input.buffer) {
            return null
        }
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
        this._totalDataLength = dataDuration
        this._dataUnitCount = dataDuration
        this._totalRecordingLength = recordingDuration
        if (recordingDuration > dataDuration) {
            this._discontinuous = true
        } else {
            this._discontinuous =  false
        }
        for (const gap of dataGaps) {
            this._dataGaps.set(gap.start, gap.duration)
        }
        // Use input mutex properties as read buffers.
        this._mutex = new BiosignalMutex(
                undefined,
                input
            )
        await this._mutex.initSignalBuffers(cacheProps, dataDuration, input.buffer, bufferStart)
        this._isMutexReady = true
        return this._mutex.propertiesForCoupling
    }

    async setupSharedWorkerWithInput (
        input: MessagePort,
        dataDuration: number,
        recordingDuration: number,
        dataGaps = [] as SignalDataGap[]
    ) {
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
        this._totalDataLength = dataDuration
        this._dataUnitCount = dataDuration
        this._totalRecordingLength = recordingDuration
        if (recordingDuration > dataDuration) {
            this._discontinuous = true
        } else {
            this._discontinuous =  false
        }
        for (const gap of dataGaps) {
            this._dataGaps.set(gap.start, gap.duration)
        }
        this._fallbackCache = new SharedWorkerCache(input, postMessage)
        return true
    }
}
