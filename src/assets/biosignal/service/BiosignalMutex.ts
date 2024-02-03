/**
 * Biosignal mutex.
 * @package    @epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type SignalCacheMutex, type SignalCachePart } from '#types/service'
import {
    IOMutex,
    type ArrayBufferArray,
    type MutexExportProperties,
    type MutexMetaField,
} from 'asymmetric-io-mutex'
import { concatFloat32Arrays } from '#util/signal'
import { NUMERIC_ERROR_VALUE } from '#util/constants'
import { Log } from 'scoped-ts-log'

const SCOPE = 'BiosignalMutex'

/**
 * TODO: This class is missing type definitions!
 */

export default class BiosignalMutex extends IOMutex implements SignalCacheMutex {

    // Mutex meta fields
    /** Length of the signal range allocation value. */
    static readonly RANGE_ALLOCATED_LENGTH = 1
    /** Name of the signal range allocation field. */
    static readonly RANGE_ALLOCATED_NAME = 'allocated'
    /** Array index of the signal range allocation value. */
    static readonly RANGE_ALLOCATED_POS = 0
    /** Length of the signal range end value. */
    static readonly RANGE_END_LENGTH = 1
    /** Name of the signal range end field. */
    static readonly RANGE_END_NAME = 'end'
    /** Array index of the signal range end value. */
    static readonly RANGE_END_POS = 2
    /** Length of the signal range start value. */
    static readonly RANGE_START_LENGTH = 1
    /** Name of the signal range start field. */
    static readonly RANGE_START_NAME = 'start'
    /** Array index of the signal range start value. */
    static readonly RANGE_START_POS = 1

    // Signal meta fields
    /** Name of the signal data field. */
    static readonly SIGNAL_DATA_NAME = 'data'
    /** Array index of the (first) signal data value. */
    static readonly SIGNAL_DATA_POS = 3
    /** Length of the signal sampling rate value. */
    static readonly SIGNAL_SAMPLING_RATE_LENGTH = 1
    /** Name of the signal sampling rate field. */
    static readonly SIGNAL_SAMPLING_RATE_NAME = 'sampling_rate'
    /** Array index of the signal sampling rate value. */
    static readonly SIGNAL_SAMPLING_RATE_POS = 0
    /** Length of the signal updated range end value. */
    static readonly SIGNAL_UPDATED_END_LENGTH = 1
    /** Name of the signal updated range end field. */
    static readonly SIGNAL_UPDATED_END_NAME = 'updated_end'
    /** Array index of the signal updated range end value. */
    static readonly SIGNAL_UPDATED_END_POS = 2
    /** Length of the signal updated range start value. */
    static readonly SIGNAL_UPDATED_START_LENGTH = 1
    /** Name of the signal updated range start field. */
    static readonly SIGNAL_UPDATED_START_NAME = 'updated_start'
    /** Array index of the signal updated range start value. */
    static readonly SIGNAL_UPDATED_START_POS = 1

    static convertPropertiesForCoupling (props: MutexExportProperties) {
        // Convert typed array constructors into strings.
        if (props.data) {
            for (const array of props.data.arrays) {
                if (typeof array.constructor !== 'string') {
                    // @ts-ignore We need to resort to this hack to transfer the properties between threads.
                    array.constructor = array.constructor.name
                }
            }
            for (const field of props.data.fields) {
                if (typeof field.constructor !== 'string') {
                    // @ts-ignore
                    field.constructor = field.constructor.name
                }
            }
        }
        for (const field of props.meta.fields) {
            if (typeof field.constructor !== 'string') {
                // @ts-ignore
                field.constructor = field.constructor.name
            }
        }
        return props
    }

    protected _masterBufferLock = null as Int32Array | null

    /**
     * Instantiate a shared memory mutex for biosignal data. All parameters are immutable after initialiation.
     * An output mutex should usually be initialized without any optional parameters, and input mutexes
     * should be initialized with the output mutex as a reference. Optionally, separate buffers for each
     * shared data type may be provided; these will be ignored, if a reference mutex is also passed.
     * @param coupledMutex - Mutex to use as reference for shared buffers (optional).
     * @param coupledProps - Coupling properties from a referenec mutex (optional, ignored if coupledMutex is provided).
     * @param inputBuffer - SharedArrayBuffer to use as input buffer (optional, ignored if coupledMutex or coupledProps are provided).
     * @param inputStart - Starting index (32-bit) of the input mutex data within its buffer (optional, default 0).
     */
    constructor (
        coupledMutex?: IOMutex,
        coupledProps?: MutexExportProperties,
        inputBuffer?: SharedArrayBuffer,
        inputStart?: number
    ) {
        // Data fields to accompany each data array.
        const dataFields = [{
            constructor: Float32Array,
            name: BiosignalMutex.SIGNAL_SAMPLING_RATE_NAME,
            length: BiosignalMutex.SIGNAL_SAMPLING_RATE_LENGTH,
            position: BiosignalMutex.SIGNAL_SAMPLING_RATE_POS,
        },{
            constructor: Float32Array,
            name: BiosignalMutex.SIGNAL_UPDATED_START_NAME,
            length: BiosignalMutex.SIGNAL_UPDATED_START_LENGTH,
            position: BiosignalMutex.SIGNAL_UPDATED_START_POS,
        },{
            constructor: Float32Array,
            name: BiosignalMutex.SIGNAL_UPDATED_END_NAME,
            length: BiosignalMutex.SIGNAL_UPDATED_END_LENGTH,
            position: BiosignalMutex.SIGNAL_UPDATED_END_POS,
        }]
        // Common meta fields for the recording.
        const metaFields = [{
            constructor: Int32Array,
            name: BiosignalMutex.RANGE_ALLOCATED_NAME,
            length: BiosignalMutex.RANGE_ALLOCATED_LENGTH,
            position: BiosignalMutex.RANGE_ALLOCATED_POS,
        },
        {
            constructor: Int32Array,
            name: BiosignalMutex.RANGE_END_NAME,
            length: BiosignalMutex.RANGE_END_LENGTH,
            position: BiosignalMutex.RANGE_END_POS,
        },
        {
            constructor: Int32Array,
            name: BiosignalMutex.RANGE_START_NAME,
            length: BiosignalMutex.RANGE_START_LENGTH,
            position: BiosignalMutex.RANGE_START_POS,
        }]
        if (coupledProps) {
            const nameToConstr = (name: string) => {
                if (typeof name !== 'string') {
                    return name
                }
                switch (name) {
                    case 'Float32Array': {
                        return Float32Array
                    }
                    default: {
                        return Int32Array
                    }
                }
            }
            // Reverse the constructor to string conversion in propertiesForCoupling.
            if (coupledProps.data) {
                for (const array of coupledProps.data.arrays) {
                    // @ts-ignore
                    array.constructor = nameToConstr(array.constructor)
                }
                for (const field of coupledProps.data.fields) {
                    // @ts-ignore
                    field.constructor = nameToConstr(field.constructor)
                }
            }
            for (const field of coupledProps.meta.fields) {
                // @ts-ignore
                field.constructor = nameToConstr(field.constructor)
            }
        }
        super(
            // Store allocated signal length and buffered signal start and end.
            metaFields,
            dataFields,
            coupledMutex ? coupledMutex.propertiesForCoupling
            : coupledProps ? coupledProps
            : inputBuffer ? {
                buffer: inputBuffer,
                bufferStart: inputStart || 0,
                // Default signal mutex metadata fields.
                data: {
                    arrays: [],
                    buffer: null,
                    fields: dataFields,
                    length: 3,
                    position: IOMutex.UNASSIGNED_VALUE,
                },
                meta: {
                    buffer: null,
                    fields: metaFields,
                    length: 3,
                    position: IOMutex.UNASSIGNED_VALUE,
                    view: null,
                }
            } : undefined
        )
        // We can have either a reference Mutex or individual buffers; reference Mutex take precedence.
        if (coupledMutex && inputBuffer) {
            Log.warn(`Received both a reference mutex and separate buffers in constructor; ` +
                     `separate buffers will be ignored.`, SCOPE)
        }
    }

    // Some getters as shorthands for functions that require value checks etc.

    /**
     * Signal range allocated to the input, or null if not set.
     */
    protected get _inputSignalRangeAllocated (): Promise<number|null> {
        return this._getMetaFieldValue(
            IOMutex.MUTEX_SCOPE.INPUT,
            BiosignalMutex.RANGE_ALLOCATED_NAME
        ).then((rangeAllocated) => {
            const allocatedValue = rangeAllocated && rangeAllocated.length ? rangeAllocated[0] : null
            return allocatedValue
        })
    }

    /**
     * Signal range end of the input, or null if not set.
     */
    protected get _inputSignalRangeEnd (): Promise<number|null> {
        return this._getMetaFieldValue(
            IOMutex.MUTEX_SCOPE.INPUT,
            BiosignalMutex.RANGE_END_NAME
        ).then((rangeEnd) => {
            const endValue = rangeEnd && rangeEnd.length ? rangeEnd[0] : null
            return endValue
        })
    }

    /**
     * Signal range start of the input, or null if not set.
     */
    protected get _inputSignalRangeStart (): Promise<number|null> {
        return this._getMetaFieldValue(
            IOMutex.MUTEX_SCOPE.INPUT,
            BiosignalMutex.RANGE_START_NAME
        ).then((rangeStart) => {
            const startValue = rangeStart && rangeStart.length ? rangeStart[0] : null
            return startValue
        })
    }

    /**
     * Signal range allocated to the output, or null if not set.
     */
    protected get _outputSignalRangeAllocated (): Promise<number|null> {
        return this._getMetaFieldValue(
            IOMutex.MUTEX_SCOPE.OUTPUT,
            BiosignalMutex.RANGE_ALLOCATED_NAME
        ).then((rangeAllocated) => {
            const allocatedValue = rangeAllocated && rangeAllocated.length ? rangeAllocated[0] : null
            return allocatedValue
        })
    }

    /**
     * Signal range end of the output, or null if not set.
     */
    protected get _outputSignalRangeEnd (): Promise<number|null> {
        return this._getMetaFieldValue(
            IOMutex.MUTEX_SCOPE.OUTPUT,
            BiosignalMutex.RANGE_END_NAME
        ).then((rangeEnd) => {
            const endValue = rangeEnd && rangeEnd.length ? rangeEnd[0] : null
            return endValue
        })
    }

    /**
     * Signal range start of the output, or null if not set.
     */
    protected get _outputSignalRangeStart (): Promise<number|null> {
        return this._getMetaFieldValue(
            IOMutex.MUTEX_SCOPE.OUTPUT,
            BiosignalMutex.RANGE_START_NAME
        ).then((rangeStart) => {
            const startValue = rangeStart && rangeStart.length ? rangeStart[0] : null
            return startValue
        })
    }

    // Most of the public getters are just aliases for the protected output functions.

    get inputRangeAllocated (): Promise<number | null> {
        return this._getRangeAllocated(IOMutex.MUTEX_SCOPE.INPUT).then((result) => {
            return result ? (result.data as Float32Array)[0] : result
        })
    }

    get inputRangeEnd (): Promise<number | null> {
        return this._getRangeEnd(IOMutex.MUTEX_SCOPE.INPUT).then((result) => {
            return result ? (result.data as Float32Array)[0] : result
        })
    }

    get inputRangeStart (): Promise<number | null> {
        return this._getRangeStart(IOMutex.MUTEX_SCOPE.INPUT).then((result) => {
            return result ? (result.data as Float32Array)[0] : result
        })
    }

    get outputRangeAllocated (): Promise<number | null> {
        return this._getRangeAllocated(IOMutex.MUTEX_SCOPE.OUTPUT).then((result) => {
            return result ? (result.data as Float32Array)[0] : result
        })
    }

    get outputRangeEnd (): Promise<number | null> {
        return this._getRangeEnd(IOMutex.MUTEX_SCOPE.OUTPUT).then((result) => {
            return result ? (result.data as Float32Array)[0] : result
        })
    }

    get outputRangeStart (): Promise<number | null> {
        return this._getRangeStart(IOMutex.MUTEX_SCOPE.OUTPUT).then((result) => {
            return result ? (result.data as Float32Array)[0] : result
        })
    }

    get inputSignalProperties (): Promise<{ [field: string]: number }[] | null> {
        return this._getSignalProperties(IOMutex.MUTEX_SCOPE.INPUT).then((result) => {
            if (!result) {
                return result
            }
            const props = [] as { [field: string]: number }[]
            for (const prop of result) {
                if (!prop.data) {
                    continue
                }
                props.push({
                    [prop.name]: prop.data[0]
                })
            }
            return props
        })
    }

    get inputSignals (): Promise<Float32Array[]> {
        return this._getSignals(IOMutex.MUTEX_SCOPE.INPUT)
    }

    get inputSignalViews (): Promise<Float32Array[]| null> {
        return this._getSingalViews(IOMutex.MUTEX_SCOPE.INPUT)
    }

    get outputSignalArrays (): ArrayBufferArray[] {
        return this._outputData?.arrays || []
    }

    get outputSignalProperties (): Promise<{ [field: string]: number }[] | null> {
        return this._getSignalProperties(IOMutex.MUTEX_SCOPE.OUTPUT).then((result) => {
            if (!result) {
                return result
            }
            const props = [] as { [field: string]: number }[]
            for (const prop of result) {
                if (!prop.data) {
                    continue
                }
                props.push({
                    [prop.name]: prop.data[0] as number
                })
            }
            return props
        })
    }

    get outputSignals (): Promise<Float32Array[]> {
        return this._getSignals(IOMutex.MUTEX_SCOPE.OUTPUT)
    }

    get outputSignalSamplingRates (): Promise<number>[] {
        const rates = [] as Promise<number>[]
        for (let i=0; i<this.outputDataViews.length; i++) {
            rates.push(this._signalSamplingRate(i, IOMutex.MUTEX_SCOPE.OUTPUT))
        }
        return rates
    }

    get outputSignalUpdatedRanges (): Promise<{ start: number, end: number }>[] {
        const ranges = [] as Promise<{ start: number, end: number }>[]
        for (let i=0; i<this.outputDataViews.length; i++) {
            ranges.push(
                this._signalUpdatedRange(i, IOMutex.MUTEX_SCOPE.OUTPUT).then(async (range) => {
                    return {
                        start: range[0][0],
                        end: range[1][0],
                    }
                })
            )
        }
        return ranges
    }

    get outputSingalViews (): Promise<Float32Array[] | null> {
        return this._getSingalViews(IOMutex.MUTEX_SCOPE.OUTPUT)
    }

    get propertiesForCoupling (): MutexExportProperties {
        return BiosignalMutex.convertPropertiesForCoupling(super.propertiesForCoupling)
    }

    /////////////////////////////////////////////////////////////////////////
    //////                      INTERNAL METHODS                      ///////
    /////////////////////////////////////////////////////////////////////////

    /**
     * Get the amount of memory (in seconds of signal range) allocated to the signal data.
     * @param scope - Optional scope of the signals (INPUT or OUTPUT - default OUTPUT).
     */
    protected async _getRangeAllocated (scope = IOMutex.MUTEX_SCOPE.OUTPUT):
    Promise<MutexMetaField | null> {
        const range = await this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, async () => {
            const range = this._getMetaFieldProperties(scope, BiosignalMutex.RANGE_ALLOCATED_NAME)
            if (range) {
                range.data = await this._getMetaFieldValue(scope, BiosignalMutex.RANGE_ALLOCATED_NAME) || undefined
            }
            return range
        })
        return range
    }

    /**
     * Get a meta field object holding the buffered range end (in seconds) of the signals.
     * @param scope - Optional scope of the signals (INPUT or OUTPUT - default OUTPUT).
     */
    protected async _getRangeEnd (scope = IOMutex.MUTEX_SCOPE.OUTPUT):
    Promise<MutexMetaField | null> {
        const range = await this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, async () => {
            const range = this._getMetaFieldProperties(scope, BiosignalMutex.RANGE_END_NAME)
            if (range) {
                range.data = await this._getMetaFieldValue(scope, BiosignalMutex.RANGE_END_NAME) || undefined
            }
            return range
        })
        return range
    }

    /**
     * Get the buffered range start (in seconds) of the signals.
     * @param scope - Optional scope of the signals (INPUT or OUTPUT - default OUTPUT).
     */
    protected async _getRangeStart (scope = IOMutex.MUTEX_SCOPE.OUTPUT):
    Promise<MutexMetaField | null> {
        const range = await this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, async () => {
            const range = this._getMetaFieldProperties(scope, BiosignalMutex.RANGE_START_NAME)
            if (range) {
                range.data = await this._getMetaFieldValue(scope, BiosignalMutex.RANGE_START_NAME) || undefined
            }
            return range
        })
        return range
    }

    /**
     * Get the properties of the signal data arrays.
     * @param scope - Optional scope of the signals (INPUT or OUTPUT - default OUTPUT).
     */
    protected async _getSignalProperties (scope = IOMutex.MUTEX_SCOPE.OUTPUT):
    Promise<MutexMetaField[] | null> {
        let dataFields: typeof this._inputDataFields | null = null
        await this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, () => {
            dataFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                   ? this._inputDataFields
                                   : this._outputData?.fields || []
        })
        return dataFields
    }

    /**
     * Get up-to-date signal data.
     * @param scope - Optional scope of the signals (INPUT or OUTPUT - default OUTPUT).
     */
    protected _getSignals = async (scope = IOMutex.MUTEX_SCOPE.OUTPUT) => {
        const sigs = [] as Float32Array[]
        await this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, async () => {
            const dataViews = scope === IOMutex.MUTEX_SCOPE.INPUT
                              ? this._inputDataViews
                              : (this._outputData?.arrays || []).map(a => a.view)
            for (let i=0; i<dataViews.length; i++) {
                // Get the updated signal data start
                const updatedStartPos = (await this._getDataFieldValue(
                                            scope, i, BiosignalMutex.SIGNAL_UPDATED_START_NAME
                                        ) || [NUMERIC_ERROR_VALUE])[0]
                if (updatedStartPos === NUMERIC_ERROR_VALUE) {
                    Log.warn(`Could not verify input signals; updated range start was not found.`, SCOPE)
                }
                // Get the updated signal data end
                const updatedEndPos = (await this._getDataFieldValue(
                                          scope, i, BiosignalMutex.SIGNAL_UPDATED_END_NAME
                                      ) || [NUMERIC_ERROR_VALUE])[0]
                if (updatedEndPos === NUMERIC_ERROR_VALUE) {
                    Log.warn(`Could not verify input signals; updated range end was not found.`, SCOPE)
                }
                sigs.push((dataViews[i] as Float32Array).subarray(
                    updatedStartPos + this._outputDataFieldsLen,
                    updatedEndPos + this._outputDataFieldsLen,
                ))
            }
        })
        return sigs
    }

    /**
     * Get the entire data arrays holding both signal properties and data.
     * @param scope - Optional scope of the signals (INPUT or OUTPUT - default OUTPUT).
     */
    protected async _getSingalViews (scope = IOMutex.MUTEX_SCOPE.OUTPUT) {
        let dataViews: Float32Array[] | null = null
        await this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, () => {
            dataViews = scope === IOMutex.MUTEX_SCOPE.INPUT
                                  ? this._inputDataViews as Float32Array[]
                                  : (this._outputData?.arrays || []).map(a => a.view as Float32Array)
        })
        return dataViews
    }

    /**
     * Check if tha master data buffer is locked.
     * @returns true/false.
     */
    protected _isMasterBufferLocked = () => {
        if (!this._masterBufferLock) {
            return true
        }
        const bufferState = this._masterBufferLock[0]
        return (bufferState === 1)
    }

    /**
     * Get the sampling rate for a buffered signal.
     * @param index - Index of the signal in signalViews.
     * @param scope - Optional scope of the signals (INPUT or OUTPUT - default OUTPUT).
     * @returns Sampling rate or 0 on error.
     */
    protected _signalSamplingRate = async (index: number, scope = IOMutex.MUTEX_SCOPE.OUTPUT): Promise<number> => {
        const samplingRate = await this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, () => {
            const signalViews = scope === IOMutex.MUTEX_SCOPE.INPUT
                                          ? this._inputDataViews
                                          : (this._outputData?.arrays || []).map(a => a.view as Float32Array)
            if (index < 0 || index >= signalViews.length) {
                Log.error(`Cannot read signal sampling rate with an out of bound index ${index} ` +
                          `(${signalViews.length} signals buffered).`, SCOPE)
                return 0
            }
            return signalViews[index][BiosignalMutex.SIGNAL_SAMPLING_RATE_POS]
        })
        return samplingRate
    }

    /**
     * Get the range of updated values for a buffered signal.
     * @param index - Index of the signal in signalViews.
     * @param scope - Optional scope of the signals (INPUT or OUTPUT - default OUTPUT).
     * @returns Range as [start, end] or empty array on error.
     */
    protected _signalUpdatedRange = async (index: number, scope = IOMutex.MUTEX_SCOPE.OUTPUT): Promise<Float32Array[]> => {
        const range = [] as Float32Array[]
        await this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, () => {
            const signalViews = scope === IOMutex.MUTEX_SCOPE.INPUT
                                        ? this._inputDataViews as Float32Array[]
                                        : (this._outputData?.arrays || []).map(a => a.view as Float32Array)
            if (index < 0 || index >= signalViews.length) {
                Log.error(`Cannot read updated signal range with an out of bound index ${index} ` +
                          `(${signalViews.length} signals buffered).`, SCOPE)
                return
            }
            range.push(signalViews[index].subarray(
                BiosignalMutex.SIGNAL_UPDATED_START_POS,
                BiosignalMutex.SIGNAL_UPDATED_START_POS + BiosignalMutex.SIGNAL_UPDATED_START_LENGTH
            ))
            range.push(signalViews[index].subarray(
                BiosignalMutex.SIGNAL_UPDATED_END_POS,
                BiosignalMutex.SIGNAL_UPDATED_END_POS + BiosignalMutex.SIGNAL_UPDATED_END_LENGTH
            ))
        })
        return range
    }

    /////////////////////////////////////////////////////////////////////////
    //////                       PUBLIC METHODS                       ///////
    /////////////////////////////////////////////////////////////////////////

    async asCachePart () {
        const cachePart = {
            start: 0,
            end: 0,
            signals: []
        } as SignalCachePart
        const signalData = await this._getSignals(IOMutex.MUTEX_SCOPE.OUTPUT)
        cachePart.start = (await this.outputRangeStart as number) || 0
        cachePart.end = (await this.outputRangeEnd as number) || 0
        for (let i=0; i<signalData.length; i++) {
            const updRange = await this._signalUpdatedRange(i, IOMutex.MUTEX_SCOPE.OUTPUT)
            cachePart.signals[i] = {
                data: signalData[i],
                samplingRate: await this._signalSamplingRate(i, IOMutex.MUTEX_SCOPE.OUTPUT),
                start: updRange[0][0],
                end: updRange[1][0],
            }
        }
        return cachePart
    }

    async clearSignals () {
        await this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE, () => {
            for (
                const sig of IOMutex.OPERATION_MODE.WRITE === IOMutex.OPERATION_MODE.READ
                    ? this._inputDataViews as Float32Array[]
                    : (this._outputData?.arrays || []).map(a => a.view as Float32Array)
            ) {
                sig?.fill(0.0)
            }
        })
    }

    async initSignalBuffers (
        cacheProps: SignalCachePart,
        dataLength: number,
        buffer: SharedArrayBuffer,
        bufferStart = 0
    ) {
        // Check that signals haven't already been initialized.
        if (this._outputData?.buffer) {
            Log.error(`Attempted to initialize signal buffers that had already been initialized!`, SCOPE)
            return
        }
        // Save master buffer lock position.
        Log.debug(`Setting master buffer lock position for BiosignalMutex.`, SCOPE)
        this._masterBufferLock = new Int32Array(buffer).subarray(0, 1)
        if (this._isMasterBufferLocked()) {
            Log.error(`Cannot initialize mutex buffers when the master buffer is locked.`, SCOPE)
            return
        }
        // Initialize the buffer.
        this.initialize(buffer, bufferStart)
        Log.debug(`Initializing signal buffers for ${cacheProps.signals.length} signals.`, SCOPE)
        this.setDataArrays(cacheProps.signals.map(s => { return { constructor: Float32Array, length: s.samplingRate*dataLength }}))
        await this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE, () => {
            // Set meta values (we can use the same write lock to reduce operations).
            this._setOutputMetaFieldValue(BiosignalMutex.RANGE_ALLOCATED_NAME, dataLength)
            // Set initial range start to zero and end to max buffer seconds.
            this._setOutputMetaFieldValue(BiosignalMutex.RANGE_START_NAME, 0)
            this._setOutputMetaFieldValue(BiosignalMutex.RANGE_END_NAME, dataLength)
            /*
            // Determine the amount of memory available for cached signals
            let totalBytesForSecond = 0
            for (const sig of cacheProps.signals) {
                totalBytesForSecond += sig.samplingRate*Float32Array.BYTES_PER_ELEMENT
            }
            if (totalBytesForSecond<=0) {
                Log.error(`Total bytes per second of signal data is invalid (${totalBytesForSecond}).`, SCOPE)
                return
            }
            // Record length may not be full seconds, so also save the maximum buffer length as float
            const maxBufferSeconds = Math.floor(SETTINGS.app.maxLoadCacheSize/totalBytesForSecond)
            Log.debug(`Maximum buffered seconds for the recording is ${maxBufferSeconds}.`, SCOPE)
            if (dataLength > maxBufferSeconds) {
                Log.error(`Data length ${dataLength} exceeded maximum buffer length ${maxBufferSeconds}.`, SCOPE)
                return
            }
            */
            // Initialize buffers for each signal in the recording
            for (let i=0; i<cacheProps.signals.length; i++) {
                const sig = cacheProps.signals[i]
                // TODO: This will throw "RangeError: Array buffer allocation failed" if
                //       the browser runs out of memory. Catch and handle this somehow?
                // Construct buffer views, setting sampling rates and up-to-date data ranges.
                this.setDataFieldValue(BiosignalMutex.SIGNAL_SAMPLING_RATE_NAME, sig.samplingRate, [i])
                this.setDataFieldValue(BiosignalMutex.SIGNAL_UPDATED_START_NAME , BiosignalMutex.EMPTY_FIELD, [i])
                this.setDataFieldValue(BiosignalMutex.SIGNAL_UPDATED_END_NAME, BiosignalMutex.EMPTY_FIELD, [i])
            }
        })
        Log.debug(`Mutex initialization complete.`, SCOPE)
    }

    async insertSignals (signalPart: SignalCachePart) {
        if (signalPart.signals.length !== this._outputData?.arrays.length) {
            // Number of signals don't match.
            Log.error(`Number of inserted signals doesn't match number of buffered signals ` +
                      `(${signalPart.signals.length} vs ${this._outputData?.arrays.length})`, SCOPE)
            return
        }
        const rangeStartView = await this._getMetaFieldValue(
                                        IOMutex.MUTEX_SCOPE.OUTPUT,
                                        BiosignalMutex.RANGE_START_NAME
                                     )
        const rangeEndView = await this._getMetaFieldValue(
                                        IOMutex.MUTEX_SCOPE.OUTPUT,
                                        BiosignalMutex.RANGE_END_NAME
                                    )
        if (rangeStartView === null || rangeEndView === null || !rangeStartView.length || !rangeEndView.length) {
            // Meta fields have not been initialized correctly.
            Log.error(`Output meta fields have not been inizialied correctly.`, SCOPE)
            return
        }
        const rangeStart = rangeStartView[0]
        const rangeEnd = rangeEndView[0]
        if (signalPart.start < rangeStart || signalPart.end > rangeEnd) {
            // The offered part is out of signal buffer bounds.
            Log.error(`Tried to insert signals with range ${signalPart.start} - ${signalPart.end} ` +
                      `when buffer range is ${rangeStart} - ${rangeEnd}!`, SCOPE)
            return
        }
        await this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE, async () => {
            for (let i=0; i<(this._outputData?.arrays || []).length; i++) {
                // Check that we have the required view.
                const dataView = this._outputData?.arrays[i]?.view
                if (!dataView) {
                    Log.error(`Output data view for index ${i} is falsy (${dataView}).`, SCOPE)
                    continue
                }
                const dataPartLen = dataView.length - this._outputDataFieldsLen
                // Check that sampling rates match (direct access to avoid array read lock).
                const samplingRate = dataView[BiosignalMutex.SIGNAL_SAMPLING_RATE_POS]
                if (!IOMutex.floatsAreEqual(samplingRate, signalPart.signals[i].samplingRate)) {
                    Log.error(`Sampling rates of existing and new signals at index ${i} don't match ` +
                              `(${samplingRate} vs ${signalPart.signals[i].samplingRate}).`, SCOPE)
                    // Fill the buffer with zeroes so the error won't go unnoticed.
                    this.setData(i, new Float32Array(dataPartLen))
                    continue
                }
                // Check that new signals can fit the buffer.
                const startPos = Math.round((signalPart.start - rangeStart)*samplingRate)
                const endPos = Math.round((signalPart.end - rangeStart)*samplingRate)
                // New signals before or at the end of current buffer.
                if (endPos <= dataPartLen) {
                    this.setData(i, signalPart.signals[i].data, startPos)
                } else {
                    // Need to truncate the data to fit it into the remaining buffer.
                    Log.warn(`New signal data exceeded available buffer by ${endPos - dataPartLen} values `+
                             `and had to be truncated.`, SCOPE)
                    this.setData(i, signalPart.signals[i].data.subarray(0, endPos - dataPartLen), startPos)
                }
                // Update the range of up-to-date signal values if needed.
                // The range values are stored as Floats, so round them to avoid precision errors.
                const updatedRangeStart = dataView[BiosignalMutex.SIGNAL_UPDATED_START_POS]
                const updatedRangeEnd = dataView[BiosignalMutex.SIGNAL_UPDATED_END_POS]
                if (updatedRangeStart === BiosignalMutex.EMPTY_FIELD || updatedRangeStart > startPos) {
                    this.setDataFieldValue(BiosignalMutex.SIGNAL_UPDATED_START_NAME, startPos, [i])
                }
                if (updatedRangeEnd === BiosignalMutex.EMPTY_FIELD || updatedRangeEnd < endPos) {
                    this.setDataFieldValue(BiosignalMutex.SIGNAL_UPDATED_END_NAME, endPos, [i])
                }
            }
        })
    }

    async invalidateOutputSignals (channels?: number[]) {
        await this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, BiosignalMutex.OPERATION_MODE.WRITE, () => {
            for (let i=0; i<(this._outputData?.fields || []).length; i++) {
                if (channels && channels.indexOf(i) === -1) {
                    continue
                }
                this._setOutputDataFieldValue(i, BiosignalMutex.SIGNAL_UPDATED_START_NAME, 0)
                this._setOutputDataFieldValue(i, BiosignalMutex.SIGNAL_UPDATED_END_NAME, 0)
            }
        })
    }

    async readSignals () {
        const sigs = [] as Float32Array[]
        await this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, BiosignalMutex.OPERATION_MODE.READ, () => {
            if (this._outputData) {
                for (const dataArr of this._outputData.arrays) {
                    if (dataArr.view) {
                        sigs.push((dataArr.view as Float32Array).subarray(this._outputDataFieldsLen))
                    }
                }
            }
        })
        return sigs
    }

    async setSignalRange (rangeStart: number, rangeEnd: number) {
        // Check that signal buffer has been initialized.
        if (this._outputMeta.view === null) {
            Log.error(`Cannot set signal range in an uninitialized mutex.`, SCOPE)
            return
        }
        const allocatedRange = this._outputMeta.view[BiosignalMutex.RANGE_ALLOCATED_POS]
        // Truncate range if it is too long for allocated memory.
        if (rangeEnd - rangeStart > allocatedRange) {
            rangeEnd = rangeStart + allocatedRange
            Log.warn(`Cannot set signal range that exceeded allocated range; the excess range was truncated.`, SCOPE)
        }
        const oldStart = this._outputMeta.view[BiosignalMutex.RANGE_START_POS]
        const oldEnd = this._outputMeta.view[BiosignalMutex.RANGE_END_POS]
        if (oldStart !== rangeStart || oldEnd !== rangeEnd) {
            await this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, BiosignalMutex.OPERATION_MODE.WRITE, async () => {
                if (!this._outputData?.arrays) {
                    Log.error(`Cannot set signal data in an uninitialized mutex.`, SCOPE)
                    return
                }
                for (let i=0; i<this._outputData.arrays.length; i++) {
                    const dataView = this._outputData.arrays[i].view
                    if (!dataView) {
                        continue
                    }
                    //const updatedStart = this._outputData.arrays[i].view[BiosignalMutex.SIGNAL_UPDATED_START_POS]
                    const updatedEnd = dataView[BiosignalMutex.SIGNAL_UPDATED_END_POS]
                    const samplingRate = dataView[BiosignalMutex.SIGNAL_SAMPLING_RATE_POS]
                    // Retrieve a reference to signal data so we can adjust the buffered data to the new range.
                    const signalData = dataView.subarray(
                        this._outputDataFieldsLen,
                        this._outputDataFieldsLen + Math.round(await this._outputSignalRangeAllocated || 0 )
                    )
                    // Check if we can discard all old signals.
                    if (oldStart > rangeEnd || oldEnd < rangeStart) {
                        this._setOutputDataFieldValue(
                            i, BiosignalMutex.SIGNAL_UPDATED_START_NAME, BiosignalMutex.EMPTY_FIELD
                        )
                        this._setOutputDataFieldValue(
                            i, BiosignalMutex.SIGNAL_UPDATED_END_NAME, BiosignalMutex.EMPTY_FIELD
                        )
                        signalData.fill(0)
                    } else if (rangeStart > oldStart) {
                        // Shift signals down.
                        const shiftBy = Math.round((rangeStart - oldStart)*samplingRate)
                        const validData = Math.max(
                            updatedEnd - shiftBy,
                            0 // Can't have a negative array index.
                        )
                        signalData.set(signalData.subarray(shiftBy, validData), 0)
                        // Fill the rest with zeroes.
                        signalData.set((new Float32Array(shiftBy)).fill(0), validData)
                        // Set the up-to-date signal range.
                        this._setOutputDataFieldValue(i, BiosignalMutex.SIGNAL_UPDATED_START_NAME, 0)
                        this._setOutputDataFieldValue(i, BiosignalMutex.SIGNAL_UPDATED_END_NAME, validData)
                    } else if (rangeEnd < oldEnd) {
                        // Shift signals up.
                        const shiftBy = Math.round((oldEnd - rangeEnd)*samplingRate)
                        const validData = Math.min(
                            updatedEnd + shiftBy,
                            signalData.length - shiftBy // Truncate overflowing data.
                        )
                        signalData.set(signalData.subarray(0, validData), shiftBy)
                        // Fill the start with zeroes.
                        signalData.set((new Float32Array(shiftBy)).fill(0), 0)
                        // Set the up-to-date signal range.
                        this._setOutputDataFieldValue(i, BiosignalMutex.SIGNAL_UPDATED_START_NAME, shiftBy)
                        this._setOutputDataFieldValue(i, BiosignalMutex.SIGNAL_UPDATED_END_NAME, validData)
                    } else {
                        // Signals have not been set up yet
                        this._setOutputDataFieldValue(
                            i, BiosignalMutex.SIGNAL_UPDATED_START_NAME, BiosignalMutex.EMPTY_FIELD
                        )
                        this._setOutputDataFieldValue(
                            i, BiosignalMutex.SIGNAL_UPDATED_END_NAME, BiosignalMutex.EMPTY_FIELD
                        )
                        signalData.fill(0)
                    }
                }
                // The meta view will not be unset after it has been initialized, so this is safe.
                this._setOutputMetaFieldValue(BiosignalMutex.RANGE_START_NAME, rangeStart)
                this._setOutputMetaFieldValue(BiosignalMutex.RANGE_END_NAME, rangeEnd)
            })
        }
    }

    /**
     * Replace the buffered signals with new signal arrays. Both the number of signals and
     * the length of individual signal arrays must match those of the existing signals.
     * @param signals - New signals as Float32Arrays.
     * @returns Success of the operation as true/false.
     */
    async writeSignals (signals: Float32Array[]) {
        // Check that signal counts and lengths match.
        if (signals.length !== this._outputData?.arrays.length) {
            Log.error(`Cannot output mismatched number of signals (output ${signals.length} signals to ` +
                      `${this._outputData?.arrays.length} buffers).`, SCOPE)
            return false
        }
        for (let i=0; i<signals.length; i++) {
            const dataView = this._outputData.arrays[i].view
            if (!dataView) {
                continue
            }
            if (signals[i].length !== dataView.length) {
                if (signals[i].length > dataView.length) {
                    // Truncate signals.
                    signals[i] = signals[i].subarray(0, dataView.length)
                } else {
                    signals[i] = concatFloat32Arrays(
                        signals[i],
                        // Fill the missing part with zeroes.
                        new Float32Array(dataView.length - signals[i].length).fill(0)
                    )
                }
                Log.warn(`Provided a signal of wrong length for index ${i} (${signals[i].length} values to ` +
                         `a buffer of ${dataView.length}).`, SCOPE)
            }
        }
        // Assign signals.
        await this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, BiosignalMutex.OPERATION_MODE.WRITE, () => {
            for (let i=0; i<signals.length; i++) {
                this._outputData?.arrays[i].view?.set(signals[i], this._outputDataFieldsLen)
            }
        })
        return true
    }
}
