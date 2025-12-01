/**
 * Generic biosignal annotation.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import type { BiosignalAnnotation, } from '#types'

export default abstract class GenericBiosignalAnnotation extends GenericAsset implements BiosignalAnnotation {
    protected _annotator = ''
    protected _class = 'event' as BiosignalAnnotation['class']
    protected _codes = [] as (number | string)[]
    protected _label: string
    protected _priority = 0
    protected _text = ''
    protected _type: string
    protected _visible: boolean

    constructor (
        // Required properties:
        name: string, label: string, type: string,
        // Optional properties:
        annoClass?: BiosignalAnnotation['class'], codes?: (number | string)[], priority?: number, text?: string,
        visible = true,
    ) {
        super(name, type)
        this._label = label
        this._type = type
        this._visible = visible
        // Optional properties.
        if (annoClass !== undefined) {
            this._class = annoClass
        }
        if (codes !== undefined) {
            this._codes = codes
        }
        if (priority !== undefined) {
            this._priority = priority
        }
        if (text !== undefined) {
            this._text = text
        }
    }

    get annotator () {
        return this._annotator
    }
    set annotator (value: string) {
        this._setPropertyValue('annotator', value)
    }

    get class () {
        return this._class
    }
    set class (value: BiosignalAnnotation['class']) {
        this._setPropertyValue('class', value)
    }

    get codes () {
        return this._codes
    }
    set codes (value: (number | string)[]) {
        this._setPropertyValue('codes', value)
    }

    get label () {
        return this._label
    }
    set label (value: string) {
        this._setPropertyValue('label', value)
    }

    get priority () {
        return this._priority
    }
    set priority (value: number) {
        this._setPropertyValue('priority', value)
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

    serialize () {
        return {
            annotator: this.annotator,
            class: this.class,
            codes: this.codes,
            label: this.label,
            priority: this.priority,
            text: this.text,
            type: this.type,
            visible: this.visible,
        }
    }
}
