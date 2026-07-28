/**
 * Contract tests for the signal reader's rolling-window operation queue.
 *
 * The queue is the single serialisation point for window mutations and coordinated reads:
 * strictly FIFO, one op in flight, per-stream supersession (queued ops dropped and settled,
 * the in-flight op aborted), and a pump that survives throwing ops so the queue can never
 * wedge.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import SignalReaderOpQueue, { type ReaderOp, type ReaderOpKind } from '../../src/assets/reader/SignalReaderOpQueue'

/** Wait until `cond` returns true, polling every few milliseconds. */
const until = async (cond: () => boolean) => {
    const deadline = Date.now() + 1000
    while (!cond()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out waiting for condition.')
        }
        await new Promise(resolve => setTimeout(resolve, 2))
    }
}

/** Build a gated op that logs its lifecycle and completes when released. */
const makeOp = (name: string, stream: string, log: string[], kind: ReaderOpKind = 'load') => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const op: ReaderOp = {
        kind,
        stream,
        run: async (signal) => {
            log.push(`start:${name}`)
            await gate
            log.push(`end:${name}${signal.aborted ? ':aborted' : ''}`)
        },
        settleSuperseded: () => log.push(`superseded:${name}`),
    }
    return { op, release }
}

describe('SignalReaderOpQueue', () => {
    test('runs ops strictly one at a time in FIFO order', async () => {
        const queue = new SignalReaderOpQueue()
        const log: string[] = []
        const a = makeOp('a', 'view', log)
        const b = makeOp('b', 'view', log)
        queue.enqueue(a.op)
        queue.enqueue(b.op)
        await until(() => log.includes('start:a'))
        expect(log).not.toContain('start:b')
        a.release()
        await until(() => log.includes('start:b'))
        b.release()
        await until(() => queue.pending === 0)
        expect(log).toStrictEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    })
    test('superseding a stream drops its queued ops and settles them', async () => {
        const queue = new SignalReaderOpQueue()
        const log: string[] = []
        const a = makeOp('a', 'view', log)
        const b = makeOp('b', 'view', log)
        const c = makeOp('c', 'view', log)
        queue.enqueue(a.op)
        queue.enqueue(b.op)
        queue.enqueue(c.op)
        await until(() => log.includes('start:a'))
        queue.supersedeStream('view')
        expect(log).toContain('superseded:b')
        expect(log).toContain('superseded:c')
        a.release()
        await until(() => queue.pending === 0)
        expect(log).not.toContain('start:b')
        expect(log).not.toContain('start:c')
    })
    test('superseding a stream aborts its in-flight op', async () => {
        const queue = new SignalReaderOpQueue()
        const log: string[] = []
        const a = makeOp('a', 'view', log)
        queue.enqueue(a.op)
        await until(() => log.includes('start:a'))
        queue.supersedeStream('view')
        a.release()
        await until(() => queue.pending === 0)
        expect(log).toContain('end:a:aborted')
    })
    test('superseding one stream never touches another', async () => {
        const queue = new SignalReaderOpQueue()
        const log: string[] = []
        const a = makeOp('a', 'view', log)
        const b = makeOp('b', 'trend', log)
        queue.enqueue(a.op)
        queue.enqueue(b.op)
        await until(() => log.includes('start:a'))
        queue.supersedeStream('trend')
        expect(log).toContain('superseded:b')
        queue.supersedeStream('view')
        a.release()
        await until(() => queue.pending === 0)
        // The view op was in-flight (aborted, not dropped); the trend op was dropped.
        expect(log).toContain('end:a:aborted')
        expect(log).not.toContain('start:b')
    })
    test('superseding all streams drops every queued op and aborts the in-flight one', async () => {
        const queue = new SignalReaderOpQueue()
        const log: string[] = []
        const a = makeOp('a', 'view', log)
        const b = makeOp('b', 'trend', log)
        const c = makeOp('c', 'view', log)
        queue.enqueue(a.op)
        queue.enqueue(b.op)
        queue.enqueue(c.op)
        await until(() => log.includes('start:a'))
        queue.supersedeAll()
        expect(log).toContain('superseded:b')
        expect(log).toContain('superseded:c')
        a.release()
        await until(() => queue.pending === 0)
        expect(log).toContain('end:a:aborted')
        expect(log).not.toContain('start:b')
        expect(log).not.toContain('start:c')
    })
    test('a throwing op does not stop the pump', async () => {
        const queue = new SignalReaderOpQueue()
        const log: string[] = []
        queue.enqueue({
            kind: 'load',
            stream: 'view',
            run: async () => {
                throw new Error('boom')
            },
            settleSuperseded: () => log.push('superseded:thrower'),
        })
        const b = makeOp('b', 'view', log)
        queue.enqueue(b.op)
        await until(() => log.includes('start:b'))
        b.release()
        await until(() => queue.pending === 0)
        expect(log).toContain('end:b')
    })
})
