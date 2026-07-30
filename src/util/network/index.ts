/**
 * Resilient network layer: typed fetch-failure classification, a per-origin circuit breaker, and a
 * `fetch` wrapper that retries transient failures, refuses through an open circuit, and throws a
 * typed error instead of letting an error body be decoded as data.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

export { BreakerRegistry, CircuitBreaker, DEFAULT_BREAKER_CONFIG } from './breaker'
export type { BreakerConfig, BreakerState } from './breaker'
export { classifyFetchOutcome } from './classify'
export { NetworkError } from './errors'
export type { BreakerTrip, FetchFailureKind, FetchOutcome } from './errors'
export { networkBreakers, setNetworkStatusHandler } from './registry'
export {
    CATEGORY_TIMEOUT_MS,
    DEFAULT_BACKOFF,
    DEFAULT_RETRIES,
    resilientFetch,
} from './resilientFetch'
export type { BackoffConfig, FetchCategory, ResilientFetchOptions } from './resilientFetch'
