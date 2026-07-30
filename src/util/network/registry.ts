/**
 * The per-realm circuit-breaker registry singleton and its surfacing hook.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BreakerRegistry, type BreakerState } from './breaker'

let statusHandler: ((origin: string, state: BreakerState) => void) | undefined

/**
 * Wire how this JS context surfaces breaker transitions: the main thread dispatches to the event
 * bus, a reader worker posts an unsolicited `network-status` message back to its service. Passing
 * `undefined` detaches the handler. One handler per realm — the module singleton below is distinct
 * in each worker and on the main thread, so each context surfaces its own breakers.
 */
export function setNetworkStatusHandler (handler: ((origin: string, state: BreakerState) => void) | undefined) {
    statusHandler = handler
}

/**
 * The realm's shared breaker registry, keyed by origin, consulted by `resilientFetch` through its
 * `registry` option. Transitions delegate to whatever {@link setNetworkStatusHandler} last set.
 */
export const networkBreakers = new BreakerRegistry({
    onTransition: (origin, state) => statusHandler?.(origin, state),
})
