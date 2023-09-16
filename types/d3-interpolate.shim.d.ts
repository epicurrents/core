/**
 * D3 Interpolate shims.
 * @package    epicurrents-core
 * @copyright  2020-2021 Sampsa Lohi
 * @license    Apache-2.0
 */

declare module 'd3-interpolate' {
    function interpolateNumber (a: number, b: number): (c: number) => number
    export { interpolateNumber }
}
