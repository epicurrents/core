/**
 * Generic biosignal annotation.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import { settingsColorToRgba } from '#util'
import type {
    BiosignalAnnotation,
    ConfigSchema,
    ResourceConfig,
    SettingsColor,
} from '#types'

/**
 * Configuration schema for biosignal annotations.
 */
const CONFIG_SCHEMA = {
    context: 'biosignal_annotation',
    fields: [
        // Properties that can be modified with an external config.
        {
            name: 'background',
            type: 'boolean',
        },
        {
            name: 'duration',
            type: 'number',
        },
        {
            name: 'label',
            type: 'string',
        },
        {
            name: 'opacity',
            type: 'number',
        },
        {
            name: 'priority',
            type: 'number',
        },
        {
            name: 'start',
            type: 'number',
        },
        {
            name: 'text',
            type: 'string',
        },
        {
            name: 'visible',
            type: 'boolean',
        },
    ],
    name: 'Biosignal annotation configuration',
    type: 'epicurrents_configuration',
    version: '1.0',
} as ConfigSchema

export default abstract class GenericBiosignalAnnotation extends GenericAsset implements BiosignalAnnotation {
    protected _annotator = ''
    protected _background = false
    protected _channels = [] as (number | string)[]
    protected _class = 'event' as BiosignalAnnotation['class']
    protected _duration: number
    protected _label: string
    protected _priority = 0
    protected _start: number
    protected _text = ''
    protected _type = 'annotation'
    protected _visible = true
    protected _color?: SettingsColor
    protected _opacity?: number

    constructor (
        // Required properties:
        name: string, start: number, duration: number, label: string,
        // Optional properties:
        annoClass?: BiosignalAnnotation['class'], channels?: (number | string)[], priority?: number, text?: string,
        visible?: boolean, background?: boolean, color?: SettingsColor, opacity?: number
    ) {
        super(name, 'annotation')
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
        this._setPropertyValue('annotator', value)
    }

    get background () {
        return this._background
    }
    set background (value: boolean) {
        this._setPropertyValue('background', value)
    }

    get channels () {
        return this._channels
    }
    set channels (value: (number | string)[]) {
        this._setPropertyValue('channels', value)
    }

    get class () {
        return this._class
    }
    set class (value: BiosignalAnnotation['class']) {
        this._setPropertyValue('class', value)
    }

    get color () {
        return this._color
    }
    set color (value: SettingsColor | undefined) {
        this._setPropertyValue('color', value)
        this.dispatchEvent('appearance-changed')
    }

    get duration () {
        return this._duration
    }
    set duration (value: number) {
        this._setPropertyValue('duration', value)
    }

    get label () {
        return this._label
    }
    set label (value: string) {
        this._setPropertyValue('label', value)
    }

    get opacity () {
        return this._opacity
    }
    set opacity (value: number | undefined) {
        this._setPropertyValue('opacity', value)
        this.dispatchEvent('appearance-changed')
    }

    get priority () {
        return this._priority
    }
    set priority (value: number) {
        this._setPropertyValue('priority', value)
    }

    get start () {
        return this._start
    }
    set start (value: number) {
        this._setPropertyValue('start', value)
    }

    get text () {
        return this._text
    }
    set text (value: string) {
        this._setPropertyValue('text', value)
    }

    get type () {
        return this._type
    }
    set type (value: string) {
        this._setPropertyValue('type', value)
    }

    get visible () {
        return this._visible
    }
    set visible (value: boolean) {
        this._setPropertyValue('visible', value)
    }

    configure (config: ResourceConfig) {
        super.configure(config, CONFIG_SCHEMA, this)
    }

    serialize () {
        return {
            annotator: this.annotator,
            background: this.background,
            channels: this.channels,
            class: this.class,
            color: this.color ? settingsColorToRgba(this.color) : '',
            duration: this.duration,
            label: this.label,
            opacity: this.opacity,
            priority: this.priority,
            start: this.start,
            text: this.text,
            type: this.type,
            visible: this.visible,
        }
    }
}
