/**
 * Offline audio render helpers.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Render an audio graph to an AudioBuffer with an `OfflineAudioContext`, faster than real time and off the UI thread.
 * The `build` callback wires the graph: it creates source / oscillator / processing nodes, connects them to
 * `context.destination`, and starts them.
 * @param numberOfChannels - Channel count of the output buffer.
 * @param length - Output buffer length in samples.
 * @param sampleRate - Output sample rate in Hz.
 * @param build - Callback that wires and starts the graph for the given context.
 * @returns Promise resolving with the rendered buffer.
 */
export async function renderGraph (
    numberOfChannels: number,
    length: number,
    sampleRate: number,
    build: (context: OfflineAudioContext) => void
): Promise<AudioBuffer> {
    const context = new OfflineAudioContext(numberOfChannels, length, sampleRate)
    build(context)
    return context.startRendering()
}

/**
 * Render a single source buffer to an AudioBuffer, optionally inserting a processing chain. A `buildChain` callback
 * may insert nodes between the source and the destination; the node it returns is connected to the destination. With
 * no callback the source is rendered verbatim. The output matches the source's channel count, length, and sample rate.
 * @param source - Source buffer to render.
 * @param buildChain - Optional callback that receives the render context and the source node and returns the tail node
 *                     to connect to the destination.
 * @returns Promise resolving with the rendered buffer.
 */
export async function renderOffline (
    source: AudioBuffer,
    buildChain?: (context: OfflineAudioContext, input: AudioNode) => AudioNode
): Promise<AudioBuffer> {
    return renderGraph(source.numberOfChannels, source.length, source.sampleRate, (context) => {
        const node = context.createBufferSource()
        node.buffer = source
        const tail = buildChain ? buildChain(context, node) : node
        tail.connect(context.destination)
        node.start()
    })
}
