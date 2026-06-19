/**
 * Biosignal audio class.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import { mintDirectBuffer } from './synthesizers/direct'
import { type AudioRecording } from '#types/media'
import { Log } from 'scoped-event-log'

const SCOPE = 'BiosignalAudio'

/**
 * The maximum absolute value of the raw data (expressed in uV).
 * When creating the audio buffer source, all signal data is normalized against this value, meaning that raw data
 * exceeding it is clipped.
 * @remarks
 * The value of 32,768 was chosen because it is the maximum value for a 16-bit signed integer used by the WAV file
 * format, for example.
 */
const SAMPLE_MAX_VALUE = 32_768

export default class BiosignalAudio extends GenericAsset implements AudioRecording {
    protected _audio: AudioContext | null = null
    protected _buffer: AudioBuffer | null = null
    protected _compressor: DynamicsCompressorNode | null = null
    protected _duration = 0
    protected _hasStarted = false
    protected _isPlaying = false
    /** Whether the loaded buffer loops perpetually on playback. */
    protected _loop = false
    protected _playEndedCallbacks: (() => unknown)[] = []
    protected _playStartedCallbacks: (() => unknown)[] = []
    protected _position = 0
    protected _previousGain = 1.0
    protected _sampleCount = 0
    protected _sampleMaxAbsValue: number
    protected _samplingRate = 0
    /** Non-normalized signal data measured in physical units, retained for inspection via the `signals` getter. */
    protected _signals: Float32Array[] = []
    protected _source: AudioBufferSourceNode | null = null
    protected _startTime = 0
    protected _volume: GainNode | null = null

    constructor (name: string, data?: ArrayBuffer, sampleMaxValue = SAMPLE_MAX_VALUE) {
        super(name, 'audio')
        this._sampleMaxAbsValue = sampleMaxValue || 0
        if (data) {
            this.loadFile(data)
        }
    }

    get buffer () {
        return this._buffer
    }

    get currentTime () {
        if (!this._hasStarted) {
            return 0
        }
        return (this._audio?.currentTime || 0) - this._startTime
    }

    get duration () {
        return this._duration
    }

    get hasStarted () {
        return this._hasStarted
    }
    protected set hasStarted (value: boolean) {
        // This is not meant for external use.
        this._setPropertyValue('hasStarted', value)
    }

    get isPlaying () {
        return this._isPlaying
    }
    protected set isPlaying (value: boolean) {
        // This is not meant for external use.
        this._setPropertyValue('isPlaying', value)
    }

    get playbackRate () {
        return this._source?.playbackRate || null
    }

    get sampleCount () {
        return this._sampleCount
    }

    get sampleMaxAbsValue () {
        return this._sampleMaxAbsValue
    }
    set sampleMaxAbsValue (value: number) {
        this._setPropertyValue('sampleMaxAbsValue', value)
    }

    get samplingRate () {
        return this._samplingRate
    }

    get signals () {
        return this._signals
    }

    addPlayEndedCallback (callback: (() => unknown)) {
        for (const cb of this._playEndedCallbacks) {
            if (cb === callback) {
                return
            }
        }
        this._playEndedCallbacks.push(callback)
    }

    addPlayStartedCallback (callback: (() => unknown)) {
        for (const cb of this._playStartedCallbacks) {
            if (cb === callback) {
                return
            }
        }
        this._playStartedCallbacks.push(callback)
    }

    destroy (dispatchEvent = true) {
        if (dispatchEvent) {
            this.dispatchEvent(BiosignalAudio.EVENTS.DESTROY, 'before')
        }
        this.stop()
        this._audio = null
        this._buffer = null
        this._compressor = null
        this._previousGain = 1.0
        this._signals.length = 0
        this._source = null
        this._volume = null
        super.destroy()
    }

    async loadBuffer () {
        if (!this._buffer) {
            return
        }
        if (!this._audio) {
            this._audio = new AudioContext()
        }
        this._source = this._audio.createBufferSource()
        this._source.buffer = this._buffer
        this._source.loop = this._loop
        this._previousGain = 1.0
    }

    async loadFile (fileBuffer: ArrayBuffer) {
        const context = new AudioContext()
        const decoded = await context.decodeAudioData(fileBuffer.slice(0))
        const prevSignals = this._signals
        this._signals = []
        for (let i=0; i<decoded.numberOfChannels; i++) {
            this._signals.push(decoded.getChannelData(i))
        }
        this.dispatchPropertyChangeEvent('signals', this.signals, prevSignals)
        this.setBuffer(decoded)
        // The playback context is created lazily on first play; the decode context is no longer needed.
        await context.close().catch(() => {})
    }

    pause () {
        if (!this._audio || !this._source) {
            return
        }
        if (this._audio.state === 'running') {
            this._audio.suspend()
        }
        this._setPropertyValue('isPlaying', false)
    }

    async play (position = 0, gain = this._previousGain) {
        if (!this._audio || !this._source) {
            await this.loadBuffer()
        }
        if (!this._source || !this._audio) {
            // For typescript.
            return
        }
        this._source.addEventListener('ended', () => {
            this.stop()
            for (const cb of this._playEndedCallbacks) {
                cb()
            }
        })
        if (!this._volume) {
            this._volume = new GainNode(this._audio)
            this._compressor = this._audio.createDynamicsCompressor()
            this._source.connect(this._volume)
            this._volume.connect(this._compressor)
            this._compressor.connect(this._audio.destination)
        }
        this.setGain(gain)
        if (!position && this._hasStarted && this._audio.state === 'suspended') {
            this._audio.resume()
        } else {
            if (this._hasStarted) {
                // Need to end current playback before we can wind to desired position.
                this.stop()
                this.play(position, gain)
                return
            }
            this._source.start(0, position)
            this._startTime = this._audio.currentTime - position
        }
        this._setPropertyValue('isPlaying', true)
        for (const cb of this._playStartedCallbacks) {
            cb()
        }
        this._setPropertyValue('hasStarted', true)
    }

    removePlayEndedCallback (callback: (() => unknown)) {
        for (let i=0; i<this._playEndedCallbacks.length; i++) {
            if (this._playEndedCallbacks[i] === callback) {
                this._playEndedCallbacks.splice(i, 1)
                return
            }
        }
    }

    removePlayStartedCallback (callback: (() => unknown)) {
        for (let i=0; i<this._playStartedCallbacks.length; i++) {
            if (this._playStartedCallbacks[i] === callback) {
                this._playStartedCallbacks.splice(i, 1)
                return
            }
        }
    }

    setBuffer (buffer: AudioBuffer, loop = false) {
        this._buffer = buffer
        this._loop = loop
        this._setPropertyValue('sampleCount', buffer.length)
        this._setPropertyValue('samplingRate', buffer.sampleRate)
        this._setPropertyValue('duration', buffer.duration)
        this._previousGain = 1.0
    }

    setGain (gain: number) {
        if (!this._volume) {
            return
        }
        if (gain < 0) {
            gain = 0
        }
        this._previousGain = gain
        // We need to tone the volume down a bit (TODO: Allow user-defined scaling).
        this._volume.gain.value = gain*SAMPLE_MAX_VALUE/10
    }

    setSignals (length: number, samplingRate: number, ...data: Float32Array[]) {
        this._signals = data.slice()
        this.setBuffer(mintDirectBuffer(data, samplingRate, {
            durationSeconds: length,
            sampleMaxAbsValue: this._sampleMaxAbsValue,
        }))
    }

    stop () {
        if (!this._source) {
            return
        }
        if (!this._hasStarted) {
            Log.warn(`Stop called without starting audio first.`, SCOPE)
            return
        }
        try {
            this._source.stop()
        } catch (e) {
            // This may happen in rare cases...
            Log.debug(`Stop called on audio buffer node that wasn't started yet.`, SCOPE)
        }
        this._hasStarted = false
        if (this._audio && this._source && this._volume && this._compressor) {
            this._compressor.disconnect(this._audio.destination)
            this._volume.disconnect(this._compressor)
            this._source.disconnect(this._volume)
            this._compressor = null
            this._volume = null
            this._source = null
            this._audio = null
        }
        this._position = 0
        this._startTime = 0
        this._setPropertyValue('isPlaying', false)
    }
}
