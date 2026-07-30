/**
 * Classification of a fetch response or thrown error into a {@link FetchOutcome}.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type FetchOutcome } from './errors'

/** Duck-type check for a `Response` without relying on the global being the same realm. */
function isResponse (input: unknown): input is Response {
    return typeof input === 'object' && input !== null &&
        typeof (input as Response).status === 'number' && 'ok' in (input as object)
}

/**
 * Classify a fetch outcome. Accepts either the resolved `Response` (status-based) or a thrown
 * error (a network/CORS `TypeError`, or an `AbortError` from a fired signal). The caller resolves
 * one ambiguity this function cannot: `AbortError` is reported as `aborted` here, but `resilientFetch`
 * reinterprets it as `timeout` when the fire came from its own deadline rather than the caller.
 * @param input - The resolved response or the thrown error.
 */
export function classifyFetchOutcome (input: Response | Error): FetchOutcome {
    if (isResponse(input)) {
        const status = input.status
        if (input.ok) {
            return { ok: true, status, retryable: false, breakerTrip: null }
        }
        if (status === 401 || status === 403) {
            return { ok: false, kind: 'auth', status, retryable: false, breakerTrip: 'auth' }
        }
        if (status === 404 || status === 410) {
            return { ok: false, kind: 'gone', status, retryable: false, breakerTrip: null }
        }
        if (status === 429 || status === 502 || status === 503 || status === 504) {
            return { ok: false, kind: 'transient', status, retryable: true, breakerTrip: 'unavailable' }
        }
        if (status >= 500) {
            return { ok: false, kind: 'server', status, retryable: true, breakerTrip: 'unavailable' }
        }
        // Any other 4xx: a per-resource client error, not worth retrying or breaking the origin.
        return { ok: false, kind: 'client', status, retryable: false, breakerTrip: null }
    }
    if ((input as Error)?.name === 'AbortError') {
        return { ok: false, kind: 'aborted', retryable: false, breakerTrip: null }
    }
    // fetch rejects with a bare TypeError for both a network failure and a CORS rejection; the two
    // are indistinguishable, so treat as transient and let the retry budget / breaker bound it.
    return { ok: false, kind: 'transient', retryable: true, breakerTrip: 'unavailable' }
}
