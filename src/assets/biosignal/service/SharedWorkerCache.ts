/**
 * Simplified cache abstraction for a shared signal data worker.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericService from '#assets/service/GenericService'
import { combineSignalParts } from '#root/src/util'
import { type SignalRange, type SignalDataCache } from '#types/biosignal'
import { type SignalCachePart, type WorkerCommission } from '#types/service'
import { Log } from 'scoped-event-log'

const SCOPE = 'SharedWorkerCache'

export default class SharedWorkerCache extends GenericService implements SignalDataCache {
    protected _postMessage: typeof postMessage
    protected _rangeEnd = 0
    protected _rangeStart = 0
    protected _signalCache: SignalCachePart = {
        start: 0,
        end: 0,
        signals: [],
    }
    protected _signalSamplingRates: number[] = []
    protected _signalUpdatedRanges: SignalRange[] = []

    constructor (port: MessagePort, post: typeof postMessage) {
        super(GenericService.CONTEXTS.BIOSIGNAL, port, true)
        this._postMessage = post
        port.addEventListener('message', this.handleWorkerMessage.bind(this))
    }

    get inputRangeEnd () {
        const commission = this._commissionWorker('get-range-end')
        return commission.promise as Promise<number>
    }
    get inputRangeStart () {
        const commission = this._commissionWorker('get-range-start')
        return commission.promise as Promise<number>
    }
    get inputSignals () {
        const commission = this._commissionWorker('get-signals')
        return commission.promise as Promise<Float32Array[]>
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

    // Override _commissionWorker to include ID as caller.
    protected _commissionWorker(
        action: string,
        props?: Map<string, unknown> | undefined,
        callbacks?: {
            resolve: (value?: unknown) => void,
            reject: (reason?: string | undefined) => void
        } | undefined,
        overwriteRequest?: boolean
    ): WorkerCommission {
        return super._commissionWorker(
            action,
            props ? props.set('caller', this.id)
                  : new Map<string, unknown>([
                        ['caller', this.id]
                    ]),
            callbacks,
            overwriteRequest
        )
    }

    asCachePart(): SignalCachePart {
        return this._signalCache
    }

    handleWorkerMessage (message: MessageEvent) {
        const data = message.data
        // Only react to messages addressed to us.
        if (data.caller !== this.id) {
            return
        }
        const commission = this._getCommissionForMessage(message)
        if (commission) {
            if (data.action === 'get-range-end') {
                commission.resolve(data.value)
            } else if (data.action === 'get-range-start') {
                commission.resolve(data.value)
            } else if (data.action === 'get-signals') {
                commission.resolve(data.value)
            }
        }
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