/**
 * Tests for the commission dispatch every worker inherits.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerMessage } from '#types/service'
import { BaseWorker } from '#workers/base.worker'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

/** Responses the worker posts back to its service. */
let posted: Record<string, unknown>[] = []

class TestWorker extends BaseWorker {
    constructor () {
        super()
        this.extendActionMap([
            ['ok', () => Promise.resolve(this._success({ action: 'ok' } as WorkerMessage['data']))],
            ['throws-async', () => {
                throw new Error('handler exploded')
            }],
            ['rejects', () => Promise.reject(new Error('handler rejected'))],
            ['throws-a-string', () => {
                throw 'not an error object'
            }],
        ])
    }
}

const message = (action: string, rn: number) => ({ data: { action, rn } }) as WorkerMessage

describe('BaseWorker commission dispatch', () => {
    beforeEach(() => {
        posted = []
        vi.stubGlobal('postMessage', (msg: unknown) => {
            posted.push(msg as Record<string, unknown>)
        })
    })

    it('answers an unregistered action rather than staying silent', async () => {
        const worker = new TestWorker()
        await expect(worker.handleMessage(message('nope', 1))).resolves.toBe(false)
        expect(posted).toHaveLength(1)
        expect(posted[0].success).toBe(false)
        expect(posted[0].rn).toBe(1)
    })

    it('answers a commission whose handler throws', async () => {
        // Nothing was posted when a handler threw, so the service's promise for that commission
        // stayed pending for the life of the session, and any waiter registered against the same
        // action was never notified — the service wedged rather than failing.
        const worker = new TestWorker()
        await expect(worker.handleMessage(message('throws-async', 2))).resolves.toBe(false)
        expect(posted).toHaveLength(1)
        expect(posted[0].success).toBe(false)
        expect(posted[0].rn).toBe(2)
        expect(String(posted[0].error)).toContain('handler exploded')
    })

    it('answers a commission whose handler rejects', async () => {
        const worker = new TestWorker()
        await expect(worker.handleMessage(message('rejects', 3))).resolves.toBe(false)
        expect(posted).toHaveLength(1)
        expect(posted[0].rn).toBe(3)
        expect(String(posted[0].error)).toContain('handler rejected')
    })

    it('answers when a handler throws something that is not an Error', async () => {
        const worker = new TestWorker()
        await expect(worker.handleMessage(message('throws-a-string', 4))).resolves.toBe(false)
        expect(posted).toHaveLength(1)
        expect(String(posted[0].error)).toContain('not an error object')
    })

    it('answers a message carrying no action', async () => {
        const worker = new TestWorker()
        await expect(worker.handleMessage({ data: {} } as WorkerMessage)).resolves.toBe(false)
        expect(posted).toHaveLength(1)
        expect(posted[0].success).toBe(false)
    })

    it('still passes a successful commission through untouched', async () => {
        const worker = new TestWorker()
        await expect(worker.handleMessage(message('ok', 5))).resolves.toBe(true)
        expect(posted).toHaveLength(1)
        expect(posted[0].success).toBe(true)
    })
})
