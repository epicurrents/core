/**
 * Tests for the resilient network layer: classification, the per-origin circuit breaker, and the
 * resilientFetch wrapper (retry/backoff/timeout/breaker).
 */

import {
    BreakerRegistry,
    CircuitBreaker,
    classifyFetchOutcome,
    NetworkError,
    resilientFetch,
} from '../../src/util/network'

const URL_A = 'https://a.example/data'

describe('classifyFetchOutcome', () => {
    const res = (status: number) => new Response(status === 204 ? null : 'x', { status })

    it('reports an ok response as success with no breaker effect', () => {
        const o = classifyFetchOutcome(res(200))
        expect(o).toMatchObject({ ok: true, retryable: false, breakerTrip: null })
    })
    it.each([401, 403])('classifies %i as sticky auth', (status) => {
        expect(classifyFetchOutcome(res(status))).toMatchObject({
            ok: false, kind: 'auth', retryable: false, breakerTrip: 'auth',
        })
    })
    it.each([404, 410])('classifies %i as gone — per-resource, no breaker trip', (status) => {
        expect(classifyFetchOutcome(res(status))).toMatchObject({
            ok: false, kind: 'gone', retryable: false, breakerTrip: null,
        })
    })
    it.each([429, 502, 503, 504])('classifies %i as retryable transient', (status) => {
        expect(classifyFetchOutcome(res(status))).toMatchObject({
            ok: false, kind: 'transient', retryable: true, breakerTrip: 'unavailable',
        })
    })
    it('classifies 500 as retryable server error', () => {
        expect(classifyFetchOutcome(res(500))).toMatchObject({
            ok: false, kind: 'server', retryable: true, breakerTrip: 'unavailable',
        })
    })
    it.each([400, 416, 422])('classifies %i as non-retryable client error, no trip', (status) => {
        expect(classifyFetchOutcome(res(status))).toMatchObject({
            ok: false, kind: 'client', retryable: false, breakerTrip: null,
        })
    })
    it('classifies a network/CORS TypeError as retryable transient', () => {
        expect(classifyFetchOutcome(new TypeError('Failed to fetch'))).toMatchObject({
            ok: false, kind: 'transient', retryable: true, breakerTrip: 'unavailable',
        })
    })
    it('classifies an AbortError as aborted, no trip', () => {
        expect(classifyFetchOutcome(new DOMException('Aborted', 'AbortError'))).toMatchObject({
            ok: false, kind: 'aborted', retryable: false, breakerTrip: null,
        })
    })
})

describe('CircuitBreaker', () => {
    let time: number
    const now = () => time
    const make = (onTransition?: (s: string) => void) => new CircuitBreaker({
        config: { transientTrip: 2, cooldownInitialMs: 1_000, cooldownMaxMs: 4_000 },
        now,
        onTransition,
    })

    beforeEach(() => { time = 0 })

    it('starts closed and permits requests', () => {
        const b = make()
        expect(b.state).toBe('closed')
        expect(b.canRequest()).toBe(true)
    })

    it('opens sticky auth immediately and refuses until reset', () => {
        const b = make()
        b.onFailure('auth')
        expect(b.state).toBe('open-auth')
        expect(b.canRequest()).toBe(false)
        time += 10_000
        expect(b.canRequest()).toBe(false)
        b.reset()
        expect(b.state).toBe('closed')
        expect(b.canRequest()).toBe(true)
    })

    it('does not trip on gone/client outcomes', () => {
        const b = make()
        b.onFailure(null)
        b.onFailure(null)
        b.onFailure(null)
        expect(b.state).toBe('closed')
    })

    it('trips to open-unavailable after N consecutive transient failures', () => {
        const b = make()
        b.onFailure('unavailable')
        expect(b.state).toBe('closed')
        b.onFailure('unavailable')
        expect(b.state).toBe('open-unavailable')
        expect(b.canRequest()).toBe(false)
    })

    it('half-opens after cooldown and allows exactly one probe', () => {
        const b = make()
        b.onFailure('unavailable')
        b.onFailure('unavailable')
        time += 1_000
        expect(b.canRequest()).toBe(true)          // this reserves the probe
        expect(b.state).toBe('half-open')
        expect(b.canRequest()).toBe(false)         // second concurrent caller is refused
    })

    it('closes on a successful probe', () => {
        const b = make()
        b.onFailure('unavailable')
        b.onFailure('unavailable')
        time += 1_000
        b.canRequest()
        b.onSuccess()
        expect(b.state).toBe('closed')
        expect(b.canRequest()).toBe(true)
    })

    it('re-opens with a doubled, capped cooldown when the probe fails', () => {
        const b = make()
        b.onFailure('unavailable')
        b.onFailure('unavailable')
        time += 1_000
        b.canRequest()                             // half-open
        b.onFailure('unavailable')                 // probe fails
        expect(b.state).toBe('open-unavailable')
        expect(b.canRequest()).toBe(false)         // cooldown now 2000, not yet elapsed
        time += 1_000
        expect(b.canRequest()).toBe(false)         // still within the 2000 ms cooldown
        time += 1_000
        expect(b.canRequest()).toBe(true)          // 2000 ms elapsed → half-open
    })

    it('fires onTransition only on actual state changes', () => {
        const spy = vi.fn()
        const b = make(spy)
        b.onFailure('unavailable')                 // stays closed → no fire
        expect(spy).not.toHaveBeenCalled()
        b.onFailure('unavailable')                 // → open-unavailable
        expect(spy).toHaveBeenCalledWith('open-unavailable')
        b.onFailure('auth')                        // → open-auth
        expect(spy).toHaveBeenLastCalledWith('open-auth')
        expect(spy).toHaveBeenCalledTimes(2)
    })
})

describe('BreakerRegistry', () => {
    it('creates one breaker per origin and memoises it', () => {
        const reg = new BreakerRegistry()
        const a1 = reg.get('https://a.example')
        const a2 = reg.get('https://a.example')
        const b = reg.get('https://b.example')
        expect(a1).toBe(a2)
        expect(a1).not.toBe(b)
    })

    it('forwards transitions with the origin', () => {
        const spy = vi.fn()
        const reg = new BreakerRegistry({ onTransition: spy })
        reg.get('https://a.example').onFailure('auth')
        expect(spy).toHaveBeenCalledWith('https://a.example', 'open-auth')
    })

    it('resets a single origin or all', () => {
        const reg = new BreakerRegistry()
        reg.get('https://a.example').onFailure('auth')
        reg.get('https://b.example').onFailure('auth')
        reg.reset('https://a.example')
        expect(reg.get('https://a.example').state).toBe('closed')
        expect(reg.get('https://b.example').state).toBe('open-auth')
        reg.reset()
        expect(reg.get('https://b.example').state).toBe('closed')
    })
})

describe('resilientFetch', () => {
    let mockFetch: ReturnType<typeof vi.fn>
    const fast = { backoff: { baseMs: 0 } }

    beforeEach(() => {
        mockFetch = vi.fn()
        vi.stubGlobal('fetch', mockFetch)
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns the ok response and closes the breaker', async () => {
        mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))
        const breaker = new CircuitBreaker()
        const res = await resilientFetch(URL_A, {}, { ...fast, breaker })
        expect(res.status).toBe(200)
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(breaker.state).toBe('closed')
    })

    it('retries a transient failure then succeeds', async () => {
        mockFetch
            .mockResolvedValueOnce(new Response('busy', { status: 503 }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }))
        const res = await resilientFetch(URL_A, {}, { ...fast, retries: 2 })
        expect(res.status).toBe(200)
        expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws transient after exhausting the retry budget', async () => {
        mockFetch.mockResolvedValue(new Response('busy', { status: 503 }))
        await expect(resilientFetch(URL_A, {}, { ...fast, retries: 1 }))
            .rejects.toMatchObject({ name: 'NetworkError', kind: 'transient' })
        expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws auth at once without retrying and opens the breaker', async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 401 }))
        const breaker = new CircuitBreaker()
        await expect(resilientFetch(URL_A, {}, { ...fast, retries: 3, breaker }))
            .rejects.toMatchObject({ name: 'NetworkError', kind: 'auth' })
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(breaker.state).toBe('open-auth')
    })

    it('does not retry a client error', async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 400 }))
        await expect(resilientFetch(URL_A, {}, { ...fast, retries: 3 }))
            .rejects.toMatchObject({ kind: 'client', status: 400 })
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('short-circuits when the breaker is open, without calling fetch', async () => {
        const breaker = new CircuitBreaker()
        breaker.onFailure('auth')
        await expect(resilientFetch(URL_A, {}, { ...fast, breaker }))
            .rejects.toMatchObject({ kind: 'auth' })
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('reports a caller abort as aborted and does not retry', async () => {
        mockFetch.mockImplementation((_url: string, init: RequestInit) =>
            init.signal?.aborted
                ? Promise.reject(new DOMException('Aborted', 'AbortError'))
                : Promise.resolve(new Response('ok')))
        const controller = new AbortController()
        controller.abort()
        await expect(resilientFetch(URL_A, {}, { ...fast, retries: 3, signal: controller.signal }))
            .rejects.toMatchObject({ kind: 'aborted' })
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('treats its own timeout as a retryable failure', async () => {
        // A fetch that never resolves until its signal aborts (our deadline).
        mockFetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')))
        }))
        await expect(resilientFetch(URL_A, {}, { ...fast, retries: 1, timeoutMs: 5 }))
            .rejects.toMatchObject({ kind: 'timeout' })
        expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('with the timeout disabled, relies solely on the caller signal (breaker-only mode)', async () => {
        // A fetch that never settles until its signal aborts: with timeoutMs Infinity there is no
        // internal deadline, so only the caller's abort ends it — and retries: 0 means one attempt.
        mockFetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }))
        const controller = new AbortController()
        const pending = resilientFetch(URL_A, {}, {
            ...fast, retries: 0, timeoutMs: Infinity, signal: controller.signal,
        })
        controller.abort()
        await expect(pending).rejects.toMatchObject({ kind: 'aborted' })
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('is thrown as a NetworkError instance', async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 500 }))
        await expect(resilientFetch(URL_A, {}, { ...fast, retries: 0 }))
            .rejects.toBeInstanceOf(NetworkError)
    })

    it('draws the breaker from a registry by origin and short-circuits the second call', async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 401 }))
        const registry = new BreakerRegistry()
        await expect(resilientFetch(URL_A, {}, { ...fast, registry }))
            .rejects.toMatchObject({ kind: 'auth' })
        expect(registry.get('https://a.example').state).toBe('open-auth')
        mockFetch.mockClear()
        await expect(resilientFetch(URL_A, {}, { ...fast, registry }))
            .rejects.toMatchObject({ kind: 'auth' })
        expect(mockFetch).not.toHaveBeenCalled()
    })
})
