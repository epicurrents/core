/**
 * FIFO operation queue for a signal reader's rolling-window cache.
 *
 * All window mutations (invalidate, per-block load) and coordinated reads funnel through one
 * queue, so a read never observes a half-invalidated window and the window has a single mover.
 * Ops are grouped into consumer streams: a newer request in a stream supersedes older pending
 * ops of the same stream (queued ops are dropped and settled, the in-flight op is aborted),
 * while ops of other streams are never touched.
 *
 * The pump can never wedge: an op that throws or is aborted is caught and the queue proceeds
 * to the next op. Op bodies are responsible for settling their own external promises — on
 * normal completion and on abort — and `settleSuperseded` must be idempotent, because a
 * superseded in-flight op may be settled both by its own abort handling and by the queue.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'

const SCOPE = 'SignalReaderOpQueue'

/** Kind of a queued reader operation. */
export type ReaderOpKind = 'invalidate' | 'load' | 'read'

/** One operation in the reader's rolling-window queue. */
export type ReaderOp = {
    /** Kind of the operation; informational (logging, tests) — the pump treats all kinds alike. */
    kind: ReaderOpKind
    /** Consumer stream this op belongs to; supersession is scoped to one stream. */
    stream: string
    /**
     * Operation body. `signal` aborts when the op's stream is superseded mid-flight; a body
     * that performs abortable work (fetches) must observe it and settle its promises as
     * superseded. Must not reject with meaningful state — the pump discards errors.
     */
    run: (signal: AbortSignal) => Promise<void>
    /** Settle the op's external promises with a superseded result. Must be idempotent. */
    settleSuperseded: () => void
}

export default class SignalReaderOpQueue {

    /** The op currently being executed, with its abort controller. */
    protected _current: { op: ReaderOp, controller: AbortController } | null = null
    /** Ops waiting to be executed, in FIFO order. */
    protected _queue: ReaderOp[] = []
    /** True while the pump loop is draining the queue. */
    protected _running = false

    /** Number of ops that have not finished (queued + in-flight). */
    get pending (): number {
        return this._queue.length + (this._current ? 1 : 0)
    }

    /** Drain the queue one op at a time until it is empty. */
    protected async _pump (): Promise<void> {
        if (this._running) {
            return
        }
        this._running = true
        while (this._queue.length) {
            const op = this._queue.shift() as ReaderOp
            const controller = new AbortController()
            this._current = { op, controller }
            try {
                await op.run(controller.signal)
            } catch (e: unknown) {
                // Op bodies settle their own promises; an escaped rejection only gets logged so
                // the pump keeps the queue moving.
                Log.debug(
                    `Queued ${op.kind} op (stream '${op.stream}') rejected: ${(e as Error)?.message ?? e}.`,
                    SCOPE
                )
            }
            this._current = null
        }
        this._running = false
    }

    /** Append an operation and start the pump if it is idle. */
    enqueue (op: ReaderOp): void {
        this._queue.push(op)
        void this._pump()
    }

    /**
     * Supersede every pending operation of the given stream: queued ops are removed and settled
     * via their `settleSuperseded`, and an in-flight op of the stream has its abort signal fired
     * (its own body settles its promises). Ops of other streams are unaffected.
     */
    supersedeStream (stream: string): void {
        const keep: ReaderOp[] = []
        for (const op of this._queue) {
            if (op.stream === stream) {
                op.settleSuperseded()
            } else {
                keep.push(op)
            }
        }
        this._queue = keep
        if (this._current && this._current.op.stream === stream) {
            this._current.controller.abort()
        }
    }
}
