/**
 * Cache abstraction for a shared signal data worker.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericService } from "#assets"
import { SignalCachePart, WorkerCommission } from "#root/src/types"
import { type SignalRange, type WorkerSignalCache } from "#types/biosignal"

export default class SharedWorkerCache extends GenericService implements WorkerSignalCache {
    protected _rangeEnd = 0
    protected _rangeStart = 0
    protected _signalSamplingRates: number[] = []
    protected _signalUpdatedRanges: SignalRange[] = []

    constructor (port: MessagePort) {
        super('sig')
        this.setupWorker(port)
        port.addEventListener('message', this.handleWorkerMessage.bind(this))
    }

    get inputRangeEnd () {
        const commission = this._commissionWorker('get-input-range-end')
        return commission.promise as Promise<number>
    }
    get inputRangeStart () {
        const commission = this._commissionWorker('get-input-range-start')
        return commission.promise as Promise<number>
    }
    get inputSignals () {
        const commission = this._commissionWorker('get-input-signals')
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
        throw new Error("Method not implemented.")
    }

    handleWorkerMessage (message: MessageEvent) {
        const data = message.data
        // Only react to messages addressed to us.
        if (data.caller !== this.id) {
            return
        }
        const commission = this._getCommissionForMessage(message)
        if (commission) {
            if (data.action === 'get-input-range-end') {
                commission.resolve(data.value)
            } else if (data.action === 'get-input-range-start') {
                commission.resolve(data.value)
            } else if (data.action === 'get-input-signals') {
                commission.resolve(data.value)
            }
        }
    }

    async insertSignals(signalPart: SignalCachePart) {
        throw new Error("Method not implemented.")
    }

    invalidateOutputSignals() {
        throw new Error("Method not implemented.")
    }

    releaseBuffers() {
        throw new Error("Method not implemented.")
    }
}