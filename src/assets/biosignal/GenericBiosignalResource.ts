/**
 * Generic biosignal resource.
 * This class serves only as as superclass for more spesific biosignal classes.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

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
    SignalDataGap,
    SignalDataGapMap,
    SignalPart,
    SourceChannel,
    VideoAttachment
} from '#types/biosignal'
import type { CommonBiosignalSettings, ConfigChannelFilter } from '#types/config'
import type {
    MemoryManager,
    SignalCachePart,
    SignalCacheResponse,
} from '#types/service'
import type { StudyContext } from '#types/study'
import Log from 'scoped-event-log'
import type { MutexExportProperties } from 'asymmetric-io-mutex'

const SCOPE = 'GenericBiosignalResource'

export default abstract class GenericBiosignalResource extends GenericResource implements BiosignalResource {

    protected _activeMontage: BiosignalMontage | null = null
    protected _annotations: BiosignalAnnotation[] = []
    protected _cacheProps: SignalDataCache | null = null
    protected _channels: SourceChannel[] = []
    protected _cursors: BiosignalCursor[] = []
    protected _dataDuration: number = 0
    protected _dataGaps: SignalDataGapMap = new Map<number, number>()
    protected _displayViewStart: number = 0
    protected _filterChannelTypes = {} as { [type: string]: BiosignalFilterType[] }
    protected _filters = {
        bandreject: [],
        highpass: 0,
        lowpass: 0,
        notch: 0,
    } as BiosignalFilters
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
        const TYPE_SETTINGS = window.__EPICURRENTS__.RUNTIME?.SETTINGS.modules[modality] as CommonBiosignalSettings
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
    set dataDuration (value :number) {
        this._setPropertyValue('dataDuration', value)
    }

    get dataGaps (): SignalDataGap[] {
        const dataGaps = [] as SignalDataGap[]
        let priorGapsTotal = 0
        for (const gap of this._dataGaps) {
            dataGaps.push({ start: gap[0] + priorGapsTotal, duration: gap[1] })
            priorGapsTotal += gap[1]
        }
        return dataGaps
    }
    set dataGaps (value: SignalDataGap[]) {
        const prevState = [...this.dataGaps]
        this._dataGaps.clear()
        for (const gap of value) {
            this._dataGaps.set(gap.start, gap.duration)
        }
        // Set updated data gaps in montages.
        for (const montage of this._montages) {
            montage.setDataGaps(this._dataGaps)
        }
        this.dispatchPropertyChangeEvent('dataGaps', this.dataGaps, prevState)
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
        return (this._videos.length > 0)
    }

    get id () {
        return this._id
    }

    get loader () {
        return this._service
    }

    get maxSampleCount () {
        return Math.max(0, ...this._channels.filter(chan => shouldDisplayChannel(chan, true))
                                            .map(chan => chan.sampleCount))
    }

    get maxSamplingRate () {
        return Math.max(0, ...this._channels.filter(chan => shouldDisplayChannel(chan, true))
                                            .map(chan => chan.samplingRate))
    }

    get montages () {
        return this._montages
    }
    set montages (value: BiosignalMontage[]) {
        this._setPropertyValue('montages', value)
    }

    get name () {
        return this._name
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

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    addAnnotations (...annotations: BiosignalAnnotation[]) {
        let anyChange = false
        const prevState = [...this.annotations]
        new_loop:
        for (const newAnno of annotations) {
            for (const oldAnno of this._annotations) {
                if (
                    (oldAnno.id && oldAnno.id === newAnno.id) ||
                    (
                        oldAnno.start === newAnno.start &&
                        oldAnno.duration === newAnno.duration &&
                        oldAnno.type === newAnno.type &&
                        oldAnno.label === newAnno.label &&
                        oldAnno.channels.length === newAnno.channels.length &&
                        oldAnno.channels.every(val => newAnno.channels.includes(val))
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

    addDataGaps (gaps: SignalDataGapMap) {
        let anyChange = false
        const prevState = this.dataGaps
        for (const gap of gaps) {
            if (this._dataGaps.get(gap[0]) !== gap[1]) {
                this._dataGaps.set(gap[0], gap[1])
                anyChange = true
            }
        }
        if (anyChange) {
            // Propagate new data gaps to montages.
            for (const montage of this._montages) {
                montage.setDataGaps(gaps)
            }
            this.dispatchPropertyChangeEvent('dataGaps', this.dataGaps, prevState)
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

    getDataGaps (useCacheTime = false): SignalDataGap[] {
        const dataGaps = [] as SignalDataGap[]
        let priorGapsTotal = 0
        for (const gap of this._dataGaps) {
            const gapTime = useCacheTime ? gap[0] : gap[0] + priorGapsTotal
            dataGaps.push({ start: gapTime, duration: gap[1] })
            priorGapsTotal += gap[1]
        }
        return dataGaps
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
        Log.info(`Releasing data buffers in ${this.name}.`, SCOPE)
        await Promise.all(this._montages.map(m => m.releaseBuffers()))
        Log.info(`Montage buffers released.`, SCOPE)
        this._montages.splice(0)
        this._montages = []
        await this.loader?.unload()
        Log.info(`Signal loader buffers released.`, SCOPE)
        this.signalCacheStatus.splice(0)
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

    setDataGaps (gaps: SignalDataGapMap) {
        const prevState = this.dataGaps
        this._dataGaps = gaps
        // Set updated data gaps in montages.
        for (const montage of this._montages) {
            montage.setDataGaps(gaps)
        }
        this.dispatchPropertyChangeEvent('dataGaps', this.dataGaps, prevState)
    }

    setDefaultSensitivity (value: number) {
        this._setPropertyValue('sensitivity', value)
    }

    setHighpassFilter (value: number | null, target?: string | number, scope: string = 'recording') {
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
            this._activeMontage.setHighpassFilter(value, target)
        } else {
            if (scope === 'recording') {
                // TODO: Actually check for the type and only alter those channels.
                if (!target) {
                    this._filters.highpass = value
                    this._activeMontage?.updateFilters()
                }
            } else if (this._activeMontage) {
                this._activeMontage.setHighpassFilter(value, target)
            }
        }
        this.dispatchPropertyChangeEvent('filters', this.filters, prevState)
    }

    setLowpassFilter (value: number | null, target?: string | number, scope: string = 'recording') {
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
            this._activeMontage.setLowpassFilter(value, target)
        } else {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.lowpass = value
                    this._activeMontage?.updateFilters()
                }
            } else if (this._activeMontage) {
                this._activeMontage.setLowpassFilter(value, target)
            }
        }
        this.dispatchPropertyChangeEvent('filters', this.filters, prevState)
    }

    setMemoryManager (manager: MemoryManager | null) {
        this._memoryManager = manager
    }

    setNotchFilter (value: number | null, target?: string | number, scope: string = 'recording') {
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
            this._activeMontage.setNotchFilter(value, target)
        } else {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.notch = value
                    this._activeMontage?.updateFilters()
                }
            } else if (this._activeMontage) {
                this._activeMontage.setNotchFilter(value, target)
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
            this._cacheProps = result as SignalDataCache
        }
        return this._cacheProps
    }

    async setupMutex (): Promise<MutexExportProperties | null> {
        if (!this._service) {
            Log.error(`Cannot setup cache before service has been set.`, SCOPE)
            return null
        }
        const result = await this._service.setupMutex().then(async response => {
            if (response) {
                Log.debug(`Cache for raw signal data initiated.`, SCOPE)
                this._mutexProps = response
                return response
            } else {
                Log.error(`Cache initialization failed.`, SCOPE)
                return null
            }
        }).catch(e => {
            Log.error(`Failed to set up mutex in worker.`, SCOPE, e)
            return null
        })
        return result
    }

    startCachingSignals () {
        // Start caching file data if recording was activated.
        if (this.isActive && !this._signalCacheStatus[1]) {
            Log.debug("Starting to cache signals from file.", SCOPE)
            this._service?.cacheSignalsFromUrl()
        }
    }

    unload () {
        return this.releaseBuffers()
    }
}
