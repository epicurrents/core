/**
 * ONNX utilities.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import { NUMERIC_ERROR_VALUE } from './constants'

const SCOPE = 'util:onnx'

type DetectionRange = {
    confidence: number
    range: number[]
}

/**
 * Get the intersection-over-union of two intersecting ranges.
 * @param range1 - First range as [start, end].
 * @param range2 - Second range as [start, end].
 * @returns Intersection over union as a fraction (or NUMERIC_ERROR_VALUE if error).
 */
export const IoU = (range1: number[], range2: number[]): number => {
    if (range1.length !== 2 || range2.length !== 2) {
        Log.error(`One of the ranges given to IoU has an incorrect amount of elements (exactly 2 expected).`, SCOPE)
        return NUMERIC_ERROR_VALUE
    }
    if (range1[0] >= range1[1] || range2[0] >= range2[1]) {
        Log.error(`One of the ranges given to IoU has a zero or negative length (positive length expected).`, SCOPE)
        return NUMERIC_ERROR_VALUE
    }
    if (range1[0] < 0 || range2[0] < 0) {
        Log.error(`At least one of the ranges given to IoU has a negative element (non-negative expected).`, SCOPE)
        return NUMERIC_ERROR_VALUE
    }
    const innerLowBound = Math.max(range1[0], range2[0])
    const innerHighBound = Math.min(range1[1], range2[1])
    if (innerLowBound >= innerHighBound) {
        return 0 // No intersection.
    }
    const intersection = innerHighBound - innerLowBound
    const union = Math.max(range1[1], range2[1]) - Math.min(range1[0], range2[0])
    return intersection/union
}

/**
 * Non-maximum suppression algorithm to find the most likely detection range
 * out of overlapping detection ranges.
 * @param detections - Array of detections to process.
 * @param iouTh - Intersection-over-union threshold (default 0.5).
 * @return Range as [start, end] or empty array if error.
 * @remarks
 * Aims to retain the detections with the highest confidence while pruning
 * those with a lower confidence but high intersection-over-union (=overlap),
 * using the iouTh as a threshold for pruning.
 */
export const NMS = (detections: DetectionRange[], iouTh = 0.5): DetectionRange[] => {
    if (!detections.length) {
        return []
    }
    if (detections.length === 1) {
        return [detections[0]]
    }
    const keepers = [] as DetectionRange[]
    // Sort by confidence
    detections.sort((a, b) => a.confidence - b.confidence)
    // Start off by adding the highest confidence range.
    while (detections.length) {
        const nextBest = detections.splice(0, 1)[0]
        keepers.push(nextBest)
        for (let i=0; i<detections.length; i++) {
            if (IoU(detections[i].range, nextBest.range) > iouTh) {
                detections.splice(i, 1)
                i--
            }
        }
    }
    return keepers
}
