/**
 * Biosignal cascade montage. Stacks N time-shifted slices of one source channel as N vertically
 * arranged traces so a long continuous segment of a single source signal can be scanned at a
 * glance.
 *
 * Each row covers a fixed `pageLength` seconds; the visible reach across all rows is
 * `rowCount * pageLength`. A page-turn advances `viewStart` by the full reach so successive
 * screens are non-overlapping.
 *
 * Modality wrappers extend this class and override {@link _createChannel} to wrap each row in
 * the modality's own concrete `MontageChannel` class. The slice math and page-step / timebase
 * override logic stay in this base.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import type {
    BiosignalResource,
    BiosignalSetup,
    MontageChannel,
    SetFiltersResponse,
    SetupChannel,
    SignalInterruptionMap,
} from '#types/biosignal'
import type {
    ConfigBiosignalMontage,
} from '#types/config'
import type {
    MemoryManager,
    SignalCacheResponse,
} from '#types/service'
import { calculateSignalOffsets, filterSignal } from '#util/signal'
import GenericBiosignalMontage from './GenericBiosignalMontage'

const SCOPE = 'GenericBiosignalCascadeMontage'

export default abstract class GenericBiosignalCascadeMontage extends GenericBiosignalMontage {
    protected _rowCount: number
    protected _sourceLabel: string

    constructor (
        name: string,
        recording: BiosignalResource,
        setup: BiosignalSetup,
        sourceLabel: string,
        rowCount: number,
        pageLength: number,
        manager?: MemoryManager,
        config?: ConfigBiosignalMontage,
    ) {
        super(name, recording, setup, undefined, manager, config)
        this._rowCount = rowCount
        this._sourceLabel = sourceLabel
        // Cascade montages own all of their display state: filter band, sensitivity, sec/page
        // geometry — the recording's regular settings should not bleed in, and downstream
        // mutations while a cascade is active should land on the cascade rather than on the
        // recording. The `applyToMontage` flag flips this routing on for every setter call and
        // every reader site (`recording.sensitivity` / `recording.filters` short-circuit to this
        // montage's values while it is active).
        this._applyToMontage = true
        // Force constant sec/page geometry and a montage-specific page length so the framework
        // refuses calibrated (cm/sec) timebase while this montage is active. The page-turn step
        // is derived from `pageLength` via the {@link pageStep} getter override, so timebase
        // changes (which route to `pageLength`) automatically expand or contract the per-page
        // step.
        this.pageLength = pageLength
        this.timebaseUnit = 'secPerPage'
    }

    override get isCascade () {
        return true as const
    }
    get pageStep () {
        return this.pageLength === null ? null : this.pageLength * this._rowCount
    }
    set pageStep (_value: number | null) {
        // Cascade montages derive their step from pageLength × rowCount; explicit assignments
        // would diverge from that contract, so we ignore them here. Use `pageLength` instead.
    }

    get rowCount () {
        return this._rowCount
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    getRowAtY (relYFromBottom: number): number {
        const idx = Math.floor((1 - relYFromBottom) * this._rowCount)
        if (idx < 0) {
            return 0
        }
        if (idx >= this._rowCount) {
            return this._rowCount - 1
        }
        return idx
    }

    getRowAtTime (time: number): number {
        if (this.pageLength === null) {
            return -1
        }
        const offset = time - this._recording.viewStart
        if (offset < 0 || offset >= this._rowCount * this.pageLength) {
            return -1
        }
        return Math.floor(offset / this.pageLength)
    }

    getRowTimeRange (rowIndex: number): [number, number] | null {
        if (this.pageLength === null || rowIndex < 0 || rowIndex >= this._rowCount) {
            return null
        }
        const start = this._recording.viewStart + rowIndex * this.pageLength
        return [start, start + this.pageLength]
    }

    getTimeAtRowPosition (rowIndex: number, secondsWithinRow: number): number {
        if (this.pageLength === null) {
            return this._recording.viewStart
        }
        return this._recording.viewStart + rowIndex * this.pageLength + secondsWithinRow
    }

    /**
     * Template-method hook: construct one row's `MontageChannel`. Modality wrappers must
     * implement this to wrap each row in their concrete `MontageChannel` subclass — downstream
     * consumers access inherited getters (`color`, `sensitivity`, `polarity`, ...) so a
     * plain-properties stand-in is not sufficient. The base class is abstract for this reason.
     */
    protected abstract _createChannel (src: SetupChannel, rowIndex: number): MontageChannel

    /**
     * Resolve the source channel by label or name against the montage's setup. Returns null
     * (and logs a debug entry) when no candidate matches.
     */
    protected _resolveSourceChannel (): SetupChannel | null {
        const match = this._setup.channels.find(
            (chan: SetupChannel) => chan.label === this._sourceLabel || chan.name === this._sourceLabel
        )
        if (!match) {
            Log.debug(
                `Cannot map cascade montage channels: source '${this._sourceLabel}' not found in setup.`,
                SCOPE,
            )
            return null
        }
        return match
    }

    // The base implementation forwards to `getAllSignals`, but that path is row-mode in the
    // cascade — it always fetches `rowCount * pageLength` seconds regardless of the requested
    // range. Override here so the analysis path (which calls `getChannelSignal`) gets exactly
    // the user-selected range, with the cascade's own filters applied for consistency with what
    // is drawn on screen.
    async getChannelSignal (
        _channel: number | string,
        range: number[],
        _config?: unknown,
    ): Promise<SignalCacheResponse> {
        if (!this.channels.length) {
            return null
        }
        const sourceIdx = this.channels[0]?.active as number
        if (typeof sourceIdx !== 'number') {
            return null
        }
        const response = await this._recording.getAllRawSignals(
            range,
            { include: [sourceIdx] },
        )
        if (!response?.signals?.length) {
            return null
        }
        const src = response.signals[0]
        const f = this.filters
        const filtered = (f.highpass || f.lowpass || f.notch)
            ? filterSignal(src.data, src.samplingRate, f.highpass, f.lowpass, f.notch)
            : src.data
        return {
            start: range[0],
            end: range[1],
            signals: [{
                data: filtered,
                samplingRate: src.samplingRate,
            }],
        }
    }

    // Reads the single source channel via the recording's raw-signal path over the full reach
    // (`rowCount * pageLength`) and slices the result into `rowCount` row-sized chunks. The
    // cascade deliberately bypasses the montage worker — every "channel" derives from the same
    // source with no reference, so there is nothing to derive worker-side and the setup-worker /
    // setup-cache / set-interruptions commissions are skipped in
    // `GenericBiosignalResource.addCascadeMontage`. No special cache-reach negotiation is done:
    // rows past the cached boundary render whatever the raw-signal cache returns (gaps or zeros).
    async getAllSignals (range: number[]): Promise<SignalCacheResponse> {
        if (!this.channels.length) {
            return null
        }
        const pageLength = this.pageLength ?? (range[1] - range[0])
        const expandedRange = [range[0], range[0] + this._rowCount * pageLength]
        // All N channels point at the same source; the active index of the first one is the
        // source index in the recording's raw signal array.
        const sourceIdx = this.channels[0]?.active as number
        if (typeof sourceIdx !== 'number') {
            return null
        }
        const response = await this._recording.getAllRawSignals(
            expandedRange,
            { include: [sourceIdx] },
        )
        if (!response?.signals?.length) {
            return null
        }
        const src = response.signals[0]
        // Apply the montage's own filters main-thread before slicing into rows. `filterSignal`
        // caches Butterworth coefficients per (fs, fc) tuple so the per-call cost is just the
        // filtfilt pass over the one channel — for typical signal ranges (~256 Hz × 5 min ≈ 80k
        // samples) this is sub-10 ms, well within a per-frame budget. Filtering the
        // expanded-range source once (before slicing) keeps each row coherent across its
        // boundary — slicing first and filtering per slice would introduce edge artefacts at
        // every row transition.
        const f = this.filters
        const filtered = (f.highpass || f.lowpass || f.notch)
            ? filterSignal(src.data, src.samplingRate, f.highpass, f.lowpass, f.notch)
            : src.data
        const samplesPerRow = Math.round(pageLength * src.samplingRate)
        const signals = [] as { data: Float32Array, samplingRate: number }[]
        for (let i = 0; i < this._rowCount; i++) {
            const startSample = i * samplesPerRow
            const endSample = startSample + samplesPerRow
            signals.push({
                data: filtered.subarray(startSample, endSample),
                samplingRate: src.samplingRate,
            })
        }
        return {
            start: range[0],
            end: range[1],
            signals,
        }
    }

    mapChannels () {
        const src = this._resolveSourceChannel()
        if (!src) {
            return []
        }
        const channels = Array.from(
            { length: this._rowCount },
            (_, i) => this._createChannel(src, i),
        )
        this.channels = channels
        // Cascade montages are added to the recording AFTER the consumer's montage-change handler
        // has called `setChannelLayout` on the existing montages, so they miss the offset pass
        // and would render every row on top of the others. Compute offsets here without a config
        // — the configured layout path (group sizes + spacing) doesn't apply since every row is
        // the same channel, so we want the equidistant branch (`!config`) that spaces N rows
        // evenly across the viewport.
        calculateSignalOffsets(channels)
        return channels
    }

    // No-op override. The cascade bypasses the worker (see `getAllSignals`) and reads
    // interruption metadata via the raw-signal path. Forwarding to `_service.setInterruptions`
    // would fail validation because no worker was set up.
    // GOTCHA — Remove this override when the cascade worker is enabled (ROADMAP: "Viewer —
    // cascade montage worker enablement"). Otherwise newly-changed interruptions won't reach the
    // worker and derivation will silently use stale data.
    setInterruptions (_interruptions: SignalInterruptionMap) {
        // No-op — see comment above.
    }

    // No-op override. The cascade renders raw source bytes — no derivation, no filtering — and
    // the base implementation's `_service.setFilters()` commission would fail because the worker
    // was never set up. Filter values still land on `this._filters` / per-channel state via the
    // inherited setters; we just don't propagate to a worker that isn't used.
    // GOTCHA — Remove this override when the cascade worker is enabled. Otherwise filter
    // changes will appear to stick on the montage object but never reach the pipeline, and
    // rendered cascade rows will keep showing unfiltered raw source.
    async updateFilters (): Promise<SetFiltersResponse> {
        return { success: true, updated: false }
    }
}
