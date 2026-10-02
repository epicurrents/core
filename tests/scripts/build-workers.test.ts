// @vitest-environment node
/**
 * The split between a worker's class module and its thread entry, asserted against the sources
 * rather than the bundles: `umd/` is build output and is not committed, so a test that read it would
 * pass or fail on whether someone had run the build.
 *
 * A standalone bundle built from a class module loads, answers nothing and reports no error, so
 * neither the build nor the rest of the suite can see it happen. That is how the montage worker
 * shipped without a message handler once the entry was split out of it and `build-workers.mjs` was
 * left naming the class module.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const buildScript = readFileSync(join(coreRoot, 'scripts', 'build-workers.mjs'), 'utf-8')
const workerSource = (file: string) => readFileSync(join(coreRoot, 'src', 'workers', file), 'utf-8')

/** Names in the script's `WORKERS` list, which is what gets a standalone bundle. */
const standaloneWorkers = (() => {
    const list = /const WORKERS = \[([^\]]*)\]/.exec(buildScript)
    expect(list, 'build-workers.mjs no longer declares a WORKERS array').not.toBeNull()
    return [...(list as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map(match => match[1])
})()

/** A top-level `onmessage = ` assignment, which is what binds the handler on a worker thread. */
const bindsOnMessage = (source: string) => /^onmessage\s*=/m.test(source)

describe('standalone worker bundles', () => {
    it('declares the workers this package ships standalone', () => {
        expect(standaloneWorkers.length).toBeGreaterThan(0)
        expect(standaloneWorkers).toEqual([...standaloneWorkers].filter(name => /^[a-z-]+$/.test(name)))
    })

    it('bundles each one from a thread entry rather than from its class module', () => {
        // The entry suffix is read out of the script so the test fails on a changed template rather
        // than passing against a path nothing builds.
        expect(buildScript).toContain('${name}.worker.entry.ts')
        expect(buildScript).not.toMatch(/\$\{name\}\.worker\.ts/)
    })

    for (const name of standaloneWorkers) {
        describe(name, () => {
            it('has a thread entry that binds onmessage', () => {
                const entry = `${name}.worker.entry.ts`
                expect(existsSync(join(coreRoot, 'src', 'workers', entry)), `${entry} is missing`).toBe(true)
                expect(bindsOnMessage(workerSource(entry))).toBe(true)
            })

            it('keeps the class module free of the binding', () => {
                // The class is imported on the main thread — out of the barrel, or by a substitute —
                // so a binding here takes over the importer's own handler, and under the package's
                // `sideEffects: false` a bundler may drop it from the thread that needs it.
                expect(bindsOnMessage(workerSource(`${name}.worker.ts`))).toBe(false)
            })
        })
    }
})

describe('worker class modules', () => {
    it('leave every binding to a thread entry, including workers with no standalone bundle', () => {
        // signal-reader has no standalone bundle and so is not covered by the per-worker cases
        // above, but the same rule applies: it is instantiated on the main thread by its substitute.
        const classModules = ['base', 'memory-manager', 'montage', 'signal-reader', 'trend']
        const offenders = classModules.filter(name => bindsOnMessage(workerSource(`${name}.worker.ts`)))
        expect(offenders, 'these class modules bind onmessage; move it to a .worker.entry.ts').toEqual([])
    })
})
