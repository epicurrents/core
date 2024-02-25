/**
 * Media types.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * General type for audio recordings.
 */
export interface AudioRecording {
    /** Buffer to use as audio data source. */
    buffer: ArrayBuffer | null
    /** Current audio playback time. */
    currentTime: number
    /** Total audio duration. */
    duration: number
    /** Has playback started. */
    hasStarted: boolean
    /** Is the audio currently playing. */
    isPlaying: boolean
    /** Current playback rate. */
    playbackRate: AudioParam | null
    /** Audio channel sample count. */
    sampleCount: number
    /** Maximum absolute value of the audio singals. */
    sampleMaxAbsValue: number
    /** Audio sampling rate. */
    samplingRate: number
    /** Signals expressed in physical untis. */
    signals: Float32Array[]
    /**
     * Add a function to the playback end callback list.
     * @param callback - The function to call when playback ends.
     */
    addPlayEndedCallback (callback: (() => unknown)): void
    /**
     * Add a function to the playback start callback list.
     * @param callback - The function to call when playback starts.
     */
    addPlayStartedCallback (callback: (() => unknown)): void
    /**
     * Load the buffer set to the `buffer` property.
     * @returns Promise that resolves when loading is complete.
     */
    loadBuffer (): Promise<void>
    /**
     * Load an audio recording from the given file buffer.
     * @param fileBuffer - ArrayBuffer from the opened file.
     * @returns Promise that fulfills when the loading is complete.
     */
    loadFile (fileBuffer: ArrayBuffer): Promise<void>
    /**
     * Pause audio playback.
     */
    pause (): void
    /**
     * Start audio playback either from the beginning or the given position.
     * @param position - Position (in seconds) to start from (defaults to 0 = beginning).
     * @param gain - Gan to set (default no change).
     * @returns Promise that fulfills when playback has started.
     */
    play (position?: number, gain?: number): Promise<void>
    /**
     * Remove a function from the play ended callback list.
     * @param callback - The callback function to remove.
     */
    removePlayEndedCallback (callback: (() => unknown)): void
    /**
     * Remove a function from the play started callback list.
     * @param callback - The callback function to remove.
     */
    removePlayStartedCallback (callback: (() => unknown)): void
    /**
     * Set the audio gain to account for display scale.
     * @param gain - Gain factor, which is the reciprocal of sensitivity (vertical uV/D value).
     * @example
     * sensitivity = 50 // uV/D
     * audio.setGain(1/sensitivity) // = 1/50 = 0.02
     */
    setGain (gain: number): void
    /**
     * Set the signal data to use for callback. Data should be expressed in physical units without normalization.
     * @param length - Length of the recording (in seconds).
     * @param samplingRate - Sampling rate of the signals.
     * @param data - Actual signal data (one continuous array per channel).
     */
    setSignals (length: number, samplingRate: number, ...data: Float32Array[]): void
    /**
     * Stop audio playback.
     */
    stop (): void
}
/**
 * WAV header properties.
 */
export type WavHeader = {
    blockAlignment: number
    bitsPerSample: number
    bytesPerSec: number
    dataOffset: number
    dataSize: number
    description: string
    fileSize: number
    nChannels: number
    nSamples: number
    samplingRate: number
    sectionSize: number
    typeFormat: number
}
/**
 * A channel containing WAV signal.
 */
export type WavSignalChannel = {
    /** Channel label. */
    label: string
    /** Unique, identifying name. */
    name: string
    /** Signal type. */
    type: string
    /** Signal sampling rate. */
    samplingRate: number
    /** A multiplier to signal amplitude. */
    amplification: number
    /** Channel-specific sensitivity. */
    sensitivity: number
    /** Actual signal data. */
    signal: Float32Array
    /** Physical unit of the signal. */
    unit: string
    /** Number of signal datapoints. */
    sampleCount: number
}
