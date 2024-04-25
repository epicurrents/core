/**
 * Generic biosignal resource.
 * This class serves only as as superclass for more spesific biosignal classes.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalAnnotation,
    type BiosignalChannel,
    type BiosignalCursor,
    type BiosignalDataService,
    type BiosignalMontage,
    type BiosignalResource,
    type BiosignalSetup,
    type SignalDataGap,
    type SignalDataGapMap,
    type SignalPart,
    type VideoAttachment
} from '#types/biosignal'
import { type CommonBiosignalSettings, type ConfigChannelFilter } from '#types/config'
import {
    type MemoryManager,
    type SignalCachePart,
    type SignalCacheResponse,
} from '#types/service'
import { type StudyContext } from '#types/study'
import { nullPromise } from '#util/general'
import { shouldDisplayChannel, getIncludedChannels, combineSignalParts } from '#util/signal'
import GenericResource from '#assets/GenericResource'
import Log from 'scoped-ts-log'

const SCOPE = 'GenericBiosignalResource'

export default abstract class GenericBiosignalResource extends GenericResource implements BiosignalResource {

    protected _activeMontage: BiosignalMontage | null = null
    protected _annotations: BiosignalAnnotation[] = []
    protected _channels: BiosignalChannel[] = []
    protected _cursors: BiosignalCursor[] = []
    protected _dataDuration: number = 0
    protected _dataGaps: SignalDataGapMap = new Map<number, number>()
    protected _displayViewStart: number = 0
    protected _filters = {
        highpass: 0,
        lowpass: 0,
        notch: 0,
    }
    protected _loaded = false
    protected _memoryManager: MemoryManager | null = null
    protected _montages: BiosignalMontage[] = []
    protected _recordMontage: BiosignalMontage | null = null
    protected _sampleCount: number | null = null
    protected _samplingRate: number | null = null
    protected _sensitivity: number = 0
    protected _service: BiosignalDataService | null = null
    protected _setup: BiosignalSetup | null = null
    protected _signalCacheStatus: number[] = [0, 0]
    protected _startTime: Date | null = null
    protected _totalDuration: number = 0
    protected _url: string = ''
    protected _videos: VideoAttachment[] = []
    protected _viewStart: number = 0

    constructor (name: string, type: string, source?: StudyContext) {
        const TYPE_SETTINGS = window.__EPICURRENTS_RUNTIME__?.SETTINGS.modules[type] as CommonBiosignalSettings
        super(name, GenericResource.SCOPES.BIOSIGNAL, type, source)
        // Set default filters.
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
        const oldVal = [...this._annotations]
        for (const newAnno of value) {
            if (!newAnno.id) {
                newAnno.id = GenericBiosignalResource.CreateUniqueId()
            }
        }
        // Sort the annotations in ascending order according to start time.
        value.sort((a, b) => a.start - b.start)
        this._annotations = value
        this.onPropertyUpdate('annotations', value, oldVal)
    }

    get channels () {
        return this._channels
    }

    get cursors () {
        return this._cursors
    }

    get dataDuration () {
        return this._dataDuration
    }
    set dataDuration (value :number) {
        const oldVal = this._dataDuration
        this._dataDuration = value
        this.onPropertyUpdate('data-duration', value, oldVal)
    }

    get displayViewStart () {
        return this._displayViewStart
    }
    set displayViewStart (value: number) {
        const oldVal = this._displayViewStart
        this._displayViewStart = value
        this.onPropertyUpdate('display-view-start', value, oldVal)
    }

    get filters () {
        return this._filters
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
    set montages (montages: BiosignalMontage[]) {
        this._montages = montages
        this.onPropertyUpdate('montages')
    }

    get name () {
        return this._name
    }

    get recordMontage () {
        return this._recordMontage
    }
    set recordMontage (montage: BiosignalMontage | null) {
        this._recordMontage = montage
    }

    get sampleCount () {
        return this._sampleCount
    }
    set sampleCount (value: number | null) {
        if (value !== null && value < 0) {
            Log.error(`Cannot set sample count to ${value}; value must be zero or greater.`, SCOPE)
            return
        }
        const oldVal = this._sampleCount
        this._sampleCount = value
        this.onPropertyUpdate('sample-count', value, oldVal)
    }

    get samplingRate () {
        return this._samplingRate
    }
    set samplingRate (value: number | null) {
        if (value !== null && value <= 0) {
            Log.error(`Cannot set sampling rate to ${value}; value must be greater than zero.`, SCOPE)
            return
        }
        const oldVal = this._samplingRate
        this._samplingRate = value
        this.onPropertyUpdate('sampling-rate', value, oldVal)
    }

    get sensitivity () {
        return this._sensitivity
    }
    set sensitivity (value: number) {
        if (value <= 0) {
            Log.error(`Cannot set sensitivity to ${value}; value must be greater than zero.`, SCOPE)
            return
        }
        const oldVal = this._sensitivity
        this._sensitivity = value
        this.onPropertyUpdate('sensitivity', value, oldVal)
    }

    get setup () {
        return this._setup
    }
    set setup (value: BiosignalSetup | null) {
        const oldVal = this._setup
        this._setup = value
        this.onPropertyUpdate('setup', value, oldVal)
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
        const oldVal = [...this._signalCacheStatus]
        this._signalCacheStatus = value
        this.onPropertyUpdate('signal-cache-status', value, oldVal)
    }

    get startTime () {
        return this._startTime
    }

    get totalDuration () {
        return this._totalDuration
    }
    set totalDuration (value: number) {
        if (value <= 0) {
            Log.error(`Cannot set total duration to ${value}; value must be zero or greater.`, SCOPE)
            return
        }
        const oldVal = this._totalDuration
        this._totalDuration = value
        this.onPropertyUpdate('total-duration', value, oldVal)
    }

    get type () {
        return this._type
    }

    get url () {
        return this._url
    }

    get videos () {
        return this._videos
    }
    set videos (videos: VideoAttachment[]) {
        this._videos = videos
        this.onPropertyUpdate('videos', videos)
    }

    get viewStart () {
        return this._viewStart
    }
    set viewStart (value: number) {
        if (value < 0) {
            value = 0
        }
        const oldVal = this._viewStart
        this._viewStart = value
        this.onPropertyUpdate('view-start', value, oldVal)
    }

    get visibleChannels () {
        return this._channels.filter(c => shouldDisplayChannel(c, true))
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    addAnnotations (...annotations: BiosignalAnnotation[]) {
        let anyChange = false
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
            this.onPropertyUpdate('annotations')
        }
    }

    addCursors (...cursors: BiosignalCursor[]) {
        for (const curs of cursors) {
            this._cursors.push(curs)
        }
    }

    addDataGaps (gaps: SignalDataGapMap) {
        let anyChange = false
        for (const gap of gaps) {
            if (this._dataGaps.get(gap[0]) !== gap[1]) {
                this._dataGaps.set(gap[0], gap[1])
                anyChange = true
            }
        }
        if (anyChange) {
            this.onPropertyUpdate('data-gaps')
        }
    }

    deleteAnnotations (...ids: string[] | number[]): BiosignalAnnotation[] {
        let idxOffset = 0
        const deleted = [] as BiosignalAnnotation[]
        for (const id of ids) {
            if (typeof id === 'number' && id >= 0 && id - idxOffset < this._annotations.length) {
                deleted.push(...this._annotations.splice(id - idxOffset, 1))
                idxOffset++
            } else if (typeof id === 'string') {
                for (let i=0; i<this._annotations.length; i++) {
                    if (this._annotations[i].id === id) {
                        deleted.push(...this._annotations.splice(i, 1))
                        break
                    }
                }
            }
        }
        this.onPropertyUpdate('annotations')
        return deleted
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

    removeAllPropertyUpdateHandlers () {
        for (const chan of this._channels) {
            chan.removeAllPropertyUpdateHandlers()
        }
        super.removeAllPropertyUpdateHandlers()
    }

    async setActiveMontage (montage: number | string | null) {
        this._activeMontage?.removeAllPropertyUpdateHandlers()
        if (montage === null) {
            // Use raw signals.
            if (this._activeMontage) {
                this._activeMontage.stopCachingSignals()
            }
            this._activeMontage = null
            this.onPropertyUpdate('active-montage')
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
                this._activeMontage = this._montages[montage as number]
                // Relay channel updates to the resource listeners.
                this._activeMontage.addPropertyUpdateHandler('channels', () => {
                    this.activeMontage?.updateFilters()
                    this.onPropertyUpdate('channels')
                })
                // Update filter settings in case they have changed since this montage was created/active.
                await this._activeMontage.updateFilters()
                this.onPropertyUpdate('active-montage')
            }
        }
    }

    setDataGaps (gaps: SignalDataGapMap) {
        const oldVal = new Map(this._dataGaps)
        this._dataGaps = gaps
        this.onPropertyUpdate('data-gaps', gaps, oldVal)
        // Set updated data gaps in montages.
        for (const montage of this._montages) {
            montage.setDataGaps(gaps)
        }
    }

    setDefaultSensitivity (value: number) {
        this.sensitivity = value
    }

    setHighpassFilter (value: number | null, target?: string | number, scope: string = 'recording') {
        if (value === null) {
            value = 0
        } else if (value < 0 || value === this._filters.highpass) {
            return
        }
        if (typeof target === 'number' && this._activeMontage) {
            // Channel index can only refer to montage channels.
            this._activeMontage.setHighpassFilter(value, target)
        } else {
            if (scope === 'recording') {
                // TODO: Actually check for the type and only alter those channels.
                if (!target) {
                    this._filters.highpass = value
                }
            } else if (this._activeMontage) {
                this._activeMontage.setHighpassFilter(value, target)
            }
        }
        this._activeMontage?.updateFilters()
        this.onPropertyUpdate('highpass-filter')
    }

    setLowpassFilter (value: number | null, target?: string | number, scope: string = 'recording') {
        if (value === null) {
            value = 0
        } else if (value < 0 || value === this._filters.lowpass) {
            return
        }
        if (typeof target === 'number' && this._activeMontage) {
            // Channel index can only refer to montage channels.
            this._activeMontage.setLowpassFilter(value, target)
        } else {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.lowpass = value
                }
            } else if (this._activeMontage) {
                this._activeMontage.setLowpassFilter(value, target)
            }
        }
        this._activeMontage?.updateFilters()
        this.onPropertyUpdate('lowpass-filter')
    }

    setMemoryManager (manager: MemoryManager | null) {
        this._memoryManager = manager
    }

    setNotchFilter (value: number | null, target?: string | number, scope: string = 'recording') {
        if (value === null) {
            value = 0
        } else if (value < 0 || value === this._filters.notch) {
            return
        }
        if (typeof target === 'number' && this._activeMontage) {
            // Channel index can only refer to montage channels.
            this._activeMontage.setNotchFilter(value, target)
        } else {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.notch = value
                }
            } else if (this._activeMontage) {
                this._activeMontage.setNotchFilter(value, target)
            }
        }
        this._activeMontage?.updateFilters()
        this.onPropertyUpdate('notch-filter')
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
