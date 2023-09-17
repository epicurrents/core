/**
 * WebGL plot trace line.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalPlot,
    type WebGlCompatibleColor,
    type WebGlTrace
} from "TYPES/plot"
import Log from 'scoped-ts-log'

const SCOPE = 'WebGlPlotTrace'

export default class WebGlPlotTrace implements WebGlTrace {
    protected _amplification = 1
    protected _buffer = 0 as WebGLBuffer
    protected _color: WebGlCompatibleColor
    protected _coordinates = 0
    protected _downsampleFactor = 0
    protected _offset: number
    protected _parent: BiosignalPlot
    protected _polarity: 1 | -1
    protected _render = true
    protected _samplesPerPx: number
    protected _samplingRate: number
    protected _sensitivity: number
    protected _xyPairs: Float32Array = new Float32Array()


    get amplification () {
        return this._amplification
    }
    set amplification (value: number) {
        this._amplification = value
    }
    get buffer () {
        return this._buffer
    }
    set buffer (buffer: WebGLBuffer) {
        this._buffer = buffer
    }
    get color () {
        return this._color
    }
    get coordinates () {
        return this._coordinates
    }
    set coordinates (coords: number) {
        this._coordinates = coords
    }
    get length () {
        return this._xyPairs.length/2
    }
    get offset () {
        return this._offset
    }
    get polarity () {
        return this._polarity
    }
    set polarity (value: 1 | -1) {
        this._polarity = value
    }
    get render () {
        return this._render
    }
    get samplingRate () {
        return this._samplingRate
    }
    get sensitivity () {
        return this._sensitivity
    }
    set sensitivity (value: number) {
        this._sensitivity = value
    }
    get xy () {
        return this._xyPairs
    }

    constructor (
        parent: BiosignalPlot,
        color: WebGlCompatibleColor,
        length: number,
        sensitivity: number,
        samplingRate: number,
        samplesPerPx: number,
        downsampleFactor: number,
        polarity: 1 | -1,
        amplification: number,
        offset: number,
    ) {
        this._color = color
        this._downsampleFactor = downsampleFactor
        this._offset = offset
        this._parent = parent
        this._polarity = polarity
        this._samplesPerPx = samplesPerPx
        this._samplingRate = samplingRate
        this._sensitivity = sensitivity
        this._amplification = amplification
        this._xyPairs = new Float32Array(2*Math.floor(length))
        this.initData()
    }

    getData () {
        return this._xyPairs.filter((value: number, index: number) => (index%2))
    }

    initData (length = this.length, step: number = 1) {
        // WebGL canvas clip space dimensions are always -1 to 1.
        const clipSpaceStep = 2/length
        // Initialize the array with the given step, i.e. set x-values to be `step` apart.
        for (let i=0; i<length; i++) {
            const xPos = (i*step)*clipSpaceStep - 1
            if (xPos > 1) {
                break
            }
            this._xyPairs[i*2] = xPos
            this._xyPairs[i*2 + 1] = 0
        }
    }

    setData (data: Float32Array | number, downsampleFactor = this._downsampleFactor) {
        if (typeof data === 'number') {
            // Set all datapoints to same value.
            for (let i=0; i<this.length; i++) {
                this._xyPairs[i*2 + 1] = data
            }
            return
        }
        const dataLoop = Math.floor(Math.min(data.length/downsampleFactor, this.length))
        for (let i=0; i<dataLoop; i++) {
            this._xyPairs[i*2 + 1] = data[i*downsampleFactor]
        }
        // Fill any leftover with zeroes.
        for (let j=dataLoop; j<this.length; j++) {
            this._xyPairs[j*2 + 1] = 0
        }
    }

    setSensitivity (value: number) {
        if (value <= 0) {
            Log.error(`Sensitivity must be greater than zero, ${value} was given.`, SCOPE)
            return
        }
        this._sensitivity = value
    }
}
