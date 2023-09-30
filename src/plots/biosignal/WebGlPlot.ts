/**
 * WebGL plot for high-density and quicly refreshing signals.
 * This concept is (heavily) inspired by:
 * - WebGL-Plot (MIT) by Danial Chitnis (https://github.com/danchitnis/webgl-plot)
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalPlot,
    type WebGlCompatibleColor,
    type WebGlPlotConfig,
    type WebGlTrace,
} from "#types/plot"
import { Log } from 'scoped-ts-log'
import PlotColor from "./PlotColor"

const SCOPE = "WebGlPlot"

/** Default config should include the parameters needed by canvas.getContext(). */
const defaultConfig = {
    antialias: false,
    desynchronized: false,
    powerPerformance: 'high-performance',
    preserveDrawingBuffer: false,
    transparent: true,
} as WebGlPlotConfig

export default class WebGlPlot implements BiosignalPlot {
    protected _background: WebGlCompatibleColor
    protected _canvas: HTMLCanvasElement
    protected _context: WebGLRenderingContext | null = null
    protected _params: WebGlPlotConfig | null = null
    protected _program: WebGLProgram | null = null
    protected _width: number | string = 0
    /**
     * Amount of vertical pixels per signal sensitivity reference unit.
     * @remarks
     * For absolutely scaled values, we also need to save this as an absolute value,
     * in case the plot height changes.
     */
    protected _pxPerSensRefUnit = 0
    protected _traces = [] as WebGlTrace[]

    constructor (config?: WebGlPlotConfig) {
        // Save background color.
        this._background = config?.background || new PlotColor(1, 1, 1, 1)
        // Create a canvas in the container.
        this._canvas = document.createElement('canvas')
        // Save screen width to determine maximum possible data required for fullscreen plot.
        // This may also reveal, if the user has dragged the window from one screen to another
        // (but only if the screens have different pixel dimensions).
        Log.debug(`New WebGL plot initiated.`, SCOPE)
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

    protected _createContext (config?: WebGlPlotConfig) {
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
        this._context = this._canvas.getContext('webgl', config) as WebGLRenderingContext
        Log.debug(`New WebGL context created.`, SCOPE)
        // Initialize the canvas.
        this._context.clear(this._context.COLOR_BUFFER_BIT)
        // We will be using a line drawing program.
        this._initProgram()
        // TODO: Default blending makes black traces lighter.
        //       Check if there is a mode similar to CSS multiply or darken
        this._context.enable(this._context.BLEND)
        this._context.blendFunc(this._context.SRC_COLOR, this._context.DST_COLOR)
    }

    /**
     * Initialize the line drawing program.
     * @returns void
     */
    protected _initProgram () {
        if (!this._context) {
            Log.error("Could not create program, the WebGL canvas was not initialized!", SCOPE)
            return
        }
        const vertexCode = `
            attribute vec2 coordinates;
            uniform mat2 uScale;
            uniform vec2 uOffset;
            void main (void) {
                float x = coordinates.x;
                float y = coordinates.y;
                vec2 line = vec2(x, y);
                gl_Position = vec4(uScale*line + uOffset, 0.0, 1.0);
            }`
        const fragmentCode = `
            precision mediump float;
            uniform highp vec4 uColor;
            void main(void) {
                gl_FragColor =  uColor;
            }`
        // Create a shader for the plot.
        const vShader = this._context.createShader(this._context.VERTEX_SHADER) as WebGLShader
        this._context.shaderSource(vShader, vertexCode)
        this._context.compileShader(vShader)
        const fShader = this._context.createShader(this._context.FRAGMENT_SHADER) as WebGLShader
        this._context.shaderSource(fShader, fragmentCode)
        this._context.compileShader(fShader)
        // Create the program and attach shaders.
        this._program = this._context.createProgram() as WebGLProgram
        this._context.attachShader(this._program, vShader)
        this._context.attachShader(this._program, fShader)
        this._context.linkProgram(this._program)
        this._context.useProgram(this._program)
    }

    protected _updateLines () {
        if (!this._context) {
            Log.error("Could not update traces, the WebGL canvas was not initialized!", SCOPE)
            return
        }
        if (!this._program) {
            Log.error("Could not update traces, the WebGL program was not initialized!", SCOPE)
            return
        }
        this._updateViewport()
        for (const line of this._traces) {
            if (!line.render) {
                continue
            }
            // Set up matrix.
            const uScale = this._context.getUniformLocation(this._program, 'uScale')
            // WebGL native canvas scale is from -1 to 1 = 2.
            const ampScale = 2/(this.heightInSensRefUnits*line.sensitivity/line.amplification)
            this._context.uniformMatrix2fv(
                uScale,
                false,
                [1,0, 0,ampScale*line.polarity]
            )
            // Set up line offset.
            const uOffset = this._context.getUniformLocation(this._program, 'uOffset')
            this._context.uniform2fv(
                uOffset,
                // TODO: X-offset could be used to create different colored line segments?
                new Float32Array([0, line.offset*2 - 1])
            )
            // Set up color
            const uColor = this._context.getUniformLocation(this._program, "uColor")
            this._context.uniform4fv(uColor, line.color.array)
            // Clear the background.
            //this._context.clear(this._context.COLOR_BUFFER_BIT)
            //this._context.clearColor(...this._background.array)
            // Create the buffer and draw traces.
            this._context.bufferData(this._context.ARRAY_BUFFER, line.xy, this._context.STREAM_DRAW)
            this._context.drawArrays(this._context.LINE_STRIP, 0, line.length)
        }
    }

    protected _updateViewport () {
        this._canvas.width = this._canvas.offsetWidth
        this._canvas.height = this._canvas.offsetHeight
        this.setViewport(0, 0, this._canvas.offsetWidth, this._canvas.offsetHeight)
    }

    addChannel (trace: WebGlTrace) {
        if (!this._context) {
            Log.error("Could not add a channel, the WebGL canvas was not initialized!", SCOPE)
            return
        }
        if (!this._program) {
            Log.error("Could not add a channel, the WebGL program was not initialized!", SCOPE)
            return
        }
        // Initialize the trace buffer.
        trace.buffer = this._context.createBuffer() as WebGLBuffer
        this._context.bindBuffer(this._context.ARRAY_BUFFER, trace.buffer)
        this._context.bufferData(this._context.ARRAY_BUFFER, trace.xy, this._context.STREAM_DRAW)
        trace.coordinates = this._context.getAttribLocation(this._program, 'coordinates')
        this._context.vertexAttribPointer(trace.coordinates, 2, this._context.FLOAT, false, 0, 0)
        this._context.enableVertexAttribArray(trace.coordinates)
        this._traces.push(trace)
    }

    addTo (container: HTMLDivElement) {
        // Make sure the plot does not extend beyond the container.
        container.style.position = 'relative'
        container.style.overflow = 'hidden'
        // Remove possible child elements of the container.
        while (container.lastChild) {
            container.removeChild(container.lastChild)
        }
        container.appendChild(this._canvas)
        // Use container width if none is set.
        if (!this._width) {
            this._width = container.offsetWidth
        }
        this._canvas.style.position = 'absolute'
        this._canvas.style.top = '0'
        this._canvas.style.left = '0'
        this._canvas.style.height = '100%'
        // Use constant width to avoid the need to recreate lines when window is resized horizontally.
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
        this._context.clear(this._context.COLOR_BUFFER_BIT)
    }

    recreate (config: WebGlPlotConfig) {
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

    setViewport (x: number, y: number, width: number, height: number) {
        if (!this._context) {
            Log.error("Could not update viewport, the WebGL canvas was not initialized!", SCOPE)
            return
        }
        this._context.viewport(x, y, width, height)
    }

    update () {
        if (!this._context) {
            Log.error("Could not update plot, the WebGL canvas was not initialized!", SCOPE)
            return
        }
        if (!this._program) {
            Log.error("Could not update plot, the WebGL program was not initialized!", SCOPE)
            return
        }
        this._updateLines()
    }
}
