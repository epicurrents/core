import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inlineWorker, toPlainData } from '../../src/util/worker'

/**
 * Minimal stand-in for a host framework's reactive wrapper: a `Proxy` whose `toString` tag still
 * reports the underlying type (as Vue's reactive proxies do) but which the structured clone
 * algorithm rejects. We can't run `postMessage` under jsdom, so the tests assert the property that
 * matters instead — the returned value is a fresh plain object/array, not the proxy.
 */
const reactiveLike = <T extends object>(target: T): T => new Proxy(target, {})

describe('toPlainData', () => {
    it('returns primitives unchanged', () => {
        expect(toPlainData(5)).toBe(5)
        expect(toPlainData('x')).toBe('x')
        expect(toPlainData(null)).toBe(null)
        expect(toPlainData(undefined)).toBe(undefined)
        expect(toPlainData(true)).toBe(true)
    })

    it('rebuilds a proxied array into a fresh plain array with equal contents', () => {
        const proxied = reactiveLike([1, 2, 3])
        const plain = toPlainData(proxied) as number[]
        expect(plain).not.toBe(proxied)
        expect(Array.isArray(plain)).toBe(true)
        expect(plain).toEqual([1, 2, 3])
    })

    it('strips proxies nested inside plain structures', () => {
        const input = {
            rearrange: [
                { id: 'a', range: reactiveLike([0, 10]) },
                { id: 'b', range: reactiveLike([10, 20]) },
            ],
            release: reactiveLike([reactiveLike([0, 10])]),
        }
        const plain = toPlainData(input) as typeof input
        expect(plain).toEqual({
            rearrange: [
                { id: 'a', range: [0, 10] },
                { id: 'b', range: [10, 20] },
            ],
            release: [[0, 10]],
        })
        // The nested range arrays are rebuilt, not the original proxies.
        expect(plain.rearrange[0].range).not.toBe(input.rearrange[0].range)
    })

    it('returns typed arrays by reference so transferables are not copied', () => {
        const view = new Float32Array([1, 2, 3])
        const out = toPlainData({ signal: view }) as { signal: Float32Array }
        expect(out.signal).toBe(view)
    })

    it('returns ArrayBuffer and SharedArrayBuffer by reference', () => {
        const ab = new ArrayBuffer(8)
        const sab = new SharedArrayBuffer(8)
        const out = toPlainData({ ab, sab }) as { ab: ArrayBuffer, sab: SharedArrayBuffer }
        expect(out.ab).toBe(ab)
        expect(out.sab).toBe(sab)
    })

    it('rebuilds Map and Set contents', () => {
        const map = new Map<string, unknown>([['range', reactiveLike([0, 5])]])
        const set = new Set<unknown>([reactiveLike([1, 2])])
        const outMap = toPlainData(map) as Map<string, number[]>
        const outSet = toPlainData(set) as Set<number[]>
        expect(outMap.get('range')).toEqual([0, 5])
        expect([...outSet][0]).toEqual([1, 2])
    })

    it('resolves cyclic references without infinite recursion', () => {
        const a = { name: 'a' } as Record<string, unknown>
        const b = { name: 'b', a } as Record<string, unknown>
        a.b = b
        const out = toPlainData(a) as Record<string, unknown>
        expect(out.name).toBe('a')
        expect((out.b as Record<string, unknown>).name).toBe('b')
        // The cycle is preserved as a cycle (same rebuilt node), not duplicated forever.
        expect(((out.b as Record<string, unknown>).a)).toBe(out)
    })
})

/**
 * jsdom implements neither `URL.createObjectURL` nor `Worker`, so both are stubbed. The stub counts
 * object-URL creations, which is the property these tests are about: an object URL lives for the
 * document's lifetime and nothing revokes these, so creating more than one per distinct worker
 * source is a leak.
 *
 * The cache the tests exercise is module-level and outlives each test, so every test below uses a
 * source string no other test uses. Sharing one would make the creation counts order-dependent.
 */
class StubWorker {
    constructor (public url: string, public options?: WorkerOptions) {}
}

describe('inlineWorker', () => {
    let createObjectURL: ReturnType<typeof vi.fn>
    const originalCreateObjectURL = URL.createObjectURL

    beforeEach(() => {
        let issued = 0
        createObjectURL = vi.fn(() => `blob:stub/${issued++}`)
        URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
        vi.stubGlobal('Worker', StubWorker)
    })

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectURL
        vi.unstubAllGlobals()
    })

    it('constructs the worker from the object URL it returns', () => {
        const { create, url } = inlineWorker('Stub', 'self.onmessage = () => {}')
        const worker = create() as unknown as StubWorker
        expect(worker.url).toBe(url)
    })

    it('creates one object URL per distinct source, however many times it is called', () => {
        const source = 'self.onmessage = () => { postMessage(1) }'
        const first = inlineWorker('Stub', source)
        const second = inlineWorker('Stub', source)
        first.create()
        second.create()
        second.create()
        expect(createObjectURL).toHaveBeenCalledTimes(1)
        expect(second.url).toBe(first.url)
    })

    it('keeps separate object URLs for separate sources', () => {
        const first = inlineWorker('StubA', 'self.onmessage = () => { postMessage("a") }')
        const second = inlineWorker('StubB', 'self.onmessage = () => { postMessage("b") }')
        expect(first.url).not.toBe(second.url)
        expect(createObjectURL).toHaveBeenCalledTimes(2)
    })

    it('passes the requested worker type through to the constructor', () => {
        const source = 'export default null'
        const classic = inlineWorker('Stub', source).create() as unknown as StubWorker
        const module = inlineWorker('Stub', source, 'module').create() as unknown as StubWorker
        expect(classic.options).toEqual({ type: 'classic' })
        expect(module.options).toEqual({ type: 'module' })
    })
})
