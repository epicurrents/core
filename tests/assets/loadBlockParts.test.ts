/**
 * Contract tests for reading a rolling-cache block in parts.
 *
 * `_loadBlock` reads a block `dataBlockChunkDuration` seconds at a time and announces each part
 * before reading the next, so a viewer can draw the view as soon as the part holding it is in
 * instead of after the whole block. The reader under test has a canned read and a recording cache,
 * so the tests exercise the part boundaries and the order of reads and reports, not the decoding.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import GenericSignalReader from '../../src/assets/reader/GenericSignalReader'
import SETTINGS from '../../src/config/Settings'
import type { ConfigChannelFilter, SignalCachePart } from '../../src/types'

type Block = { startTime: number, endTime: number, loaded: boolean }

class PartReader extends GenericSignalReader {
    /** Every read and every report, in the order they happened. */
    log: string[] = []
    /** Abort controller fired after this many reads, if set. */
    abortAfter: { reads: number, controller: AbortController } | null = null
    reads = 0
    covered = 0

    constructor () {
        super(Float32Array)
    }

    protected _cacheTimeToRecordingTime (time: number) {
        return time
    }

    protected _recordingTimeToCacheTime (time: number) {
        return time
    }

    protected _cacheRangeToRecordingRange (start: number, end: number): [number, number] {
        return [start, end]
    }

    protected async _readSignalPart (start: number, end: number): Promise<SignalCachePart | null> {
        this.reads++
        this.log.push(`read ${start}-${end}`)
        if (this.abortAfter && this.reads === this.abortAfter.reads) {
            this.abortAfter.controller.abort()
        }
        return { start, end, signals: [{ data: new Float32Array(end - start), samplingRate: 1 }] }
    }

    protected _finaliseSignalPart () {
        // The canned part needs no interpolation.
    }

    protected async _getSignalCacheRange () {
        return { start: 0, end: 0 }
    }

    async getSignalUpdatedRange () {
        return { start: 0, end: this.covered }
    }

    getEvents () {
        return []
    }

    getInterruptions () {
        return []
    }

    async getSignals (range: number[], _config?: ConfigChannelFilter): Promise<SignalCachePart> {
        return { start: range[0], end: range[1], signals: [] }
    }
}

/** A reader holding one block over `[start, end)` seconds, with one data unit every `unit` seconds. */
const readerWithBlock = (start: number, end: number, unit = 1) => {
    const reader = new PartReader()
    const raw = reader as unknown as Record<string, unknown>
    const blocks: Block[] = [{ startTime: start, endTime: end, loaded: false }]
    raw._dataBlocks = blocks
    raw._dataUnitDuration = unit
    raw._totalDataLength = end
    raw._totalRecordingLength = end
    raw._fallbackCache = {
        insertSignals: async (part: SignalCachePart) => {
            reader.covered = Math.max(reader.covered, part.end)
        },
    }
    reader.setUpdateCallback(update => {
        const range = (update as { range: number[] }).range
        reader.log.push(`report ${range[0]}-${range[1]}`)
    })
    const load = (signal?: AbortSignal) =>
        (reader as unknown as { _loadBlock: (i: number, s?: AbortSignal) => Promise<boolean> })._loadBlock(0, signal)
    return { reader, block: blocks[0], load }
}

describe('reading a rolling-cache block in parts', () => {
    const saved = { ...SETTINGS.app }

    beforeEach(() => {
        SETTINGS.app.dataBlockChunkDuration = 300
        SETTINGS.app.signalLoadingYieldMs = 0
    })

    afterEach(() => {
        SETTINGS.app.dataBlockChunkDuration = saved.dataBlockChunkDuration
        SETTINGS.app.signalLoadingYieldMs = saved.signalLoadingYieldMs
    })

    it('reads an hour-long block in five-minute parts and marks it loaded after the last', async () => {
        const { reader, block, load } = readerWithBlock(0, 3600)
        expect(await load()).toBe(true)
        const reads = reader.log.filter(l => l.startsWith('read'))
        expect(reads).toHaveLength(12)
        expect(reads[0]).toBe('read 0-300')
        expect(reads[11]).toBe('read 3300-3600')
        expect(block.loaded).toBe(true)
    })

    it('reports each part before reading the next', async () => {
        const { reader, load } = readerWithBlock(0, 900)
        await load()
        expect(reader.log).toEqual([
            'read 0-300', 'report 0-300',
            'read 300-600', 'report 0-600',
            'read 600-900', 'report 0-900',
        ])
    })

    it('reads a block that starts later from its own start', async () => {
        const { reader, load } = readerWithBlock(3600, 4200)
        await load()
        expect(reader.log.filter(l => l.startsWith('read'))).toEqual(['read 3600-3900', 'read 3900-4200'])
    })

    it('rounds a part to whole data units and ends the last at the block end', async () => {
        const { reader, load } = readerWithBlock(0, 700, 30)
        await load()
        // 300 s of 30 s units is ten units; the block's 700 s leaves 100 s for the last part.
        expect(reader.log.filter(l => l.startsWith('read'))).toEqual(['read 0-300', 'read 300-600', 'read 600-700'])
    })

    it('reads at least one data unit at a time when the part is shorter than a unit', async () => {
        SETTINGS.app.dataBlockChunkDuration = 10
        const { reader, load } = readerWithBlock(0, 90, 30)
        await load()
        expect(reader.log.filter(l => l.startsWith('read'))).toEqual(['read 0-30', 'read 30-60', 'read 60-90'])
    })

    it('reads the block whole when the part duration is zero', async () => {
        SETTINGS.app.dataBlockChunkDuration = 0
        const { reader, load } = readerWithBlock(0, 3600)
        await load()
        expect(reader.log).toEqual(['read 0-3600', 'report 0-3600'])
    })

    it('stops at an abort between parts and leaves the block to be read again', async () => {
        const { reader, block, load } = readerWithBlock(0, 3600)
        const controller = new AbortController()
        reader.abortAfter = { reads: 2, controller }
        expect(await load(controller.signal)).toBe(false)
        expect(reader.reads).toBe(2)
        expect(block.loaded).toBe(false)
    })
})
