/**
 * Epicurrents signal file reader. This class can be used inside a worker or the main thread.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    FileEncoder,
    SignalDataGapMap,
    SignalDataWriter,
    TypedNumberArray,
} from '#types'
import { GenericBiosignalHeader } from '../biosignal'
import GenericSignalProcessor from './GenericSignalProcessor'

//const SCOPE = 'GenericSignalFileWriter'

export default abstract class GenericSignalWriter extends GenericSignalProcessor implements SignalDataWriter {
    protected _encoder: FileEncoder
    protected _fileTypeHeader: unknown | null = null
    protected _header: GenericBiosignalHeader | null = null
    protected _sourceBuffer: ArrayBuffer | null = null
    protected _sourceDigitalSignals: TypedNumberArray[] | null = null
    /** Writing process start time (for debugging). */
    protected _startTime = 0

    constructor (encoder: FileEncoder) {
        super(encoder.dataEncoding)
        this._encoder = encoder
    }

    async destroy () {
        await this.releaseCache()
        this._fileTypeHeader = null
        this._header = null
        this._sourceBuffer = null
        this._sourceDigitalSignals = null
        this._startTime = 0
        super.destroy()
    }

    get encoder (): FileEncoder {
        return this._encoder
    }
    set encoder (value: FileEncoder) {
        this._encoder = value
    }

    setBiosignalHeader(header: GenericBiosignalHeader): void {
        this._header = header
    }

    setDataGaps (dataGaps: SignalDataGapMap) {
        this._dataGaps = dataGaps
    }

    setFileTypeHeader(header: unknown): void {
        this._fileTypeHeader = header
    }

    setSourceArrayBuffer(buffer: ArrayBuffer): void {
        this._sourceBuffer = buffer
    }

    setSourceDigitalSignals(signals: TypedNumberArray[]): void {
        this._sourceDigitalSignals = signals
    }
}
