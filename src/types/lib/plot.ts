/**
 * Plot and trace types.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalChannel } from "./biosignal"

export interface BiosignalPlot {
    /**
     * Pixels per signal sensitivity reference unit.
     *
     * For example, if signal sensitivity is measured in uV/cm, this value
     * tells how pixels there are in one centimeter on the screen. Alternatively,
     * if signal height is relative to plot height, this value tells how pixels
     * there are in one unit of reference (e.g. plot height or division height).
     */
    pxPerSensRefUnit: number
    /** List of traces assigned to this plot. */
    traces: BiosignalTrace[]
    /**
     * Represents the maximum possible component width on current screen.
     */
    width: number
    /**
     * Add a new channel to this plot.
     * @param trace - Trace to use for drawing the channel signal.
     */
    addChannel (trace: WebGlTrace): void
    /**
     * Add the plot canvas to the given div element.
     * @param container - div element parent for the canvas
     */
    addTo (container: HTMLDivElement): void
     /**
     * Remove all traces from the plot.
     */
    clearAll (): void
    /**
     * Clear the canvas of any graphical elements.
     */
    clearCanvas (): void
    /**
     * Recreate the canvas context with new parameters.
     * @param config - New config (optional).
     */
    recreate (config: BiosignalPlotConfig): void
    /**
     * Reset the plot viewport after changing canvas dimensions.
     */
    resetViewport (): void
    /**
     * Reset component width to the given value or current parent element width (default).
     * @param width - New width for the component; number is assumed in pixels, string to include the unit.
     */
    resetWidth (width?: number | string): void
    /**
     * Update the plot to reflect altered trace data.
     */
    update (): void
}
/**
 * Configuration properties for biosignal plots.
 */
export type BiosignalPlotConfig = {
    /** Applied antialising to the plot traces? */
    antialias?: boolean
    /** Color of the plot background (defaults to white). */
    background?: WebGlCompatibleColor
    /** Use low-latency, desynchronized rendering? */
    desynchronized?: boolean
    /**
     * Plot container height in sensitivity reference units.
     *
     * For example, if signal sensitivity is measured in uV/cm, this value should
     * tell the plot container height in centimeters. Alternatively, if signal
     * height is relative to plot height, this value should tell how many
     * vertical divisions there are on the plot.
     */
    heightInSensitivityReferenceUnits?: number
    /**
     * Pixels per signal sensitivity reference unit.
     *
     * For example, if signal sensitivity is measured in uV/cm, this value should
     * tell how pixels there are in one centimeter on the screen. Alternatively,
     * if signal height is relative to plot height, this value should be the
     * container height divided by amplitude divisions.
     */
    pxPerSensitivityReferenceUnit?: number
}
/**
 * Plot trace for biosignals.
 */
export type BiosignalTrace = {
    /** Amplification to apply (as a multiplier) to the signal amplitude. */
    amplification: number
    /** Trace color. TODO: Implement traces with multiple color segments. */
    color: WebGlCompatibleColor
    /** TODO: What is this value supposed to be used for? */
    coordinates: number
    /** Signal length, i.e. number of datapoints in the trace. */
    length: number
    /** Offset from the bottom of the trace (zero line). */
    offset: number
    /** Display polarity of this channel. */
    polarity: -1 | 1
    /** Should this line be rendered. */
    render: boolean
    /** Sampling rate of the signal. */
    samplingRate: number,
    /** Sensitivity of the individual line. */
    sensitivity: number
    /**
     * Get the signal data set to this trace as Float32Array.
     */
    getData(): Float32Array
    /**
     * Initialize the trace data array with the given parameters.
     * @param length - Number of signal data points (default is preset data length).
     */
    initData (length?: number): void
    /**
     * Set the data for this trace.
     * @param data - Signa data to set; if single number, all datapoints will be set to given value.
     * @param downsampleFactor - Only apply every *N*th data point (default is initialized downsampleFactor).
     */
    setData (data: Float32Array | number, downsampleFactor?: number): void
    /**
     * Set sensitivity to use when drawing the signal trace.
     * @param value - Sensitivity value (must be a positive and greater than zero).
     */
    setSensitivity (value: number): void
}
/**
 * Signal part selected for closer inspection.
 */
export type PlotTraceSelection = {
    amplitude: number
    channel: BiosignalChannel
    crop: number[]
    dragDimensions: number[]
    frequencyBandProperties: {
        name: string
        absolute: number
        average: number
        peakFrequency: number
        relativeAbsolute: number
        relativeAverage: number
        topAbsolute: boolean
        topAverage: boolean
        topFrequency: boolean
    }[]
    getDragElement: () => HTMLDivElement
    markers: SignalPoI[]
    maxValue: number
    minValue: number
    range: number[]
    signal: Float32Array | null
}
/**
 * A point of interest on the signal.
 */
export type SignalPoI = {
    color: string
    id: number,
    index: number
    value: number
}
/**
 * Color properties required for WebGL line drawing.
 */
export type WebGlCompatibleColor = {
    /** Alpha fraction of the color. */
    a: number
    /** Color as an array of [r, g, b, a]. */
    array: [number, number, number, number]
    /** Blue fraction of the color. */
    b: number
    /** Green fraction of the color. */
    g: number
    /** Red fraction of the color. */
    r: number
}
/**
 * Biosignal trace with additional WebGL properties.
 */
export type WebGlTrace = BiosignalTrace & {
    buffer: WebGLBuffer
    /** An array buffer holding the line x,y -coordinates. */
    xy: ArrayBuffer
}

/**
 * BiosignalPlotConfig extended with WebGL specific options.
 */
export type WebGlPlotConfig = BiosignalPlotConfig & {
    powerPerformance?: "default" | "high-performance" | "low-power"
}

