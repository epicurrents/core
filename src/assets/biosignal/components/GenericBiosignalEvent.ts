/**
 * Generic biosignal event annotation.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAnnotation from '#assets/annotation/GenericAnnotation'
import { settingsColorToRgba } from '#util'
import type {
    AssetSerializeOptions,
    BiosignalAnnotationEvent,
    BiosignalAnnotationEventOptions,
    ConfigSchema,
    ResourceConfig,
    SettingsColor,
} from '#types'

/**
 * Configuration schema for biosignal annotations.
 */
const CONFIG_SCHEMA = {
    context: 'biosignal_annotation_event',
    fields: [
        // Properties that can be modified with an external config.
        {
            name: 'background',
            type: 'boolean',
        },
        {
            name: 'channels',
            type: 'array',
        },
        {
            name: 'codes',
            type: 'array',
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
    name: 'Biosignal annotation event configuration',
    type: 'epicurrents_configuration',
    version: '1.0',
} as ConfigSchema

export default abstract class GenericBiosignalEvent extends GenericAnnotation implements BiosignalAnnotationEvent {

    protected _background = false
    protected _channels = [] as (number | string)[]
    protected _class = 'event' as BiosignalAnnotationEvent['class']
    protected _duration: number
    protected _label: string
    protected _start: number
    protected _color?: SettingsColor
    protected _opacity?: number

    constructor (
        // Required properties:
        name: string, start: number, duration: number, label: string,
        // Optional properties:
        options: BiosignalAnnotationEventOptions = {},
    ) {
        options.label = label
        super(name, [start, duration], 'event', options)
        this._duration = duration
        this._label = label
        this._start = start
        // Optional properties.
        this._background = options.background ?? false
        this._channels = options.channels ?? []
        this._color = options.color
        this._opacity = options.opacity
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
    set class (value: BiosignalAnnotationEvent['class']) {
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

    get opacity () {
        return this._opacity
    }
    set opacity (value: number | undefined) {
        this._setPropertyValue('opacity', value)
        this.dispatchEvent('appearance-changed')
    }

    get start () {
        return this._start
    }
    set start (value: number) {
        this._setPropertyValue('start', value)
    }

    configure(config: ResourceConfig): void {
        super.configure(config, CONFIG_SCHEMA, this)
    }

    serialize (options?: AssetSerializeOptions) {
        const base = super.serialize(options)
        return {
            ...base,
            background: this.background,
            channels: this.channels.length > 0
                      ? this.channels
                      : (options?.nullIfEmpty?.includes('channels') ? null : []),
            color: this.color
                   ? settingsColorToRgba(this.color)
                   : (options?.nullIfEmpty?.includes('color') ? null : ''),
            duration: this.duration,
            opacity: this.opacity,
            start: this.start,
        }
    }
}
