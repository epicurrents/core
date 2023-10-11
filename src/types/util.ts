/**
 * Utility types. These are meant to help with typing (not to describe the utility functions).
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Modify type `T`, omitting properties of `R` and replacing them with the defined properties.
 */
export type Modify<T, R> = Omit<T, keyof R> & R