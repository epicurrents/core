/**
 * Trend processor — in-worker computation engine for biosignal trends.
 *
 * Follows the composition pattern: `_inputCache` and `_outputMutex` are properties,
 * not parent classes, so the same class works with SharedArrayBuffer (SAB) or a
 * plain `BiosignalCache` fallback without any structural difference.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { computeAmplitudeIntegratedEpoch } from '#util/signal'
import { butterHighpass, FFT, SOSFilter } from '#util/dsp'
import { Log } from 'scoped-event-log'
import BiosignalMutex from './BiosignalMutex'
import type {
    BiosignalTrendFunction,
    BiosignalTrendProperties,
    CommonBiosignalSettings,
    SignalCacheMutex,
    SignalDataCache,
    SignalInterruptionMap,
    SignalPart,
} from '#types'
import type { MutexExportProperties } from 'asymmetric-io-mutex'

const SCOPE = 'TrendProcessor'

/** Volts → microvolts. EDF signals are decoded to V; aEEG math is defined in µV. */
const V_TO_UV = 1e6

/** Yield to the event loop every this many epochs so the UI stays responsive. */
const YIELD_EVERY = 5

export default class TrendProcessor {
    /** Names of trends whose computation has been cancelled between epochs. */
    protected _cancelledTrends = new Set<string>()
    /**
     * Pre-allocated CAR scratch buffers, one per trend that uses `averageReference`.
     * Sized for a full epoch at setup time; reused across every epoch to avoid
     * per-epoch Float32Array allocations.  The last (partial) epoch writes into a
     * subarray so unused tail bytes are never read.
     */
    protected _carBuffers = new Map<string, Float32Array>()
    /**
     * Per-trend FFT resources for frequency-domain trends (spectrogram, ratio, pdbsi).
     * Created once in `setupTrend` and reused across all epochs to avoid repeated
     * twiddle-factor allocation.
     *
     * `bins` and `rawBinsPerOutput` apply only to spectrogram output; ratio and pdbsi
     * read directly from the raw FFT bins using `Hz → bin = round(Hz × fftSize / fs)`.
     */
    protected _fftCache = new Map<string, {
        fft:              FFT
        hann:             Float64Array
        fftOut:           Float64Array   // reused output buffer
        inputSr:          number         // input sampling rate used to size the FFT
        bins:             number         // spectrogram output bin count = maxFreqHz (one per Hz)
        rawBinsPerOutput: number         // raw FFT bins averaged into each spectrogram output bin
        /** 0.5 Hz zero-phase highpass applied before FFT to remove reference-electrode drift. */
        preFilter:        SOSFilter
        /** Reused zero-padded FFT input buffer, sized to `fft.size`. */
        padded:           Float32Array
        /** Reused channel-slice scratch for pdbsi (sized to one epoch at inputSr). */
        epochBuf:         Float32Array
    }>()
    /**
     * Input side: the EDF reader's output SAB viewed as a read-only input, or a plain
     * `BiosignalCache` when SharedArrayBuffer is not available.
     */
    protected _inputCache: SignalCacheMutex | SignalDataCache | null = null
    /** Per-channel sampling rates read from the SAB header at setup time.
     *  Used to convert committed sample counts to seconds so _combineChannels
     *  gets a correct cacheDuration during progressive caching. */
    protected _inputChannelSamplingRates: number[] = []
    protected _interruptions: SignalInterruptionMap = new Map()
    /**
     * Output side: the trend's own SAB region where computed epoch values are stored.
     * `null` in no-SAB environments — epochs are forwarded via `_postMessage` only.
     */
    protected _outputMutex: BiosignalMutex | null = null
    /**
     * Outbound message sender — `postMessage` in a real worker, injected callback in
     * `TrendWorkerSubstitute` so per-epoch updates reach the service the same way.
     */
    protected _postMessage: (message: unknown) => void
    protected _settings: CommonBiosignalSettings
    /**
     * Per-channel modality strings (e.g. `'eeg'`, `'ekg'`, `'annotation'`), passed at
     * setup time. Used by `_averageReferenceInto` to restrict CAR to like-modality
     * channels — a single non-EEG channel can have voltages thousands of times larger
     * than EEG and would otherwise dominate the average. Empty array means the caller
     * did not provide modalities, in which case CAR falls back to averaging every
     * non-empty channel (legacy behaviour).
     */
    protected _signalModalities: string[] = []
    protected _totalDataLength = 0
    protected _totalRecordingLength = 0
    /** Registered trends, keyed by name. */
    protected _trends = new Map<string, BiosignalTrendProperties>()
    /**
     * Monotonically increasing session counter per trend name. Each call to
     * `computeTrend` increments the session for that name. The running loop
     * checks its own session on every yield; if a newer computation has started,
     * the old loop exits immediately — closing the race between the cancel message
     * arriving and the old loop checking `_cancelledTrends`.
     */
    protected _trendSessions = new Map<string, number>()

    constructor (
        settings: CommonBiosignalSettings,
        postMessageFn?: (message: unknown) => void
    ) {
        this._settings = settings
        this._postMessage = postMessageFn ?? ((msg) => {
            if (typeof postMessage === 'function') {
                ;(postMessage as (m: unknown) => void)(msg)
            }
        })
    }

    set settings (value: CommonBiosignalSettings) {
        this._settings = value
    }

    /**
     * Compute the Common Average Reference for the given time window and write the
     * result into `out`.  Returns a subarray view of `out` sized to the actual
     * number of samples written (may be shorter than `out` for the last epoch),
     * or `null` if no signal data was available.
     *
     * Writing directly into the caller-supplied buffer avoids a Float32Array
     * allocation on every epoch.
     */
    protected _averageReferenceInto (
        allSignals: Float32Array[],
        cacheStart: number,
        cacheEnd: number,
        dataStart: number,
        dataEnd: number,
        out: Float32Array
    ): Float32Array | null {
        const cacheDuration = cacheEnd - cacheStart
        if (cacheDuration <= 0 || !allSignals.length) {
            return null
        }
        const sr = allSignals[0].length / cacheDuration
        const startSample = Math.round((dataStart - cacheStart) * sr)
        const length = Math.min(
            Math.round((dataEnd - dataStart) * sr),
            out.length
        )
        if (length <= 0) {
            return null
        }
        const view = out.subarray(0, length)
        view.fill(0)
        // Restrict CAR to EEG-modality channels when modality metadata was provided.
        // A single non-EEG channel (EKG, photic, status) can have voltages thousands of
        // times larger than EEG and would otherwise dominate the mean — turning derived
        // signals into essentially −CAR for every electrode and collapsing per-channel
        // spectral asymmetry to nothing.
        const hasModalityInfo = this._signalModalities.length === allSignals.length
        let channelCount = 0
        for (let ci = 0; ci < allSignals.length; ci++) {
            if (hasModalityInfo && this._signalModalities[ci] !== 'eeg') {
                continue
            }
            const sig = allSignals[ci]
            const s0 = Math.max(0, startSample)
            const s1 = Math.min(sig.length, startSample + length)
            if (s0 >= sig.length || s1 <= 0) {
                continue
            }
            const offset = s0 - startSample
            for (let i = 0, n = s1 - s0; i < n; i++) {
                view[offset + i] += sig[s0 + i]
            }
            channelCount++
        }
        if (!channelCount) {
            return null
        }
        for (let i = 0; i < length; i++) {
            view[i] /= channelCount
        }
        return view
    }

    /**
     * Extract and combine a set of channels from the full input-signal arrays,
     * sliced to the requested time window.
     */
    protected _combineChannels (
        allSignals: Float32Array[],
        cacheStartSeconds: number,
        cacheEndSeconds: number,
        channelIndices: number[],
        fn: BiosignalTrendFunction = 'average',
        startTime: number,
        endTime: number
    ): Float32Array | null {
        const parts: SignalPart[] = []
        const cacheDuration = cacheEndSeconds - cacheStartSeconds
        for (const idx of channelIndices) {
            const sig = allSignals[idx]
            if (!sig?.length || cacheDuration <= 0) {
                continue
            }
            // sr = committed samples / committed duration. With the corrected cacheEnd
            // (committed end, not allocated end) this now equals the true channel sr.
            const sr = sig.length / cacheDuration
            const startSample = Math.round((startTime - cacheStartSeconds) * sr)
            const endSample = Math.round((endTime - cacheStartSeconds) * sr)
            if (startSample >= sig.length || endSample <= 0) {
                continue
            }
            parts.push({
                data: sig.subarray(
                    Math.max(0, startSample),
                    Math.min(sig.length, endSample)
                ),
                samplingRate: sr,
            })
        }
        return this._combineSignalParts(parts, fn)
    }

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
     * Compute one pdBSI epoch:
     *   pdBSI = mean over pairs of |P_R − P_L| / (P_R + P_L)
     * where P is total power in the configured band for one electrode of the pair.
     *
     * Each pair entry in `derivation.pairs` is `[leftIndex, rightIndex]` into the raw
     * input-signal arrays. Optional Common Average Reference is applied to every channel
     * uniformly before the FFT.
     */
    protected async _computePdbsiEpoch (
        name: string,
        trendProps: BiosignalTrendProperties,
        allSignals: Float32Array[],
        cacheStart: number,
        cacheEnd: number,
        dataStart: number,
        dataEnd: number,
    ): Promise<number[] | null> {
        const fftRes = this._fftCache.get(name)
        if (!fftRes) {
            Log.warn(`Trend '${name}': FFT not initialised for pdbsi.`, SCOPE)
            return null
        }
        const pairs = trendProps.derivation.pairs
        if (!pairs?.length) {
            return null
        }
        const cacheDuration = cacheEnd - cacheStart
        if (cacheDuration <= 0) {
            return null
        }
        const band = trendProps.band ?? [1, 4]
        const { fft, hann, fftOut, inputSr, preFilter, padded, epochBuf } = fftRes
        // Use the configured channel-0 sampling rate when available — `allSignals[0]` may
        // be an annotation channel with length 0, in which case `length / cacheDuration`
        // would be 0 even though every actual signal channel has data.
        const sr = this._inputChannelSamplingRates[0]
            || (allSignals[0]?.length ? allSignals[0].length / cacheDuration : 0)
        if (!sr) {
            return null
        }
        const startSample = Math.round((dataStart - cacheStart) * sr)
        const sliceLen = Math.round((dataEnd - dataStart) * sr)
        if (sliceLen <= 0) {
            return null
        }
        // Optional CAR: compute once across all input channels for this epoch, reused
        // across every electrode in every pair.
        let carSlice: Float32Array | null = null
        if (trendProps.derivation.averageReference) {
            let buf = this._carBuffers.get(name)
            if (!buf || buf.length < sliceLen) {
                buf = new Float32Array(Math.max(sliceLen, Math.round(trendProps.epochLength * inputSr)))
                this._carBuffers.set(name, buf)
            }
            carSlice = this._averageReferenceInto(
                allSignals, cacheStart, cacheEnd, dataStart, dataEnd, buf
            )
        }
        let total = 0
        let nPairs = 0
        for (const [leftIdx, rightIdx] of pairs) {
            const pL = this._pdbsiBandPower(
                allSignals, leftIdx, startSample, sliceLen, carSlice,
                preFilter, padded, epochBuf, fft, hann, fftOut, inputSr, band
            )
            const pR = this._pdbsiBandPower(
                allSignals, rightIdx, startSample, sliceLen, carSlice,
                preFilter, padded, epochBuf, fft, hann, fftOut, inputSr, band
            )
            if (pL === null || pR === null) {
                continue
            }
            const denom = pR + pL
            if (denom <= 0) {
                continue
            }
            total += Math.abs(pR - pL) / denom
            nPairs++
        }
        if (!nPairs) {
            return null
        }
        return [total / nPairs]
    }

    /**
     * Returns true when the epoch `[startRec, endRec]` (both in recording time) overlaps
     * any interruption. Epochs that touch a gap boundary are also considered gap epochs
     * because partial-epoch aEEG computation produces unreliable bandpass results.
     */
    protected _epochOverlapsGap (startRec: number, endRec: number): boolean {
        let priorGapTotal = 0
        for (const [dataStart, duration] of this._interruptions) {
            const gapStartRec = dataStart + priorGapTotal
            const gapEndRec = gapStartRec + duration
            if (gapStartRec >= endRec) {
                break
            }
            if (startRec < gapEndRec) {
                return true
            }
            priorGapTotal += duration
        }
        return false
    }

    /**
     * Total interruption time (seconds) that falls strictly before `recordingTime`.
     * Used to convert a recording-time position to its data-time equivalent.
     * Returns 0 when there are no interruptions.
     */
    protected _getInterruptionTimeBefore (recordingTime: number): number {
        let total = 0
        for (const [dataStart, duration] of this._interruptions) {
            const gapStartRec = dataStart + total
            if (recordingTime <= gapStartRec) {
                break
            }
            if (recordingTime < gapStartRec + duration) {
                break  // inside the gap — don't count it as completed
            }
            total += duration
        }
        return total
    }

    /**
     * Integrate raw FFT power across `[band[0]..band[1])` Hz. The output range is in the
     * same units as `fftOut[k]² + fftOut[k+1]²` — adequate for ratio formulas where the
     * absolute scale cancels.
     */
    protected _integrateBandPower (
        fftOut: Float64Array,
        fftSize: number,
        inputSr: number,
        band: [number, number],
    ): number {
        const half = fftSize >>> 1
        const k0 = Math.max(0, Math.min(half, Math.round(band[0] * fftSize / inputSr)))
        const k1 = Math.max(k0 + 1, Math.min(half, Math.round(band[1] * fftSize / inputSr)))
        let p = 0
        for (let k = k0; k < k1; k++) {
            const idx = k * 2
            p += fftOut[idx] * fftOut[idx] + fftOut[idx + 1] * fftOut[idx + 1]
        }
        return p
    }

    /**
     * Total power in `band` for one channel's epoch slice. Applies the pre-filter and
     * (optional) CAR subtraction, runs the cached FFT, and integrates raw bin power
     * across the band. Returns `null` when the slice is empty.
     */
    protected _pdbsiBandPower (
        allSignals: Float32Array[],
        channelIdx: number,
        startSample: number,
        sliceLen: number,
        carSlice: Float32Array | null,
        preFilter: SOSFilter,
        padded: Float32Array,
        epochBuf: Float32Array,
        fft: FFT,
        hann: Float64Array,
        fftOut: Float64Array,
        inputSr: number,
        band: [number, number],
    ): number | null {
        const sig = allSignals[channelIdx]
        if (!sig?.length) {
            return null
        }
        const s0 = Math.max(0, startSample)
        const s1 = Math.min(sig.length, startSample + sliceLen)
        if (s0 >= sig.length || s1 <= 0) {
            return null
        }
        const span = s1 - s0
        const view = epochBuf.subarray(0, span)
        if (carSlice && carSlice.length === sliceLen) {
            const offset = s0 - startSample
            for (let i = 0; i < span; i++) {
                view[i] = sig[s0 + i] - carSlice[offset + i]
            }
        } else {
            for (let i = 0; i < span; i++) {
                view[i] = sig[s0 + i]
            }
        }
        // Subtract the per-channel epoch mean. CAR removes the common DC across channels but
        // leaves each electrode's individual offset; the 0.5 Hz HP can't fully settle that
        // offset within one epoch, and the residual leaks through the FFT making every channel
        // contribute near-identical band power — collapsing pdBSI to ~0 regardless of asymmetry.
        let sum = 0
        for (let i = 0; i < span; i++) sum += view[i]
        const mean = sum / span
        for (let i = 0; i < span; i++) view[i] -= mean
        const filtered = preFilter.filtfilt(view)
        padded.fill(0)
        const copyLen = Math.min(filtered.length, fft.size)
        for (let i = 0; i < copyLen; i++) {
            padded[i] = filtered[i]
        }
        fft.forward(padded, fftOut, hann)
        return this._integrateBandPower(fftOut, fft.size, inputSr, band)
    }

    /** Set the cancellation flag; the loop exits before the next epoch starts. */
    cancelTrendComputation (name: string) {
        if (this._trends.has(name)) {
            this._cancelledTrends.add(name)
        }
    }

    /**
     * Run the full computation loop for the given trend, posting a `'trend-epoch'`
     * message for each completed epoch and a `'trend-complete'` message when done.
     * Cancellation is cooperative: check between epochs via `cancelTrendComputation`.
     *
     * @param name - Trend name registered with {@link setupTrend}.
     * @param range - Optional `[start, end]` in seconds; defaults to the full recording.
     */
    async computeTrend (name: string, range?: number[]): Promise<boolean> {
        const trendProps = this._trends.get(name)
        if (!trendProps) {
            Log.error(`Cannot compute trend '${name}': not registered.`, SCOPE)
            this._postMessage({ action: 'trend-error', name, error: 'Trend has not been set up.' })
            return false
        }
        // Assign a monotonically increasing session ID to this computation. Any running
        // loop for the same trend name will see a newer session on its next yield and exit
        // without posting further results — closing the race where cancel is processed
        // *after* the old loop has already resumed from its yield point and cleared the
        // cancel flag itself.
        const mySession = (this._trendSessions.get(name) ?? 0) + 1
        this._trendSessions.set(name, mySession)
        this._cancelledTrends.delete(name)
        const epochLength = trendProps.epochLength
        const rangeStart = Math.max(0, range?.[0] ?? 0)
        const rangeEnd = Math.min(range?.[1] ?? this._totalRecordingLength, this._totalRecordingLength)
        const totalEpochs = Math.ceil((rangeEnd - rangeStart) / epochLength)
        const firstEpoch = Math.floor(rangeStart / epochLength)

        const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

        let workDone = 0  // count only non-gap epochs for yield throttling
        for (let i = 0; i < totalEpochs; i++) {
            if (this._cancelledTrends.has(name)) {
                Log.debug(`Trend '${name}' cancelled at epoch ${i}/${totalEpochs}.`, SCOPE)
                this._cancelledTrends.delete(name)
                this._postMessage({ action: 'trend-cancelled', name })
                return false
            }
            // Session check: a newer computeTrend call has started for this trend.
            // Exit silently — the new computation is now the authoritative one.
            if (this._trendSessions.get(name) !== mySession) {
                Log.debug(`Trend '${name}' session ${mySession} superseded at epoch ${i}/${totalEpochs}.`, SCOPE)
                return false
            }
            const epochIndex = firstEpoch + i
            const signal = await this.computeTrendEpoch(name, epochIndex)
            if (signal !== null) {
                this._postMessage({
                    action: 'trend-epoch',
                    name,
                    epochIndex,
                    signal,
                    totalEpochs,
                })
                // Yield only after actual computation work — gap epochs (null) are
                // skipped cheaply and must not inflate the yield counter, otherwise
                // a large recording gap causes thousands of unnecessary async yields
                // that pause the trend for seconds.
                workDone++
                if (workDone % YIELD_EVERY === 0) {
                    await yieldToEventLoop()
                }
            }
        }
        // Final session guard: the loop finished but a new computation started on the
        // last iteration's yield. Don't post trend-complete for a superseded run.
        if (this._trendSessions.get(name) !== mySession) {
            Log.debug(`Trend '${name}' session ${mySession} superseded after loop completion.`, SCOPE)
            return false
        }
        this._postMessage({ action: 'trend-complete', name, totalEpochs })
        return true
    }

    /**
     * Compute a single epoch and return its result array, or null on failure.
     * For `'amplitude'` trends: returns `[min, max]` in semi-log-compressed µV.
     */
    async computeTrendEpoch (name: string, epochIndex: number): Promise<number[] | null> {
        if (!this._inputCache) {
            Log.error(`Cannot compute trend '${name}' epoch ${epochIndex}: no input cache.`, SCOPE)
            return null
        }
        const trendProps = this._trends.get(name)
        if (!trendProps) {
            return null
        }
        const epochLength = trendProps.epochLength
        const startTime = Math.max(0, epochIndex * epochLength)
        const endTime = Math.min(startTime + epochLength, this._totalRecordingLength)
        if (endTime - startTime <= 0) {
            return null
        }
        // Gap check: any epoch that overlaps an interruption is treated as a gap epoch.
        // Return null so the epoch is not posted and its signal positions stay empty.
        // Amplitude trends previously used [NaN, NaN] as a positional sentinel, but that
        // only works when signal.length === 2 per epoch. For variable-length epochs
        // (spectrogram: `bins` values) the sentinel would be spliced at the wrong offset
        // and corrupt surrounding pre-gap data.
        if (this._interruptions.size > 0 && this._epochOverlapsGap(startTime, endTime)) {
            return null
        }
        // Convert recording-time epoch boundaries to data time (gap-exclusive) before
        // indexing into the SAB. Without this, epochs after any gap would sample the
        // wrong region of the SAB (which stores signal in gap-exclusive data time).
        const dataStart = this._interruptions.size > 0
            ? startTime - this._getInterruptionTimeBefore(startTime)
            : startTime
        const dataEnd = this._interruptions.size > 0
            ? endTime - this._getInterruptionTimeBefore(endTime)
            : endTime
        // Read signal arrays. Mutex (SAB) path: read via input views.
        // Plain-cache (no-SAB) path: read from the cache's own output.
        let allSignals: Float32Array[]
        let cacheStart: number
        let cacheEnd: number
        if (this._inputCache instanceof BiosignalMutex) {
            allSignals = await this._inputCache.inputSignals
            cacheStart = (await this._inputCache.inputRangeStart) ?? 0
            // inputRangeEnd returns the ALLOCATED total (constant = totalDataDuration).
            // During progressive caching allSignals[i] is only the committed subarray,
            // so sr = sig.length / totalDataDuration would be far too low. Derive the
            // actual committed end from the committed sample count and the true channel sr.
            const sr0 = this._inputChannelSamplingRates[0]
            cacheEnd = (sr0 && allSignals[0]?.length)
                ? cacheStart + allSignals[0].length / sr0
                : (await this._inputCache.inputRangeEnd) ?? this._totalDataLength
        } else {
            const part  = (this._inputCache as SignalDataCache).asCachePart()
            allSignals  = part.signals.map(s => s.data)
            cacheStart  = (this._inputCache as SignalDataCache).outputRangeStart
            cacheEnd    = (this._inputCache as SignalDataCache).outputRangeEnd
        }
        if (!allSignals.length) {
            Log.warn(`Trend '${name}' epoch ${epochIndex}: no input signals available.`, SCOPE)
            return null
        }
        if (trendProps.derivation.type === 'pdbsi') {
            return this._computePdbsiEpoch(
                name, trendProps, allSignals, cacheStart, cacheEnd, dataStart, dataEnd
            )
        }
        // Derive source and reference signals using data-time positions.
        const sourceSignal = this._combineChannels(
            allSignals, cacheStart, cacheEnd,
            trendProps.derivation.sourceChannels,
            trendProps.derivation.sourceFunction,
            dataStart, dataEnd
        )
        if (!sourceSignal) {
            return null
        }
        let referenceSignal: Float32Array | null = null
        if (trendProps.derivation.averageReference) {
            // Common Average Reference: mean of all available input channels.
            // Averages out electrode-specific noise so a single bad reference
            // electrode doesn't contaminate all derivations.
            let buf = this._carBuffers.get(name)
            if (!buf) {
                // Cache path: SR wasn't known at setupTrend time — allocate now
                // from the first epoch's actual sample count.
                buf = new Float32Array(sourceSignal.length)
                this._carBuffers.set(name, buf)
            }
            referenceSignal = this._averageReferenceInto(
                allSignals, cacheStart, cacheEnd, dataStart, dataEnd, buf
            )
        } else if (trendProps.derivation.referenceChannels.length) {
            referenceSignal = this._combineChannels(
                allSignals, cacheStart, cacheEnd,
                trendProps.derivation.referenceChannels,
                trendProps.derivation.referenceFunction,
                dataStart, dataEnd
            )
        }
        // Infer sampling rate from the source signal length (samples / epochLength).
        // epochLength is the recording-time span; the data slice is the same duration
        // for non-gap epochs so using epochLength here is correct.
        const samplingRate = sourceSignal.length / epochLength
        // EDF signals are in volts; aEEG math is defined in µV.
        const derived = new Float32Array(sourceSignal.length)
        for (let i = 0; i < derived.length; i++) {
            derived[i] = (sourceSignal[i] - (referenceSignal?.[i] ?? 0)) * V_TO_UV
        }
        if (trendProps.derivation.type === 'amplitude') {
            const opts = this._settings.trends?.amplitude
            const [min, max] = computeAmplitudeIntegratedEpoch(derived, samplingRate, {
                bandHighpass: opts?.bandHighpass ?? 2,
                bandLowpass: opts?.bandLowpass ?? 15,
                envelopeMethod: opts?.envelopeMethod ?? 'minmax',
                scaleCompression: opts?.scaleCompression ?? 'semilog',
            })
            return [min, max]
        }
        if (trendProps.derivation.type === 'spectrogram') {
            const fftRes = this._fftCache.get(name)
            if (!fftRes) {
                Log.warn(`Trend '${name}': FFT not initialised for spectrogram.`, SCOPE)
                return null
            }
            const { fft, hann, fftOut, bins, rawBinsPerOutput, preFilter, padded } = fftRes
            // Remove reference-electrode drift before FFT. filtfilt is zero-phase
            // so it doesn't shift spectral peaks within the epoch.
            const filtered = preFilter.filtfilt(derived)
            padded.fill(0)
            const copyLen = Math.min(filtered.length, fft.size)
            for (let i = 0; i < copyLen; i++) padded[i] = filtered[i]
            fft.forward(padded, fftOut, hann)
            // Aggregate raw FFT bins into fixed output bins (one per Hz).
            // Each output bin k covers raw FFT bins [k*bpo .. (k+1)*bpo - 1].
            // Short epochs: rawBinsPerOutput=1 (no aggregation).
            // Long epochs: rawBinsPerOutput>1 (average multiple raw bins).
            const power = new Array<number>(bins)
            for (let k = 0; k < bins; k++) {
                let sum = 0
                const start = k * rawBinsPerOutput
                for (let j = 0; j < rawBinsPerOutput; j++) {
                    const idx = (start + j) * 2
                    sum += fftOut[idx] * fftOut[idx] + fftOut[idx + 1] * fftOut[idx + 1]
                }
                power[k] = sum / rawBinsPerOutput
            }
            return power
        }
        if (trendProps.derivation.type === 'ratio') {
            const fftRes = this._fftCache.get(name)
            if (!fftRes) {
                Log.warn(`Trend '${name}': FFT not initialised for ratio.`, SCOPE)
                return null
            }
            const { fft, hann, fftOut, inputSr, preFilter, padded } = fftRes
            // Defaults match TAR (theta / alpha), which is what the EEG-module threshold
            // default (0.26 per van Stigt 2023) is calibrated for.
            const numBand = trendProps.numeratorBand ?? [4, 8]
            const denBand = trendProps.denominatorBand ?? [8, 13]
            // Subtract the epoch mean before filtering. The 0.5 Hz pre-filter cannot fully
            // settle a multi-MV DC offset within a 2-s epoch, so residual DC leaks into the
            // band-power integrations via the Hann-window side-lobes and dominates the
            // result — yielding a near-constant ratio across all epochs. Mirrors the
            // `computeAmplitudeIntegratedEpoch` demean for the same reason.
            let sum = 0
            for (let i = 0; i < derived.length; i++) sum += derived[i]
            const mean = sum / derived.length
            for (let i = 0; i < derived.length; i++) derived[i] -= mean
            const filtered = preFilter.filtfilt(derived)
            padded.fill(0)
            const copyLen = Math.min(filtered.length, fft.size)
            for (let i = 0; i < copyLen; i++) padded[i] = filtered[i]
            fft.forward(padded, fftOut, hann)
            const pNum = this._integrateBandPower(fftOut, fft.size, inputSr, numBand)
            const pDen = this._integrateBandPower(fftOut, fft.size, inputSr, denBand)
            const total = pNum + pDen
            if (total <= 0) {
                return null
            }
            // Normalised form (P_num − P_den) / (P_num + P_den) yields a value on
            // [−1, +1] so a single threshold setting covers both extremes regardless
            // of which band convention (TAR, DAR, …) is configured.
            return [(pNum - pDen) / total]
        }
        Log.error(`Unsupported trend type '${trendProps.derivation.type}' for trend '${name}'.`, SCOPE)
        return null
    }

    async destroy () {
        this._trends.clear()
        this._cancelledTrends.clear()
        this._carBuffers.clear()
        this._fftCache.clear()
        this._inputCache = null
        this._outputMutex = null
    }

    setInterruptions (interruptions: SignalInterruptionMap) {
        this._interruptions = interruptions
    }

    /**
     * Register a named trend. Must be called before `computeTrend`.
     * Returns false if a trend with the same name already exists.
     */
    setupTrend (name: string, props: BiosignalTrendProperties): boolean {
        if (this._trends.has(name)) {
            // Re-setup is a normal part of the activate / change-montage cycle — the EEG module
            // tears trends down and rebuilds them. Demote to debug so it doesn't surface as a
            // user-visible callout via the Log.warn → addCallout bridge.
            Log.debug(`Trend '${name}' is already registered; overwriting.`, SCOPE)
        }
        this._trends.set(name, props)
        // Pre-allocate a CAR scratch buffer sized for one full epoch.  A single
        // reusable allocation replaces one new Float32Array per epoch per trend.
        // The SR is known here only on the SAB path (setupWithInputMutex has run);
        // on the cache path the buffer is allocated lazily on the first epoch.
        if (props.derivation.averageReference) {
            const inputSr = this._inputChannelSamplingRates[0] ?? 0
            if (inputSr > 0) {
                const epochSamples = Math.round(props.epochLength * inputSr)
                this._carBuffers.set(name, new Float32Array(epochSamples))
                Log.debug(`Trend '${name}' CAR buffer: ${epochSamples} samples.`, SCOPE)
            }
        }
        // Pre-build FFT resources for frequency-domain trends so twiddle factors are
        // computed once and reused across every epoch in the loop.
        const type = props.derivation.type
        if (type === 'spectrogram' || type === 'ratio' || type === 'pdbsi') {
            const inputSr = this._inputChannelSamplingRates[0] ?? 0
            if (inputSr > 0) {
                const epochSamples = Math.round(props.epochLength * inputSr)
                const fftSize = 1 << Math.ceil(Math.log2(epochSamples))
                // Spectrogram-specific output binning. Ratio and pdbsi read raw bins
                // directly via Hz→bin conversion, so these values are unused for them.
                const maxFreq = props.maxFreqHz ?? 30
                const rawBinsPerOutput = Math.max(1, Math.round(fftSize / inputSr))
                const bins = maxFreq
                const fft = new FFT(fftSize)
                // 2nd-order Butterworth highpass at 0.5 Hz. Removes slow reference-
                // electrode drift (movement, impedance change) that would otherwise
                // inflate the delta bin and mask genuine sleep/wake differences.
                const preFilter = new SOSFilter(butterHighpass(2, 0.5, inputSr))
                this._fftCache.set(name, {
                    fft,
                    hann:             FFT.hann(fftSize),
                    fftOut:           new Float64Array(fftSize * 2),
                    inputSr,
                    bins,
                    rawBinsPerOutput,
                    preFilter,
                    padded:           new Float32Array(fftSize),
                    epochBuf:         new Float32Array(epochSamples),
                })
                Log.debug(`Trend '${name}' FFT: type=${type} size=${fftSize}, inputSr=${inputSr}.`, SCOPE)
            }
        }
        Log.debug(`Trend '${name}' registered (type=${props.derivation.type}, epochLength=${props.epochLength}s).`, SCOPE)
        return true
    }

    /**
     * Connect the processor to a plain `BiosignalCache` (no-SAB path).
     * Called by `TrendWorkerSubstitute` when SharedArrayBuffer is unavailable.
     */
    setupWithCache (cache: SignalDataCache, dataDuration: number, recordingDuration: number) {
        this._totalDataLength = dataDuration
        this._totalRecordingLength = recordingDuration
        this._inputCache = cache
        Log.debug(`TrendProcessor connected to cache (dataDuration=${dataDuration}s).`, SCOPE)
    }

    /**
     * Connect the processor to the EDF reader's output SAB as an input-only reader.
     * Must be called before `setupTrend` or `computeTrend`.
     */
    async setupWithInputMutex (
        input: MutexExportProperties,
        dataDuration: number,
        recordingDuration: number,
        signalModalities?: string[],
    ): Promise<boolean> {
        if (!input.buffer) {
            Log.error(`Cannot set up TrendProcessor without an input buffer.`, SCOPE)
            return false
        }
        this._totalDataLength = dataDuration
        this._totalRecordingLength = recordingDuration
        this._inputCache = new BiosignalMutex({ coupledProps: input, inputOnly: true })
        // Read per-channel sampling rates from the SAB header once. These are constant
        // and needed to compute the committed data end during progressive caching
        // (inputRangeEnd returns the allocated total, not the written-to position).
        this._inputChannelSamplingRates = await Promise.all(
            (this._inputCache as BiosignalMutex).inputSignalSamplingRates
        )
        this._signalModalities = signalModalities ?? []
        Log.debug(`TrendProcessor connected to input SAB (dataDuration=${dataDuration}s, channels=${this._inputChannelSamplingRates.length}, modalities=${this._signalModalities.length ? this._signalModalities.join(',') : 'unspecified'}).`, SCOPE)
        return true
    }
}
