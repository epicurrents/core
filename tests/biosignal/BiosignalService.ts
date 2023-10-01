import { BiosignalServiceSAB } from "../../src"
import { BiosignalDataService, BiosignalResource, MemoryManager, SignalCacheResponse } from "../../src/types"
import { NUMERIC_ERROR_VALUE } from "../../src/util/constants"

export class BiosignalService extends BiosignalServiceSAB implements BiosignalDataService {
    /** Resolved or rejected based on the success of data loading. */
    protected _getSignals: Promise<SignalCacheResponse> | null = null
    protected _signalBufferStart = NUMERIC_ERROR_VALUE
    /** Set to true when the worker is done setting up. */
    protected _workerReady = false

    get isReady () {
        return super.isReady && this._workerReady
    }
    get signalBufferStart () {
        return this._signalBufferStart
    }
    set signalBufferStart (value: number) {
        this._signalBufferStart = value
    }
    get worker () {
        return this._worker
    }

    constructor (recording: BiosignalResource, worker: Worker, manager: MemoryManager) {
        super (recording, worker, manager)
        this._manager = manager
        this._worker?.addEventListener('message', this.handleMessage.bind(this))
    }
}
