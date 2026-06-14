/**
 * Media types.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BaseAsset } from '#types/application'

/**
 * A single biquad EQ band applied while shaping synthesized audio.
 */
export interface AudioEqBand {
    /** Centre / cutoff frequency in Hz. */
    frequency: number
    /** Gain in dB; applies to peaking and shelving filter types only. */
    gain?: number
    /** Quality factor. */
    q?: number
    /** Biquad filter type. */
    type: BiquadFilterType
}

/**
 * General type for audio recordings.
 */
export interface AudioRecording extends BaseAsset {
    /** The AudioBuffer currently loaded for playback, or null if none is loaded. */
    buffer: AudioBuffer | null
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
     * Destroy this recording and release all resources.
     * @param dispatchEvent - Should the destroy `before` event be dispatched (default true). Set to false if calling from a child class and the event has already been dispatched.
     */
    destroy (dispatchEvent?: boolean): void
    /**
     * Arm the playback source from the currently loaded buffer.
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
     * Set the AudioBuffer to play, replacing any currently loaded buffer. Updates duration, sample count, and
     * sampling rate to match the buffer.
     * @param buffer - The rendered audio buffer to play.
     */
    setBuffer (buffer: AudioBuffer): void
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
 * Identifier for a registered audio synthesis method. The built-in methods are `direct`, `stethoscope`, and
 * `spectral-tone`; the registry accepts any string so projects can register their own.
 */
export type AudioSynthesisMethod = 'direct' | 'spectral-tone' | 'stethoscope'

/**
 * Options common to all audio synthesis methods.
 */
export interface AudioSynthesisOptions {
    /**
     * Output duration in seconds. The `direct` method defaults to `signals[0].length / sampleRate`; `stethoscope`
     * defaults to the signal duration (it is time-preserving); `spectral-tone` defaults to a fixed sustain.
     */
    durationSeconds?: number
}

/**
 * Turns raw biosignal channels into a playable AudioBuffer. Implementations render off the UI thread with an
 * `OfflineAudioContext` and hand the result to a player via {@link AudioRecording.setBuffer}.
 */
export interface AudioSynthesizer {
    /**
     * Render the given signals into an AudioBuffer.
     * @param signals - One continuous Float32Array per channel, in physical units.
     * @param sampleRate - Sampling rate of the signals in Hz.
     * @param opts - Method-specific synthesis options.
     * @returns Promise resolving with the rendered audio buffer.
     */
    synthesize (signals: Float32Array[], sampleRate: number, opts?: AudioSynthesisOptions): Promise<AudioBuffer>
}

/**
 * Options for the `direct` synthesis method.
 */
export interface DirectSynthesisOptions extends AudioSynthesisOptions {
    /** Optional EQ band chain applied through an offline render. */
    eq?: AudioEqBand[]
    /**
     * Maximum absolute physical-unit value; the signal is normalised against this and clipped to [-1, 1]. A falsy
     * value disables normalisation.
     */
    sampleMaxAbsValue?: number
}

/**
 * Options for the `spectral-tone` synthesis method, which resynthesises the dominant spectral peaks of a clean signal
 * window as a steady, audible tone.
 */
export interface SpectralToneSynthesisOptions extends AudioSynthesisOptions {
    /** Number of spectral peaks to resynthesise additively (default 5). */
    peakCount?: number
    /** Explicit multiplicative speed-up factor applied to every peak frequency; overrides `targetFundamentalHz`. */
    speedUp?: number
    /** Target frequency (Hz) for the dominant peak; the speed-up factor is derived to land it here (default 440). */
    targetFundamentalHz?: number
}

/**
 * Options for the `stethoscope` synthesis method, which maps a sub-audible signal onto an audible carrier in a
 * time-preserving way (brain-stethoscope style).
 */
export interface StethoscopeSynthesisOptions extends AudioSynthesisOptions {
    /** Carrier frequency band [min, max] in Hz used when tracking signal frequency (default [110, 880]). */
    carrierBandHz?: [number, number]
    /** Base carrier frequency in Hz used when frequency is not tracked (default 220). */
    carrierHz?: number
    /** Control-curve update rate in Hz for the amplitude / frequency automation (default 50). */
    controlRateHz?: number
    /** Track the signal's instantaneous frequency to modulate carrier pitch; when false the carrier stays at `carrierHz` (default true). */
    trackFrequency?: boolean
}
