/**
 * Generic biosignal resource.
 * This class serves only as as superclass for more spesific biosignal classes.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalAnnotation,
    type BiosignalChannel,
    type BiosignalCursor,
    type BiosignalMontage,
    type BiosignalResource,
    type BiosignalSetup,
    type VideoAttachment
} from "#types/biosignal"
import { type CommonBiosignalSettings, type ConfigChannelFilter } from "#types/config"
import { type SignalCacheResponse } from "#types/service"
import { Log } from 'scoped-ts-log'
import SETTINGS from "#config/Settings"
import GenericResource from "#assets/GenericResource"
import { BiosignalService } from "#assets/biosignal"
import { StudyContext } from "#types/study"
import { nullPromise } from "#util/general"
import { shouldDisplayChannel } from "#util/signal"

const SCOPE = 'GenericBiosignalResource'

export default abstract class GenericBiosignalResource extends GenericResource implements BiosignalResource {

    protected _activeMontage: BiosignalMontage | null = null
    protected _annotations: BiosignalAnnotation[] = []
    protected _channels: BiosignalChannel[] = []
    protected _cursors: BiosignalCursor[] = []
    protected _dataDuration: number = 0
    protected _dataGaps = new Map<number, number>()
    protected _displayViewStart: number = 0
    protected _filters = {
        highpass: 0,
        lowpass: 0,
        notch: 0,
    }
    protected _loaded = false
    protected _montages: BiosignalMontage[] = []
    protected _recordMontage: BiosignalMontage | null = null
    protected _sampleCount: number | null = null
    protected _samplingRate: number | null = null
    protected _sensitivity: number
    protected _service: BiosignalService | null = null
    protected _setup: BiosignalSetup | null = null
    protected _signalCacheStatus: number[] = [0, 0]
    protected _startTime: Date | null = null
    protected _totalDuration: number = 0
    protected _url: string = ''
    protected _videos: VideoAttachment[] = []
    protected _viewStart: number = 0

    constructor (name: string, sensitivity: number, type: string, source?: StudyContext) {
        super(name, GenericResource.SCOPES.BIOSIGNAL, type, source)
        this._sensitivity = sensitivity
        // Set default filters
        this._filters.highpass = (SETTINGS.modules[type] as CommonBiosignalSettings)?.filters.highpass.default || 0
        this._filters.lowpass = (SETTINGS.modules[type] as CommonBiosignalSettings)?.filters.lowpass.default || 0
        this._filters.notch = (SETTINGS.modules[type] as CommonBiosignalSettings)?.filters.notch.default || 0
    }

    get activeMontage () {
        return this._activeMontage
    }

    get annotations () {
        return this._annotations
    }
    set annotations (annotations: BiosignalAnnotation[]) {
        // Sort the annotations in ascending order according to start time.
        annotations.sort((a, b) => a.start - b.start)
        this._annotations = annotations
        this.onPropertyUpdate('annotations')
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
    set dataDuration (duration :number) {
        this._dataDuration = duration
    }

    get dataGaps () {
        return this._dataGaps
    }
    set dataGaps (gaps: Map<number, number>) {
        this._dataGaps = gaps
        this.onPropertyUpdate('data-gaps')
        // Set updated data gaps in montages.
        for (const montage of this._montages) {
            montage.dataGaps = gaps
        }
    }

    get displayViewStart () {
        return this._displayViewStart
    }
    set displayViewStart (value :number) {
        this._displayViewStart = value
        this.onPropertyUpdate('display-view-start')
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

    get isPrepared () {
        return this._loaded
    }
    set isPrepared (value: boolean) {
        this._loaded = value
        this.onPropertyUpdate('is-prepared')
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
        this._sampleCount = value
    }

    get samplingRate () {
        return this._samplingRate
    }
    set samplingRate (value: number | null) {
        this._samplingRate = value
    }

    get sensitivity () {
        return this._sensitivity
    }
    set sensitivity (value: number) {
        if (value <= 0) {
            Log.error(`Sensitivity must be greater than zero, ${value} was given.`, SCOPE)
            return
        }
        this._sensitivity = value
        this.onPropertyUpdate('sensitivity')
    }

    get setup () {
        return this._setup
    }
    set setup (setup: BiosignalSetup | null) {
        this._setup = setup
        this.onPropertyUpdate('setup')
    }

    get signalCacheStatus () {
        return this._signalCacheStatus
    }
    set signalCacheStatus (status: number[]) {
        if (status.length !== 2) {
            Log.error(`Signal cache status must be a numeric array with length of 2 ` +
                      `(array with length of ${status.length} given).`, SCOPE)
            return
        }
        this._signalCacheStatus = status
        this.onPropertyUpdate('signal-cache-status')
    }

    get startTime () {
        return this._startTime
    }

    get totalDuration () {
        return this._totalDuration
    }
    set totalDuration (duration :number) {
        this._totalDuration = duration
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
    }

    get viewStart () {
        return this._viewStart
    }
    set viewStart (start: number) {
        if (start < 0) {
            start = 0
        }
        this._viewStart = start
        this.onPropertyUpdate('view-start')
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

    addDataGaps (gaps: Map<number, number>) {
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

    deleteAnnotations (...ids: string[] | number[]) {
        let idxOffset = 0
        for (const id of ids) {
            if (typeof id === 'number' && id >= 0 && id - idxOffset < this._annotations.length) {
                this._annotations.splice(id - idxOffset, 1)
                idxOffset++
            } else if (typeof id === 'string') {
                for (let i=0; i<this._annotations.length; i++) {
                    if (this._annotations[i].id === id) {
                        this._annotations.splice(i, 1)
                        break
                    }
                }
            }
        }
        this.onPropertyUpdate('annotations')
    }

    getAllSignals (range: number[], config?: ConfigChannelFilter): Promise<SignalCacheResponse | null> {
        if (!this._activeMontage) {
            return this.getAllRawSignals(range, config)
        }
        return this._activeMontage.getAllSignals(range, config).then((response) => {
            return response
        })
    }

    getAllRawSignals (range: number[], config?: ConfigChannelFilter): Promise<SignalCacheResponse | null> {
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

    getChannelSignal(channel: string | number, range: number[], config?: ConfigChannelFilter):
    Promise<SignalCacheResponse | null> {
        if (!this._activeMontage) {
            return this.getRawChannelSignal(channel, range, config)
        }
        return this._activeMontage.getChannelSignal(channel, range, config).then((response) => {
            return response
        })
    }

    async getRawChannelSignal (channel: number | string, range: number[], config?: ConfigChannelFilter):
    Promise<SignalCacheResponse | null> {
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
        return this._service?.getSignals(range, config) || nullPromise
    }

    async releaseBuffers () {
        Log.info(`Releasing data buffers in ${this.name}.`, SCOPE)
        for (const mtg of this._montages) {
            await mtg.releaseBuffers()
        }
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
            // Use raw signals
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
            this._activeMontage.setHighpassFilter(target, value)
        } else if (typeof target === 'string') {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.highpass = value
                }
            } else if (this._activeMontage) {
                this._activeMontage.setHighpassFilter(target, value)
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
            this._activeMontage.setLowpassFilter(target, value)
        } else if (typeof target === 'string') {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.lowpass = value
                }
            } else if (this._activeMontage) {
                this._activeMontage.setLowpassFilter(target, value)
            }
        }
        this._activeMontage?.updateFilters()
        this.onPropertyUpdate('lowpass-filter')
    }

    setNotchFilter (value: number | null, target?: string | number, scope: string = 'recording') {
        if (value === null) {
            value = 0
        } else if (value < 0 || value === this._filters.notch) {
            return
        }
        if (typeof target === 'number' && this._activeMontage) {
            // Channel index can only refer to montage channels.
            this._activeMontage.setNotchFilter(target, value)
        } else if (typeof target === 'string') {
            if (scope === 'recording') {
                if (!target) {
                    this._filters.notch = value
                }
            } else if (this._activeMontage) {
                this._activeMontage.setNotchFilter(target, value)
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
}
