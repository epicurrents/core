/**
 * `resilientFetch` — a fetch wrapper with per-category timeout, bounded retry with backoff, and a
 * per-origin circuit breaker, throwing a typed {@link NetworkError} instead of decoding error bodies.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type BreakerRegistry, type CircuitBreaker } from './breaker'
import { classifyFetchOutcome } from './classify'
import { type FetchFailureKind, NetworkError } from './errors'

/** Request category, selecting a default timeout. Orders of magnitude apart, so no global ceiling. */
export type FetchCategory = 'range' | 'file' | 'setup' | 'config' | 'default'

/** Default per-category timeouts (ms). `range` matches the reader's LOAD_BLOCK_TIMEOUT. */
export const CATEGORY_TIMEOUT_MS: Record<FetchCategory, number> = {
    range: 30_000,
    file: 120_000,
    setup: 300_000,
    config: 10_000,
    default: 30_000,
}

/** Backoff parameters for the retry delay. */
export interface BackoffConfig {
    baseMs: number
    factor: number
    capMs: number
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 300, factor: 2, capMs: 3_000 }

/** Default retry count (attempts = retries + 1). */
export const DEFAULT_RETRIES = 3

export interface ResilientFetchOptions {
    /** Selects the default timeout; ignored when {@link timeoutMs} is given. */
    category?: FetchCategory
    /** Explicit per-request timeout, overriding the category default. */
    timeoutMs?: number
    /** Retry count (attempts = retries + 1). Defaults to {@link DEFAULT_RETRIES}. */
    retries?: number
    /** Caller abort — merged with the timeout; when it fires, the error is `aborted` (no retry). */
    signal?: AbortSignal
    /** The origin's breaker. Takes precedence over {@link registry}; when both are omitted, no breaker runs. */
    breaker?: CircuitBreaker
    /** A registry to draw the breaker from, keyed by the resolved origin — the usual call-site form. */
    registry?: BreakerRegistry
    /** Key used for the breaker lookup and error context; defaults to the URL's origin. */
    origin?: string
    /** Backoff overrides (tests pass `baseMs: 0` for near-instant retries). */
    backoff?: Partial<BackoffConfig>
}

/** Resolve the origin for breaker keying and error context, tolerating relative URLs. */
function resolveOrigin (url: string): string {
    try {
        const base = typeof location !== 'undefined' ? location.href : undefined
        return new URL(url, base).origin
    } catch {
        return url
    }
}

/** Combine caller and timeout signals into one, preferring `AbortSignal.any` when available. */
function anySignal (signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
    const list = signals.filter((s): s is AbortSignal => s !== undefined)
    if (list.length === 0) {
        return undefined
    }
    if (list.length === 1) {
        return list[0]
    }
    const AS = AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }
    if (typeof AS.any === 'function') {
        return AS.any(list)
    }
    const controller = new AbortController()
    for (const signal of list) {
        if (signal.aborted) {
            controller.abort((signal as { reason?: unknown }).reason)
            break
        }
        signal.addEventListener('abort', () => controller.abort((signal as { reason?: unknown }).reason), { once: true })
    }
    return controller.signal
}

/** Sleep for `ms`, rejecting early if `signal` fires. */
function abortableDelay (ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) {
        return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        const onAbort = () => {
            clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
        }
        if (signal) {
            if (signal.aborted) {
                onAbort()
                return
            }
            signal.addEventListener('abort', onAbort, { once: true })
        }
    })
}

/** Backoff delay for the given (1-based) attempt, with ±30 % jitter. */
function backoffMs (attempt: number, config: BackoffConfig): number {
    const raw = Math.min(config.baseMs * config.factor ** (attempt - 1), config.capMs)
    const jitter = raw * 0.3 * (Math.random() * 2 - 1)
    return Math.max(0, Math.round(raw + jitter))
}

/**
 * Fetch `url`, guaranteeing an ok `Response` on resolve and a typed {@link NetworkError} on any
 * terminal failure. Transient failures (network/CORS, timeout, 429/5xx) are retried with backoff
 * up to the budget; persistent ones (auth, gone, other 4xx) throw at once. When a breaker is given,
 * an open circuit short-circuits before any request, and every outcome updates the breaker.
 * @param url - Request URL.
 * @param init - Standard `fetch` init; its `signal`, if any, is superseded by the merged signal.
 * @param opts - Timeout, retry, breaker and backoff controls.
 */
export async function resilientFetch (
    url: string,
    init: RequestInit = {},
    opts: ResilientFetchOptions = {},
): Promise<Response> {
    const origin = opts.origin ?? resolveOrigin(url)
    const timeoutMs = opts.timeoutMs ?? CATEGORY_TIMEOUT_MS[opts.category ?? 'default']
    // A caller can disable the internal deadline (`timeoutMs: Infinity` or 0) when it already owns
    // cancellation — the signal reader relies solely on the op-queue's abort signal, so a slow block
    // over a throttled link is not killed by a duplicate timeout.
    const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    const maxAttempts = (opts.retries ?? DEFAULT_RETRIES) + 1
    const backoff: BackoffConfig = { ...DEFAULT_BACKOFF, ...opts.backoff }
    const callerSignal = opts.signal
    const breaker = opts.breaker ?? opts.registry?.get(origin)

    if (breaker && !breaker.canRequest()) {
        const kind: FetchFailureKind = breaker.state === 'open-auth' ? 'auth' : 'transient'
        throw new NetworkError(kind, `Circuit open (${breaker.state}) for ${origin}.`, { origin })
    }

    let lastKind: FetchFailureKind = 'transient'
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const timeoutController = useTimeout ? new AbortController() : undefined
        const timer = timeoutController ? setTimeout(() => timeoutController.abort(), timeoutMs) : undefined
        let response: Response
        try {
            response = await fetch(url, { ...init, signal: anySignal([callerSignal, timeoutController?.signal]) })
        } catch (error) {
            if (timer !== undefined) {
                clearTimeout(timer)
            }
            if (callerSignal?.aborted) {
                throw new NetworkError('aborted', `Request to ${origin} aborted by caller.`, { origin, cause: error })
            }
            // Our deadline, or a network/CORS failure — both retryable, both a candidate breaker trip.
            lastKind = timeoutController?.signal.aborted ? 'timeout' : 'transient'
            breaker?.onFailure('unavailable')
            if (attempt < maxAttempts) {
                await abortableDelay(backoffMs(attempt, backoff), callerSignal)
                continue
            }
            throw new NetworkError(lastKind, `Request to ${origin} failed (${lastKind}).`, { origin, cause: error })
        }
        if (timer !== undefined) {
            clearTimeout(timer)
        }

        const outcome = classifyFetchOutcome(response)
        if (outcome.ok) {
            breaker?.onSuccess()
            return response
        }
        breaker?.onFailure(outcome.breakerTrip)
        lastKind = outcome.kind as FetchFailureKind
        if (outcome.retryable && attempt < maxAttempts) {
            await abortableDelay(backoffMs(attempt, backoff), callerSignal)
            continue
        }
        throw new NetworkError(lastKind, `Request to ${origin} failed (${outcome.status}).`, {
            origin,
            status: outcome.status,
        })
    }
    // Unreachable in practice — the loop returns or throws — but keeps the type checker satisfied.
    throw new NetworkError(lastKind, `Request to ${origin} failed after ${maxAttempts} attempts.`, { origin })
}
