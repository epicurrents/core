/**
 * Biosignal montage.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-ts-log'
import {
    type BiosignalMontage,
    type BiosignalMontageReferenceSignal,
    type BiosignalMontageTemplate,
    type BiosignalResource,
    type BiosignalSetup,
    type MontageChannel,
    type SetFiltersResponse,
} from '#types/biosignal'
import {
    type ConfigBiosignalMontage,
    type ConfigChannelFilter,
    type ConfigMapChannels,
} from '#types/config'
import { type HighlightContext, type SignalHighlight } from '#types/plot'
import {
    type MemoryManager,
    type SignalCachePart,
    type SignalCacheResponse,
} from '#types/service'
import { type MutexExportProperties } from 'asymmetric-io-mutex'
import {
    combineAllSignalParts,
    combineSignalParts,
    isContinuousSignal,
    mapMontageChannels,
    shouldDisplayChannel,
} from '#util/signal'
import { NUMERIC_ERROR_VALUE } from '#util/constants'
import GenericAsset from '#assets/GenericAsset'
import MontageService from '../service/MontageService'

const SCOPE = 'GenericBiosignalMontage'

export default abstract class GenericBiosignalMontage extends GenericAsset implements BiosignalMontage {
    protected _channels: MontageChannel[] = []
    protected _cachedSignals = {
        start: 0,
        end: 0,
        signals: []
    } as SignalCachePart
    protected _cacheParts = [] as SignalCachePart[]
    protected _config: BiosignalMontageTemplate | null =  null
    protected _dataGaps = new Map<number, number>()
    protected _filters = {
        highpass: 0,
        lowpass: 0,
        notch: 0,
    }
    protected _highlights = new Map<string, HighlightContext>()
    protected _label: string
    protected _reference: BiosignalMontageReferenceSignal = null
    protected _recording: BiosignalResource
    protected _service: MontageService
    protected _setup: BiosignalSetup

    constructor (
        name: string,
        recording: BiosignalResource,
        setup: BiosignalSetup,
        manager?: MemoryManager,
        config?: ConfigBiosignalMontage,
    ) {
        super(name, GenericAsset.SCOPES.BIOSIGNAL, 'mtg')
        this._label = config?.label || name
        this._recording = recording
        this._setup = setup
        this._service = new MontageService(recording.type, this, manager)
    }
    get cacheStatus ()  {
        return this._cachedSignals
    }
    // Getters and setters.
    get channels () {
        return this._channels
    }
    set channels (channels: MontageChannel[]) {
        this._channels = channels
        for (const chan of this._channels) {
            // Trigger a general channels update if any property of a channel changes.
            chan.addPropertyUpdateHandler('.+', () => {
                this.onPropertyUpdate('channels')
            })
            // Listen for changes in channel filters.
            chan.addPropertyUpdateHandler('.+-filter', () => {
                this._service.setFilters().then((updated) => {
                    if (updated) {
                        this._recording.onPropertyUpdate('active-montage-filters')
                    }
                })
            })
        }
        this.onPropertyUpdate('channels')
    }
    get config () {
        return this._config
    }
    get dataGaps () {
        return this._dataGaps
    }
    set dataGaps (gaps: Map<number, number>) {
        this._dataGaps = gaps
        this._service.setDataGaps(gaps)
        this.onPropertyUpdate('data-gaps')
    }
    get filters () {
        // Primarily return local filter values, secondarily recording scope values.
        return {
            highpass: this._filters.highpass || this._recording.filters.highpass,
            lowpass: this._filters.lowpass || this._recording.filters.lowpass,
            notch: this._filters.notch || this._recording.filters.notch,
        }
    }
    get hasCommonReference () {
        return this._reference?.common || false
    }
    get highlights () {
        return this._highlights
    }
    get label () {
        return this._label
    }
    set label (label: string) {
        this._label = label
    }
    get recording () {
        return this._recording
    }
    get reference () {
        return this._reference
    }
    get referenceLabel () {
        return this._reference?.label || ''
    }
    get setup () {
        return this._setup
    }
    get visibleChannels () {
        return this._channels.filter(c => shouldDisplayChannel(c, false))
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    addHighlightContext (name: string, context: HighlightContext) {
        if (this._highlights.get(name)) {
            Log.error(`Could not add duplicate highlight context ${name}.`, SCOPE)
            return false
        }
        this._highlights.set(name, context)
        return true
    }

    addHighlights (ctxName: string, ...highlights: SignalHighlight[]) {
        const context = this._highlights.get(ctxName)
        if (!context) {
            Log.warn(`Tried to add highlights to a non-existing source ${ctxName}.`, SCOPE)
            return
        }
        let anyNew = false
        highlight_loop:
        for (const hl of highlights) {
            hl.channels.sort((a, b) => a - b)
            for (const ex of context.highlights) {
                if (hl.type == ex.type && hl.start === ex.start && hl.end === ex.end) {
                    // Don't add the same highlight again
                    if (hl.channels.every((v, i) => v === ex.channels[i])) {
                        continue highlight_loop
                    }
                }
            }
            context.highlights.push(hl)
            anyNew = true
        }
        if (anyNew) {
            // Highlights may be added in any order, but may need to be processed
            // consecutively, so sort them by start time.
            context.highlights.sort((a, b) => a.start - b.start)
            this.onPropertyUpdate('highlights', ctxName)
        }
    }

    async getAllSignals (range: number[], config?: ConfigChannelFilter): Promise<SignalCacheResponse> {
        // Check if we have the requested signals in cache
        const derivedSignals = {
            start: range[0],
            end: range[1],
            signals: []
        } as SignalCachePart
        // First check if the requested range has been cached
        if (this._cachedSignals.start <= range[0] && this._cachedSignals.end >= range[1]) {
            for (let i=0; i<this._cachedSignals.signals.length; i++) {
                // Exlude channels based on request or missing active signal
                if (
                    config?.include?.length && config.include.indexOf(i) === -1 ||
                    config?.exclude?.length && config.exclude.indexOf(i) !== -1 ||
                    this._channels[i].active === NUMERIC_ERROR_VALUE
                ) {
                    derivedSignals.signals.push({
                        data: new Float32Array(),
                        samplingRate: 0,
                    })
                    continue
                }
                const start = Math.max(
                    Math.round((range[0] - this._cachedSignals.start)*this._channels[i].samplingRate),
                    0
                )
                const end = Math.min(
                    Math.round((range[1] - this._cachedSignals.start)*this._channels[i].samplingRate),
                    this._channels[i].samplingRate*this._recording.totalDuration
                )
                derivedSignals.signals.push({
                    data: this._cachedSignals.signals[i].data.subarray(start, end),
                    samplingRate: this._cachedSignals.signals[i].samplingRate
                })
            }
            return derivedSignals
        }
        const response = await this._service.getSignals(range, config)
        if (!response?.signals || !response.signals.length) {
            Log.error(`Could not get signals for requested range [${range[0]}, ${range[1]}].`, SCOPE)
            return null
        }
        // Check that montages actually match
        if (this._channels.length !== response.signals.length) {
            Log.error(`Worker response had an invalid number of montage channels (` +
                `expected ${this._channels.length}, received ${response.signals.length}` +
            `).`, SCOPE)
            return null
        }
        for (let i=0; i<response.signals.length; i++) {
            // Exlude channels based on request or missing active signal
            if (
                config?.include?.length && config.include.indexOf(i) === -1 ||
                config?.exclude?.length && config.exclude.indexOf(i) !== -1 ||
                this._channels[i].active === NUMERIC_ERROR_VALUE
            ) {
                derivedSignals.signals.push({
                    data: new Float32Array(),
                    samplingRate: 0,
                })
                continue
            }
            derivedSignals.signals.push(response.signals[i])
        }
        return derivedSignals
    }

    async getChannelSignal (channel: number | string, range: number[], config?: ConfigChannelFilter):
    Promise<SignalCacheResponse> {
        // This is just an alias for getAllSignals with a channel filter
        if (!config) {
            // Initialize config
            config = { include: [] as number[] }
        }
        if (typeof channel === 'string') {
            for (let i=0; i<this._channels.length; i++) {
                if (this._channels[i]?.name === channel) {
                    config.include = [i]
                    break
                } else if (i === this._channels.length - 1) {
                    // Did not find the requested channel, return empty array
                    return null
                }
            }
        }
        return this.getAllSignals(range, config)
    }

    mapChannels (config?: ConfigMapChannels) {
        this._channels = mapMontageChannels(this._setup, config)
    }

    async releaseBuffers () {
        await this._service?.unload()
    }

    removeAllHighlights () {
        this._highlights.clear()
        this.onPropertyUpdate('highlights')
    }

    removeAllHighlightsFrom (ctxName: string) {
        const context = this._highlights.get(ctxName)
        if (!context) {
            Log.warn(`Tried to remove all highlights from a non-existing context ${ctxName}.`, SCOPE)
            return
        }
        context.highlights.splice(0)
        this.onPropertyUpdate('highlights', ctxName)
    }

    removeAllPropertyUpdateHandlers () {
        for (const chan of this._channels) {
            chan.removeAllPropertyUpdateHandlers()
        }
        super.removeAllPropertyUpdateHandlers()
    }

    removeHighlights (ctxName: string, ...indices: number[]) {
        const context = this._highlights.get(ctxName)
        if (!context) {
            Log.warn(`Tried to remove highlights from a non-exsting source ${ctxName}.`, SCOPE)
            return
        }
        let offset = 0
        for (const idx of indices) {
            const adjIdx = idx - offset
            if (adjIdx < 0 || adjIdx > context.highlights.length - 1) {
                Log.warn(`Adjusted index ${adjIdx} from index ${idx} is out of bouds for highlight array of length ${context.highlights.length}.`, SCOPE)
                continue
            }
            context.highlights.splice((idx - offset), 1)
            offset++
        }
        if (offset) {
            this.onPropertyUpdate('highlights', ctxName)
        }
    }

    removeMatchingHighlights (ctxName: string, matcherFn: ((highlight: SignalHighlight) => boolean)) {
        const context = this._highlights.get(ctxName)
        if (!context) {
            Log.warn(`Tried to remove matching highlights from a non-exsting source ${ctxName}.`, SCOPE)
            return
        }
        for (let i=0; i<context.highlights.length; i++) {
            if (matcherFn(context.highlights[i])) {
                context.highlights.splice(i, 1)
                i--
            }
        }
    }

    resetChannels(): void {
    }

    async resetSignalCache () {
        await this.releaseBuffers()
        this._cachedSignals = {
            start: 0,
            end: 0,
            signals: []
        }
    }

    saveSignalsToCache (newPart: SignalCachePart) {
        // Initialize channels if they are not set yet.
        if (!this._cachedSignals.signals.length) {
            this._cachedSignals.signals = this._channels.map((chan) => {
                return { data: new Float32Array(), samplingRate: chan.samplingRate }
            })
        }
        // Combine signal parts if possible.
        if (combineSignalParts(this._cachedSignals, newPart)) {
            this._recording.onPropertyUpdate('active-montage-signal-cache')
        } else {
            // Cound not combine this part directly, save it in temporary parts.
            // The new part can extend more than one existing part,
            // so combine any overlapping parts.
            this._cacheParts = combineAllSignalParts(newPart, ...this._cacheParts)
            // Try again to combine into main cache.
            if (isContinuousSignal(...this._cacheParts, this._cachedSignals)) {
                this._cachedSignals = combineAllSignalParts(this._cachedSignals, ...this._cacheParts)[0]
                this._cacheParts = []
                this._recording.onPropertyUpdate('active-montage-signal-cache')
            }
        }
    }

    async setHighpassFilter (target: string | number, value: number) {
        if (typeof target === 'number') {
            this._channels[target].highpassFilter = value
        } else {
            this._filters.highpass = value
        }
        const updated = await this._service.setFilters()
        if (updated) {
            this._recording.onPropertyUpdate('active-montage-filters')
        }
        return updated
    }

    async setLowpassFilter (target: string | number, value: number) {
        if (typeof target === 'number') {
            this._channels[target].lowpassFilter = value
        } else {
            this._filters.lowpass = value
        }
        const updated = await this._service.setFilters()
        if (updated) {
            this._recording.onPropertyUpdate('active-montage-filters')
        }
        return updated
    }

    async setNotchFilter (target: string | number, value: number) {
        if (typeof target === 'number') {
            this._channels[target].notchFilter = value
        } else {
            this._filters.notch = value
        }
        const updated = await this._service.setFilters()
        if (updated) {
            this._recording.onPropertyUpdate('active-montage-filters')
        }
        return updated
    }

    async setupLoaderWithInputMutex (inputProps: MutexExportProperties) {
        return this._service.setupMontageWithInputMutex(inputProps)
    }

    async setupLoaderWithSharedWorker (port: MessagePort) {
        return this._service.setupMontageWithSharedWorker(port)
    }

    startCachingSignals () {

    }

    stopCachingSignals () {

    }

    async updateFilters (): Promise<SetFiltersResponse> {
        const response = await this._service.setFilters()
        if (response) {
            // Fire property update change.
            this._recording.onPropertyUpdate('active-montage-filters')
        }
        return response
    }
}
