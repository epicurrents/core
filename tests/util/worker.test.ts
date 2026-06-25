import { describe, expect, it } from 'vitest'
import { toPlainData } from '../../src/util/worker'

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
