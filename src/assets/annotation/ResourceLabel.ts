/**
 * Generic label annotation.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAnnotation from './GenericAnnotation'
import type {
    AnnotationLabel,
    AssetSerializeOptions,
    ConfigSchema,
    ResourceConfig,
} from '#types'

/**
 * Configuration schema for resource label annotations.
 */
const CONFIG_SCHEMA = {
    context: 'resource_label',
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
    name: 'Annotation label configuration',
    type: 'epicurrents_configuration',
    version: '1.0',
} as ConfigSchema

export default class ResourceLabel extends GenericAnnotation implements AnnotationLabel {
    protected _class = 'label' as AnnotationLabel['class']
    protected _type = 'label'

    constructor (
        // Required properties:
        name: string, value: boolean | number | number[] | string | string[],
        // Optional properties:
        label?: string, labelClass?: AnnotationLabel['class'], codes?: (number | string)[], priority?: number, text?: string,
        visible?: boolean,
    ) {
        super(name, value, 'label', label, labelClass, codes, priority, text, visible)
    }

    get class () {
        return this._class
    }
    set class (value: AnnotationLabel['class']) {
        this._setPropertyValue('class', value)
    }

    configure (config: ResourceConfig) {
        super.configure(config, CONFIG_SCHEMA, this)
    }

    serialize (options?: AssetSerializeOptions) {
        return {
            ...super.serialize(options),
            class: this._class || (options?.nullIfEmpty?.includes('class') ? null : ''),
        }
    }
}
