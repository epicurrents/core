/**
 * Runtime utilities.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-ts-log'

/**
 * Make a log entry of a mutation attempt with an invalid value.
 * @param property - Name of the property.
 * @param value - The invalid value.
 * @param scope - Scope of the event.
 * @param hint - Optional hint or explanation.
 */
export const logInvalidMutation = (property: string, value: unknown, scope: string, hint?: string) => {
    Log.warn(`New value '${value}' for property '${property}' is not valid.${ hint ? ' ' + hint : '' }`, scope)
}
