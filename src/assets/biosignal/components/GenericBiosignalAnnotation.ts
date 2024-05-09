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
        super(name, GenericAsset.SCOPES.BIOSIGNAL, 'annotation')
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
        this._annotator = value
        this.onPropertyUpdate('annotator')
    }

    get background () {
        return this._background
    }
    set background (value: boolean) {
        this._background = value
        this.onPropertyUpdate('background')
    }

    get channels () {
        return this._channels
    }
    set channels (value: number[]) {
        this._channels = value
        this.onPropertyUpdate('channels')
    }

    get class () {
        return this._class
    }
    set class (value: BiosignalAnnotation['class']) {
        this._class = value
        this.onPropertyUpdate('class')
    }

    get duration () {
        return this._duration
    }
    set duration (value: number) {
        this._duration = value
        this.onPropertyUpdate('duration')
    }

    get label () {
        return this._label
    }
    set label (value: string) {
        this._label = value
        this.onPropertyUpdate('label')
    }

    get priority () {
        return this._priority
    }
    set priority (value: number) {
        this._priority = value
        this.onPropertyUpdate('priority')
    }

    get start () {
        return this._start
    }
    set start (value: number) {
        this._start = value
        this.onPropertyUpdate('start')
    }

    get text () {
        return this._text
    }
    set text (value: string) {
        this._text = value
        this.onPropertyUpdate('text')
    }

    get visible () {
        return this._visible
    }
    set visible (value: boolean) {
        this._visible = value
        this.onPropertyUpdate('visible')
    }

    get color () {
        return this._color
    }
    set color (value: SettingsColor | undefined) {
        this._color = value
        this.onPropertyUpdate('color')
        this.onPropertyUpdate('appearance')
    }

    get opacity () {
        return this._opacity
    }
    set opacity (value: number | undefined) {
        this._opacity = value
        this.onPropertyUpdate('opacity')
        this.onPropertyUpdate('appearance')
    }
}
