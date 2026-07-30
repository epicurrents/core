/**
 * Per-origin circuit breaker and registry for the resilient network layer.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type BreakerTrip } from './errors'

/**
 * Breaker states:
 * - `closed` — normal; requests pass.
 * - `open-auth` — a 401/403 was seen; sticky, requests are refused until an explicit `reset()`
 *   (the platform's post-re-authentication notification). This is the storm short-circuit.
 * - `open-unavailable` — enough consecutive transient failures accrued; requests are refused until
 *   the cooldown elapses, then a single probe is allowed.
 * - `half-open` — the cooldown elapsed; one probe is in flight. Its success closes the breaker, its
 *   failure re-opens `open-unavailable` with a longer cooldown.
 */
export type BreakerState = 'closed' | 'open-auth' | 'open-unavailable' | 'half-open'

/** Tunable thresholds. Starting values; revisit against a real flaky link. */
export interface BreakerConfig {
    /** Consecutive transient/server failures that trip `closed` → `open-unavailable`. */
    transientTrip: number
    /** First cooldown before a half-open probe. */
    cooldownInitialMs: number
    /** Cooldown ceiling; each re-open doubles the cooldown up to this. */
    cooldownMaxMs: number
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
    transientTrip: 3,
    cooldownInitialMs: 5_000,
    cooldownMaxMs: 60_000,
}

/**
 * A single origin's breaker. State transitions fire the optional `onTransition` callback so a
 * registry can surface them (to the event bus on the main thread, or across `postMessage` from a
 * worker). `now` is injectable so the cooldown logic is testable without real time.
 */
export class CircuitBreaker {
    protected _config: BreakerConfig
    protected _cooldownMs: number
    protected _consecutive = 0
    protected _now: () => number
    protected _onTransition?: (state: BreakerState) => void
    protected _probing = false
    protected _reopenAt = 0
    protected _state: BreakerState = 'closed'

    constructor (opts?: {
        config?: Partial<BreakerConfig>,
        now?: () => number,
        onTransition?: (state: BreakerState) => void,
    }) {
        this._config = { ...DEFAULT_BREAKER_CONFIG, ...opts?.config }
        this._cooldownMs = this._config.cooldownInitialMs
        this._now = opts?.now ?? Date.now
        this._onTransition = opts?.onTransition
    }

    get state () {
        return this._state
    }

    /** Set the state and fire the transition callback if it actually changed. */
    protected _setState (state: BreakerState) {
        if (state === this._state) {
            return
        }
        this._state = state
        this._onTransition?.(state)
    }

    /**
     * Whether a request may proceed now. In `half-open` this reserves the single probe slot, so it
     * is not a pure query — the reservation is what keeps concurrent callers to one probe in flight.
     */
    canRequest (): boolean {
        if (this._state === 'closed') {
            return true
        }
        if (this._state === 'open-auth') {
            return false
        }
        if (this._state === 'open-unavailable') {
            if (this._now() >= this._reopenAt && !this._probing) {
                this._probing = true
                this._setState('half-open')
                return true
            }
            return false
        }
        // half-open: allow exactly one probe at a time.
        if (!this._probing) {
            this._probing = true
            return true
        }
        return false
    }

    /** Record a successful request: close the breaker and reset the cooldown. */
    onSuccess () {
        this._consecutive = 0
        this._cooldownMs = this._config.cooldownInitialMs
        this._probing = false
        this._setState('closed')
    }

    /**
     * Record a failed request. `trip` is the outcome's breaker effect: `auth` opens the sticky auth
     * state immediately; `unavailable` counts toward the transient threshold (or, if it was the
     * half-open probe, re-opens with a longer cooldown); `null` has no effect.
     */
    onFailure (trip: BreakerTrip) {
        if (trip === 'auth') {
            this._probing = false
            this._setState('open-auth')
            return
        }
        if (trip !== 'unavailable') {
            return
        }
        if (this._state === 'half-open') {
            // The probe failed — back off with a longer cooldown, capped.
            this._cooldownMs = Math.min(this._cooldownMs * 2, this._config.cooldownMaxMs)
            this._reopenAt = this._now() + this._cooldownMs
            this._probing = false
            this._setState('open-unavailable')
            return
        }
        this._consecutive++
        if (this._consecutive >= this._config.transientTrip) {
            this._cooldownMs = this._config.cooldownInitialMs
            this._reopenAt = this._now() + this._cooldownMs
            this._setState('open-unavailable')
        }
    }

    /** Force the breaker closed (post-re-authentication, or a manual clear). */
    reset () {
        this._consecutive = 0
        this._cooldownMs = this._config.cooldownInitialMs
        this._probing = false
        this._reopenAt = 0
        this._setState('closed')
    }
}

/**
 * A per-context (one per JS realm — the main thread, and each worker) map of origin → breaker.
 * `onTransition` is where a context wires surfacing: the main thread dispatches to the event bus,
 * a worker posts an unsolicited `network-status` message back to its service.
 */
export class BreakerRegistry {
    protected _breakers = new Map<string, CircuitBreaker>()
    protected _config?: Partial<BreakerConfig>
    protected _now?: () => number
    protected _onTransition?: (origin: string, state: BreakerState) => void

    constructor (opts?: {
        config?: Partial<BreakerConfig>,
        now?: () => number,
        onTransition?: (origin: string, state: BreakerState) => void,
    }) {
        this._config = opts?.config
        this._now = opts?.now
        this._onTransition = opts?.onTransition
    }

    /** Get (creating on first use) the breaker for an origin. */
    get (origin: string): CircuitBreaker {
        let breaker = this._breakers.get(origin)
        if (!breaker) {
            breaker = new CircuitBreaker({
                config: this._config,
                now: this._now,
                onTransition: (state) => this._onTransition?.(origin, state),
            })
            this._breakers.set(origin, breaker)
        }
        return breaker
    }

    /** Reset a single origin's breaker, or every breaker when `origin` is omitted. */
    reset (origin?: string) {
        if (origin !== undefined) {
            this._breakers.get(origin)?.reset()
            return
        }
        for (const breaker of this._breakers.values()) {
            breaker.reset()
        }
    }
}
