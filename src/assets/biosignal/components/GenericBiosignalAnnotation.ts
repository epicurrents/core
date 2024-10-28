/**
 * Generic biosignal annotation.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import { BiosignalAnnotation, SettingsColor } from '#types'

export default abstract class GenericBiosignalAnnotation extends GenericAsset implements BiosignalAnnotation {
    protected _annotator = ''
    protected _background = false
    protected _channels = [] as number[]
    protected _class = 'event' as BiosignalAnnotation['class']
    protected _duration: number
    protected _label: string
    protected _priority = 0
    protected _start: number
    protected _text = ''
    protected _visible = true
    protected _color?: SettingsColor
    protected _opacity?: number

    constructor (
        // Required properties:
        name: string, start: number, duration: number, label: string,
        // Optional properties:
        annoClass?: BiosignalAnnotation['class'], channels?: number[], priority?: number, text?: string,
        visible?: boolean, background?: boolean, color?: SettingsColor, opacity?: number
    ) {
        super(name, GenericAsset.CONTEXTS.BIOSIGNAL, 'annotation')
        this._duration = duration
        this._label = label
        this._start = start
        // Optional properties.
        if (annoClass !== undefined) {
            this._class = annoClass
        }
        if (channels !== undefined) {
            this._channels = channels
        }
        if (priority !== undefined) {
            this._priority = priority
        }
        if (text !== undefined) {
            this._text = text
        }
        if (visible !== undefined) {
            this._visible = visible
        }
        if (background !== undefined) {
            this._background = background
        }
        if (color !== undefined) {
            this._color = color
        }
        if (opacity !== undefined) {
            this._opacity = opacity
        }
    }

    get annotator () {
        return this._annotator
    }
    set annotator (value: string) {
        const prevVal = this._annotator
        this._setPropertyValue('annotator', value)
        this.onPropertyUpdate('annotator', value, prevVal) // TODO: Deprecated.
    }

    get background () {
        return this._background
    }
    set background (value: boolean) {
        const prevVal = this._background
        this._setPropertyValue('background', value)
        this.onPropertyUpdate('background', value, prevVal) // TODO: Deprecated.
    }

    get channels () {
        return this._channels
    }
    set channels (value: number[]) {
        const prevVal = [...this._channels]
        this._setPropertyValue('channels', value)
        this.onPropertyUpdate('channels', value, prevVal) // TODO: Deprecated.
    }

    get class () {
        return this._class
    }
    set class (value: BiosignalAnnotation['class']) {
        const prevVal = this._class
        this._setPropertyValue('class', value)
        this.onPropertyUpdate('class', value, prevVal) // TODO: Deprecated.
    }

    get duration () {
        return this._duration
    }
    set duration (value: number) {
        const prevVal = this._duration
        this._setPropertyValue('duration', value)
        this.onPropertyUpdate('duration', value, prevVal) // TODO: Deprecated.
    }

    get label () {
        return this._label
    }
    set label (value: string) {
        const prevVal = this._label
        this._setPropertyValue('label', value)
        this.onPropertyUpdate('label', value, prevVal) // TODO: Deprecated.
    }

    get priority () {
        return this._priority
    }
    set priority (value: number) {
        const prevVal = this._priority
        this._setPropertyValue('priority', value)
        this.onPropertyUpdate('priority', value, prevVal) // TODO: Deprecated.
    }

    get start () {
        return this._start
    }
    set start (value: number) {
        const prevVal = this._start
        this._setPropertyValue('start', value)
        this.onPropertyUpdate('start', value, prevVal) // TODO: Deprecated.
    }

    get text () {
        return this._text
    }
    set text (value: string) {
        const prevVal = this._text
        this._setPropertyValue('text', value)
        this.onPropertyUpdate('text', value, prevVal) // TODO: Deprecated.
    }

    get visible () {
        return this._visible
    }
    set visible (value: boolean) {
        const prevVal = this._visible
        this._setPropertyValue('visible', value)
        this.onPropertyUpdate('visible', value, prevVal) // TODO: Deprecated.
    }

    get color () {
        return this._color
    }
    set color (value: SettingsColor | undefined) {
        const prevVal = [...(this._color || [])]
        this._setPropertyValue('color', value)
        this.dispatchEvent('appearance-changed')
        this.onPropertyUpdate('color', value, prevVal) // TODO: Deprecated.
        this.onPropertyUpdate('appearance') // TODO: Deprecated.
    }

    get opacity () {
        return this._opacity
    }
    set opacity (value: number | undefined) {
        const prevVal = this._opacity
        this._setPropertyValue('opacity', value)
        this.dispatchEvent('appearance-changed')
        this.onPropertyUpdate('opacity', value, prevVal) // TODO: Deprecated.
        this.onPropertyUpdate('appearance') // TODO: Deprecated.
    }
}
