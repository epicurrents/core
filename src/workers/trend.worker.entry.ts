/**
 * Worker-thread entry point for the dedicated trend worker. Imported through Vite's `?worker&inline`
 * suffix and built as the standalone bundle, which is what makes the module body run on a thread of
 * its own.
 *
 * The handlers live in {@link TrendWorker}, in a module with no side effects, because `dist/`
 * compiles that module as an ordinary import rather than as a thread entry. Instantiating the
 * worker and binding `onmessage` here keeps an importer from acquiring either, and is what lets the
 * package declare itself free of side effects.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { WorkerMessage } from '#types/service'
import { TrendWorker } from './trend.worker'

const WORKER = new TrendWorker()

onmessage = async (message: WorkerMessage) => {
    WORKER.handleMessage(message)
}
