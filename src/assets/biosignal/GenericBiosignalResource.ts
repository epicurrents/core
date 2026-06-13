/**
 * Generic biosignal resource.
 * This class serves only as as superclass for more spesific biosignal classes.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { ResourceEvents } from '#events'
import {
    combineSignalParts,
    getIncludedChannels,
    shouldDisplayChannel,
} from '#util/signal'
import GenericBiosignalChannel from './components/GenericBiosignalChannel'
import { nullPromise } from '#util/general'
import GenericResource from '#assets/GenericResource'
import { INDEX_NOT_ASSIGNED } from '#util/constants'
import type {
    AnnotationLabel,
    PropertyChangeContext,
} from '#types/application'
import type {
    AnnotationLabelTemplate,
    AnnotationEventTemplate,
    BiosignalCacheDerivationSlot,
    BiosignalFilters,
    BiosignalAnnotationEvent,
    BiosignalCursor,
    BiosignalDataService,
    BiosignalFilterType,
    BiosignalMontage,
    BiosignalResource,
    BiosignalSetup,
    BiosignalTrend,
    DerivedChannelProperties,
    SetupDerivation,
    SignalDataCache,
    SignalInterruption,
    SignalInterruptionMap,
    SignalPart,
    SourceChannel,
    VideoAttachment,
} from '#types/biosignal'
import type {
    CommonBiosignalSettings,
    ConfigChannelFilter,
    ConfigSchema,
    ResourceConfig,
} from '#types/config'
import type {
    MemoryManager,
    SignalCachePart,
    SignalCacheResponse,
} from '#types/service'
import type { StudyContext } from '#types/study'
import Log from 'scoped-event-log'
import type { MutexExportProperties } from 'asymmetric-io-mutex'

/**
 * Configuration schema for the biosignal resources.
 */
const CONFIG_SCHEMA = {
    context: 'biosignal_resource',
    fields: [
        // Properties that can be modified with an external config.
        {
            name: 'interruptions',
            type: 'array',
        },
        {
            name: 'modality',
            type: 'string',
        },
        {
            name: 'name',
            type: 'string',
        },
        {
            name: 'startTime',
            nullable: true,
            type: 'date',
        },
        {
            name: 'timebase',
            type: 'number',
        },
        {
            name: 'timebaseUnit',
            type: 'string',
        },
        {
            name: 'totalDuration',
            type: 'number',
        },
        {
            name: 'viewStart',
            type: 'number',
        },
    ],
    name: 'Biosignal resource configuration',
    type: 'epicurrents_configuration',
    version: '1.0',
} as ConfigSchema

const SCOPE = 'GenericBiosignalResource'

/**
 * Returns true when `value` is a `PropertyChangeContext` (or `null`) rather
 * than an annotation item.  Used by the overloaded mutation methods to detect
 * whether the caller is passing an optional context as the first argument.
 *
 * The check relies on the fact that none of the annotation types
 * (`BiosignalAnnotationEvent`, `AnnotationLabel`, `AnnotationEventTemplate`,
 * `string`, `number`) carry a `source`, `callback`, or `event` own-property.
 */
function _isPropertyChangeContext (value: unknown): value is PropertyChangeContext | null {
    if (value === null) {
        return true
    }
    if (typeof value !== 'object') {
        return false
    }
    return 'source' in value || 'callback' in value || 'event' in value
}

export default abstract class GenericBiosignalResource extends GenericResource implements BiosignalResource {
    // Protected properties.
    protected _activeMontage: BiosignalMontage | null = null
    protected _annotationsLocked: boolean = false
    protected _cacheProps: SignalDataCache | null = null
    protected _channels: SourceChannel[] = []
    protected _cursors: BiosignalCursor[] = []
    protected _dataDuration: number = 0
    protected _displayViewStart: number = 0
    protected _events: BiosignalAnnotationEvent[] = []
    protected _filterChannelTypes = {} as { [type: string]: BiosignalFilterType[] }
    protected _filters = {
        bandreject: [],
        highpass: 0,
        lowpass: 0,
        notch: 0,
    } as BiosignalFilters
    protected _interruptions: SignalInterruptionMap = new Map<number, number>()
    protected _loaded = false
    protected _memoryManager: MemoryManager | null = null
    protected _montages: BiosignalMontage[] = []
    protected _trends: Map<string, BiosignalTrend> = new Map()
    protected _mutexProps: MutexExportProperties | null = null
    protected _recordMontage: BiosignalMontage | null = null
    protected _sampleCount: number | null = null
    protected _samplingRate: number | null = null
    protected _sensitivity: number = 0
    protected _service: BiosignalDataService | null = null
    protected _setup: BiosignalSetup | null = null
    protected _signalCacheStatus: number[] = [0, 0]
    protected _startTime: Date | null = null
    protected _subject: {
        age?: number
        gender?: string
        height?: number
        weight?: number
    } | null = null
    protected _timebase = 0
    protected _timebaseUnit = ''
    protected _totalDuration: number = 0
    protected _url: string = ''
    protected _videos: VideoAttachment[] = []
    protected _viewStart: number = 0

    constructor (name: string, modality: string, source?: StudyContext) {
        const TYPE_SETTINGS = window.__EPICURRENTS__.RUNTIME?.SETTINGS
                                    .modules[modality] as unknown as CommonBiosignalSettings
        super(name, modality, source)
        // Set default filters.
        this._filterChannelTypes ?? TYPE_SETTINGS?.filterChannelTypes
        this._filters.highpass = TYPE_SETTINGS?.defaultFilters?.highpass || 0
        this._filters.lowpass = TYPE_SETTINGS?.defaultFilters?.lowpass || 0
        this._filters.notch = TYPE_SETTINGS?.defaultFilters?.notch || 0
        // Propagate the corrected-channel suffix from module settings so all channel instances
        // created under this resource use the configured convention automatically.
        if (TYPE_SETTINGS?.correctedChannelSuffix) {
            GenericBiosignalChannel.correctedChannelSuffix = TYPE_SETTINGS.correctedChannelSuffix
        }
    }

    get activeMontage () {
        return this._activeMontage
    }

    get annotationsLocked () {
        return this._annotationsLocked
    }
    set annotationsLocked (value: boolean) {
        if (this._annotationsLocked) {
            return
        }
        this._setPropertyValue('annotationsLocked', value)
    }

    get channels () {
        return this._channels
    }

    get cursors () {
        return this._cursors
    }

    get dataCache () {
        return this._mutexProps || this._cacheProps
    }

    get dataDuration () {
        return this._dataDuration
    }
    set dataDuration (value: number) {
        this._setPropertyValue('dataDuration', value)
    }

    get displayViewStart () {
        return this._displayViewStart
    }
    set displayViewStart (value: number) {
        this._setPropertyValue('displayViewStart', value)
    }

    get events () {
        return this._events
    }
    set events (value: BiosignalAnnotationEvent[]) {
        for (const newAnno of value) {
            if (!newAnno.id) {
                newAnno.id = GenericBiosignalResource.CreateUniqueId()
            }
        }
        // Sort the events in ascending order according to start time.
        value.sort((a, b) => a.start - b.start)
        this._setPropertyValue('events', value)
    }

    get filterChannelTypes () {
        return this._filterChannelTypes
    }

    get filters () {
        // Effective value: an active montage that owns its display state surfaces its own filter
        // set authoritatively; otherwise the recording's own filters apply.
        if (this._activeMontage?.applyToMontage) {
            return this._activeMontage.filters
        }
        return { ...this._filters }
    }

    get hasVideo () {
        return this._videos.length > 0
    }

    get interruptions (): SignalInterruption[] {
        const interruptions = [] as SignalInterruption[]
        let priorGapsTotal = 0
        for (const intr of this._interruptions) {
            interruptions.push({ start: intr[0] + priorGapsTotal, duration: intr[1] })
            priorGapsTotal += intr[1]
        }
        return interruptions
    }
    set interruptions (value: SignalInterruption[]) {
        const prevState = [...this.interruptions]
        this._interruptions.clear()
        for (const intr of value) {
            this._interruptions.set(intr.start, intr.duration)
        }
        // Set updated interruptions in montages.
        for (const montage of this._montages) {
            montage.setInterruptions(this._interruptions)
        }
        this.dispatchPropertyChangeEvent('interruptions', this.interruptions, prevState)
    }

    get maxSampleCount () {
        return Math.max(0, ...this._channels.filter(chan => shouldDisplayChannel(chan, true))
                                            .map(chan => chan.sampleCount)
                        )
    }

    get maxSamplingRate () {
        return Math.max(0, ...this._channels.filter(chan => shouldDisplayChannel(chan, true))
                                            .map(chan => chan.samplingRate)
                        )
    }

    get montages () {
        return this._montages
    }
    set montages (value: BiosignalMontage[]) {
        this._setPropertyValue('montages', value)
    }

    get recordMontage () {
        return this._recordMontage
    }
    set recordMontage (value: BiosignalMontage | null) {
        this._setPropertyValue('recordMontage', value)
    }

    get sampleCount () {
        return this._sampleCount
    }
    set sampleCount (value: number | null) {
        if (value !== null && value < 0) {
            Log.error(`Cannot set sample count to ${value}; value must be zero or greater.`, SCOPE)
            return
        }
        this._setPropertyValue('sampleCount', value)
    }

    get samplingRate () {
        return this._samplingRate
    }
    set samplingRate (value: number | null) {
        if (value !== null && value <= 0) {
            Log.error(`Cannot set sampling rate to ${value}; value must be greater than zero.`, SCOPE)
            return
        }
        this._setPropertyValue('samplingRate', value)
    }

    get sensitivity () {
        // Effective value: if the active montage owns its display state and has a sensitivity
        // override, use it; otherwise fall back to the recording's own value.
        if (this._activeMontage?.applyToMontage && this._activeMontage.sensitivity !== null) {
            return this._activeMontage.sensitivity
        }
        return this._sensitivity
    }
    set sensitivity (value: number) {
        if (value <= 0) {
            Log.error(`Cannot set sensitivity to ${value}; value must be greater than zero.`, SCOPE)
            return
        }
        const prevState = this.sensitivity
        // Route to the active montage when it owns its display state; otherwise land on the
        // recording as before (the dominant pattern — most montages don't override). Either way,
        // dispatch 'sensitivity' at the recording level so subscribers to the recording-level
        // event react without needing to know about the override mechanism.
        if (this._activeMontage?.applyToMontage) {
            this._activeMontage.sensitivity = value
            this.dispatchPropertyChangeEvent('sensitivity', this.sensitivity, prevState)
            return
        }
        this._setPropertyValue('sensitivity', value)
    }

    get service () {
        return this._service
    }

    get setup () {
        return this._setup
    }
    set setup (value: BiosignalSetup | null) {
        this._setPropertyValue('setup', value)
    }

    get signalCacheStatus () {
        return this._signalCacheStatus
    }
    set signalCacheStatus (value: number[]) {
        if (value.length !== 2) {
            Log.error(`Signal cache status must be a numeric array with length of 2 ` +
                      `(array with length of ${value.length} given).`, SCOPE)
            return
        }
        this._setPropertyValue('signalCacheStatus', value)
    }

    get startTime () {
        return this._startTime
    }
    set startTime (value: Date | null) {
        this._setPropertyValue('startTime', value)
    }

    get mainViewLength (): number | null {
        // Recording-level page length for the user's regular view, in seconds. The active
        // montage may route `timebase` to its own `pageLength` (cascade does), so this getter
        // bypasses the routing and returns the underlying value. Falls back to null when the
        // recording's saved unit is calibrated (cm/sec) — callers should then use a settings
        // default since cm/sec → seconds depends on viewport geometry.
        if (this._timebaseUnit === 'secPerPage' && this._timebase > 0) {
            return this._timebase
        }
        return null
    }

    get subject () {
        return this._subject
    }
    set subject (value: { age?: number, height?: number, sex?: 'female' | 'male', weight?: number } | null) {
        this._setPropertyValue('subject', value)
    }

    get timebase () {
        // Effective value: when the active montage owns its display state and the current unit
        // is sec/page (which is the only mode applyToMontage montages support today), surface
        // the montage's `pageLength` override. Falls back to the recording's own value when the
        // montage doesn't override.
        if (this._activeMontage?.applyToMontage
            && this.timebaseUnit === 'secPerPage'
            && this._activeMontage.pageLength !== null) {
            return this._activeMontage.pageLength
        }
        return this._timebase
    }
    set timebase (value: number) {
        // Route to the active montage's pageLength when it owns its display state and the
        // effective unit is sec/page — that's how cascade-style montages keep their per-row
        // page geometry independent from the recording-level timebase. Dispatch at the
        // recording level so subscribers to the recording-level event react without needing to
        // know about the override mechanism.
        if (this._activeMontage?.applyToMontage && this.timebaseUnit === 'secPerPage') {
            const prevState = this._timebase
            this._activeMontage.pageLength = value
            this.dispatchPropertyChangeEvent('timebase', this.timebase, prevState)
            return
        }
        this._setPropertyValue('timebase', value)
    }

    get timebaseUnit () {
        // Effective unit: an applyToMontage montage that forces a specific unit (e.g. cascade
        // hard-locks 'secPerPage') wins over the recording's own setting.
        if (this._activeMontage?.applyToMontage && this._activeMontage.timebaseUnit !== null) {
            return this._activeMontage.timebaseUnit
        }
        return this._timebaseUnit
    }
    set timebaseUnit (value: string) {
        this._setPropertyValue('timebaseUnit', value)
    }

    get totalDuration () {
        return this._totalDuration
    }
    set totalDuration (value: number) {
        if (value <= 0) {
            Log.error(`Cannot set total duration to ${value}; value must be zero or greater.`, SCOPE)
            return
        }
        this._setPropertyValue('totalDuration', value)
    }

    get url () {
        return this._url
    }

    get videos () {
        return this._videos
    }
    set videos (value: VideoAttachment[]) {
        this._setPropertyValue('videos', value)
    }

    get viewStart () {
        return this._viewStart
    }
    set viewStart (value: number) {
        if (value < 0) {
            value = 0
        }
        this._setPropertyValue('viewStart', value)
    }

    get visibleChannels () {
        return this.activeMontage
               ? this.activeMontage.channels.filter(c => shouldDisplayChannel(c, false))
               : this._channels.filter(c => shouldDisplayChannel(c, true))
    }

    // ///////////////////////////////////////////// //
    //                   HELPERS                     //
    // ///////////////////////////////////////////// //

    /**
     * Template-method hook for default-setup application. Modality subclasses override this to
     * attach their canonical setups (and any setup-level derivations) to the resource. The hook
     * is expected to be called during {@link prepare} — i.e. **after** the worker has parsed the
     * file header and **before** the resource is activated — so that any `SetupDerivation`
     * entries are known to the activation-time memory budgeter and SAB sizer.
     *
     * The base implementation is a no-op; subclasses that don't ship default setups inherit it
     * harmlessly. Subclasses that do override should be idempotent — `prepare` may be invoked
     * more than once on a recording across a lifetime (e.g. after a reset), and re-applying the
     * same setup twice should be a no-op rather than producing duplicates.
     */
    protected async _applyDefaultSetups (): Promise<void> {
        // No-op by default. Subclasses override.
    }

    /**
     * Resolve the materialised cache-slot sizing for each `SetupDerivation` declared on the
     * active setup. Each returned entry corresponds to one additional cache slot that the SAB
     * allocator must reserve alongside source channels.
     *
     * Sampling rate is taken from `derivation.samplingRate` when set; otherwise it is inferred
     * from the first active input by walking back to the source channel's sampling rate. A
     * derivation whose rate can't be resolved (no `samplingRate`, no resolvable input) is
     * dropped from the result with a debug log — the consumer keeps the source channels but
     * won't allocate a phantom slot.
     */
    protected _derivationCacheSlots (): Array<{
        derivation: SetupDerivation
        samplingRate: number
        sampleCount: number
    }> {
        const derivations = this._setup?.derivations
        if (!derivations?.length) {
            return []
        }
        const slots: Array<{ derivation: SetupDerivation, samplingRate: number, sampleCount: number }> = []
        for (const deriv of derivations) {
            const samplingRate = deriv.samplingRate || this._resolveDerivationSamplingRate(deriv)
            if (samplingRate <= 0) {
                continue
            }
            slots.push({
                derivation: deriv,
                samplingRate,
                sampleCount: Math.round(samplingRate*this._dataDuration),
            })
        }
        return slots
    }

    /**
     * Look up a derivation's effective sampling rate from its first active input. Treats `active`
     * as either a bare index, an `[index, weight]` pair, or a list of either. Returns 0 when no
     * usable input is found — callers should treat that as "drop this derivation from sizing".
     */
    protected _resolveDerivationSamplingRate (deriv: SetupDerivation): number {
        const pickFirstIndex = (entry: number | (number | number[])[]): number => {
            if (typeof entry === 'number') {
                return entry
            }
            const first = entry[0]
            if (typeof first === 'number') {
                return first
            }
            // [index, weight] tuple.
            return Array.isArray(first) ? first[0] : -1
        }
        const idx = pickFirstIndex(deriv.active as number | DerivedChannelProperties)
        if (typeof idx !== 'number' || idx < 0) {
            return 0
        }
        return this._channels[idx]?.samplingRate ?? 0
    }

    /**
     * Template-method hook for {@link addCascadeMontage}. `GenericBiosignalCascadeMontage` is
     * abstract — its `_createChannel` requires a modality-specific implementation — so the base
     * resource cannot construct a concrete cascade instance directly. Modality subclasses
     * override this hook to return their own concrete cascade class. Calling
     * `addCascadeMontage` on a resource that hasn't overridden the hook throws.
     */
    protected _constructCascadeMontage (
        _name: string,
        _setup: BiosignalSetup,
        _sourceLabel: string,
        _rowCount: number,
        _pageLength: number,
        _config?: { label: string },
    ): BiosignalMontage {
        throw new Error(
            `${this.constructor.name} must override _constructCascadeMontage to support cascade montages.`,
        )
    }

    // ///////////////////////////////////////////// //
    //                   METHODS                     //
    // ///////////////////////////////////////////// //

    addCursors (...cursors: BiosignalCursor[]) {
        const newCursors = [...this._cursors, ...cursors]
        this._setPropertyValue('cursors', newCursors, {
            callback: () => newCursors,
        })
    }

    lockAnnotations () {
        for (const event of this._events) {
            event.locked = true
        }
        for (const label of this._labels) {
            label.locked = true
        }
        this.annotationsLocked = true
    }

    addEvents (...items: BiosignalAnnotationEvent[]): void
    addEvents (context: PropertyChangeContext | null, ...items: BiosignalAnnotationEvent[]): void
    addEvents (contextOrFirst: PropertyChangeContext | BiosignalAnnotationEvent | null, ...rest: BiosignalAnnotationEvent[]): void {
        if (this._annotationsLocked) {
            Log.error(`Cannot add events to a resource with locked annotations.`, SCOPE)
            return
        }
        const context = _isPropertyChangeContext(contextOrFirst) ? contextOrFirst : null
        const events = _isPropertyChangeContext(contextOrFirst) ? rest : [contextOrFirst as BiosignalAnnotationEvent, ...rest]
        const toAdd = [] as BiosignalAnnotationEvent[]
        new_loop:
        for (const newEvent of events) {
            for (const oldEvent of this._events) {
                if (
                    (oldEvent.id && oldEvent.id === newEvent.id)
                    || (
                        oldEvent.start === newEvent.start
                        && oldEvent.duration === newEvent.duration
                        && oldEvent.type === newEvent.type
                        && oldEvent.label === newEvent.label
                        && (oldEvent.channels?.length ?? 0) === (newEvent.channels?.length ?? 0)
                        && (oldEvent.channels ?? []).every(val => (newEvent.channels ?? []).includes(val))
                    )
                ) {
                    continue new_loop
                }
            }
            if (!newEvent.id) {
                newEvent.id = GenericBiosignalResource.CreateUniqueId()
            }
            toAdd.push(newEvent)
        }
        if (!toAdd.length) {
            return
        }
        const newEvents = [...this._events, ...toAdd].sort((a, b) => a.start - b.start)
        this._setPropertyValue('events', newEvents, {
            source: context?.source,
            callback: () => newEvents,
        })
    }

    addEventsFromTemplates (_context: PropertyChangeContext | null, ..._templates: AnnotationEventTemplate[]) {
        if (this._annotationsLocked) {
            Log.error(`Cannot add events to a resource with locked annotations.`, SCOPE)
            return
        }
        Log.warn(`addEventsFromTemplates was not overridden in child class.`, SCOPE)
    }

    addInterruptions (interruptions: SignalInterruptionMap) {
        let anyChange = false
        const prevState = this.interruptions
        for (const intr of interruptions) {
            if (this._interruptions.get(intr[0]) !== intr[1]) {
                this._interruptions.set(intr[0], intr[1])
                anyChange = true
            }
        }
        if (anyChange) {
            // Propagate new interruptions to montages.
            for (const montage of this._montages) {
                montage.setInterruptions(interruptions)
            }
            this.dispatchPropertyChangeEvent('interruptions', this.interruptions, prevState)
        }
    }

    addLabels (...items: AnnotationLabel[]): void
    addLabels (context: PropertyChangeContext | null, ...items: AnnotationLabel[]): void
    addLabels (contextOrFirst: PropertyChangeContext | AnnotationLabel | null, ...rest: AnnotationLabel[]): void {
        if (this._annotationsLocked) {
            Log.error(`Cannot add labels to a resource with locked annotations.`, SCOPE)
            return
        }
        const context = _isPropertyChangeContext(contextOrFirst) ? contextOrFirst : null
        const labels = _isPropertyChangeContext(contextOrFirst) ? rest : [contextOrFirst as AnnotationLabel, ...rest]
        const toAdd = [] as AnnotationLabel[]
        new_loop:
        for (const newLabel of labels) {
            for (const oldLabel of this._labels) {
                if (
                    (oldLabel.id && oldLabel.id === newLabel.id)
                    || (
                        oldLabel.type === newLabel.type
                        && oldLabel.label === newLabel.label
                        && Object.entries(oldLabel.codes).every(
                            ([key, val]) => newLabel.codes[key] === val
                        )
                    )
                ) {
                    continue new_loop
                }
            }
            if (!newLabel.id) {
                newLabel.id = GenericBiosignalResource.CreateUniqueId()
            }
            toAdd.push(newLabel)
        }
        if (!toAdd.length) {
            return
        }
        const newLabels = [...this._labels, ...toAdd]
        this._setPropertyValue('labels', newLabels, {
            source: context?.source,
            callback: () => newLabels,
        })
    }

    addLabelsFromTemplates (_context: PropertyChangeContext | null, ..._templates: AnnotationLabelTemplate[]) {
        if (this._annotationsLocked) {
            Log.error(`Cannot add labels to a resource with locked annotations.`, SCOPE)
            return
        }
        Log.warn(`addLabelsFromTemplates was not overridden in child class.`, SCOPE)
    }

    get trends (): { [name: string]: BiosignalTrend } {
        return Object.fromEntries(this._trends)
    }

    async addCascadeMontage (
        name: string,
        label: string,
        setup: BiosignalSetup,
        sourceLabel: string,
        rowCount: number,
        pageLength: number,
    ): Promise<BiosignalMontage | null> {
        let montage = this._montages.find(m => m.name === name) || null
        if (this._mutexProps && this._service?.bufferRangeStart === INDEX_NOT_ASSIGNED) {
            Log.error(`Cannot add a cascade montage before buffer has been initialized.`, SCOPE)
            return null
        }
        if (montage) {
            Log.debug(`Montage '${name}' already exists.`, SCOPE)
        } else {
            montage = this._constructCascadeMontage(
                name, setup, sourceLabel, rowCount, pageLength, { label }
            )
            montage.mapChannels()
            if (!montage.channels.length) {
                // _resolveSourceChannel on the cascade base logs the underlying reason.
                return null
            }
            // Cascade montages deliberately skip the worker-setup dance (setup-worker /
            // setup-cache / set-interruptions). Every row reads from the same source channel
            // with no derivation, so the cascade's `getAllSignals` override fetches the raw
            // source directly via the recording's `getAllRawSignals` path and slices it on the
            // main thread. The MontageService still exists on the montage but its worker stays
            // idle.
            this._setPropertyValue('montages', [...this._montages, montage])
        }
        return montage
    }

    addTrend (trend: BiosignalTrend): boolean {
        if (this._trends.has(trend.name)) {
            Log.error(`A trend named '${trend.name}' is already registered on this recording.`, SCOPE)
            return false
        }
        this._trends.set(trend.name, trend)
        // Dispatch directly — _setPropertyValue computes protectedKey='_trends' and would
        // overwrite the Map with the plain-object snapshot returned by the getter.
        this.dispatchPropertyChangeEvent('trends', this.trends, undefined)
        return true
    }

    async cacheSignals (..._ranges: [number, number][]) {
        // Start caching file data if recording was activated.
        if (this.isActive && !this._signalCacheStatus[1]) {
            Log.debug('Starting to cache signals from file.', SCOPE)
            return this._service?.cacheSignals() || false
        }
        return false
    }

    configure (config: ResourceConfig) {
        super.configure(config, CONFIG_SCHEMA, this)
    }

    async destroy (): Promise<void> {
        this._activeMontage?.removeAllEventListeners()
        this._activeMontage = null
        this._cacheProps = null
        this._channels.length = 0
        this._cursors.length = 0
        this._events.length = 0
        this._filterChannelTypes = {}
        this._filters.bandreject.length = 0
        this._interruptions.clear()
        this._memoryManager = null
        this._montages.forEach(m => m.removeAllEventListeners())
        this._montages.length = 0
        this._mutexProps = null
        this._recordMontage = null
        await this.releaseBuffers()
        this._service?.destroy()
        this._service = null
        this._setup = null
        this._signalCacheStatus.length = 0
        this._videos.length = 0
        super.destroy()
    }

    getAbsoluteTimeAt (time: number) {
        if (!this.startTime) {
            // The recording has no start time information, just return relative time.
            return {
                date: null,
                day: Math.floor(time / 86400) + 1, // +1 to start from day 1.
                hour: Math.floor((time % 86400) / 3600),
                minute: Math.floor((time % 3600) / 60),
                second: Math.floor(time % 60),
            }
        }
        // Calculate the absolute date and time at given time position.
        const startDay = this.startTime.getFullYear()*365
                         + this.startTime.getMonth()*30
                         + this.startTime.getDay()
        const posDate = new Date(
                            this.startTime.getTime()
                            + time*1000
                        )
        const posDay = posDate.getFullYear()*365
                       + posDate.getMonth()*30
                       + posDate.getDay()
        // Add 1 to day to start from day 1.
        const day = posDay - startDay + 1
        const hour = posDate.getHours()
        const minute = posDate.getMinutes()
        const second = posDate.getSeconds()
        return {
            date: posDate,
            day, hour, minute, second
        }
    }

    getAllSignals (range: number[], config?: ConfigChannelFilter): Promise<SignalCacheResponse | null> {
        if (!this._activeMontage) {
            return this.getAllRawSignals(range, config)
        }
        return this._activeMontage.getAllSignals(range, config)
    }

    async getAllRawSignals (range: number[], config?: ConfigChannelFilter): Promise<SignalCacheResponse | null> {
        // First check if we have the requested signals cached.
        const responseSigs = [] as SignalPart[]
        let allCached = true
        for (const chan of getIncludedChannels(this._channels, config)) {
            const startSignalIndex = range.length >= 1
                                     ? Math.round(range[0]*chan.samplingRate) : 0
            const endSignalIndex = range.length === 2
                                   ? Math.round(range[1]*chan.samplingRate) - 1 : undefined
            if (
                !chan.signal?.length ||
                startSignalIndex >= chan.signal.length ||
                (endSignalIndex && endSignalIndex >= chan.signal.length)
            ) {
                allCached = false
                break
            }
            responseSigs.push({
                data: chan.signal.subarray(startSignalIndex, endSignalIndex),
                samplingRate: chan.samplingRate,
            })
        }
        if (allCached) {
            return {
                start: range[0],
                end: range[1],
                signals: responseSigs
            }
        }
        // Get non-cached signals from the service.
        return this._service?.getSignals(range, config) || nullPromise
    }

    getChannelAtYPosition (yPos: number) {
        // Check for invalid position.
        if (yPos < 0 || yPos > 1) {
            return null
        }
        // Try to identify the channel at given position.
        const visibleChannels = this._activeMontage?.visibleChannels || this.visibleChannels
        if (!visibleChannels.length) {
            return null
        }
        for (let i=0; i<visibleChannels.length; i++) {
            const offset = visibleChannels[i]?.offset
            if (offset !== undefined && offset.bottom <= yPos && offset.top >= yPos) {
                const chanIndex = i
                return {
                    index: chanIndex,
                    top: offset.top,
                    bottom: offset.bottom,
                }
            }
        }
        return null
    }

    getChannelSignal (channel: string | number, range: number[], config?: ConfigChannelFilter):
        Promise<SignalCacheResponse | null>
    {
        if (!this._activeMontage) {
            return this.getRawChannelSignal(channel, range, config)
        }
        return this._activeMontage.getChannelSignal(channel, range, config)
    }

    getInterruptions (useCacheTime = false): SignalInterruption[] {
        const interruptions = [] as SignalInterruption[]
        let priorGapsTotal = 0
        for (const intr of this._interruptions) {
            const intrTime = useCacheTime ? intr[0] : intr[0] + priorGapsTotal
            interruptions.push({ start: intrTime, duration: intr[1] })
            priorGapsTotal += intr[1]
        }
        return interruptions
    }

    async getRawChannelSignal (channel: number | string, range: number[], config?: ConfigChannelFilter):
        Promise<SignalCacheResponse | null>
    {
        if (!config) {
            // Initialize config.
            config = { include: [] as number[] }
        }
        if (typeof channel === 'string') {
            for (let i=0; i<this._channels.length; i++) {
                if (this._channels[i]?.name === channel) {
                    config.include = [i]
                    break
                } else if (i === this._channels.length - 1) {
                    // Did not find the requested channel, return empty array.
                    return null
                }
            }
        }
        return this.getAllRawSignals(range, config)
    }

    getRelativeTimeAt (time: number) {
        return {
            days: Math.floor(time / 86400),
            hours: Math.floor((time % 86400) / 3600),
            minutes: Math.floor((time % 3600) / 60),
            seconds: Math.floor(time % 60),
        }
    }

    getTrend (name: string): BiosignalTrend | null {
        return this._trends.get(name) ?? null
    }

    hasVideoAt (time: number | [number, number]) {
        if (!this._videos.length) {
            return false
        }
        // Will use signal cache part as an aid to combine multiple video parts.
        const foundParts = {
            start: 0,
            end: 0,
            signals: []
        } as SignalCachePart
        for (const vid of this._videos) {
            if (Array.isArray(time)) {
                // Check for continuous video in range.
                if (vid.startTime <= time[0] && vid.endTime >= time[1]) {
                    return true
                } else if (
                    vid.startTime <= time[0] && vid.endTime > time[0] ||
                    vid.endTime >= time[1] && vid.startTime < time[1] ||
                    vid.startTime > time[0] && vid.endTime < time[1]
                ) {
                    // Try combining signal parts to check for multiple parts
                    // covering the requested range.
                    // The recording video array is sorted according to video part
                    // start time, so if two consecutive parts are not continuous
                    // then there is no continuous video in the requested range.
                    combineSignalParts(foundParts, {
                        start: vid.startTime,
                        end: vid.endTime,
                        signals: []
                    })
                    if (foundParts.start <= time[0] && foundParts.end >= time[1]) {
                        return true
                    }
                }
            } else if (vid.startTime <= time && vid.endTime >= time) {
                return true
            }
        }
        return false
    }

    /**
     * Level 1 of the three-level cache lifecycle. Tells the service-side worker
     * to drop signal-array views and cancel in-flight caching, but preserves
     * the mutex layout and the SAB allocation, so a subsequent reactivation
     * can rebind the existing mutex shell cheaply via
     * `BiosignalMutex.initSignalBuffers(..., overwrite=true)`.
     *
     * Use {@link releaseBuffers} (Level 2) when the SAB must also be released
     * from the memory manager — for example on `unloadOnClose=true` with no
     * intent to reactivate.
     */
    async releaseSignalArrays () {
        Log.debug(`Releasing signal arrays in ${this.name}.`, SCOPE)
        await Promise.all(this._montages.map(m => m.releaseSignalArrays()))
        await this._service?.releaseSignalArrays()
        this.signalCacheStatus = [0, 0]
    }

    /**
     * Level 2 of the three-level cache lifecycle. Tears down the worker-side
     * mutex completely and releases the SAB from the memory manager. The
     * service is no longer ready after this call; a fresh `setupCache`/
     * `setupMutex` round-trip is required to use the cache again.
     */
    async releaseBuffers () {
        Log.debug(`Releasing data buffers in ${this.name}.`, SCOPE)
        await Promise.all(this._montages.map(m => m.releaseBuffers({ removeFromManager: false})))
        Log.debug(`Montage buffers released.`, SCOPE)
        await this._service?.unload(false)
        // Now remove all buffer ranges from the manager in one call.
        const ids = this._montages.map(m => m.serviceId)
        if (this._service) {
            ids.push(this._service.id)
        }
        await this._memoryManager?.release(...ids)
        this.signalCacheStatus = [0, 0]
    }

    removeAllTrends (): void {
        for (const trend of this._trends.values()) {
            trend.cancelTrendComputation()
        }
        this._trends.clear()
        this.dispatchPropertyChangeEvent('trends', this.trends, undefined)
    }

    removeEvents (...events: (string | number | BiosignalAnnotationEvent)[]): BiosignalAnnotationEvent[]
    removeEvents (context: PropertyChangeContext | null, ...events: (string | number | BiosignalAnnotationEvent)[]): BiosignalAnnotationEvent[]
    removeEvents (contextOrFirst: PropertyChangeContext | string | number | BiosignalAnnotationEvent | null, ...rest: (string | number | BiosignalAnnotationEvent)[]): BiosignalAnnotationEvent[] {
        if (this._annotationsLocked) {
            Log.error(`Cannot remove events from a resource with locked annotations.`, SCOPE)
            return []
        }
        const context = _isPropertyChangeContext(contextOrFirst) ? contextOrFirst : null
        const events = (_isPropertyChangeContext(contextOrFirst) ? rest : [contextOrFirst, ...rest]) as string[] | number[] | BiosignalAnnotationEvent[]
        const deleted = [] as BiosignalAnnotationEvent[]
        const newEvents = [...this._events]
        // All arguments must be of the same type, so we can check the first element.
        if (typeof events[0] === 'number') {
            // Remaining IDs must be offset when events are removed from the preceding array.
            // We must go through the IDs in ascending order for this to work.
            const eventIdxs = (events as number[]).sort((a, b) => a - b).map((v, i) => v - i)
            for (const idx of eventIdxs) {
                if (newEvents[idx]?.locked) {
                    Log.error(`Cannot remove locked event at index ${idx}.`, SCOPE)
                    continue
                }
                deleted.push(...newEvents.splice(idx, 1))
            }
        } else {
            for (const event of events as string[] | BiosignalAnnotationEvent[]) {
                const eventId = typeof event === 'string' ? event : event.id
                for (let i=0; i<newEvents.length; i++) {
                    if (newEvents[i].id === eventId) {
                        if (newEvents[i].locked) {
                            Log.error(`Cannot remove locked event '${newEvents[i].label}'.`, SCOPE)
                            break
                        }
                        deleted.push(...newEvents.splice(i, 1))
                        break
                    }
                }
            }
        }
        this._setPropertyValue('events', newEvents, {
            source: context?.source,
            callback: () => newEvents,
        })
        return deleted
    }

    removeLabels (...labels: (string | number | AnnotationLabel)[]): AnnotationLabel[]
    removeLabels (context: PropertyChangeContext | null, ...labels: (string | number | AnnotationLabel)[]): AnnotationLabel[]
    removeLabels (contextOrFirst: PropertyChangeContext | string | number | AnnotationLabel | null, ...rest: (string | number | AnnotationLabel)[]): AnnotationLabel[] {
        if (this._annotationsLocked) {
            Log.error(`Cannot remove labels from a resource with locked annotations.`, SCOPE)
            return []
        }
        const context = _isPropertyChangeContext(contextOrFirst) ? contextOrFirst : null
        const labels = (_isPropertyChangeContext(contextOrFirst) ? rest : [contextOrFirst, ...rest]) as string[] | number[] | AnnotationLabel[]
        const deleted = [] as AnnotationLabel[]
        const newLabels = [...this._labels]
        // All arguments must be of the same type, so we can check the first element.
        if (typeof labels[0] === 'number') {
            // Remaining IDs must be offset when labels are removed from the preceding array.
            // We must go through the IDs in ascending order for this to work.
            const labelIdxs = (labels as number[]).sort((a, b) => a - b).map((v, i) => v - i)
            for (const idx of labelIdxs) {
                if (newLabels[idx]?.locked) {
                    Log.error(`Cannot remove locked label at index ${idx}.`, SCOPE)
                    continue
                }
                deleted.push(...newLabels.splice(idx, 1))
            }
        } else {
            for (const label of labels as string[] | AnnotationLabel[]) {
                const labelId = typeof label === 'string' ? label : label.id
                for (let i=0; i<newLabels.length; i++) {
                    if (newLabels[i].id === labelId) {
                        if (newLabels[i].locked) {
                            Log.error(`Cannot remove locked label '${newLabels[i].label}'.`, SCOPE)
                            break
                        }
                        deleted.push(...newLabels.splice(i, 1))
                        break
                    }
                }
            }
        }
        this._setPropertyValue('labels', newLabels, {
            source: context?.source,
            callback: () => newLabels,
        })
        return deleted
    }

    removeTrend (name: string): boolean {
        const trend = this._trends.get(name)
        if (!trend) {
            Log.error(`Cannot remove trend '${name}': not found on this recording.`, SCOPE)
            return false
        }
        trend.cancelTrendComputation()
        this._trends.delete(name)
        this.dispatchPropertyChangeEvent('trends', this.trends, undefined)
        return true
    }

    async setActiveMontage (montage: number | string | null) {
        const prevMontage = this.activeMontage
        if (montage === null) {
            // Use raw signals.
            prevMontage?.removeAllEventListeners()
            if (this._activeMontage) {
                this._activeMontage.stopCachingSignals()
            }
            this._setPropertyValue('activeMontage', null)
            return
        }
        if (typeof montage === 'string') {
            // Match montage name to montage index.
            for (let i=0; i<this._montages.length; i++) {
                if (this._montages[i].name === montage) {
                    montage = i
                    break
                } else if (i === this._montages.length - 1) {
                    // No match found.
                    return
                }
            }
        }
        if ((montage as number) >= 0 && (montage as number) < this._montages.length) {
            if (this._activeMontage?.name !== this._montages[montage as number].name) {
                // Tear down the previous montage's listeners only when we are
                // actually switching. Doing this unconditionally (which the
                // previous version did) strips the per-channel relay listener
                // installed below and never re-adds it on a same-name no-op
                // call, silently breaking redraws for the rest of the session.
                prevMontage?.removeAllEventListeners()
                this._activeMontage?.stopCachingSignals()
                this._setPropertyValue('activeMontage', this._montages[montage as number])
                // Relay channel updates to the resource listeners.
                this._activeMontage?.onPropertyChange('channels', () => {
                    this.dispatchPropertyChangeEvent('channels', this.channels, this.channels)
                }, this.id)
                // Update filter settings in case they have changed since this montage was created/active.
                await this._activeMontage?.updateFilters()
                this.dispatchPropertyChangeEvent('activeMontage', this.activeMontage, prevMontage) // TODO: Deprecated.
            }
        }
    }

    setInterruptions (interruptions: SignalInterruptionMap) {
        const prevState = this.interruptions
        this._interruptions = interruptions
        // Set updated interruptions in montages.
        for (const montage of this._montages) {
            montage.setInterruptions(interruptions)
        }
        this.dispatchPropertyChangeEvent('interruptions', this.interruptions, prevState)
    }

    setDefaultSensitivity (value: number) {
        this._setPropertyValue('sensitivity', value)
    }

    async setHighpassFilter (value: number | null, target?: string | number, scope: string = 'recording') {
        if (value === null) {
            value = 0
        } else if (value < 0) {
            Log.error(`Highpass filter value must be zero or greater, ${value} was given.`, SCOPE)
            return
        } else if (value === this.filters.highpass) {
            // Compare against the effective value (routing-aware), not the recording's raw state.
            // Otherwise a cascade montage with highpass=0.5 won't see a user set-to-0 click when
            // the recording's value happens to be 0 already.
            return
        }
        const prevState = { ...this.filters }
        // Route to the active montage when it owns its display state — the montage's own filter
        // store becomes the truth; the recording's stays untouched until the user switches back.
        // The dispatched event still carries `this.filters`, which (via the routing getter)
        // already returns the montage's new values — so subscribers at recording level see the
        // change without needing to know about the override mechanism.
        if (this._activeMontage?.applyToMontage) {
            await this._activeMontage.setHighpassFilter(value, target)
            this.dispatchPropertyChangeEvent('filters', this.filters, prevState)
            return
        }
        if (typeof target === 'number' && this._activeMontage) {
            // Channel index can only refer to montage channels.
            await this._activeMontage.setHighpassFilter(value, target)
        } else {
            if (scope === 'recording') {
                // TODO: Actually check for the type and only alter those channels.
                if (!target) {
                    this._filters.highpass = value
                    await this._activeMontage?.updateFilters()
                }
            } else if (this._activeMontage) {
                await this._activeMontage.setHighpassFilter(value, target)
            }
        }
        this.dispatchPropertyChangeEvent('filters', this.filters, prevState)
    }

    async setLowpassFilter (value: number | null, target?: string | number, scope: string = 'recording') {
        if (value === null) {
            value = 0
        } else if (value < 0) {
            Log.error(`Lowpass filter value must be zero or greater, ${value} was given.`, SCOPE)
            return
        } else if (value === this.filters.lowpass) {
            // See setHighpassFilter — compare against the effective value, not the recording's raw state.
            return
        }
        const prevState = { ...this.filters }
        // See setHighpassFilter — route per active-montage flag, with dispatch retained.
        if (this._activeMontage?.applyToMontage) {
            await this._activeMontage.setLowpassFilter(value, target)
            this.dispatchPropertyChangeEvent('filters', this.filters, prevState)
            return
        }
        if (typeof target === 'number' && this._activeMontage) {
            // Channel index can only refer to montage channels.
            await this._activeMontage.setLowpassFilter(value, target)
        } else {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.lowpass = value
                    await this._activeMontage?.updateFilters()
                }
            } else if (this._activeMontage) {
                await this._activeMontage.setLowpassFilter(value, target)
            }
        }
        this.dispatchPropertyChangeEvent('filters', this.filters, prevState)
    }

    setMemoryManager (manager: MemoryManager | null) {
        this._memoryManager = manager
    }

    async setNotchFilter (value: number | null, target?: string | number, scope: string = 'recording') {
        if (value === null) {
            value = 0
        } else if (value < 0) {
            Log.error(`Notch filter value must be zero or greater, ${value} was given.`, SCOPE)
            return
        } else if (value === this.filters.notch) {
            // See setHighpassFilter — compare against the effective value, not the recording's raw state.
            return
        }
        const prevState = { ...this.filters }
        // See setHighpassFilter — route per active-montage flag, with dispatch retained.
        if (this._activeMontage?.applyToMontage) {
            await this._activeMontage.setNotchFilter(value, target)
            this.dispatchPropertyChangeEvent('filters', this.filters, prevState)
            return
        }
        if (typeof target === 'number' && this._activeMontage) {
            // Channel index can only refer to montage channels.
            await this._activeMontage.setNotchFilter(value, target)
        } else {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.notch = value
                    await this._activeMontage?.updateFilters()
                }
            } else if (this._activeMontage) {
                await this._activeMontage.setNotchFilter(value, target)
            }
        }
        this.dispatchPropertyChangeEvent('filters', this.filters, prevState)
    }

    async setupCache () {
        if (!this._service) {
            Log.error(`Cannot setup cache before service has been set.`, SCOPE)
            return null
        }
        const derivationSlots = this._derivationCacheSlotsForCommission()
        const result = await this._service.setupCache(this._dataDuration, derivationSlots)
        if (result) {
            this._cacheProps = result
        }
        return this._cacheProps
    }

    async setupMutex (): Promise<MutexExportProperties | null> {
        if (!this._service) {
            Log.error(`Cannot setup cache before service has been set.`, SCOPE)
            return null
        }
        const derivationSlots = this._derivationCacheSlotsForCommission()
        const result = await this._service.setupMutex(derivationSlots).then(response => {
            if (response) {
                Log.debug(`Mutex cache for raw signal data initiated.`, SCOPE)
                this._mutexProps = response
                return response
            } else {
                Log.error(`Mutex cache initialization failed.`, SCOPE)
                return null
            }
        }).catch((e: unknown) => {
            Log.error(`Failed to set up mutex in worker.`, SCOPE, e as Error)
            return null
        })
        return result
    }

    /**
     * Project `_derivationCacheSlots()` to the worker-message-friendly shape
     * (`BiosignalCacheDerivationSlot[]`). The `SetupDerivation` reference itself is dropped (it
     * carries display-state with no serialiser); the slot fields the materialisation pipeline
     * actually needs — sizing, op, inputs, options — cross the boundary verbatim.
     */
    protected _derivationCacheSlotsForCommission (): BiosignalCacheDerivationSlot[] {
        return this._derivationCacheSlots().map(s => ({
            active: s.derivation.active,
            label: s.derivation.label,
            name: s.derivation.name,
            operation: s.derivation.operation ?? 'linear',
            options: s.derivation.options,
            reference: s.derivation.reference,
            sampleCount: s.sampleCount,
            samplingRate: s.samplingRate,
        }))
    }

    async unload () {
        this.dispatchEvent(ResourceEvents.UNLOAD, 'before')
        await this.releaseBuffers()
        this.dispatchEvent(ResourceEvents.UNLOAD, 'after')
    }
}
