/**
 * Generic biosignal label annotation.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericBiosignalAnnotation from './GenericBiosignalAnnotation'
import type { ConfigSchema, ResourceConfig } from '#types'
import { BiosignalAnnotationLabel } from '#root/src/types/biosignal'

/**
 * Configuration schema for biosignal annotations.
 */
const CONFIG_SCHEMA = {
    context: 'biosignal_annotation_label',
    fields: [
        // Properties that can be modified with an external config.
        {
            name: 'class',
            type: 'string',
        },
        {
            name: 'codes',
            type: 'array',
        },
        {
            name: 'label',
            type: 'string',
        },
        {
            name: 'priority',
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
    name: 'Biosignal annotation label configuration',
    type: 'epicurrents_configuration',
    version: '1.0',
} as ConfigSchema

export default abstract class GenericBiosignalLabel extends GenericBiosignalAnnotation implements BiosignalAnnotationLabel {
    protected _class = 'label' as BiosignalAnnotationLabel['class']
    protected _type = 'label'

    constructor (
        // Required properties:
        name: string, label: string,
        // Optional properties:
        labelClass?: BiosignalAnnotationLabel['class'], codes?: (number | string)[], priority?: number, text?: string,
        visible?: boolean,
    ) {
        super(name, label, 'label', labelClass, codes, priority, text, visible)
    }

    get class () {
        return this._class
    }
    set class (value: BiosignalAnnotationLabel['class']) {
        this._setPropertyValue('class', value)
    }

    configure (config: ResourceConfig) {
        super.configure(config, CONFIG_SCHEMA, this)
    }

    serialize () {
        return {
            ...super.serialize(),
            class: this._class,
        }
    }
}
