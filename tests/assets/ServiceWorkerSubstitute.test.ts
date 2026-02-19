/**
 * Unit tests for ServiceWorkerSubstitute class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import ServiceWorkerSubstitute from '../../src/assets/service/ServiceWorkerSubstitute'

// Mock dependencies
jest.mock('scoped-event-log', () => ({
    Log: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }
}))

describe('ServiceWorkerSubstitute', () => {
    beforeEach(() => {
        (Log.debug as jest.Mock).mockClear()
        ;(Log.warn as jest.Mock).mockClear()
    })

    describe('constructor', () => {
        it('should create an instance with default properties', () => {
            const sub = new ServiceWorkerSubstitute()
            expect(sub.onerror).toBeNull()
            expect(sub.onmessage).toBeNull()
            expect(sub.onmessageerror).toBeNull()
        })
    })

    describe('dispatchEvent', () => {
        it('should warn and return false', () => {
            const sub = new ServiceWorkerSubstitute()
            const result = sub.dispatchEvent(new Event('test'))
            expect(result).toBe(false)
            expect(Log.warn).toHaveBeenCalled()
        })
    })

    describe('postMessage', () => {
        it('should return early if message has no action', () => {
            const sub = new ServiceWorkerSubstitute()
            sub.postMessage({} as any)
            expect(Log.warn).not.toHaveBeenCalled()
        })

        it('should return early if message is null', () => {
            const sub = new ServiceWorkerSubstitute()
            sub.postMessage(null as any)
            expect(Log.warn).not.toHaveBeenCalled()
        })

        it('should warn and return failure for unimplemented action', () => {
            const sub = new ServiceWorkerSubstitute()
            const handler = jest.fn()
            sub.onmessage = handler
            sub.postMessage({ action: 'do-something' } as any)
            expect(Log.warn).toHaveBeenCalledWith(
                expect.stringContaining('do-something'),
                expect.any(String),
            )
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        action: 'do-something',
                        success: false,
                    }),
                }),
            )
        })
    })

    describe('returnMessage', () => {
        it('should call registered message listeners', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = jest.fn()
            sub.addEventListener('message', listener as any)
            sub.returnMessage({ action: 'test', success: true } as any)
            expect(listener).toHaveBeenCalledWith({
                data: { action: 'test', success: true },
            })
        })

        it('should call onmessage handler', () => {
            const sub = new ServiceWorkerSubstitute()
            const handler = jest.fn()
            sub.onmessage = handler
            sub.returnMessage({ action: 'test' } as any)
            expect(handler).toHaveBeenCalledWith({
                data: { action: 'test' },
            })
        })

        it('should call both listeners and onmessage', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = jest.fn()
            const handler = jest.fn()
            sub.addEventListener('message', listener as any)
            sub.onmessage = handler
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).toHaveBeenCalled()
            expect(handler).toHaveBeenCalled()
        })
    })

    describe('returnFailure', () => {
        it('should return message with success false and reason', () => {
            const sub = new ServiceWorkerSubstitute()
            const handler = jest.fn()
            sub.onmessage = handler
            sub.returnFailure({ action: 'fail' } as any, 'Something went wrong')
            expect(handler).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: 'fail',
                    success: false,
                    reason: 'Something went wrong',
                }),
            })
        })
    })

    describe('returnSuccess', () => {
        it('should return message with success true and results', () => {
            const sub = new ServiceWorkerSubstitute()
            const handler = jest.fn()
            sub.onmessage = handler
            sub.returnSuccess({ action: 'ok' } as any, { value: 42 })
            expect(handler).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: 'ok',
                    success: true,
                    value: 42,
                }),
            })
        })
    })

    describe('addEventListener', () => {
        it('should add a listener', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = jest.fn()
            sub.addEventListener('message', listener as any)
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).toHaveBeenCalled()
        })

        it('should not add duplicate listener', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = jest.fn()
            sub.addEventListener('message', listener as any)
            sub.addEventListener('message', listener as any)
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).toHaveBeenCalledTimes(1)
        })
    })

    describe('removeEventListener', () => {
        it('should remove a listener', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = jest.fn()
            sub.addEventListener('message', listener as any)
            sub.removeEventListener('message', listener as any)
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).not.toHaveBeenCalled()
        })

        it('should do nothing if listener not found', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = jest.fn()
            // Should not throw
            sub.removeEventListener('message', listener as any)
        })
    })

    describe('shutdown / terminate', () => {
        it('should clear all listeners and handlers on shutdown', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = jest.fn()
            sub.addEventListener('message', listener as any)
            sub.onmessage = jest.fn()
            sub.onerror = jest.fn() as any
            sub.onmessageerror = jest.fn() as any
            sub.shutdown()
            expect(sub.onmessage).toBeNull()
            expect(sub.onerror).toBeNull()
            expect(sub.onmessageerror).toBeNull()
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).not.toHaveBeenCalled()
        })

        it('should call shutdown when terminate is called', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = jest.fn()
            sub.addEventListener('message', listener as any)
            sub.terminate()
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).not.toHaveBeenCalled()
        })
    })
})
