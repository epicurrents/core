/**
 * Utility types. These are meant to help with typing (not to describe the utility functions).
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Modify type `T`, omitting properties of `R` and replacing them with the defined properties.
 */
export type Modify<T, R> = Omit<T, keyof R> & R
/**
 * Valid typed number array.
 */
export type TypedNumberArray = Float32Array | Float64Array |
                               Int8Array | Int16Array | Int32Array |
                               Uint8Array | Uint16Array | Uint32Array
/**
 * Constructor for a valid typed number array.
 */
export type TypedNumberArrayConstructor = Float32ArrayConstructor | Float64ArrayConstructor |
                                          Int8ArrayConstructor | Int16ArrayConstructor | Int32ArrayConstructor |
                                          Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor
