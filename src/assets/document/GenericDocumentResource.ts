/**
 * Document resource.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { ConfigSchema, ResourceConfig } from '#types/config'
import type { DocumentResource } from '#types/document'
import type { StudyContext } from '#types/study'
import GenericResource from '#assets/GenericResource'
import { nullPromise } from '#util/general'

/**
 * Configuration schema for generic document.
 */
const CONFIG_SCHEMA = {
    context: 'generic_dataset',
    fields: [
        // Properties that can be modified with an external config.
        {
            name: 'scale',
            type: 'number',
        },
    ],
    name: 'Gneric document configuration',
    type: 'epicurrents_configuration',
    version: '1.0',
} as ConfigSchema

//const SCOPE = 'GenericDocumentResource'

export default abstract class GenericDocumentResource extends GenericResource implements DocumentResource {

    protected _scale = 1
    protected _sourceFormat: string

    constructor (name: string, modality: string, format: string, source: StudyContext) {
        super(name, modality, source)
        this._sourceFormat = format
    }

    get content (): Promise<unknown> {
        return nullPromise
    }

    get scale () {
        return this._scale
    }
    set scale (value: number) {
        this._setPropertyValue('scale', value)
    }

    get sourceFormat () {
        return this._sourceFormat
    }

    configure (config: ResourceConfig) {
        super.configure(config, CONFIG_SCHEMA, this)
    }
}
