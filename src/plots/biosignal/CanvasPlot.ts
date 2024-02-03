/**
 * Signal plot on the basic canvas element.
 * @package    @epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 *
 * @remarks
 * There are several plotting libraries out there that could handle this with little overhead.
 * In the end it would probably be the easiest solution to just use one of those libraries.
 */

import {
    type BiosignalPlot,
    type BiosignalPlotConfig,
    type BiosignalTrace,
} from '#types/plot'
import { Log } from 'scoped-ts-log'

const SCOPE = "SignalPlot"

/** Default config should include the parameters needed by canvas.getContext(). */
const defaultConfig = {
    antialias: false,
    transparent: true,
}

export type CanvasPlotConfig = typeof defaultConfig

export default class CanvasPlot implements BiosignalPlot {
    protected _canvas: HTMLCanvasElement
    protected _context: CanvasRenderingContext2D | null = null
    protected _params: BiosignalPlotConfig | null = null
    protected _width: number | string = 0
    /**
     * Amount of vertical pixels per signal sensitivity reference unit.
     * @remarks
     * For absolutely scaled values, we also need to save this as
     * an absolute value, in case the plot height changes.
     */
    protected _pxPerSensRefUnit = 0
    protected _traces = [] as BiosignalTrace[]

    constructor (config?: BiosignalPlotConfig) {
        // Create a canvas in the container
        this._canvas = document.createElement('canvas')
        this._createContext(config)
    }

    get configParams () {
        return this._params
    }
    get heightInSensRefUnits () {
        return this._canvas.height/this._pxPerSensRefUnit
    }
    set heightInSensRefUnits (value: number) {
        if (value <= 0) {
            Log.error(
                `Plot height in sensitivity reference units must be greater than zero, ${value} was given.`,
                SCOPE)
            return
        }
        this._pxPerSensRefUnit = this._canvas.height/value
    }
    get pxPerSensRefUnit () {
        return this._pxPerSensRefUnit
    }
    set pxPerSensRefUnit (value: number) {
        if (value <= 0) {
            Log.error(
                `Pixels per sensitivity reference unit must be greater than zero, ${value} was given.`,
                SCOPE)
            return
        }
        this._pxPerSensRefUnit = value
    }
    get traces () {
        return this._traces
    }
    get width () {
        return this._canvas.offsetWidth
    }
    protected get widthToStyle () {
        return typeof this._width === 'number' ? `${this._width}px` : this._width
    }

    protected _createContext (config?: BiosignalPlotConfig) {
        // Destroy possible pre-existing context.
        if (this._context) {
            this._context = null
            this._canvas.parentElement?.removeChild(this._canvas)
            this._canvas = document.createElement('canvas')
        }
        // Config override.
        config = Object.assign({}, defaultConfig, config)
        // Save configuration parameters.
        this._params = { ...config }
        // Create a new WebGL context.
        this._context = this._canvas.getContext('2d', config) as CanvasRenderingContext2D
        Log.debug(`New WebGL context created.`, SCOPE)
        // Initialize the canvas.
        this._context.clearRect(0, 0, this._canvas.offsetWidth, this._canvas.offsetHeight)
    }

    protected _updateLines () {
        if (!this._context) {
            Log.error("Could not update traces, the canvas was not initialized!", SCOPE)
            return
        }
        for (const line of this._traces) {
            if (!line.render) {
                continue
            }
            //const ampScale = 2/(this.heightInSensRefUnits*line.sensitivity)
        }
    }

    protected _updateViewport () {
        this._canvas.width = this._canvas.offsetWidth
        this._canvas.height = this._canvas.offsetHeight
    }

    addChannel (line: BiosignalTrace) {
        if (!this._context) {
            Log.error("Could not add a channel, the WebGL canvas was not initialized!", SCOPE)
            return
        }
        this._traces.push(line)
    }

    addTo (container: HTMLDivElement) {
        // Make sure the plot does not extend beyond the container
        container.style.position = 'relative'
        container.style.overflow = 'hidden'
        // Remove possible child elements of the container
        while (container.lastChild) {
            container.removeChild(container.lastChild)
        }
        container.appendChild(this._canvas)
        // Use container width if none is set
        if (!this._width) {
            this._width = container.offsetWidth
        }
        this._canvas.style.position = 'absolute'
        this._canvas.style.top = '0'
        this._canvas.style.left = '0'
        this._canvas.style.height = '100%'
        // Use constant width to avoid the need to recreate lines when window
        // is resized horizontally.
        this._canvas.style.width = this.widthToStyle
        this._canvas.style.pointerEvents = 'none'
        this._updateViewport()
    }

    clearAll () {
        this._traces = []
        this.clearCanvas()
    }

    clearCanvas () {
        if (!this._context) {
            Log.error("Could not clear the plot, the WebGL canvas was not initialized!", SCOPE)
            return
        }
        this._context.clearRect(0, 0, this._canvas.offsetWidth, this._canvas.offsetHeight)
    }

    recreate (config: BiosignalPlotConfig) {
        this._createContext(config)
    }

    resetViewport () {
        this._updateViewport()
    }

    resetWidth (width?: number | string) {
        // Right now this is just the parent elemnt width, but there will probably
        // be need for more sophisticated calculations down the road.
        this._width = width || this._canvas.parentElement?.offsetWidth || 0
        this._canvas.style.width = this.widthToStyle
        this._updateViewport()
    }

    update () {
        if (!this._context) {
            Log.error("Could not update plot, the canvas was not initialized!", SCOPE)
            return
        }
        this._updateLines()
    }
}
