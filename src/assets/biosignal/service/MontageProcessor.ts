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
    computeAmplitudeIntegratedEpoch,
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
    BiosignalDownsamplingMethod,
    BiosignalFilters,
    BiosignalSetup,
    BiosignalTrendDerivation,
    BiosignalTrendFunction,
    BiosignalTrendProperties,
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
import type { SignalCacheMutex, SignalCachePart } from '#types/service'

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
    protected _trends = new Map<string, BiosignalTrendProperties>()
    /** Names of trends whose computation has been requested to cancel. Checked between epochs. */
    protected _cancelledTrends = new Set<string>()
    /**
     * Outbound message sender. In a real worker this is the global `postMessage`, which routes
     * straight to the parent thread. When the processor is constructed inside a worker substitute
     * (main thread), the substitute injects its own `returnMessage` callback so per-epoch updates
     * and cache-status messages reach the service the same way as commission replies.
     */
    protected _postMessage: (message: any) => void

    constructor (
        settings: CommonBiosignalSettings,
        postMessageFn?: (message: any) => void
    ) {
        super(Float32Array)
        this._settings = settings
        // Set some parent class properties to avoid errors.
        this._dataUnitDuration = 1
        // Default: forward to the worker's global `postMessage` (the worker scope provides one).
        // In a main-thread substitute the global is `window.postMessage`, which has a different
        // signature, so callers MUST inject a callback in that case.
        this._postMessage = postMessageFn ?? ((msg) => {
            if (typeof postMessage === 'function') {
                ;(postMessage as (m: any) => void)(msg)
            }
        })
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
        // Phase C v3 diagnostic probe (non-invasive): read `inputSignalUpdatedRanges` exactly once
        // per request, log when the requested range exceeds the per-channel loaded subrange. Does
        // NOT change behaviour — still falls through to the normal read path so whatever was in the
        // SAB (including zeros for not-yet-loaded blocks) ends up in the result. The point is to
        // measure how often this happens with the current prefetch + slide-serialisation setup, so
        // we can decide whether the "skip render on miss" fix is needed at all. Remove or gate
        // behind a debug flag once we have the diagnostic data.
        const inputUpdatedRangesGetter = this._cache.inputSignalUpdatedRanges
        if (inputUpdatedRangesGetter) {
            const samplingRatesAsync = (this._cache as SignalCacheMutex).inputSignalSamplingRates
            const [updated, samplingRates] = await Promise.all([
                Promise.all(inputUpdatedRangesGetter),
                Promise.all(samplingRatesAsync),
            ])
            const requiredInputChannels = new Set<number>()
            for (const chan of channels) {
                if (Array.isArray(chan.active)) {
                    for (const a of chan.active) {
                        requiredInputChannels.add(Array.isArray(a) ? a[0] : a)
                    }
                } else if (typeof chan.active === 'number' && chan.active >= 0) {
                    requiredInputChannels.add(chan.active)
                }
                for (const r of chan.reference) {
                    requiredInputChannels.add(Array.isArray(r) ? r[0] : r)
                }
            }
            let firstMiss: { idx: number, reqStart: number, reqEnd: number, updStart: number, updEnd: number } | null = null
            for (const idx of requiredInputChannels) {
                const sr = samplingRates[idx]
                if (!sr || sr <= 0) {
                    continue
                }
                const reqStart = Math.floor(relStart*sr)
                const reqEnd = Math.ceil(relEnd*sr)
                const upd = updated[idx]
                if (!upd || upd.start > reqStart || upd.end < reqEnd) {
                    firstMiss = {
                        idx,
                        reqStart,
                        reqEnd,
                        updStart: upd?.start ?? NaN,
                        updEnd: upd?.end ?? NaN,
                    }
                    break
                }
            }
            if (firstMiss) {
                Log.info(
                    `[cache-miss-probe] relStart=${relStart.toFixed(2)}s relEnd=${relEnd.toFixed(2)}s ` +
                    `firstMiss=ch${firstMiss.idx} reqRange=[${firstMiss.reqStart},${firstMiss.reqEnd}] ` +
                    `loadedRange=[${firstMiss.updStart},${firstMiss.updEnd}] ` +
                    `skipFilters=${config?.skipFilters ?? false}`,
                    SCOPE
                )
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
            if (!config?.skipFilters && shouldFilterSignal(chan, this._filters, this._settings)) {
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
                // No filtering: still trim off the filter-padding samples so the caller gets
                // only the requested range. `data` was sized for the padded extent.
                const trimStart = rangeStart - dataStart
                const trimEnd = rangeEnd - rangeStart + trimStart
                sigProps.data = (trimStart > 0 || trimEnd < data.length)
                    ? data.slice(trimStart, trimEnd)
                    : data
            }
            derived.signals.push(sigProps)
        }
        if (cachePart) {
            // Finally, assign the signals to out montage mutex.
            await this._cache.insertSignals(derived)
            const updated = await this.getSignalUpdatedRange()
            this._postMessage({
                action: 'cache-signals',
                range: [updated.start, updated.end]
            })
            return true
        } else {
            return derived
        }
    }

    /**
     * Combine a set of channel signals into a single per-sample signal using the given function.
     * @param parts - Channel signals for the same range (all the same length).
     * @param fn - Combination function (`'average'` default, `'sum'`, or `'difference'`).
     * @returns The combined signal, or null if `parts` is empty.
     */
    protected _combineSignalParts (
        parts: SignalPart[],
        fn: BiosignalTrendFunction = 'average'
    ): Float32Array | null {
        if (!parts.length) {
            return null
        }
        const length = parts[0].data.length
        if (parts.length === 1) {
            return new Float32Array(parts[0].data)
        }
        const result = new Float32Array(length)
        for (let i = 0; i < length; i++) {
            let value = parts[0].data[i] || 0
            for (let j = 1; j < parts.length; j++) {
                const sample = parts[j].data[i] || 0
                if (fn === 'difference') {
                    value -= sample
                } else {
                    value += sample
                }
            }
            if (fn === 'average') {
                value /= parts.length
            }
            result[i] = value
        }
        return result
    }

    /**
     * Compute the trend over the requested range (or the entire recording when `range` is omitted),
     * posting one `'trend-epoch'` message per completed epoch and one final `'trend-complete'` message.
     *
     * Cancellation is cooperative: {@link cancelTrendComputation} sets a flag that is checked between
     * epochs, so an in-flight epoch always runs to completion before the loop exits.
     *
     * @param name - Name of the trend (must have been registered with {@link setupTrend}).
     * @param range - Optional `[start, end]` range in seconds; defaults to the entire recording.
     * @returns True if computation completed, false if no such trend exists.
     */
    async computeTrend (name: string, range?: number[]) {
        const trendProps = this._trends.get(name)
        if (!trendProps) {
            Log.error(`Cannot compute trend '${name}': trend has not been set up.`, SCOPE)
            this._postMessage({ action: 'trend-error', name, error: 'Trend has not been set up.' })
            return false
        }
        this._cancelledTrends.delete(name)
        const epochLength = trendProps.epochLength
        const rangeStart = Math.max(0, range?.[0] ?? 0)
        const rangeEnd = Math.min(range?.[1] ?? this._totalRecordingLength, this._totalRecordingLength)
        const totalEpochs = Math.ceil((rangeEnd - rangeStart)/epochLength)
        const firstEpoch = Math.floor(rangeStart/epochLength)
        // Yield to the event loop every this many epochs. Each epoch costs a single band-pass
        // filtfilt over a 15-second window now that the display filters are skipped (via
        // `skipFilters: true` on the trend's `getSignals` calls). The yield via `setTimeout(0)`
        // is a macrotask, so the browser is free to render between yields — microtask `await`
        // alone is not enough. Yielding every 5 epochs keeps the cycle short (~10 ms work +
        // ~4 ms yield) so the UI stays responsive even on the main-thread substitute path.
        const YIELD_EVERY = 5
        const yieldToEventLoop = () => new Promise<void>((resolve) => {
            setTimeout(resolve, 0)
        })
        for (let i = 0; i < totalEpochs; i++) {
            if (this._cancelledTrends.has(name)) {
                Log.debug(`Trend '${name}' computation cancelled at epoch ${i}/${totalEpochs}.`, SCOPE)
                this._cancelledTrends.delete(name)
                this._postMessage({ action: 'trend-cancelled', name })
                return false
            }
            const epochIndex = firstEpoch + i
            const signal = await this.computeTrendEpoch(name, epochIndex)
            if (signal) {
                this._postMessage({
                    action: 'trend-epoch',
                    name: name,
                    epochIndex: epochIndex,
                    signal: signal,
                    totalEpochs: totalEpochs,
                })
            }
            if (i > 0 && i % YIELD_EVERY === 0) {
                await yieldToEventLoop()
            }
        }
        this._postMessage({ action: 'trend-complete', name, totalEpochs })
        return true
    }

    /**
     * Cancel an ongoing {@link computeTrend} loop for the given `name`. The current in-flight epoch
     * (if any) finishes; the loop exits before the next epoch starts.
     */
    cancelTrendComputation (name: string) {
        if (this._trends.has(name)) {
            this._cancelledTrends.add(name)
        }
    }

    /**
     * Compute a single trend epoch and return its result. The shape of the returned array depends on
     * the trend type:
     *  - `'amplitude'`: `[min, max]` envelope pair (semi-log-compressed by default).
     *
     * @param name - Name of the trend.
     * @param epochIndex - Index of the epoch within the recording (0-based, absolute).
     * @returns The trend output for the epoch, or null if the epoch could not be computed.
     */
    async computeTrendEpoch (name: string, epochIndex: number): Promise<number[] | null> {
        const trendProps = this._trends.get(name)
        if (!trendProps) {
            Log.error(`Cannot compute trend '${name}': missing trend properties.`, SCOPE)
            return null
        }
        const epochLength = trendProps.epochLength
        if (epochIndex < 0 || epochIndex*Math.max(epochLength, 1) >= this._totalRecordingLength) {
            Log.error(`Cannot compute trend '${name}': invalid epoch index ${epochIndex}.`, SCOPE)
            return null
        }
        const startTime = Math.max(0, epochIndex*epochLength)
        const endTime = Math.min(startTime + epochLength, this._totalRecordingLength)
        if (endTime - startTime <= 0) {
            return null
        }
        // Trend math applies its own band-pass; ask `getSignals` to skip the per-channel display
        // filters so we don't pay for 3 unused filtfilt passes per channel per epoch.
        const sourceParts = await this.getSignals(
            [startTime, endTime],
            { include: trendProps.derivation.sourceChannels, skipFilters: true }
        )
        if (!sourceParts?.signals.length) {
            Log.warn(`Cannot compute trend '${name}' epoch ${epochIndex}: no source signals available.`, SCOPE)
            return null
        }
        const sourceSignal = this._combineSignalParts(
            sourceParts.signals,
            trendProps.derivation.sourceFunction
        )
        if (!sourceSignal) {
            return null
        }
        let referenceSignal: Float32Array | null = null
        if (trendProps.derivation.referenceChannels.length) {
            const refParts = await this.getSignals(
                [startTime, endTime],
                { include: trendProps.derivation.referenceChannels, skipFilters: true }
            )
            if (refParts?.signals.length) {
                referenceSignal = this._combineSignalParts(
                    refParts.signals,
                    trendProps.derivation.referenceFunction
                )
            }
        }
        const samplingRate = sourceParts.signals[0].samplingRate
        // Cache signals are normalised to volts at decode time (EdfDecoder applies
        // `getSignalScale(physicalUnit)` so µV-, mV- and V-stored EDFs all end up in V — the
        // sensitivity setting then converts the display-unit cm/cm value back to V/cm). The
        // aEEG math, on the other hand, is defined in µV: band-pass thresholds 2/15 Hz are
        // standard EEG units, and the Hellström-Westas semi-log scale is anchored at 10 µV.
        // So convert V → µV here.
        const V_TO_UV = 1e6
        // Final derived signal: source - reference (zero-reference when none provided), in µV.
        const derived = new Float32Array(sourceSignal.length)
        for (let i = 0; i < derived.length; i++) {
            derived[i] = (sourceSignal[i] - (referenceSignal ? referenceSignal[i] || 0 : 0))*V_TO_UV
        }
        if (trendProps.derivation.type === 'amplitude') {
            const aeegOpts = this._settings.trends?.amplitude
            const [min, max] = computeAmplitudeIntegratedEpoch(derived, samplingRate, {
                bandHighpass: aeegOpts?.bandHighpass ?? 2,
                bandLowpass: aeegOpts?.bandLowpass ?? 15,
                envelopeMethod: aeegOpts?.envelopeMethod ?? 'minmax',
                scaleCompression: aeegOpts?.scaleCompression ?? 'semilog',
            })
            return [min, max]
        }
        Log.error(`Cannot compute trend '${name}': unsupported trend type '${trendProps.derivation.type}'.`, SCOPE)
        return null
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
        // If pre-caching is enabled, check whether the requested range is already in the cache.
        const updated = this._settings.precacheMontages && await this.getSignalUpdatedRange()
        if (!updated || updated.start === NUMERIC_ERROR_VALUE ||  updated.start > range[0] || updated.end < range[1]) {
            // Retrieve missing signals (result channels will be filtered according to include/exclude).
            requestedSigs = (await this.calculateSignalsForPart(range[0], range[1], false, config)) as SignalCachePart
            if (!requestedSigs) {
                Log.error(`Could not cache requested signal range ${range[0]} - ${range[1]}.`, SCOPE)
                return null
            }
        } else {
            // Use cached signals — only reached when precacheMontages is enabled.
            const cacheStart = await this._cache.outputRangeStart
            const cacheEnd = await this._cache.outputRangeEnd
            if (cacheStart === null || cacheEnd === null) {
                Log.error(`Loading signals for range [${range[0]}, ${range[1]}] failed.`, SCOPE)
                return null
            }
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
     * Invalidate the cached output signals for all channels. Public entry point for batch-update
     * paths (e.g. the worker `set-filters` handler) that want to flip the cache to "stale" once
     * after a sequence of filter writes rather than per filter write.
     */
    async invalidateOutputCache (): Promise<void> {
        await this._cache?.invalidateOutputSignals()
    }

    /**
     * Set high-pass filter value for given channel. Pass undefined to unset individual filter value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Frequency value or undefined.
     * @param skipInvalidate - Skip the per-call output-cache invalidation. Used by the bulk
     *                        `set-filters` handler to batch one invalidation at the end instead
     *                        of firing one per filter type × channel, which would dispatch up to
     *                        `(channels + 1) * 3` concurrent `invalidateOutputSignals` calls all
     *                        contending for the OUTPUT write lock — manifesting as `Maximum
     *                        retries of locking operation reached` errors.
     */
    setHighpassFilter (value: number, target?: string | number, skipInvalidate = false) {
        if (typeof target === 'number') {
            this._channels[target].highpassFilter = value
        } else {
            this._filters.highpass = value
        }
        if (!skipInvalidate) {
            this._cache?.invalidateOutputSignals()
        }
    }

    /**
     * Set low-pass filter value for given channel. Pass undefined to unset individual filter value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Frequency value or undefined.
     * @param skipInvalidate - See {@link setHighpassFilter}.
     */
    setLowpassFilter (value: number, target?: string | number, skipInvalidate = false) {
        if (typeof target === 'number') {
            this._channels[target].lowpassFilter = value
        } else {
            this._filters.lowpass = value
        }
        if (!skipInvalidate) {
            this._cache?.invalidateOutputSignals()
        }
    }

    /**
     * Set notch filter value for given channel. Pass undefined to unset individual filter value.
     * @param target - Channel index or type (applies too all channels of the given type).
     * @param value - Frequency value or undefined.
     * @param skipInvalidate - See {@link setHighpassFilter}.
     */
    setNotchFilter (value: number, target?: string | number, skipInvalidate = false) {
        if (typeof target === 'number') {
            this._channels[target].notchFilter = value
        } else {
            this._filters.notch = value
        }
        if (!skipInvalidate) {
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
        // When precacheMontages is disabled the mutex runs in input-only mode: no output data
        // fields are registered (inputOnly=true keeps _outputData null) so all output-side
        // operations short-circuit at the !_outputData guard without touching the SAB.
        const inputOnly = !this._settings.precacheMontages
        this._mutex = new BiosignalMutex({ coupledProps: input, inputOnly })
        if (!inputOnly) {
            await this._mutex.initSignalBuffers(
                cacheProps,
                dataDuration,
                input.buffer,
                bufferStart
            )
        }
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

    async setupTrend (
        name: string,
        derivation: BiosignalTrendDerivation,
        samplingRate: number,
        epochLength: number,
        downsamplingMethod: BiosignalDownsamplingMethod
    ) {
        // The only invariant we can verify here is that every channel involved in the derivation
        // shares the same sampling rate — the per-channel `sampleCount` field isn't reliably set
        // on derived montage channels (it's computed lazily from the source signals at fetch time),
        // so it can't be used as a validation key.
        let sourceHz = this._channels[derivation.sourceChannels[0]]?.samplingRate || 0
        if (!sourceHz) {
            Log.error(`Cannot determine source channel sampling rate for trend '${name}'.`, SCOPE)
        } else {
            for (let i=1; i<derivation.sourceChannels.length; i++) {
                if ((this._channels[derivation.sourceChannels[i]]?.samplingRate || 0) !== sourceHz) {
                    Log.error(`Source channels have differing sampling rates for trend '${name}'.`, SCOPE)
                    sourceHz = 0
                    break
                }
            }
            for (const ref of derivation.referenceChannels) {
                if ((this._channels[ref]?.samplingRate || 0) !== sourceHz) {
                    Log.error(`Reference channels have differing sampling rates for trend '${name}'.`, SCOPE)
                    sourceHz = 0
                    break
                }
            }
        }
        if (!sourceHz) {
            Log.error(`Cannot set up trend '${name}': invalid channel sampling rate.`, SCOPE)
            return false
        }
        this._trends.set(name, {
            derivation,
            samplingRate,
            epochLength,
            downsamplingMethod
        })
        return true
    }
}
