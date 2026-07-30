/**
 * Typed error and outcome descriptors for the resilient network layer.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Classification of a non-success fetch outcome. Drives both retry behaviour and the per-origin
 * circuit breaker:
 * - `transient` — a 429/502/503/504 or a network/CORS `TypeError` (the two are indistinguishable
 *   from `fetch`); retryable, and counts toward tripping the breaker to `open-unavailable`.
 * - `server` — a 5xx other than the transient set; retryable, same breaker effect as `transient`.
 * - `timeout` — the request exceeded its own deadline; retryable, same breaker effect.
 * - `auth` — 401/403; not retryable, trips the breaker to the sticky `open-auth` state.
 * - `gone` — 404/410; not retryable, per-resource — does NOT trip the breaker (one missing object
 *   must not strand every other request to the same origin).
 * - `client` — a 4xx other than auth/gone; not retryable, per-resource, no breaker effect.
 * - `aborted` — the caller's own `AbortSignal` fired; not retryable, no breaker effect.
 */
export type FetchFailureKind = 'transient' | 'server' | 'timeout' | 'auth' | 'gone' | 'client' | 'aborted'

/** How a fetch outcome affects the per-origin circuit breaker. */
export type BreakerTrip = 'auth' | 'unavailable' | null

/** Result of classifying a fetch response or thrown error. */
export interface FetchOutcome {
    /** True only for an ok response; the fields below then describe the failure. */
    ok: boolean
    /** Failure classification; undefined when {@link ok} is true. */
    kind?: FetchFailureKind
    /** HTTP status when the outcome came from a response. */
    status?: number
    /** Whether `resilientFetch` should retry this outcome (given remaining budget). */
    retryable: boolean
    /** Breaker effect: immediate `auth` open, a candidate `unavailable` trip, or none. */
    breakerTrip: BreakerTrip
}

/**
 * Terminal error thrown by `resilientFetch` for any non-success outcome (a non-ok response whose
 * class is not retryable, an exhausted retry budget, an open circuit, or a caller abort). The
 * `kind` lets a caller branch — most treat any `NetworkError` as "this load failed" and fall back
 * to their sentinel, but the auth/aborted classes are worth distinguishing at higher layers.
 */
export class NetworkError extends Error {
    readonly kind: FetchFailureKind
    readonly status?: number
    readonly origin?: string

    constructor (kind: FetchFailureKind, message: string, opts?: { status?: number, origin?: string, cause?: unknown }) {
        super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined)
        this.name = 'NetworkError'
        this.kind = kind
        this.status = opts?.status
        this.origin = opts?.origin
    }
}
