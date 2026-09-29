/**
 * Tests for the memory manager's teardown.
 *
 * The manager's shared buffer is the one every registered service's mutex views are cut from, so
 * shutting the manager down is an ordering problem before it is anything else: the services have to
 * let go of the buffer, and be awaited doing so, before the worker that holds it is told to drop it.
 * These tests pin that order, the failure tolerance that keeps one stuck service from leaving the
 * worker running, and the termination that closes the leak.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetService, ManagedService } from '#types/service'
import ServiceMemoryManager from '#assets/service/ServiceMemoryManager'

vi.mock('scoped-event-log', () => ({
    Log: {
        debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(), registerWorker: vi.fn(),
    },
}))

/** Everything that happened, in order: each service unload and each commission the worker got. */
let order: string[] = []
let originalWindow: Window & typeof globalThis

/** A worker stand-in that answers every commission with success on a later tick. */
const buildWorker = () => {
    let onMessage: ((event: { data: Record<string, unknown> }) => void) | null = null
    return {
        terminate: vi.fn(),
        addEventListener: (_type: string, listener: (event: { data: Record<string, unknown> }) => void) => {
            onMessage = listener
        },
        postMessage: (msg: Record<string, unknown>) => {
            order.push(`commission:${msg.action as string}`)
            queueMicrotask(() => onMessage?.({ data: { ...msg, success: true } }))
        },
    }
}

/** A managed entry whose service records its unload and resolves when `gate` does. */
const buildManaged = (id: string, gate?: Promise<void>): ManagedService => ({
    bufferRange: [1, 11],
    dependencies: [],
    lastUsed: 0,
    service: {
        id,
        unload: vi.fn(async (releaseFromManager?: boolean) => {
            order.push(`unload:${id}:${String(releaseFromManager)}`)
            await gate
        }),
    } as unknown as AssetService,
})

/** The worker reaches the manager through the registered override on the window stub. */
const buildManager = () => new ServiceMemoryManager(1024)

describe('ServiceMemoryManager shutdown', () => {
    let worker: ReturnType<typeof buildWorker>
    beforeEach(() => {
        order = []
        worker = buildWorker()
        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: {
                __EPICURRENTS__: {
                    APP: null,
                    EVENT_BUS: {
                        addScopedEventListener: vi.fn(() => () => {}),
                        dispatchScopedEvent: vi.fn(),
                    },
                    RUNTIME: {
                        SETTINGS: { removeAllPropertyUpdateHandlersFor: vi.fn() },
                        // The manager prefers a registered override over its own inline worker,
                        // which is the seam that keeps a real thread out of the test.
                        WORKERS: new Map([['memory-manager', () => worker]]),
                    },
                },
            } as unknown as Window & typeof globalThis,
            writable: true,
        })
    })
    afterEach(() => {
        global.window = originalWindow
    })

    it('unloads every managed service before commissioning the worker', async () => {
        const manager = buildManager()
        const managed = (manager as unknown as { _managed: Map<string, ManagedService> })._managed
        managed.set('a', buildManaged('a'))
        managed.set('b', buildManaged('b'))
        await manager.shutdown()
        // Both unloads precede the shutdown commission: a service still holding views into the
        // buffer when the worker drops it would be reading memory with no owner.
        expect(order.indexOf('unload:a:false')).toBeLessThan(order.indexOf('commission:shutdown'))
        expect(order.indexOf('unload:b:false')).toBeLessThan(order.indexOf('commission:shutdown'))
    })
    it('unloads without releasing from the manager', async () => {
        // `unload(true)` calls back into `release` here, which commissions a rearrange of a buffer
        // that is about to be dropped.
        const manager = buildManager()
        const entry = buildManaged('a')
        ;(manager as unknown as { _managed: Map<string, ManagedService> })._managed.set('a', entry)
        await manager.shutdown()
        expect(entry.service.unload).toHaveBeenCalledWith(false)
        expect(order).not.toContain('commission:release-and-rearrange')
    })
    it('waits for a slow unload before commissioning the worker', async () => {
        let release = () => {}
        const gate = new Promise<void>(resolve => {
            release = resolve
        })
        const manager = buildManager()
        ;(manager as unknown as { _managed: Map<string, ManagedService> })._managed
            .set('slow', buildManaged('slow', gate))
        const shutdown = manager.shutdown()
        await Promise.resolve()
        await Promise.resolve()
        // The unload has started and has not finished, so the worker must not have been told yet.
        expect(order).toContain('unload:slow:false')
        expect(order).not.toContain('commission:shutdown')
        release()
        await shutdown
        expect(order).toContain('commission:shutdown')
    })
    it('carries on when a service fails to unload', async () => {
        const manager = buildManager()
        const managed = (manager as unknown as { _managed: Map<string, ManagedService> })._managed
        const broken = buildManaged('broken')
        broken.service.unload = vi.fn(async () => {
            order.push('unload:broken')
            throw new Error('stuck')
        })
        managed.set('broken', broken)
        managed.set('fine', buildManaged('fine'))
        await manager.shutdown()
        // One stuck service must not be able to leave the worker thread running.
        expect(order).toContain('unload:fine:false')
        expect(order).toContain('commission:shutdown')
        expect(worker.terminate).toHaveBeenCalled()
    })
    it('terminates the worker and empties the managed set', async () => {
        const manager = buildManager()
        ;(manager as unknown as { _managed: Map<string, ManagedService> })._managed.set('a', buildManaged('a'))
        await manager.shutdown()
        expect(worker.terminate).toHaveBeenCalledTimes(1)
        expect((manager as unknown as { _managed: Map<string, ManagedService> })._managed.size).toBe(0)
        expect(manager.services).toStrictEqual([])
    })
    it('is a cheap no-op when called a second time', async () => {
        const manager = buildManager()
        await manager.shutdown()
        order = []
        await manager.shutdown()
        // The worker reference is gone, so the commission resolves falsy without a post.
        expect(order).not.toContain('commission:shutdown')
        expect(worker.terminate).toHaveBeenCalledTimes(1)
    })
})
