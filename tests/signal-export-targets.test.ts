import { afterEach, describe, expect, it, vi } from 'vitest'
import { Epicurrents } from '../src'
import { isLocalResource, suggestExportSource } from '../src/util/export'
import type { DataResource } from '../src/types/application'
import type { SignalExportSourceChannel, SignalExportTarget } from '../src/types/reader'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A resource whose source study holds the given data files. */
const resource = (...files: { file: File | null, role?: string }[]) => ({
    source: {
        files: files.map(f => ({ file: f.file, role: f.role ?? 'data', url: 'blob:x' })),
    },
}) as unknown as DataResource

const localFile = () => new File([new Uint8Array(8)], 'recording.edf')

const target = (label = 'Destination'): SignalExportTarget => ({
    format: 'edf',
    label,
    submit: async () => ({ message: 'ok', success: true }),
})

const channel = (label: string, extra: Partial<SignalExportSourceChannel> = {}): SignalExportSourceChannel => ({
    label,
    sampleCount: 256,
    samplingRate: 256,
    ...extra,
})

// ── isLocalResource ───────────────────────────────────────────────────────────

describe('isLocalResource', () => {
    it('is true when every data file carries a File', () => {
        expect(isLocalResource(resource({ file: localFile() }))).toBe(true)
        expect(isLocalResource(resource({ file: localFile() }, { file: null, role: 'media' }))).toBe(true)
    })

    it('is false for a URL-loaded resource', () => {
        expect(isLocalResource(resource({ file: null }))).toBe(false)
    })

    it('is false when any data file lacks a File', () => {
        expect(isLocalResource(resource({ file: localFile() }, { file: null }))).toBe(false)
    })

    it('is false without a source or without data files', () => {
        expect(isLocalResource({ source: null } as unknown as DataResource)).toBe(false)
        expect(isLocalResource(resource({ file: localFile(), role: 'media' }))).toBe(false)
        expect(isLocalResource(resource())).toBe(false)
    })

    it('does not take a File-shaped object for a File', () => {
        const fake = { name: 'recording.edf', size: 8 } as unknown as File
        expect(isLocalResource(resource({ file: fake }))).toBe(false)
    })
})

// ── suggestExportSource ───────────────────────────────────────────────────────

describe('suggestExportSource', () => {
    it('matches a label exactly, ignoring case', () => {
        expect(suggestExportSource('Fp1', [channel('FP2'), channel('fp1')])).toBe(1)
    })

    it('matches through a modality prefix and a reference suffix', () => {
        const channels = [channel('EEG Fp1-Ref'), channel('EEG Fp2-Ref'), channel('ECG')]
        expect(suggestExportSource('Fp2', channels)).toBe(1)
        expect(suggestExportSource('C3', [channel('EEG C3-AVG')])).toBe(0)
    })

    it('keeps a bipolar derivation distinct from its first electrode', () => {
        expect(suggestExportSource('C3', [channel('C3-P3')])).toBeNull()
        expect(suggestExportSource('C3-P3', [channel('EEG C3-P3'), channel('EEG C3-Ref')])).toBe(0)
    })

    it('suggests nothing for an ambiguous match', () => {
        expect(suggestExportSource('Fp1', [channel('EEG Fp1-Ref'), channel('Fp1-AVG')])).toBeNull()
        expect(suggestExportSource('Fp1', [channel('Fp1'), channel('FP1')])).toBeNull()
    })

    it('never suggests a channel without a signal', () => {
        expect(suggestExportSource('Fp1', [channel('Fp1', { modality: 'meta' })])).toBeNull()
        expect(suggestExportSource('Fp1', [channel('Fp1', { samplingRate: 0 })])).toBeNull()
    })

    it('suggests nothing without a match', () => {
        expect(suggestExportSource('O1', [channel('Fp1'), channel('Fp2')])).toBeNull()
    })
})

// ── Target registry ───────────────────────────────────────────────────────────

describe('signal export targets', () => {
    const app = new Epicurrents()

    afterEach(() => {
        for (const name of [...app.runtime.APP.signalExportTargets.keys()]) {
            app.unregisterSignalExportTarget(name)
        }
    })

    it('offers every registered target for a local resource and none for a remote one', () => {
        app.registerSignalExportTarget('a', target('A'))
        app.registerSignalExportTarget('b', target('B'))
        expect([...app.getSignalExportTargets(resource({ file: localFile() })).keys()]).toEqual(['a', 'b'])
        expect(app.getSignalExportTargets(resource({ file: null })).size).toBe(0)
    })

    it('replaces a target registered under the same name', () => {
        app.registerSignalExportTarget('a', target('First'))
        app.registerSignalExportTarget('a', target('Second'))
        const targets = app.getSignalExportTargets(resource({ file: localFile() }))
        expect(targets.size).toBe(1)
        expect(targets.get('a')?.label).toBe('Second')
    })

    it('hands out a copy, so a caller cannot register behind the application', () => {
        const targets = app.getSignalExportTargets(resource({ file: localFile() }))
        targets.set('sneaked', target())
        expect(app.getSignalExportTargets(resource({ file: localFile() })).has('sneaked')).toBe(false)
    })

    it('announces every change and only a real removal', () => {
        const listener = vi.fn()
        const unsubscribe = app.eventBus.addScopedEventListener(
            'signal-export-targets-changed', listener, 'test', 'application', 'after'
        )
        app.registerSignalExportTarget('a', target())
        expect(app.unregisterSignalExportTarget('a')).toBe(true)
        expect(app.unregisterSignalExportTarget('a')).toBe(false)
        expect(listener).toHaveBeenCalledTimes(2)
        unsubscribe()
    })
})
