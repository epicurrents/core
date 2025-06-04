/**
 * Epicurrents signal file reader. This class can be used inside a worker or the main thread.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    FileEncoder,
    SignalDataWriter,
    SignalInterruptionMap,
    TypedNumberArray,
} from '#types'
import { GenericBiosignalHeader } from '../biosignal'
import GenericSignalProcessor from './GenericSignalProcessor'
import { Log } from 'scoped-event-log'

const SCOPE = 'GenericSignalFileWriter'

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

    setBiosignalHeader (header: GenericBiosignalHeader): void {
        this._header = header
    }

    setFileTypeHeader (header: unknown): void {
        this._fileTypeHeader = header
    }

    setInterruptions (interruptions: SignalInterruptionMap) {
        this._interruptions = interruptions
    }

    setSourceArrayBuffer (buffer: ArrayBuffer): void {
        this._sourceBuffer = buffer
    }

    setSourceDigitalSignals (signals: TypedNumberArray[]): void {
        this._sourceDigitalSignals = signals
    }

    async writeRecordingToArrayBuffer (): Promise<ArrayBuffer | null> {
        Log.error('writeRecordingToArrayBuffer must be overridden in the child class.', SCOPE)
        return null
    }

    async writeRecordingToFile (_fileName: string): Promise<File | null> {
        Log.error('writeRecordingToFile must be overridden in the child class.', SCOPE)
        return null
    }

    writeRecordingToStream (): ReadableStream | null {
        Log.error('writeRecordingToStream must be overridden in the child class.', SCOPE)
        return null
    }
}
