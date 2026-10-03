/**
 * Unit tests for ServiceWorkerSubstitute class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import ServiceWorkerSubstitute from '../../src/assets/service/ServiceWorkerSubstitute'

// Mock dependencies
vi.mock('scoped-event-log', () => ({
    Log: {
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }
}))

describe('ServiceWorkerSubstitute', () => {
    beforeEach(() => {
        (Log.debug as ReturnType<typeof vi.fn>).mockClear()
        ;(Log.warn as ReturnType<typeof vi.fn>).mockClear()
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
            const handler = vi.fn()
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

        it('should answer shutdown instead of refusing it', () => {
            // `GenericService.shutdown` and `unload` both await this commission before tearing
            // anything down, so a refusal — which is what an unregistered action produces — leaves
            // the service holding a worker it has been told not to terminate, and the study cannot
            // be closed at all. Answered here so the substitutes that register no case of their own
            // inherit it.
            const sub = new ServiceWorkerSubstitute()
            const handler = vi.fn()
            sub.onmessage = handler
            sub.postMessage({ action: 'shutdown', rn: 3 } as any)
            expect(Log.warn).not.toHaveBeenCalled()
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        action: 'shutdown',
                        rn: 3,
                        success: true,
                    }),
                }),
            )
        })

        it('should answer shutdown before dropping the listeners that carry the reply', () => {
            // `shutdown` clears the listeners and `onmessage` together, so a reply posted after it
            // reaches nobody — and the commission the service is awaiting never settles, which is
            // the same wedged teardown as refusing outright.
            const sub = new ServiceWorkerSubstitute()
            const listener = vi.fn()
            sub.addEventListener('message', listener as any)
            sub.postMessage({ action: 'shutdown', rn: 4 } as any)
            expect(listener).toHaveBeenCalledTimes(1)
            // The teardown still happened, so nothing is left subscribed afterwards.
            sub.returnMessage({ action: 'later' } as any)
            expect(listener).toHaveBeenCalledTimes(1)
        })

        it('should answer update-settings without calling it unimplemented', () => {
            // A service relays a settings snapshot to its worker on every change, and a substitute
            // is a worker as far as the service is concerned. Eight substitutes in the family
            // implement no case for it, so without the base answering here every settings change
            // would produce a warning and a failed commission from each of them.
            const sub = new ServiceWorkerSubstitute()
            const handler = vi.fn()
            sub.onmessage = handler
            sub.postMessage({ action: 'update-settings', settings: { app: {}, modules: {} } } as any)
            expect(Log.warn).not.toHaveBeenCalled()
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        action: 'update-settings',
                        success: true,
                    }),
                }),
            )
        })
    })

    describe('returnMessage', () => {
        it('should call registered message listeners', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = vi.fn()
            sub.addEventListener('message', listener as any)
            sub.returnMessage({ action: 'test', success: true } as any)
            expect(listener).toHaveBeenCalledWith({
                data: { action: 'test', success: true },
            })
        })

        it('should call onmessage handler', () => {
            const sub = new ServiceWorkerSubstitute()
            const handler = vi.fn()
            sub.onmessage = handler
            sub.returnMessage({ action: 'test' } as any)
            expect(handler).toHaveBeenCalledWith({
                data: { action: 'test' },
            })
        })

        it('should call both listeners and onmessage', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = vi.fn()
            const handler = vi.fn()
            sub.addEventListener('message', listener as any)
            sub.onmessage = handler
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).toHaveBeenCalled()
            expect(handler).toHaveBeenCalled()
        })
    })

    describe('returnFailure', () => {
        it('should report the cause under the same key a real worker uses', () => {
            // `BaseWorker._failure` sends it as `error`; sent as anything else, the services that
            // read `data.error` — most of them — report an empty cause on this path only.
            const sub = new ServiceWorkerSubstitute()
            const handler = vi.fn()
            sub.onmessage = handler
            sub.returnFailure({ action: 'fail', rn: 7 } as any, 'Something went wrong')
            expect(handler).toHaveBeenCalledWith({
                data: {
                    action: 'fail',
                    rn: 7,
                    success: false,
                    error: 'Something went wrong',
                },
            })
        })

        it('should not echo the commission back in its reply', () => {
            // Spreading the inbound message returned the whole request: a `run` reply carried its
            // `samples`, a `setup-cache` reply its cache. A consumer reading a field off the
            // response could then be handed the request's value for it.
            const sub = new ServiceWorkerSubstitute()
            const handler = vi.fn()
            sub.onmessage = handler
            sub.returnFailure({ action: 'run', rn: 8, samples: [1, 2, 3] } as any, 'nope')
            const reply = handler.mock.calls[0][0].data
            expect(reply.samples).toBeUndefined()
            expect(Object.keys(reply).sort()).toEqual(['action', 'error', 'rn', 'success'])
        })
    })

    describe('returnSuccess', () => {
        it('should return message with success true and results', () => {
            const sub = new ServiceWorkerSubstitute()
            const handler = vi.fn()
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
            const listener = vi.fn()
            sub.addEventListener('message', listener as any)
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).toHaveBeenCalled()
        })

        it('should not add duplicate listener', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = vi.fn()
            sub.addEventListener('message', listener as any)
            sub.addEventListener('message', listener as any)
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).toHaveBeenCalledTimes(1)
        })
    })

    describe('removeEventListener', () => {
        it('should remove a listener', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = vi.fn()
            sub.addEventListener('message', listener as any)
            sub.removeEventListener('message', listener as any)
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).not.toHaveBeenCalled()
        })

        it('should do nothing if listener not found', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = vi.fn()
            // Should not throw
            sub.removeEventListener('message', listener as any)
        })
    })

    describe('shutdown / terminate', () => {
        it('should clear all listeners and handlers on shutdown', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = vi.fn()
            sub.addEventListener('message', listener as any)
            sub.onmessage = vi.fn()
            sub.onerror = vi.fn() as any
            sub.onmessageerror = vi.fn() as any
            sub.shutdown()
            expect(sub.onmessage).toBeNull()
            expect(sub.onerror).toBeNull()
            expect(sub.onmessageerror).toBeNull()
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).not.toHaveBeenCalled()
        })

        it('should call shutdown when terminate is called', () => {
            const sub = new ServiceWorkerSubstitute()
            const listener = vi.fn()
            sub.addEventListener('message', listener as any)
            sub.terminate()
            sub.returnMessage({ action: 'test' } as any)
            expect(listener).not.toHaveBeenCalled()
        })
    })

    describe('_validate', () => {
        class ValidatingSubstitute extends ServiceWorkerSubstitute {
            validate (msgData: any, requiredProps: any, requiredSetup = true) {
                return this._validate(msgData, requiredProps, requiredSetup)
            }
        }

        afterEach(() => {
            vi.unstubAllGlobals()
        })

        it('should return the commission data when every required property is present', () => {
            const sub = new ValidatingSubstitute()
            const msgData = { action: 'do-thing', rn: 1, url: 'file.edf' }
            expect(sub.validate(msgData, { url: 'String' })).toBe(msgData)
        })

        it('should deliver the refusal through its own transport, not the global postMessage', () => {
            // This is the whole reason the method exists. `validateCommissionProps` defaults its
            // reply destination to the global `postMessage`, which is the right destination on a
            // worker thread and no destination at all on the main one: the refusal goes to the
            // window and the commission it was answering is never settled.
            const posted = vi.fn()
            vi.stubGlobal('postMessage', posted)
            const sub = new ValidatingSubstitute()
            const handler = vi.fn()
            sub.onmessage = handler
            expect(sub.validate({ action: 'do-thing', rn: 2, url: 42 }, { url: 'String' })).toBe(false)
            expect(posted).not.toHaveBeenCalled()
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ action: 'do-thing', rn: 2, success: false }),
                }),
            )
        })

        it('should answer the commission exactly once', () => {
            // The refusal is the answer, so a handler acting on `false` must not report the failure
            // again: the service releases the commission on the first reply and has nothing left to
            // match a second one to.
            const sub = new ValidatingSubstitute()
            const handler = vi.fn()
            sub.onmessage = handler
            sub.validate({ action: 'do-thing', rn: 3 }, { url: 'String' })
            expect(handler).toHaveBeenCalledTimes(1)
        })

        it('should refuse a commission that arrives before its required setup', () => {
            const sub = new ValidatingSubstitute()
            const handler = vi.fn()
            sub.onmessage = handler
            expect(sub.validate({ action: 'do-thing', rn: 4 }, {}, false)).toBe(false)
            expect(handler.mock.calls[0][0].data.success).toBe(false)
        })
    })
})
