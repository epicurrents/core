/**
 * Base class for biosignal trends.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BiosignalDownsamplingMethod,
    BiosignalTrend,
    BiosignalTrendDerivation,
    BiosignalTrendService,
} from '#types'
import { Log } from 'scoped-event-log'
import GenericAsset from '#assets/GenericAsset'

const SCOPE = 'GenericBiosignalTrend'

export default class GenericBiosignalTrend extends GenericAsset implements BiosignalTrend {

    /** For pdBSI trends: integration band `[hp, lp]` in Hz. */
    protected _band: [number, number] | undefined = undefined
    protected _cancelTrend: (() => void) | null = null
    /** Incremented on every new computeTrend call so stale callbacks from a
     *  cancelled computation are silently discarded. */
    protected _computeVersion = 0
    /** End of the last successfully computed range in seconds from recording start.
     *  Set to Number.MAX_SAFE_INTEGER after a full-recording (no-range) run. */
    protected _computedUpToSec = 0
    /** True while computeTrend is running; prevents overlapping computations. */
    protected _computing = false
    /** For ratio trends: denominator band `[hp, lp]` in Hz. */
    protected _denominatorBand: [number, number] | undefined = undefined
    protected _derivation: BiosignalTrendDerivation
    protected _downsamplingMethod: BiosignalDownsamplingMethod = 'average'
    protected _epochLength = 0
    /** For spectrogram trends: number of frequency bins per epoch. */
    protected _frequencyBins: number | undefined = undefined
    protected _label: string
    /** For spectrogram trends: upper frequency limit passed to the processor. */
    protected _maxFreqHz: number | undefined = undefined
    /** For ratio trends: numerator band `[hp, lp]` in Hz. */
    protected _numeratorBand: [number, number] | undefined = undefined
    protected _samplingRate: number
    /** Null for externally-loaded trends that bypass the computation service. */
    protected _service: BiosignalTrendService | null
    protected _signal: number[] = []

    constructor (
            name: string,
            label: string,
            derivation: BiosignalTrendDerivation,
            service: BiosignalTrendService | null,
            options: { epochLength: number, samplingRate: number } & Partial<BiosignalTrend> = { epochLength: 0, samplingRate: 0 }
    ) {
        super(name, 'trend')
        this._derivation = derivation
        this._epochLength = options.epochLength
        this._label = label
        this._samplingRate = options.samplingRate
        this._service = service
        if (options.downsamplingMethod !== undefined) {
            this._downsamplingMethod = options.downsamplingMethod
        }
        // Subclasses that resolve their derivation after construction (e.g. EegTrend via
        // tryResolveDerivation) must call _registerWithService() once the derivation is set.
        // Only call it here when channels are already populated (direct construction with a
        // fully specified derivation). Skip entirely for externally-loaded trends (no service).
        if (service && derivation.sourceChannels.length) {
            this._registerWithService()
        }
    }

    get computedUpToSec () {
        return this._computedUpToSec
    }
    get derivation () {
        return this._derivation
    }
    get downsamplingMethod () {
        return this._downsamplingMethod
    }
    get epochLength () {
        return this._epochLength
    }
    get frequencyBins () {
        return this._frequencyBins
    }
    get label () {
        return this._label
    }
    get samplingRate () {
        return this._samplingRate
    }
    get signal () {
        return this._signal
    }

    /**
     * Send `setupTrend` to the service with the current derivation. Call this once the
     * derivation channels are fully resolved (e.g. after `tryResolveDerivation` succeeds).
     * Guarded by the caller — only called when `_service` is non-null.
     */
    protected _registerWithService () {
        this._service!.setupTrend(
            this._name,
            this._derivation,
            this._samplingRate,
            this._epochLength,
            {
                downsamplingMethod: this._downsamplingMethod,
                maxFreqHz: this._maxFreqHz,
                numeratorBand: this._numeratorBand,
                denominatorBand: this._denominatorBand,
                band: this._band,
            },
        ).then(() => {
            Log.debug(`Trend '${this._name}' registered with service.`, SCOPE)
        }).catch((error: unknown) => {
            Log.error(`Error registering trend '${this._name}': ${error}`, SCOPE)
        })
    }

    cancelTrendComputation () {
        if (this._cancelTrend) {
            this._cancelTrend()
        } else {
            Log.debug(`No ongoing computation to cancel for trend '${this._name}'.`, SCOPE)
        }
        // Increment the version so the cancelled computation's catch block sees it as
        // superseded and does NOT log a spurious error — cancellation is expected.
        this._computeVersion++
        this._computing = false
    }

    /**
     * Run the trend computation through the service. Each epoch's result is spliced into
     * {@link signal} at its absolute epoch-index position and emitted as a `'trend-epoch'`
     * event. When all epochs are done a `'trend-complete'` event is emitted.
     *
     * Calling with a `range` that starts at `computedUpToSec` extends an existing partial
     * result without clearing the signal buffer. Calling with no range (or range starting
     * at 0) resets the buffer and recomputes from the beginning.
     *
     * Concurrent calls are silently dropped — the running computation must finish (or be
     * cancelled) before the next one starts.
     *
     * A no-op for externally-loaded trends (no service); use {@link loadSignal} instead.
     * @param range - Optional `[start, end]` in seconds; defaults to the entire recording.
     */
    async computeTrend (range?: number[]) {
        if (!this._service) {
            Log.debug(`Trend '${this._name}' has no service; use loadSignal() to supply data.`, SCOPE)
            return
        }
        if (this._computing) {
            Log.debug(`Trend '${this._name}' already computing; skipping concurrent request.`, SCOPE)
            return
        }
        this._computing = true
        const version = ++this._computeVersion
        const isExtension = !!(range && range[0] > 0)
        if (!isExtension) {
            // Full recompute: clear any stale data from a previous run.
            this._signal.length = 0
            this._computedUpToSec = 0
        }
        const compute = this._service.computeTrend(this._name, range)
        // Store cancel function locally so the finally block can check identity —
        // if a newer computation has replaced _cancelTrend, this one was superseded.
        const myCancel = compute.cancel
        this._cancelTrend = myCancel
        compute.onEpochReady((signal: number[], epochIndex: number, totalEpochs: number) => {
            // Discard stale results from a computation that was cancelled and replaced.
            if (version !== this._computeVersion) {
                return
            }
            // Direct element assignment instead of splice. splice() on a large sparse
            // array (common for spectrogram trends) runs in O(dictionary entries) in V8
            // dictionary mode, growing with every epoch. Direct assignment is O(1) per
            // element regardless of array size.
            const base = epochIndex * signal.length
            for (let k = 0; k < signal.length; k++) {
                this._signal[base + k] = signal[k]
            }
            this.dispatchPayloadEvent('trend-epoch', {
                signal: signal,
                epochIndex: epochIndex,
                totalEpochs: totalEpochs,
            })
        })
        try {
            await compute.result
            if (version !== this._computeVersion) {
                return  // superseded by a newer computation
            }
            this._computedUpToSec = range?.[1] ?? Number.MAX_SAFE_INTEGER
            Log.debug(`Trend '${this._name}' computation complete (up to ${this._computedUpToSec}s).`, SCOPE)
            this.dispatchEvent('trend-complete')
        } catch (error: unknown) {
            if (version === this._computeVersion) {
                Log.error(`Trend '${this._name}' computation interrupted: ${error}`, SCOPE)
                this.dispatchEvent('trend-error')
            }
        } finally {
            // Only clear shared state if this computation is still the active one.
            if (this._cancelTrend === myCancel) {
                this._cancelTrend = null
                this._computing = false
            }
        }
    }

    /**
     * Load pre-computed signal data into this trend, bypassing the computation service.
     * Replaces any existing signal data and emits `trend-complete`.
     * @param signal      - Flat signal array in the layout expected by the trend's renderer.
     * @param epochLength - Duration of each epoch in seconds.
     */
    loadSignal (signal: number[], epochLength: number) {
        this._epochLength = epochLength
        this._signal.length = 0
        this._signal.push(...signal)
        Log.debug(`Trend '${this._name}' loaded ${signal.length} signal values externally.`, SCOPE)
        this.dispatchEvent('trend-complete')
    }
}
