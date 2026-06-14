/**
 * Audio synthesizer registry: maps a method key to a synthesizer so a recording or UI can pick the method.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import DirectSynthesizer from './direct'
import SpectralToneSynthesizer from './spectralTone'
import StethoscopeSynthesizer from './stethoscope'
import type { AudioSynthesizer } from '#types/media'

const synthesizers = new Map<string, AudioSynthesizer>([
    ['direct', new DirectSynthesizer()],
    ['spectral-tone', new SpectralToneSynthesizer()],
    ['stethoscope', new StethoscopeSynthesizer()],
])

/**
 * Get the synthesizer registered for the given method key.
 * @param method - Method key, e.g. `direct`, `stethoscope`, `spectral-tone`.
 * @returns The synthesizer, or undefined if no method is registered under that key.
 */
export function getSynthesizer (method: string): AudioSynthesizer | undefined {
    return synthesizers.get(method)
}

/** List the keys of all registered synthesis methods. */
export function listSynthesizers (): string[] {
    return Array.from(synthesizers.keys())
}

/**
 * Register (or replace) the synthesizer for a method key, letting a project add its own synthesis method.
 * @param method - Method key.
 * @param synthesizer - The synthesizer to register.
 */
export function registerSynthesizer (method: string, synthesizer: AudioSynthesizer): void {
    synthesizers.set(method, synthesizer)
}
