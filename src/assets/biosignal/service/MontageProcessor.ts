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
import { GenericSignalReader } from '#assets/reader'
import type {
    BiosignalFilters,
    BiosignalSetup,
    DerivedChannelProperties,
    MontageChannel,
    SetupChannel,
    SignalDataCache,
    SignalInterruption,
    SignalPart,
} from '#types/biosignal'
import type {
    CommonBiosignalSettings,
    ConfigChannelFilter,
    ConfigMapChannels,
} from '#types/config'
import type { SignalDataReader } from '#types/reader'
import type { SignalCachePart } from '#types/service'

import { Log } from 'scoped-event-log'
import type { MutexExportProperties } from 'asymmetric-io-mutex'

const SCOPE = "MontageProcessor"

export default class MontageProcessor extends GenericSignalReader implements SignalDataReader {
    protected _channels = [] as MontageChannel[]
    protected _filters = {
        highpass: 0,
        lowpass: 0,
        notch: 0,
    } as BiosignalFilters
    protected _settings: CommonBiosignalSettings
    protected _setup = null as BiosignalSetup | null

    constructor (settings: CommonBiosignalSettings) {
        super(Float32Array)
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
        // Check the limits of the signal data cache.
        const inputRangeStart = await this._cache.inputRangeStart
        const inputRangeEnd = await this._cache.inputRangeEnd
        if (inputRangeStart === null || inputRangeEnd === null) {
            // TODO: Signal that the required part must be loaded by the file loader first.
            Log.error("Cannot return signal part, requested raw signals have not been loaded yet.", SCOPE)
            return false
        }
        // Clamp range to actual cached bounds.
        const cacheStart = Math.max(
            0,
            inputRangeStart,
            this._recordingTimeToCacheTime(start)
        )
        const cacheEnd = Math.min(
            this._recordingTimeToCacheTime(
                Math.min(end, this._totalRecordingLength)
            ),
            inputRangeEnd
        )
        const relStart = cacheStart - inputRangeStart
        const relEnd = cacheEnd - inputRangeStart
        /** This holds the derived signals. */
        const derived = {
            start: cacheStart,
            end: cacheEnd,
            signals: [] as SignalPart[],
        } as SignalCachePart
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
        // Check for possible interruptions in this range.
        const filterRangeStart = Math.max(cacheStart - padding, 0)
        const filterRangeEnd = Math.min(cacheEnd + padding, this._totalDataLength)
        const interruptions = this.getInterruptions([filterRangeStart, filterRangeEnd], true)
        channel_loop:
        for (let i=0; i<channels.length; i++) {
            const chan = channels[i]
            const sigProps = {
                // @ts-ignore Prepare for TypeScript 5.7+.
                data: new Float32Array() as Float32Array<ArrayBufferLike>,
                samplingRate: chan.samplingRate
            }
            // Remove missing and inactive channels.
            if (!shouldDisplayChannel(chan, false, this._settings)) {
                derived.signals.push(sigProps)
                continue
            }
            // Check if whole range is just interruption time.
            for (const intr of interruptions) {
                const intrStartRecTime = this._cacheTimeToRecordingTime(intr.start)
                if (intrStartRecTime <= start && intrStartRecTime + intr.duration >= end) {
                    derived.signals.push(sigProps)
                    continue channel_loop
                }
            }
            const highpass = chan.highpassFilter !== null ? chan.highpassFilter : this._filters.highpass
            const lowpass = chan.lowpassFilter !== null ? chan.lowpassFilter : this._filters.lowpass
            const notch = chan.notchFilter !== null ? chan.notchFilter : this._filters.notch
            const activeLen = SIGNALS[
                Array.isArray(chan.active)
                    ? Array.isArray(chan.active[0])
                        ? chan.active[0][0]
                        : chan.active[0]
                    : chan.active
            ]?.length || 0
            // Get filter padding for the channel ignoring possible interruptions.
            const {
                filterLen,
                filterStart, filterEnd,
                //paddingStart, paddingEnd,
                rangeStart, rangeEnd,
                //signalStart, signalEnd,
            } = getFilterPadding(
                [relStart, relEnd],
                activeLen,
                chan,
                this._settings,
                this._filters
            )
            const filterRange = filterEnd - filterStart
            let dataStart = filterStart
            let dataEnd = filterEnd
            // Calculate signal indices (relative to the retrieved data part) for interruptions.
            const intrIndices = [] as number[][]
            for (const intr of interruptions) {
                const intrStart = Math.round(intr.start*chan.samplingRate) - filterStart
                const intrLen = Math.round(intr.duration*chan.samplingRate)
                if (intrStart >= filterRange) {
                    break
                } else if (intrStart + intrLen <= 0) {
                    continue
                }
                // Apply a maximum of filter padding length of interruption.
                const startPos = Math.max(intrStart, 0)
                const endPos = Math.min(intrStart + intrLen, filterRange)
                if (filterLen) {
                    // Adjust data (=padding) starting and ending positions, if the interruption is withing filter
                    // padding range.
                    if (startPos >= 0 && startPos < filterLen) {
                        dataStart += Math.min(endPos, filterLen) - startPos
                    } else if (intr.start < start) {
                        // If an interruption crosses or is adjacent to the requested range start, we cannot determine
                        // its position by cache coordinates; we need to compare the actual interruption and range
                        // start times.
                        const relStart = Math.max(intr.start - start, -padding)
                        const maxDur = Math.min(intr.duration, padding)
                        if (relStart <= 0 && maxDur >= -relStart) {
                            dataStart += Math.round(-relStart*chan.samplingRate)
                        }
                    } else if (startPos >= rangeEnd - filterStart && startPos < filterRange) {
                        dataEnd -= Math.min(endPos, filterRange) - startPos
                    }
                }
                intrIndices.push([startPos, endPos])
            }
            // Need to calculate signal relative to reference(s), one datapoint at a time.
            // Check that active signal and all reference signals have the same length.
            const refs = [] as DerivedChannelProperties
            for (const ref of chan.reference) {
                const refLen = SIGNALS[
                    Array.isArray(ref) ? ref[0] : ref
                ]?.length || 0
                if (activeLen === refLen) {
                    refs.push(ref)
                }
            }
            // Set up a signal array with length of the actual data.
            const data = new Float32Array(dataEnd - dataStart).fill(0)
            let j = 0
            for (let n=dataStart; n<dataEnd; n++) {
                let refAvg = 0
                // Just leave the value at zero if we are outside tha actual signal range.
                if (n < 0 || n >= activeLen) {
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
                            const refWeight = Array.isArray(ref) ? ref[1] : 1
                            const refIndex = Array.isArray(ref) ? ref[0] : ref
                            refAvg += SIGNALS[refIndex][n]*refWeight
                        }
                        refAvg /= refs.length
                        avgMap[j] = refAvg
                    } else if (!refs.length) {
                        refAvg = 0
                    } else {
                        const refWeight = Array.isArray(refs[0]) ? refs[0][1] : 1
                        const refIndex = Array.isArray(refs[0]) ? refs[0][0] : refs[0]
                        refAvg = SIGNALS[refIndex][n]*refWeight
                    }
                }
                let actAvg = Array.isArray(chan.active) ? 0 : SIGNALS[chan.active][n]
                if (Array.isArray(chan.active)) {
                    // Calculate the average of all active signals.
                    for (const act of chan.active) {
                        const actWeight = Array.isArray(act) ? act[1] : 1
                        const actIndex = Array.isArray(act) ? act[0] : act
                        actAvg += SIGNALS[actIndex][n]*actWeight
                    }
                    actAvg /= chan.active.length
                }
                if (config?.excludeActiveFromAvg) {
                    // Doing this correction separately may seem overly complicated, but if we want
                    // to cache the average value, it must contain values from all channels.
                    refAvg -= actAvg/refs.length
                    refAvg *= refs.length/(refs.length - 1)
                }
                data.set([(actAvg - refAvg)], j)
                j++
            }
            if (shouldFilterSignal(chan, this._filters, this._settings)) {
                // Add possible interruptions.
                // @ts-ignore Prepare for TypeScript 5.7+.
                let interrupted = data as Float32Array<ArrayBufferLike>
                let lastGapEnd = 0
                const sigParts = [] as Float32Array[]
                for (const intr of intrIndices) {
                    if (lastGapEnd < intr[0]) {
                        sigParts.push(interrupted.slice(lastGapEnd, intr[0]))
                    }
                    const intrSig = new Float32Array(intr[1] - intr[0])
                    intrSig.fill(0.0)
                    sigParts.push(intrSig)
                    sigParts.push(interrupted.slice(intr[0]))
                    interrupted = concatTypedNumberArrays(...sigParts)
                    lastGapEnd = intr[1]
                }
                sigProps.data = filterSignal(
                    interrupted,
                    chan.samplingRate,
                    highpass,
                    lowpass,
                    notch,
                )
                // Remove the interruption parts in reverse order.
                for (const intr of intrIndices.reverse()) {
                    sigProps.data = concatTypedNumberArrays(
                        sigProps.data.slice(0, intr[0]),
                        sigProps.data.slice(intr[1])
                    )
                }
                // Remove the part of signal data that was used for filtering.
                const trimStart = rangeStart - dataStart
                const trimEnd = rangeEnd - rangeStart + trimStart
                sigProps.data = sigProps.data.slice(trimStart, trimEnd)
            } else {
                sigProps.data = data
            }
            derived.signals.push(sigProps)
        }
        if (cachePart) {
            // Finally, assign the signals to out montage mutex.
            await this._cache.insertSignals(derived)
            const updated = await this.getSignalUpdatedRange()
            postMessage({
                action: 'cache-signals',
                range: [updated.start, updated.end]
            })
            return true
        } else {
            return derived
        }
    }

    async destroy () {
        this._channels.length = 0
        this._interruptions.clear()
        this._mutex = null
        this._setup = null
        await super.destroy()
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
            requestedSigs = (await this.calculateSignalsForPart(range[0], range[1], false, config)) as SignalCachePart
            if (!requestedSigs) {
                Log.error(`Could not cache requested signal range ${range[0]} - ${range[1]}.`, SCOPE)
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
        // Find amount of interruption time before and within the range.
        const interruptions = this.getInterruptions(range)
        if (!interruptions.length) {
            return requestedSigs
        }
        const priorGapsTotal = range[0] > 0 ? this._getInterruptionTimeBetween(0, range[0]) : 0
        const intrTotal = this._getInterruptionTimeBetween(0, range[1])
        const rangeStart = range[0] - priorGapsTotal
        const rangeEnd = range[1] - intrTotal
        //const responseSigs = [] as SignalCachePart['signals']
        for (let i=0; i<requestedSigs.signals.length; i++) {
            const signalForRange = new Float32Array(
                                            Math.round((range[1] - range[0])*requestedSigs.signals[i].samplingRate)
                                        ).fill(0.0)
            if (rangeStart === rangeEnd) {
                // The whole range is interruption time.
                requestedSigs.signals[i].data = signalForRange
                continue
            }
            const startSignalIndex = Math.round((rangeStart - requestedSigs.start)*requestedSigs?.signals[i].samplingRate)
            const endSignalIndex = Math.round((rangeEnd - requestedSigs.start)*requestedSigs.signals[i].samplingRate)
            signalForRange.set(requestedSigs.signals[i].data.slice(startSignalIndex, endSignalIndex))
            for (const intr of interruptions) {
                const startPos = Math.round((intr.start - range[0])*requestedSigs.signals[i].samplingRate)
                const endPos = Math.min(
                    startPos + Math.round(intr.duration*requestedSigs.signals[i].samplingRate),
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
     * @param recordingDuration - Total duration of the recording (including interruptions) in seconds.
     * @param interruptions - Possible interruptions in the recording.
     */
    setupCacheWithInput (
        cache: SignalDataCache,
        dataDuration: number,
        recordingDuration: number,
        interruptions = [] as SignalInterruption[]
    ) {
        if (this._cache) {
            Log.error(`Montage cache is already set up.`, SCOPE)
            return
        }
        Log.debug(`Setting up basic cache.`, SCOPE)
        this._totalDataLength = dataDuration
        // Some calculations require data unit count, consider each second as a data unit in montages.
        this._dataUnitCount = dataDuration
        this._totalRecordingLength = recordingDuration
        if (recordingDuration > dataDuration) {
            this._discontinuous = true
        } else {
            this._discontinuous =  false
        }
        for (const intr of interruptions) {
            this._interruptions.set(intr.start, intr.duration)
        }
        this._fallbackCache = new BiosignalCache(dataDuration, cache)
        Log.debug(`Basic cache setup complete.`, SCOPE)
    }

    /**
     * Set up input mutex as the source for signal data loading. This will format the shared array buffer for storing
     * the signal data and can only be done once.
     * @param input - Properties of the input data mutex.
     * @param bufferStart - Starting index of the montage mutex array in the buffer.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including interruptions) in seconds.
     * @param interruptions - Possible interruptions in the recording.
     */
    async setupMutexWithInput (
        input: MutexExportProperties,
        bufferStart: number,
        dataDuration: number,
        recordingDuration: number,
        interruptions = [] as SignalInterruption[]
    ) {
        if (!input.buffer) {
            return null
        }
        Log.debug(`Setting up mutex cache with input mutex.`, SCOPE)
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
        for (const intr of interruptions) {
            this._interruptions.set(intr.start, intr.duration)
        }
        // Use input mutex properties as read buffers.
        this._mutex = new BiosignalMutex(
                undefined,
                input
            )
        await this._mutex.initSignalBuffers(
            cacheProps,
            this._settings.montages.preCache ? dataDuration : 0, // Montage precaching is not implemented yet.
            input.buffer,
            bufferStart
        )
        this._isMutexReady = true
        Log.debug(`Mutex cache setup complete.`, SCOPE)
        return this._mutex.propertiesForCoupling
    }

    async setupSharedWorkerWithInput (
        input: MessagePort,
        dataDuration: number,
        recordingDuration: number,
        interruptions = [] as SignalInterruption[]
    ) {
        Log.debug(`Setting up shared worker cache.`, SCOPE)
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
        for (const intr of interruptions) {
            this._interruptions.set(intr.start, intr.duration)
        }
        this._fallbackCache = new SharedWorkerCache(input, postMessage)
        Log.debug(`Shared worker cache setup complete.`, SCOPE)
        return true
    }
}
