/**
 * Simplified cache abstraction for a biosignal data.
 * @package    epicurrents-core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericAsset } from '#/'
import { combineSignalParts } from '#util'
import { type SignalDataCache, type SignalRange } from '#types/biosignal'
import { type SignalCachePart } from '#types/service'
import { Log } from 'scoped-ts-log'

const SCOPE = 'BiosignalCache'

export default class BiosignalCache extends GenericAsset implements SignalDataCache {
    protected _rangeEnd = 0
    protected _rangeStart = 0
    protected _signalCache: SignalCachePart = {
        start: 0,
        end: 0,
        signals: [],
    }
    protected _signalSamplingRates: number[] = []
    protected _signalUpdatedRanges: SignalRange[] = []

    constructor () {
        super('Biosignal cache', 'sig', 'cache')
    }

    /* Simple cache does not have input data. */
    get inputRangeEnd () {
        return Promise.resolve(0)
    }
    get inputRangeStart () {
        return Promise.resolve(0)
    }
    get inputSignals () {
        return Promise.resolve([])
    }

    get outputRangeEnd () {
        return this._rangeEnd
    }
    get outputRangeStart () {
        return this._rangeStart
    }
    get outputSignalSamplingRates () {
        return this._signalSamplingRates
    }
    get outputSignalUpdatedRanges () {
        return this._signalUpdatedRanges
    }

    asCachePart(): SignalCachePart {
        return this._signalCache
    }

    async insertSignals(signalPart: SignalCachePart) {
        if (this._signalCache.start === this._signalCache.end) {
            if (this._signalCache.signals.length) {
                this.releaseBuffers()
            }
            this._signalCache = signalPart
        } else if (!combineSignalParts(this._signalCache, signalPart)) {
            Log.error(`Failed to add new singal part to cache.`, SCOPE)
        }
    }

    invalidateOutputSignals() {
        // In this context this is the same as releasing buffers.
        this.releaseBuffers()
    }

    releaseBuffers() {
        this._signalCache.start = 0
        this._signalCache.end = 0
        this._signalCache.signals.splice(0)
    }
}