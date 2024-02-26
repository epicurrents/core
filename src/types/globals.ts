/**
 * Global property types and non-typed module declarations.
 * @package    @epicurrents/core
 * @copyright  2020 Sampsa Lohi
 * @license    Apache-2.0
 */

/* eslint-disable */

/** Path where WebPack serves its public assets (js) from. */
declare let __webpack_public_path__: string
declare module 'codecutils' {
    const CodecUtils: {
        extractTypedArray: Float32Array | Float64Array |
                           Int8Array | Int16Array | Int32Array |
                           Uint8Array | Uint16Array | Uint32Array
        getString8FromBuffer: string
    }
}

declare module 'd3-interpolate' {
    function interpolateNumber (a: number, b: number): (c: number) => number
    export { interpolateNumber }
}

declare module 'fili' {
    const Fili: any
    export default Fili
}