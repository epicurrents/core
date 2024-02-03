/**
 * Biosignal plot trace color.
 * @package    @epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { WebGlCompatibleColor } from '#types/plot'

export default class PlotColor implements WebGlCompatibleColor {
    protected _a: number
    protected _b: number
    protected _g: number
    protected _r: number

    get a () {
        return this._a
    }
    get array () {
        return [
            this._r, this._g, this._b, this._a
        ] as [ number, number, number, number]
    }
    get b () {
        return this._b
    }
    get g () {
        return this._g
    }
    get r () {
        return this._r
    }

    constructor (r: number, g: number, b: number, a: number) {
        this._a = a
        this._b = b
        this._g = g
        this._r = r
    }
}
