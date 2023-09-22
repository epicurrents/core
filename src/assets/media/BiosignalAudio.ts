/**
 * Biosignal audio class.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type AudioRecording } from 'TYPES/media'
import Log from 'scoped-ts-log'

const SCOPE = 'BiosignalAudio'

/**
 * The maximum absolute value of the raw data (expressed in uV).
 * When creating the audio buffer source, all signal data is
 * normalized against this value, meaning that raw data exceeding
 * it is clipped.
 * @remarks
 * The value of 50,000 was chosen for convednience because Synergy
 * uses that value by default when normalizing its WAV exports.
 */
const SAMPLE_MAX_VALUE = 50_000

export default class BiosignalAudio implements AudioRecording {
    protected _audio: AudioContext | null = null
    protected _buffer: AudioBuffer | null = null
    protected _compressor: DynamicsCompressorNode | null = null
    /** This is a backup of the channel audio data. */
    protected _data: Float32Array[] = []
    protected _duration = 0
    protected _hasStarted = false
    protected _playing = false
    protected _playEndedCallbacks: (() => unknown)[] = []
    protected _playStartedCallbacks: (() => unknown)[] = []
    protected _position = 0
    protected _sampleCount = 0
    protected _sampleMaxAbsValue = 1
    protected _samplingRate = 0
    /** This is the non-normalized signal data measured in physical units. */
    protected _signals: Float32Array[] = []
    protected _source: AudioBufferSourceNode | null = null
    protected _startTime = 0
    protected _volume: GainNode | null = null

    constructor (data?: ArrayBuffer) {
        if (data) {
            this.loadFile(data)
        }
    }

    get buffer () {
        if (!this._audio || !this._source || this._source.buffer) {
            return null
        }
        return this._source.buffer
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

    get isPlaying () {
        return this._playing
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
        this._sampleMaxAbsValue = value
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

    async loadBuffer () {
        if (!this._data) {
            return
        }
        this._audio = new AudioContext()
        const nSamples = Math.floor(this._audio.sampleRate*this._duration)
        this._sampleCount = nSamples
        const buffer = this._audio.createBuffer(this._data.length, nSamples, this._audio.sampleRate)
        for (let i=0; i<buffer.numberOfChannels; i++) {
            const data = buffer.getChannelData(i)
            data.set(this._data[i].slice(0))
        }
        this._source = this._audio.createBufferSource()
        this._source.buffer = buffer
    }

    async loadFile (fileBuffer: ArrayBuffer) {
        this._audio = new AudioContext()
        this._source = this._audio.createBufferSource()
        this._source.buffer = await this._audio.decodeAudioData(fileBuffer.slice(0))
        this._data = []
        for (let i=0; i<this._source.buffer.numberOfChannels; i++) {
            const data = this._source.buffer.getChannelData(i)
            this._signals.push(data)
            // Save copy channel data for replays.
            this._data.push(data.slice(0))
            if (!this._samplingRate) {
                this._samplingRate = this._source.buffer.sampleRate
            }
        }
        this._duration = this._source.buffer.duration
        this._sampleCount = Math.floor(this._audio.sampleRate*this._duration)
    }

    pause () {
        if (!this._audio || !this._source) {
            return
        }
        if (this._audio.state === 'running') {
            this._audio.suspend()
        }
        this._playing = false
    }

    async play (position = 0, gain = 1.0) {
        if (!this._audio) {
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
        this._playing = true
        for (const cb of this._playStartedCallbacks) {
            cb()
        }
        this._hasStarted = true
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

    setGain (gain: number) {
        if (!this._volume) {
            return
        }
        if (gain < 0) {
            gain = 0
        }
        // Plain 1/sensitivity results in too loud volume, we'll tone it down a bit more.
        this._volume.gain.value = gain*SAMPLE_MAX_VALUE/10
    }

    setSignals (length: number, samplingRate: number, ...data: Float32Array[]) {
        this._audio = new AudioContext()
        const nSamples = Math.floor(samplingRate*length)
        this._sampleCount = nSamples
        const buffer = this._audio.createBuffer(data.length, nSamples, samplingRate)
        this._duration = length
        for (let i=0; i<buffer.numberOfChannels; i++) {
            const channel = buffer.getChannelData(i)
            // The source sampling rate may be higher than our audio device sampling rate,
            // in which case we must downsample.
            const chanData = new Float32Array(nSamples)
            // This will handle simple downsampling if source has higher sampling rate
            // than the native audio device. Supersampling is not suppert yet.
            const dsFactor = data[i].length/nSamples
            if (samplingRate < this._audio.sampleRate) {
                Log.warn(`Source sampling rate (${samplingRate} Hz) is lower than audio device sampling rate ` +
                         `(${this._audio.sampleRate} Hz).`, SCOPE)
            }
            for (let j=0; j<nSamples; j++) {
                chanData.set([data[i][Math.floor(j*dsFactor)]/SAMPLE_MAX_VALUE], j)
            }
            if (!this._samplingRate) {
                this._samplingRate = samplingRate
            }
            channel.set(chanData)
            this._signals.push(data[i])
            // Clone an independent array of the data that was used.
            const clonedData = chanData.slice(0)
            this._data.push(clonedData)
        }
        this._source = this._audio.createBufferSource()
        this._source.buffer = buffer
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
        this._playing = false
    }
}
