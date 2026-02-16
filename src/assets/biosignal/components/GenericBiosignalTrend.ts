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

export default abstract class GenericBiosignalTrend extends GenericAsset implements BiosignalTrend {

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

    async computeTrend () {
        const compute = this._service.computeTrend()
        this._cancelTrend = compute.cancel
        compute.onEpochReady((signal: number[], epochIndex: number, totalEpochs: number) => {
            this._signal.splice(
                epochIndex*this._epochLength,
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
            Log.debug(`Trend '${this._name}' computation complete.`, SCOPE)
            this.dispatchEvent('trend-complete')
        } catch (error: unknown) {
            Log.error(`Trend '${this._name}' computation interrupted: ${error}`, SCOPE)
            this.dispatchEvent('trend-error')
        } finally {
            this._cancelTrend = null
        }
    }
}
