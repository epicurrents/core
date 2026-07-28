/**
 * Contract tests for the exploration frontier on discontinuous recordings.
 *
 * On a discontinuous file without a complete trusted interruption table, the recording-time↔
 * data-time mapping is only exact within the contiguously decoded span. The frontier tracks
 * that span, ignores detached decodes (which prove nothing about the gaps before them), and
 * clamps rolling-window slide targets; a complete trusted table lifts the restriction.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericSignalReader from '../../src/assets/reader/GenericSignalReader'

class TestReader extends GenericSignalReader {
    constructor () {
        super(Float32Array)
    }
    extend (unitStart: number, unitEnd: number) {
        this._extendExploredUnits(unitStart, unitEnd)
    }
    exploredEnd () {
        return this._exploredRecordingEnd()
    }
    viewBlockFor (position: number) {
        return this._viewBlockForPosition(position)
    }
}

const buildReader = (discontinuous = true) => {
    const reader = new TestReader()
    const raw = reader as unknown as Record<string, unknown>
    raw._discontinuous = discontinuous
    raw._dataUnitDuration = 1
    raw._dataUnitCount = 50
    raw._totalDataLength = 50
    raw._totalRecordingLength = discontinuous ? 60 : 50
    raw._dataBlocks = Array.from({ length: 5 }, (_, i) => ({
        startRecord: i*10,
        endRecord: (i + 1)*10,
        startTime: i*10,
        endTime: (i + 1)*10,
        startBytePos: 0,
        endBytePos: 0,
        data: null,
        loaded: false,
    }))
    return reader
}

describe('Exploration frontier bookkeeping', () => {
    test('contiguous decodes extend the frontier, detached ones do not', () => {
        const reader = buildReader()
        reader.extend(0, 10)
        expect(reader.exploredEnd()).toBe(10)
        reader.extend(8, 20)
        expect(reader.exploredEnd()).toBe(20)
        // A detached decode (e.g. the last-record duration probe) proves nothing about the
        // gaps before it and must not advance the frontier.
        reader.extend(40, 50)
        expect(reader.exploredEnd()).toBe(20)
    })
    test('known interruptions extend the frontier in recording time', () => {
        const reader = buildReader()
        reader.addNewInterruptions(new Map([[5, 3]]))
        reader.extend(0, 10)
        // 10 data units plus the 3-second gap discovered within them.
        expect(reader.exploredEnd()).toBe(13)
    })
    test('continuous recordings are unrestricted', () => {
        const reader = buildReader(false)
        expect(reader.exploredEnd()).toBe(-1)
    })
    test('a complete trusted interruption table lifts the restriction', () => {
        const reader = buildReader()
        expect(reader.exploredEnd()).toBe(0)
        reader.setInterruptions(new Map([[5, 3]]), true)
        expect(reader.exploredEnd()).toBe(-1)
    })
    test('a discovered (partial) table keeps the restriction', () => {
        const reader = buildReader()
        reader.setInterruptions(new Map([[5, 3]]))
        expect(reader.exploredEnd()).toBe(0)
    })
})

describe('Slide-target clamping', () => {
    test('a slide target beyond the frontier clamps to it', () => {
        const reader = buildReader()
        reader.extend(0, 10)
        // Frontier at 10 s recording time → block 1 (units [10, 20)); an unrestricted scan of
        // position 45 would land in block 4.
        expect(reader.viewBlockFor(45)).toBe(1)
    })
    test('targets within the frontier resolve normally', () => {
        const reader = buildReader()
        reader.extend(0, 30)
        expect(reader.viewBlockFor(25)).toBe(2)
    })
    test('unrestricted recordings never clamp', () => {
        const reader = buildReader(false)
        expect(reader.viewBlockFor(45)).toBe(4)
    })
})
