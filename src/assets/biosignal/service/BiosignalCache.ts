/**
 * Simplified cache abstraction for a biosignal data.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { combineSignalParts } from '#util'
import { type SignalCachePart, type SignalDataCache } from '#types'
import { Log } from 'scoped-event-log'
import GenericAsset from '#assets/GenericAsset'

const SCOPE = 'BiosignalCache'

export default class BiosignalCache extends GenericAsset implements SignalDataCache {
    protected _dataDuration: number
    protected _input: SignalDataCache | null = null
    protected _signalCache: SignalCachePart = {
        start: 0,
        end: 0,
        signals: [],
    }
    /**
     * Create a new instance of BiosignalCache with optional input cache.
     * @param input - Possible signal cache to use for input data.
     */
    constructor (dataDuration: number, input?: SignalDataCache) {
        super('Biosignal cache', 'cache')
        this._dataDuration = dataDuration
        if (input) {
            this._input = input
        }
    }

    get inputRangeEnd () {
        if (this._input) {
            return Promise.resolve(this._input.outputRangeEnd)
        }
        return Promise.resolve(0)
    }
    get inputRangeStart () {
        if (this._input) {
            return Promise.resolve(this._input.outputRangeStart)
        }
        return Promise.resolve(0)
    }
    get inputSignals () {
        return Promise.resolve(this._input?.asCachePart().signals.map(s => s.data) || [])
    }

    get outputRangeEnd () {
        return this._dataDuration
    }
    get outputRangeStart () {
        return 0
    }
    get outputSignalSamplingRates () {
        return this._signalCache.signals.map(s => s.samplingRate)
    }
    get outputSignalUpdatedRanges () {
        return this._signalCache.signals.map(s => {
            return {
                start: this._signalCache.start*s.samplingRate,
                end: this._signalCache.end*s.samplingRate,
            }
        })
    }

    asCachePart (): SignalCachePart {
        return { ...this._signalCache }
    }

    destroy (dispatchEvent = true) {
        if (dispatchEvent) {
            this.dispatchEvent(BiosignalCache.EVENTS.DESTROY, 'before')
        }
        this.releaseBuffers()
        this._input = null
        super.destroy()
    }

    async insertSignals(signalPart: SignalCachePart) {
        if (this._signalCache.start === this._signalCache.end) {
            // Replace the empty signal cache with the input part.
            if (this._signalCache.signals.length) {
                this.releaseBuffers()
            }
            this._signalCache = { ...signalPart }
        } else if (!combineSignalParts(this._signalCache, signalPart)) {
            Log.error(`Failed to add new singal part to cache.`, SCOPE)
        }
    }

    invalidateOutputSignals() {
        // In this context this is the same as releasing buffers.
        this.releaseBuffers()
    }

    releaseBuffers() {
        this._dataDuration = 0
        this._signalCache.start = 0
        this._signalCache.end = 0
        this._signalCache.signals.length = 0
    }
}
