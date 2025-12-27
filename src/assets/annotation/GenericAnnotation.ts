/**
 * Generic annotation.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import type { Annotation, AssetSerializeOptions } from '#types'

export default abstract class GenericAnnotation extends GenericAsset implements Annotation {
    protected _annotator = ''
    protected _class = 'event' as Annotation['class']
    protected _codes = [] as (number | string)[]
    protected _label = ''
    protected _priority = 0
    protected _text = ''
    protected _type: string
    protected _value: boolean | number | number[] | string | string[]
    protected _visible: boolean

    constructor (
        // Required properties:
        name: string, value: boolean | number | number[] | string | string[], type: string,
        // Optional properties:
        label?: string, annoClass?: Annotation['class'], codes?: (number | string)[], priority?: number, text?: string,
        visible = true,
    ) {
        super(name, type)
        this._value = value
        this._type = type
        this._visible = visible
        // Optional properties.
        if (label !== undefined) {
            this._label = label
        }
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
    set class (value: Annotation['class']) {
        this._setPropertyValue('class', value)
    }

    get codes () {
        return this._codes
    }
    set codes (value: (number | string)[]) {
        this._setPropertyValue('codes', value)
    }

    get label () {
        return this._label !== undefined
                            ? this._label
                            : (Array.isArray(this._value) ? this._value.join(', ') : String(this._value))
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

    get value () {
        return this._value
    }
    set value (value: boolean | number | number[] | string | string[]) {
        this._setPropertyValue('value', value)
    }

    get visible () {
        return this._visible
    }
    set visible (value: boolean) {
        this._setPropertyValue('visible', value)
    }

    serialize (options: AssetSerializeOptions = {}) {
        let finalValue = this._value as boolean | number | number[] | string | string[] | null
        if ( // Handle values that should be set to null:
            options.nullIfEmpty?.includes('value') &&
            (Array.isArray(finalValue) || typeof finalValue === 'string') &&
            !finalValue.length
        ) {
            finalValue = null
        }
        return {
            annotator: this.annotator || (options.nullIfEmpty?.includes('annotator') ? null : ''),
            class: this.class || (options.nullIfEmpty?.includes('class') ? null : 'event'),
            codes: this.codes.length > 0 ? this.codes : (options.nullIfEmpty?.includes('codes') ? null : []),
            label: this.label || (options.nullIfEmpty?.includes('label') ? null : ''),
            name: this.name || (options.nullIfEmpty?.includes('name') ? null : ''),
            priority: this.priority,
            text: this.text || (options.nullIfEmpty?.includes('text') ? null : ''),
            type: this.type || (options.nullIfEmpty?.includes('type') ? null : ''),
            value: finalValue,
            visible: this.visible,
        }
    }
}
