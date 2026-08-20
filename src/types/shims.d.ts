/**
 * Non-typed module declarations.
 * @package    epicurrents/core
 * @copyright  2020 Sampsa Lohi
 * @license    Apache-2.0
 */

/* eslint-disable */

/**
 * Worker bundled and inlined by the build. The bundle is self-contained and carries its own copy of
 * every dependency, so the constructed worker resolves nothing at runtime.
 */
declare module '*?worker&inline' {
    const InlinedWorker: new (options?: { name?: string }) => Worker
    export default InlinedWorker
}

declare module 'codecutils' {
    const CodecUtils: {
        extractTypedArray: Float32Array | Float64Array |
                           Int8Array | Int16Array | Int32Array |
                           Uint8Array | Uint16Array | Uint32Array
        getString8FromBuffer: string
    }
}