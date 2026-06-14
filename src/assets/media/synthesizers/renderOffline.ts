/**
 * Offline audio render helper.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Render an audio graph to an AudioBuffer with an `OfflineAudioContext`, faster than real time and off the UI thread.
 * A `buildChain` callback may insert processing nodes between the source and the destination; the node it returns is
 * connected to the destination. With no callback the source is rendered verbatim.
 * @param source - Source buffer to render. The output buffer matches its channel count, length, and sample rate.
 * @param buildChain - Optional callback that receives the render context and the source node and returns the tail node
 *                     to connect to the destination.
 * @returns Promise resolving with the rendered buffer.
 */
export async function renderOffline (
    source: AudioBuffer,
    buildChain?: (context: OfflineAudioContext, input: AudioNode) => AudioNode
): Promise<AudioBuffer> {
    const context = new OfflineAudioContext(source.numberOfChannels, source.length, source.sampleRate)
    const node = context.createBufferSource()
    node.buffer = source
    const tail = buildChain ? buildChain(context, node) : node
    tail.connect(context.destination)
    node.start()
    return context.startRendering()
}
