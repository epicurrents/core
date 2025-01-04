/**
 * Document resource.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type DocumentResource } from '#types/document'
import { type StudyContext } from '#types/study'
import GenericResource from '#assets/GenericResource'
import { nullPromise } from '#util/general'

//const SCOPE = 'GenericDocumentResource'

export default abstract class GenericDocumentResource extends GenericResource implements DocumentResource {

    protected _sourceFormat: string

    constructor (name: string, type: string, format: string, source: StudyContext) {
        super(name, GenericResource.CONTEXTS.DOCUMENT, type, source)
        this._sourceFormat = format
    }

    get content (): Promise<unknown> {
        return nullPromise
    }

    get sourceFormat () {
        return this._sourceFormat
    }
}
