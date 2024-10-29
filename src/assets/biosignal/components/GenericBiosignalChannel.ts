/**
 * Biosignal channel.
 * This is the root class that other biosignal channel classes should extend.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-ts-log'
import {
    type BiosignalLaterality,
    type BiosignalChannel,
    type BiosignalChannelMarker,
    type BiosignalCursor,
    type SignalPolarity,
} from '#types/biosignal'
import GenericAsset from '#assets/GenericAsset'

const SCOPE = "GenericBiosignalChannel"

export default abstract class GenericBiosignalChannel extends GenericAsset implements BiosignalChannel {
    protected _active: number
    protected _amplification: number
    protected _cursors = {
        horizontal: [] as BiosignalCursor[],
        vertical: [] as BiosignalCursor[],
    }
    protected _averaged: boolean
    protected _displayPolarity: -1 | 0 | 1 = 0
    protected _highpassFilter: number | null = null
    protected _label: string
    protected _laterality: BiosignalLaterality
    protected _lowpassFilter: number | null = null
    protected _markers: BiosignalChannelMarker[] = []
    protected _notchFilter: number | null = null
    protected _offset: BiosignalChannel['offset']
    protected _originalSampleCount?: number
    protected _originalSamplingRate?: number
    protected _reference: number[]
    protected _sampleCount: number = 0
    protected _samplingRate: number = 0
    protected _sensitivity: number
    protected _signal: Float32Array = new Float32Array() // Placeholder until the signal has been computed
    protected _triggerCache = new Map<number, number[]>()
    protected _triggerPoints: number[] = []
    protected _triggerPosition: number = 0.5
    protected _triggerValue: number = 0
    protected _unit: string
    protected _visible: boolean

    constructor (
        name: string,
        label: string,
        type: string,
        active: number,
        reference: number[],
        averaged: boolean,
        samplingRate: number,
        unit: string,
        visible: boolean,
        extraProperties = {} as Partial<BiosignalChannel>
    ) {
        super(name, GenericAsset.CONTEXTS.BIOSIGNAL, type || 'unk')
        this._type = type // override the checking in generic asset for now... need to make this more dynamic
        this._label = label
        this._active = active
        this._averaged = averaged
        this._reference = reference
        this._samplingRate = samplingRate
        this._laterality = extraProperties.laterality || ''
        this._visible = visible
        this._unit = unit
        this._amplification = extraProperties.amplification !== undefined ? extraProperties.amplification : 1
        this._offset = typeof extraProperties.offset === 'number'
            // A channel with only baseline set will take up the whole plot space
            ? {
                baseline: extraProperties.offset,
                bottom: 0,
                top: 1
            }
            : {
                baseline: extraProperties.offset?.baseline !== undefined ? extraProperties.offset.baseline : 0.5,
                bottom: extraProperties.offset?.bottom !== undefined ? extraProperties.offset.bottom : 0,
                top: extraProperties.offset?.top !== undefined ? extraProperties.offset.top : 1
            }
        // Zero means that viewer's master sensitivity is used
        this._sensitivity = extraProperties.sensitivity !== undefined ? extraProperties.sensitivity : 0
        // The following numeric values have 0 as a default, so they can be checked more leniently
        if (extraProperties.displayPolarity) {
            this._displayPolarity = extraProperties.displayPolarity
        }
        if (extraProperties.highpassFilter) {
            this._highpassFilter = extraProperties.highpassFilter
        }
        if (extraProperties.lowpassFilter) {
            this._lowpassFilter = extraProperties.lowpassFilter
        }
        if (extraProperties.notchFilter) {
            this._notchFilter = extraProperties.notchFilter
        }
        if (extraProperties.originalSampleCount) {
            this._originalSampleCount = extraProperties.originalSampleCount
        }
        if (extraProperties.originalSamplingRate) {
            this._originalSamplingRate = extraProperties.originalSamplingRate
        }
        if (extraProperties.sampleCount) {
            this._sampleCount = extraProperties.sampleCount
        }
    }

    get active () {
        return this._active
    }
    set active (value: number) {
        this._setPropertyValue('active', value)
    }

    get amplification () {
        return this._amplification
    }

    get averaged () {
        return this._averaged
    }
    set averaged (value: boolean) {
        this._setPropertyValue('averaged', value)
    }

    get cursors () {
        return this._cursors
    }
    set cursors (value: { horizontal: BiosignalCursor[], vertical: BiosignalCursor[] }) {
        this._setPropertyValue('cursors', value)
    }

    get displayPolarity () {
        return this._displayPolarity
    }
    set displayPolarity (value: SignalPolarity) {
        this._setPropertyValue('displayPolarity', value)
    }

    get highpassFilter () {
        return this._highpassFilter
    }
    set highpassFilter (value: number | null) {
        if (value && value < 0) {
            Log.error(`High-pass filter must be either null or non-negative number, ${value} was given.`, SCOPE)
            return
        }
        this._setPropertyValue('highpassFilter', value)
    }

    get label () {
        return this._label
    }

    get laterality () {
        return this._laterality
    }

    get lowpassFilter () {
        return this._lowpassFilter
    }
    set lowpassFilter (value: number | null) {
        if (value && value < 0) {
            Log.error(`Low-pass filter must be either null or non-negative number, ${value} was given.`, SCOPE)
            return
        }
        this._setPropertyValue('lowpassFilter', value)
    }

    get markers () {
        return this._markers
    }

    get notchFilter () {
        return this._notchFilter
    }
    set notchFilter (value: number | null) {
        if (value && value < 0) {
            Log.error(`Notch filter must be either null or non-negative number, ${value} was given.`, SCOPE)
            return
        }
        this._setPropertyValue('notchFilter', value)
    }

    get offset () {
        return this._offset
    }
    set offset (value: BiosignalChannel['offset']) {
        this._setPropertyValue('offset', {
            baseline: value.baseline,
            bottom: value.bottom !== undefined ? value.bottom : 0,
            top: value.top !== undefined ? value.top : 1
        })
    }

    get originalSampleCount () {
        return this._originalSampleCount
    }

    get originalSamplingRate () {
        return this._originalSamplingRate
    }

    get reference () {
        return this._reference
    }
    set reference (value: number[]) {
        this._setPropertyValue('reference', value)
    }

    get sampleCount () {
        return this._sampleCount
    }

    get samplingRate () {
        return this._samplingRate
    }

    get sensitivity () {
        return this._sensitivity
    }
    set sensitivity (value: number) {
        if (value < 0) {
            Log.error(`Sensitivity must be a non-negative number, ${value} was given.`, SCOPE)
            return
        }
        this._setPropertyValue('sensitivity', value)
    }

    get signal () {
        return this._signal
    }

    get triggerPoints () {
        return this._triggerPoints
    }
    set triggerPoints (value: number[]) {
        this._setPropertyValue('triggerPoints', value)
    }

    get triggerPosition () {
        return this._triggerValue
    }
    set triggerPosition (value: number) {
        this._setPropertyValue('triggerPosition', value)
    }

    get triggerValue () {
        return this._triggerValue
    }
    #triggerValueTimeout = 0
    set triggerValue (value: number) {
        // Drag events are fired very rapidly, don't recalculate on every event.
        const RECALCULATION_TIMEOUT = 100
        if (this.#triggerValueTimeout) {
            window.clearTimeout(this.#triggerValueTimeout)
        }
        this.#triggerValueTimeout = window.setTimeout(() => {
            const prevValue = this._triggerValue
            if (this.dispatchPropertyChangeEvent('triggerValue', value, prevValue, 'before')) {
                this._triggerValue = value
                this._triggerCache.clear()
                this.findTriggerPoints()
                this.dispatchPropertyChangeEvent('triggerValue', value, prevValue)
            }
        }, RECALCULATION_TIMEOUT)
    }

    get unit () {
        return this._unit
    }
    set unit (value: string) {
        this._setPropertyValue('unit', value)
    }

    get visible () {
        return this._visible
    }
    set visible (value: boolean) {
        this._setPropertyValue('visible', value)
    }

    addMarkers (...markers: BiosignalChannelMarker[]) {
        // Generally the first two markers are always used for property calculations,
        // beyond that it depends on the case.
        const ALWAYS_ACTIVE_COUNT = 2
        for (const mark of markers) {
            this._markers.push(mark)
            if (this._markers.length <= ALWAYS_ACTIVE_COUNT) {
                mark.active = true
            }
        }
    }

    addTriggerPoints (...points: number[]) {
        new_point_loop:
        for (const point of points) {
            for (let i=0; i<this._triggerPoints.length; i++) {
                const p = this._triggerPoints[i]
                // No duplicate points
                if (p === point) {
                    continue new_point_loop
                } else if (p > point) {
                    // Insert before the first larger value
                    this._triggerPoints.splice(i, 0, point)
                    this._triggerCache.clear()
                    continue new_point_loop
                }
            }
            // Add to the end of the array if no larger pre-existing value was found
            this._triggerPoints.push(point)
        }
    }

    clearTriggerPoints () {
        this._triggerPoints.splice(0)
        this._triggerCache.clear()
    }

    findTriggerPoints (value?: number) {
        const trigger = value || this._triggerValue
        this._triggerPoints.splice(0)
        let prevSample = 0
        for (let i=0; i<this._signal.length; i++) {
            const s = this._signal[i]
            if (
                s === trigger ||
                s > trigger && prevSample < trigger ||
                s < trigger && prevSample > trigger

            ) {
                this._triggerPoints.push(i)
                prevSample = s
            }
        }
        return this._triggerPoints
    }

    getTriggerPointsForWindow (win: number) {
        if (!this._triggerPoints.length) {
            // Trigger points have been cleared
            return []
        }
        if (this._triggerCache.has(win)) {
            return this._triggerCache.get(win) || []
        }
        const finalPoints = [] as number[]
        const startMargin = Math.floor((this._samplingRate*win/1000)*(1 - this._triggerPosition))
        const endMargin = Math.floor((this._samplingRate*win/1000)*this._triggerPosition)
        let lastPoint = 0
        for (const p of this._triggerPoints) {
            if (!lastPoint) {
                // The first point may need to use a larger window, as the signal cannot be
                // scrolled back beyond the starting point.
                finalPoints.push(p)
                lastPoint = Math.max(p, endMargin)
            } else if (p - lastPoint > startMargin) {
                finalPoints.push(p)
                lastPoint = p
            }
        }
        this._triggerCache.set(win, finalPoints)
        return finalPoints
    }

    setSignal (signal: Float32Array) {
        this._signal = signal
        this._sampleCount = signal.length
    }
}
