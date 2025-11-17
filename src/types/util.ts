/**
 * Utility types. These are meant to help with typing (not to describe the utility functions).
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Deep partial type, making all properties and nested properties optional.
 * @privateRemarks
 * From: https://stackoverflow.com/a/61132308
 */
export type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
} : T;

/**
 * Strict key and value types in a Record/Object when retrieving using the `Object.entries()` method.
 * @example
 * type MyType = { a: number, b: string, c: boolean }
 * const myObject: MyType = { a: 1, b: 'test', c: true }
 * const plainEntries = Object.entries(myObject) // Record<string, string|number|boolean>[]
 * const strictEntries: Entries<MyType> = Object.entries(myObject) // Record<{ a: number, b: string, c: boolean }>[]
 */
export type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T][]

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
