import {
    FLOAT16_EPS,
    FLOAT32_EPS,
    FLOAT64_EPS,
} from '../../src/util/constants'

describe('Machine epsilon constants', () => {
    // Pinned to the decimal expansions rather than to the powers of two the source computes, so a
    // mistyped exponent fails here instead of being confirmed by an assertion that recomputes it.
    // Each value is the one IEEE 754 defines, and a comparison tolerance built on a wrong epsilon
    // is wrong in the quiet direction: it accepts or rejects differences nobody asked it to.
    it('half precision epsilon is 2^-10', () => {
        expect(FLOAT16_EPS).toBe(0.0009765625)
    })
    it('single precision epsilon is 2^-23', () => {
        expect(FLOAT32_EPS).toBe(1.1920928955078125e-7)
    })
    it('double precision epsilon is 2^-52', () => {
        expect(FLOAT64_EPS).toBe(2.220446049250313e-16)
    })
    it('double precision epsilon is the value the language exposes', () => {
        expect(FLOAT64_EPS).toBe(Number.EPSILON)
    })
    it('each format is coarser than the next wider one', () => {
        expect(FLOAT16_EPS).toBeGreaterThan(FLOAT32_EPS)
        expect(FLOAT32_EPS).toBeGreaterThan(FLOAT64_EPS)
    })
})
