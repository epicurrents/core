/**
 * Tests for how a worker applies the settings snapshot the service relays to it.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerMessage } from '#types/service'

const posted: Record<string, unknown>[] = []

const message = (data: Record<string, unknown>) => ({ data: { rn: 1, ...data } } as unknown as WorkerMessage)

const snapshot = (modules: Record<string, unknown> = {}) => ({ app: {}, modules })

describe('settings snapshots in a worker', () => {
    beforeEach(() => {
        posted.length = 0
        vi.stubGlobal('postMessage', (msg: Record<string, unknown>) => { posted.push(msg) })
        vi.stubGlobal('close', () => {})
    })

    describe('a namespaced worker', () => {
        /**
         * Both the montage and the trend worker read one module out of the snapshot and assign it
         * to their processor. The two are tested together because the hazard is the same in both
         * and the guard against it has to stay in both.
         */
        const cases = [
            {
                name: 'MontageWorker',
                holder: '_montage',
                load: async () => (await import('#workers/montage.worker')).MontageWorker,
            },
            {
                name: 'TrendWorker',
                holder: '_processor',
                load: async () => (await import('#workers/trend.worker')).TrendWorker,
            },
        ]

        it.each(cases)('$name adopts the module its namespace names', async ({ holder, load }) => {
            const Worker = await load()
            const worker = new Worker() as unknown as Record<string, any>
            worker._namespace = 'eeg'
            worker[holder] = { settings: { existing: true } }
            await worker.handleMessage(message({
                action: 'update-settings',
                settings: snapshot({ eeg: { fresh: true } }),
            }))
            expect(worker[holder].settings).toEqual({ fresh: true })
        })

        it.each(cases)('$name keeps its settings when the snapshot omits the module', async ({ holder, load }) => {
            // Every settings change now posts a whole snapshot to every worker, so a snapshot taken
            // while this worker's module was not registered would blank a working settings object
            // over a change that had nothing to do with it. Replacing them with `undefined` is
            // worse than keeping them stale, and nothing downstream would report it.
            const Worker = await load()
            const worker = new Worker() as unknown as Record<string, any>
            worker._namespace = 'eeg'
            worker[holder] = { settings: { existing: true } }
            await worker.handleMessage(message({
                action: 'update-settings',
                settings: snapshot({ emg: { other: true } }),
            }))
            expect(worker[holder].settings).toEqual({ existing: true })
            expect(posted[0].success).toBe(true)
        })
    })

    describe('a reader worker', () => {
        it('applies the snapshot to its own settings copy', async () => {
            const { SignalReaderWorker } = await import('#workers/signal-reader.worker')
            const SETTINGS = (await import('#config/Settings')).default
            class TestWorker extends SignalReaderWorker {}
            const worker = new TestWorker({ cacheReady: true } as never)
            const original = SETTINGS.getFieldValue('app.dataChunkSize')
            await worker.handleMessage(message({
                action: 'update-settings',
                settings: { app: { dataChunkSize: 4242 }, modules: {} },
            }))
            expect(SETTINGS.getFieldValue('app.dataChunkSize')).toBe(4242)
            SETTINGS.setFieldValue('app.dataChunkSize', original)
        })

        it('answers a snapshot-less update with a failure rather than silence', async () => {
            const { SignalReaderWorker } = await import('#workers/signal-reader.worker')
            class TestWorker extends SignalReaderWorker {}
            const worker = new TestWorker({ cacheReady: true } as never)
            await worker.handleMessage(message({ action: 'update-settings' }))
            // Two replies rather than one: `validateCommissionProps` posts its own on a failed
            // check and the handler posts again. Both say the same thing, so a caller settles on
            // the first; the assertion is that the commission is answered at all, which it was not
            // before — the handler used to return `false` without replying.
            expect(posted.length).toBeGreaterThan(0)
            expect(posted.every(reply => reply.success === false)).toBe(true)
        })
    })
})
