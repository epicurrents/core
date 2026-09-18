/**
 * Tests for the ONNX detection helpers.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest'
import { IoU, NMS } from '../../src/util/onnx'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

describe('ONNX utilities', () => {
    describe('IoU', () => {
        it('should return the intersection over the union of two overlapping ranges', () => {
            // Intersection [1, 10] = 9, union [0, 11] = 11.
            expect(IoU([0, 10], [1, 11])).toBeCloseTo(9/11, 10)
        })

        it('should return 1 for identical ranges', () => {
            expect(IoU([2, 8], [2, 8])).toBe(1)
        })

        it('should return 0 for ranges that do not intersect', () => {
            expect(IoU([0, 5], [5, 10])).toBe(0)
            expect(IoU([0, 5], [6, 10])).toBe(0)
        })

        it('should reject malformed ranges rather than returning a plausible number', () => {
            expect(IoU([0], [1, 2])).toBeLessThan(0)
            expect(IoU([5, 5], [1, 2])).toBeLessThan(0)
            expect(IoU([-1, 2], [1, 2])).toBeLessThan(0)
        })
    })

    describe('NMS', () => {
        it('should keep the highest-confidence detection of an overlapping pair', () => {
            // The defining property of non-maximum suppression. Sorting ascending inverts it into
            // maximum suppression, which still returns one detection per cluster and so looks
            // correct from the outside.
            const kept = NMS([
                { confidence: 0.4, range: [1, 11] },
                { confidence: 0.9, range: [0, 10] },
            ])
            expect(kept).toHaveLength(1)
            expect(kept[0].confidence).toBe(0.9)
        })

        it('should keep the best of each cluster and drop the rest', () => {
            const kept = NMS([
                { confidence: 0.5, range: [0, 10] },
                { confidence: 0.8, range: [1, 11] },
                { confidence: 0.6, range: [100, 110] },
                { confidence: 0.3, range: [101, 111] },
            ])
            expect(kept.map(k => k.confidence).sort((a, b) => b - a)).toEqual([0.8, 0.6])
        })

        it('should keep detections that do not overlap beyond the threshold', () => {
            const kept = NMS([
                { confidence: 0.9, range: [0, 10] },
                { confidence: 0.8, range: [20, 30] },
                { confidence: 0.7, range: [40, 50] },
            ])
            expect(kept).toHaveLength(3)
        })

        it('should respect a custom IoU threshold', () => {
            const detections = [
                { confidence: 0.9, range: [0, 10] },
                { confidence: 0.4, range: [5, 15] },
            ]
            // IoU here is 5/15 = 0.333.
            expect(NMS(detections, 0.5)).toHaveLength(2)
            expect(NMS(detections, 0.3)).toHaveLength(1)
        })

        it('should not consume the array it was given', () => {
            const detections = [
                { confidence: 0.4, range: [1, 11] },
                { confidence: 0.9, range: [0, 10] },
            ]
            NMS(detections)
            expect(detections).toHaveLength(2)
            expect(detections[0].confidence).toBe(0.4)
        })

        it('should handle empty and single-element input', () => {
            expect(NMS([])).toEqual([])
            const single = [{ confidence: 0.5, range: [0, 1] }]
            expect(NMS(single)).toEqual(single)
        })
    })
})
