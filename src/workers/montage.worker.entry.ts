/**
 * Worker-thread entry point for the montage worker. Imported only through Vite's `?worker&inline`
 * suffix, which is what makes the module body run on a thread of its own.
 *
 * The handlers live in {@link MontageWorker}, in a module with no side effects, because
 * {@link MontageWorkerSubstitute} runs the same class on the main thread. Instantiating the worker
 * and binding `onmessage` here keeps that import from assigning the application's own
 * `window.onmessage`.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { WorkerMessage } from '#types/service'
import { MontageWorker } from './montage.worker'

const MONTAGE = new MontageWorker()

onmessage = async (message: WorkerMessage) => {
    MONTAGE.handleMessage(message)
}
