/**
 * Rolling-window sizing invariant tests.
 *
 * The rolling cache holds a fixed number of data blocks (the centre block plus one block of
 * lookahead on each side). Three independent sites derive from that count: the mutex buffer
 * allocation (`_blockDuration * N` in setupMutex), the resource's memory-manager request
 * (`N * blockDuration` per channel in EegRecording), and the sliding window cap
 * (`_maxDataBlocks` in `_buildDataBlocks`, consumed by `_slideToBlock`). If `_maxDataBlocks`
 * diverges below the allocation, the window is narrower than the buffer and the slide logic
 * pushes the centre block to the window edge, loading the cache ahead of (or behind) the view.
 * These tests pin `_maxDataBlocks` to the allocation count so the three sites cannot drift.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericSignalReader from '../../src/assets/reader/GenericSignalReader'
import type { AppSettings, BiosignalHeaderRecord } from '../../src/types'

/** Minimal concrete reader exposing the protected block-building machinery for direct testing. */
class TestReader extends GenericSignalReader {
    setDimensions (opts: {
        signals: { samplingRate: number, modality: string }[]
        dataUnitDuration: number
        dataUnitCount: number
        dataUnitSize: number
    }) {
        this._header = { signals: opts.signals } as unknown as BiosignalHeaderRecord
        this._dataUnitDuration = opts.dataUnitDuration
        this._dataUnitCount = opts.dataUnitCount
        this._dataUnitSize = opts.dataUnitSize
        this._dataOffset = 0
        this._totalDataLength = opts.dataUnitCount * opts.dataUnitDuration
        this._totalRecordingLength = this._totalDataLength
    }
    build () {
        this._buildDataBlocks()
    }
    get maxDataBlocks () {
        return this._maxDataBlocks
    }
    get blockDuration () {
        return this._blockDuration
    }
    get blockCount () {
        return this._dataBlocks.length
    }
    get useRolling () {
        return this._useRolling
    }
    /** The buffer allocation length setupMutex would use for the rolling window. */
    get mutexWindowSeconds () {
        return Math.min(this._totalDataLength, this._blockDuration * 3)
    }
}

/** Build an AppSettings whose only relevant fields are the cache budget and block-duration cap. */
const settingsWith = (maxLoadCacheSize: number, dataBlockDuration = 3600) => {
    return {
        app: {
            maxLoadCacheSize,
            dataBlockDuration,
        },
    } as unknown as AppSettings
}

// 12 EEG channels at 250 Hz plus one annotation channel — the clean.edf shape. Int16 EDF encoding,
// so the reader's conversion factor is 4 / 2 = 2 (samples decoded to Float32).
const CLEAN_SIGNALS = [
    ...Array.from({ length: 12 }, () => ({ samplingRate: 250, modality: 'eeg' })),
    { samplingRate: 1000, modality: 'annotation' },
]
// Bytes per 1 s data record: total samples across all channels × 2 (Int16 EDF encoding). The
// reader tracks `_dataUnitSize` in bytes — a 100 MB 16-bit file decodes to ~200 MB Float32.
const DATA_UNIT_SIZE = CLEAN_SIGNALS.reduce((t, s) => t + s.samplingRate, 0) * Int16Array.BYTES_PER_ELEMENT

describe('Rolling window equals the buffer allocation', () => {
    // A budget deliberately in the regime where the previous formula
    // (`floor(maxCacheBytes / blockSignalDataSize)`) rounded down to two blocks while the buffer
    // was allocated for three. The exact bytes are not important — the invariant must hold across
    // the whole rolling regime, which the loop below exercises.
    test('clean.edf-shaped recording gets a 3-block window, never 2', () => {
        const reader = new TestReader(Int16Array, settingsWith(3.0 * 1024 * 1024))
        reader.setDimensions({
            signals: CLEAN_SIGNALS,
            dataUnitDuration: 1,
            dataUnitCount: 12553,
            dataUnitSize: DATA_UNIT_SIZE,
        })
        reader.build()
        expect(reader.useRolling).toBe(true)
        expect(reader.maxDataBlocks).toBe(3)
    })
    test('across a sweep of rolling budgets, maxDataBlocks stays min(3, totalBlocks)', () => {
        for (let mb = 2; mb <= 40; mb += 1) {
            const reader = new TestReader(Int16Array, settingsWith(mb * 1024 * 1024))
            reader.setDimensions({
                signals: CLEAN_SIGNALS,
                dataUnitDuration: 1,
                dataUnitCount: 12553,
                dataUnitSize: DATA_UNIT_SIZE,
            })
            reader.build()
            if (reader.useRolling) {
                expect(reader.maxDataBlocks).toBe(Math.min(3, reader.blockCount))
                // The buffer allocation (3 blocks) must cover the window it advertises.
                expect(reader.mutexWindowSeconds).toBeGreaterThanOrEqual(reader.blockDuration * reader.maxDataBlocks)
            }
        }
    })
    test('full-load recording keeps every block and disables rolling', () => {
        // A budget larger than the whole recording — full-load path.
        const reader = new TestReader(Int16Array, settingsWith(1024 * 1024 * 1024))
        reader.setDimensions({
            signals: CLEAN_SIGNALS,
            dataUnitDuration: 1,
            dataUnitCount: 600,
            dataUnitSize: DATA_UNIT_SIZE,
        })
        reader.build()
        expect(reader.useRolling).toBe(false)
        expect(reader.maxDataBlocks).toBe(reader.blockCount)
    })
})
