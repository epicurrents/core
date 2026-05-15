/**
 * Base class for biosignal trends.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BiosignalDownsamplingMethod,
    BiosignalMontageService,
    BiosignalTrend,
    BiosignalTrendDerivation,
} from '#types'
import { Log } from 'scoped-event-log'
import GenericAsset from '#assets/GenericAsset'

const SCOPE = 'GenericBiosignalTrend'

export default class GenericBiosignalTrend extends GenericAsset implements BiosignalTrend {

    protected _cancelTrend: (() => void) | null = null
    protected _derivation: BiosignalTrendDerivation
    protected _downsamplingMethod: BiosignalDownsamplingMethod = 'average'
    protected _epochLength = 0
    protected _label: string
    protected _samplingRate: number
    protected _service: BiosignalMontageService
    protected _signal: number[] = []

    constructor (
            name: string,
            label: string,
            derivation: BiosignalTrendDerivation,
            samplingRate: number,
            epochLength: number,
            service: BiosignalMontageService,
            extraProperties = {} as Partial<BiosignalTrend>
    ) {
        super(name, 'trend')
        this._derivation = derivation
        this._epochLength = epochLength
        this._label = label
        this._samplingRate = samplingRate
        this._service = service
        // Extra properties.
        if (extraProperties.downsamplingMethod !== undefined) {
            this._downsamplingMethod = extraProperties.downsamplingMethod
        }
        // Set up the trend in the service.
        this._service.setupTrend(
            this._name,
            this._derivation,
            this._samplingRate,
            this._epochLength,
            this._downsamplingMethod,
        ).then(() => {
            Log.debug(`Trend '${this._name}' set up complete.`, SCOPE)
        }).catch((error) => {
            Log.error(`Error setting up trend '${this._name}': ${error}`, SCOPE)
        })
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
    get label () {
        return this._label
    }
    get samplingRate () {
        return this._samplingRate
    }
    get signal () {
        return this._signal
    }

    cancelTrendComputation () {
        if (this._cancelTrend) {
            this._cancelTrend()
        } else {
            Log.debug(`No ongoing computation to cancel for trend '${this._name}'.`, SCOPE)
        }
    }

    /**
     * Run the trend computation through the service. Each epoch's result is appended to
     * {@link signal} and emitted as a `'trend-epoch'` event. When all epochs are done, a
     * `'trend-complete'` event is emitted. Cancellation or any other failure emits `'trend-error'`.
     * @param range - Optional `[start, end]` range in seconds; defaults to the entire recording.
     */
    async computeTrend (range?: number[]) {
        // eslint-disable-next-line no-console
        console.log(`[trend-debug] GenericBiosignalTrend.computeTrend '${this._name}' range=${JSON.stringify(range)}`)
        const compute = this._service.computeTrend(this._name, range)
        this._cancelTrend = compute.cancel
        // Reset the buffer so retrying does not leave stale interleaved data.
        this._signal.length = 0
        compute.onEpochReady((signal: number[], epochIndex: number, totalEpochs: number) => {
            // Each epoch contributes `signal.length` samples. Place the values in absolute
            // (epoch-index-based) slots so progressive draws stay aligned even if the loop
            // is restarted mid-flight.
            this._signal.splice(
                epochIndex*signal.length,
                signal.length,
                ...signal
            )
            this.dispatchPayloadEvent('trend-epoch', {
                signal: signal,
                epochIndex: epochIndex,
                totalEpochs: totalEpochs,
            })
        })
        try {
            await compute.result
            // eslint-disable-next-line no-console
            console.log(`[trend-debug] GenericBiosignalTrend.computeTrend COMPLETE '${this._name}' signalLen=${this._signal.length}`)
            Log.debug(`Trend '${this._name}' computation complete.`, SCOPE)
            this.dispatchEvent('trend-complete')
        } catch (error: unknown) {
            // eslint-disable-next-line no-console
            console.log(`[trend-debug] GenericBiosignalTrend.computeTrend ERROR '${this._name}' ${error}`)
            Log.error(`Trend '${this._name}' computation interrupted: ${error}`, SCOPE)
            this.dispatchEvent('trend-error')
        } finally {
            this._cancelTrend = null
        }
    }
}
