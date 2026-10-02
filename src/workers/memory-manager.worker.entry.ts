/**
 * Worker-thread entry point for the memory manager worker. Imported through Vite's `?worker&inline`
 * suffix and built as the standalone bundle, which is what makes the module body run on a thread of
 * its own.
 *
 * The handlers live in {@link MemoryManagerWorker}, in a module with no side effects, because the
 * package barrel exports that class and `dist/` compiles it as an ordinary import. Instantiating
 * the worker and binding `onmessage` here keeps an importer from acquiring either, and is what lets
 * the package declare itself free of side effects.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { WorkerMessage } from '#types/service'
import { MemoryManagerWorker } from './memory-manager.worker'

const MEMORY_MANAGER = new MemoryManagerWorker()

onmessage = async (message: WorkerMessage) => {
    MEMORY_MANAGER.handleMessage(message)
}
