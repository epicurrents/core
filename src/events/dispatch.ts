/**
 * Shared property-change dispatch helper.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { ScopedEventBus, ScopedEventPhase } from 'scoped-event-bus/dist/types'

/**
 * Dispatch a property-change event on the scoped event bus with the standard detail shape.
 *
 * The single dispatch site for property-change events: the caller supplies the `scope` (an
 * asset instance id, or a reserved semantic scope for non-asset emitters), so the event name,
 * detail shape, and phase contract stay identical regardless of the emitter. Emitted through
 * `dispatchScopedEvent`, so both scoped (`addScopedEventListener`) and native
 * (`addEventListener`) subscribers receive it; the return value carries the before-phase
 * cancellation result.
 *
 * @param property - Name of the changed property, or a dotted field path for grouped settings.
 * @param options.event - Override for the default `property-change:<property>` event name.
 * @param options.origin - The object whose property changed, attached as `detail.origin`.
 * @param options.source - `'system'` or `'user'`; absent means user-initiated.
 */
export function dispatchPropertyChange (
    eventBus: ScopedEventBus,
    scope: string,
    property: string,
    newValue: unknown,
    oldValue: unknown,
    phase: ScopedEventPhase = 'after',
    options: { event?: string, origin?: unknown, source?: 'system' | 'user' } = {},
) {
    return eventBus.dispatchScopedEvent(
        options.event || `property-change:${property}`,
        scope,
        phase,
        {
            origin: options.origin,
            property: property,
            newValue: newValue,
            oldValue: oldValue,
            source: options.source,
        },
    )
}
