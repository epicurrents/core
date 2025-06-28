/**
 * Generic biosignal resource.
 * This class serves only as as superclass for more spesific biosignal classes.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { ResourceEvents } from '#events'
import { shouldDisplayChannel, getIncludedChannels, combineSignalParts } from '#util/signal'
import { nullPromise } from '#util/general'
import GenericResource from '#assets/GenericResource'
import type {
    BiosignalFilters,
    AnnotationTemplate,
    BiosignalAnnotation,
    BiosignalCursor,
    BiosignalDataService,
    BiosignalFilterType,
    BiosignalMontage,
    BiosignalResource,
    BiosignalSetup,
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

export default abstract class GenericBiosignalResource extends GenericResource implements BiosignalResource {
    // Protected properties.
    protected _activeMontage: BiosignalMontage | null = null
    protected _annotations: BiosignalAnnotation[] = []
    protected _cacheProps: SignalDataCache | null = null
    protected _channels: SourceChannel[] = []
    protected _cursors: BiosignalCursor[] = []
    protected _dataDuration: number = 0
    protected _displayViewStart: number = 0
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
    protected _mutexProps: MutexExportProperties | null = null
    protected _recordMontage: BiosignalMontage | null = null
    protected _sampleCount: number | null = null
    protected _samplingRate: number | null = null
    protected _sensitivity: number = 0
    protected _service: BiosignalDataService | null = null
    protected _setup: BiosignalSetup | null = null
    protected _signalCacheStatus: number[] = [0, 0]
    protected _startTime: Date | null = null
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
        this._filterChannelTypes = TYPE_SETTINGS?.filterChannelTypes || []
        this._filters.highpass = TYPE_SETTINGS?.filters.highpass.default || 0
        this._filters.lowpass = TYPE_SETTINGS?.filters.lowpass.default || 0
        this._filters.notch = TYPE_SETTINGS?.filters.notch.default || 0
    }

    get activeMontage () {
        return this._activeMontage
    }

    get annotations () {
        return this._annotations
    }
    set annotations (value: BiosignalAnnotation[]) {
        for (const newAnno of value) {
            if (!newAnno.id) {
                newAnno.id = GenericBiosignalResource.CreateUniqueId()
            }
        }
        // Sort the annotations in ascending order according to start time.
        value.sort((a, b) => a.start - b.start)
        this._setPropertyValue('annotations', value)
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

    get filterChannelTypes () {
        return this._filterChannelTypes
    }

    get filters () {
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
        return this._sensitivity
    }
    set sensitivity (value: number) {
        if (value <= 0) {
            Log.error(`Cannot set sensitivity to ${value}; value must be greater than zero.`, SCOPE)
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

    get timebase () {
        return this._timebase
    }
    set timebase (value: number) {
        this._setPropertyValue('timebase', value)
    }

    get timebaseUnit () {
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
    //                   METHODS                     //
    // ///////////////////////////////////////////// //

    addAnnotations (...annotations: BiosignalAnnotation[]) {
        let anyChange = false
        const prevState = [...this.annotations]
        new_loop:
        for (const newAnno of annotations) {
            for (const oldAnno of this._annotations) {
                if (
                    (oldAnno.id && oldAnno.id === newAnno.id)
                    || (
                        oldAnno.start === newAnno.start
                        && oldAnno.duration === newAnno.duration
                        && oldAnno.type === newAnno.type
                        && oldAnno.label === newAnno.label
                        && oldAnno.channels.length === newAnno.channels.length
                        && oldAnno.channels.every(val => newAnno.channels.includes(val))
                    )
                ) {
                    continue new_loop
                }
            }
            if (!newAnno.id) {
                newAnno.id = GenericBiosignalResource.CreateUniqueId()
            }
            this._annotations.push(newAnno)
            anyChange = true
        }
        if (anyChange) {
            this._annotations.sort((a, b) => a.start - b.start)
            this.dispatchPropertyChangeEvent('annotations', this.annotations, prevState)
        }
    }

    addAnnotationsFromTemplates (..._templates: AnnotationTemplate[]) {
        Log.warn(`addAnnotationsFromTemplates was not overridden in child class.`, SCOPE)
    }

    addCursors (...cursors: BiosignalCursor[]) {
        const prevState = [...this.cursors]
        for (const curs of cursors) {
            this._cursors.push(curs)
        }
        this.dispatchPropertyChangeEvent('cursors', this.cursors, prevState)
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

    async cacheSignals (..._ranges: [number, number][]) {
        // Start caching file data if recording was activated.
        if (this.isActive && !this._signalCacheStatus[1]) {
            Log.debug('Starting to cache signals from file.', SCOPE)
            return this._service?.cacheSignalsFromUrl() || false
        }
        return false
    }

    configure (config: ResourceConfig) {
        super.configure(config, CONFIG_SCHEMA, this)
    }

    async destroy (): Promise<void> {
        this._activeMontage?.removeAllEventListeners()
        this._activeMontage = null
        this._annotations.length = 0
        this._cacheProps = null
        this._channels.length = 0
        this._cursors.length = 0
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
                                   ? Math.round(range[1]*chan.samplingRate) : undefined
            if (
                !chan.signal.length ||
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

    removeAnnotations (...annos: string[] | number[] | BiosignalAnnotation[]): BiosignalAnnotation[] {
        const prevState = [...this._annotations]
        const deleted = [] as BiosignalAnnotation[]
        // All arguments must be of the same type, so we can check the first element.
        if (typeof annos[0] === 'number') {
            // Remaining IDs must be offset when annotations are removed from the preceding array.
            // We must go through the IDs in ascending order for this to work.
            const annoIdxs = (annos as number[]).sort((a, b) => a - b).map((v, i) => v - i)
            for (const idx of annoIdxs) {
                deleted.push(...this._annotations.splice(idx, 1))
            }
        } else {
            for (const anno of annos as string[] | BiosignalAnnotation[]) {
                const annoId = typeof anno === 'string' ? anno : anno.id
                for (let i=0; i<this._annotations.length; i++) {
                    if (this._annotations[i].id === annoId) {
                        deleted.push(...this._annotations.splice(i, 1))
                        break
                    }
                }
            }
        }
        this.dispatchPropertyChangeEvent('annotations', this.annotations, prevState)
        return deleted
    }

    async setActiveMontage (montage: number | string | null) {
        const prevMontage = this.activeMontage
        prevMontage?.removeAllEventListeners()
        if (montage === null) {
            // Use raw signals.
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
        } else if (value === this._filters.highpass) {
            return
        }
        const prevState = { ...this.filters }
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
        } else if (value === this._filters.lowpass) {
            return
        }
        const prevState = { ...this.filters }
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
        } else if (value === this._filters.notch) {
            return
        }
        const prevState = { ...this.filters }
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
        const result = await this._service.setupCache(this._dataDuration)
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
        const result = await this._service.setupMutex().then(response => {
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

    async unload () {
        this.dispatchEvent(ResourceEvents.UNLOAD, 'before')
        await this.releaseBuffers()
        this.dispatchEvent(ResourceEvents.UNLOAD, 'after')
    }
}
