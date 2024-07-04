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

    protected _currentPage = 0
    protected _numPages = 0
    protected _sourceFormat: string

    constructor (name: string, type: string, format: string, source: StudyContext) {
        super(name, GenericResource.SCOPES.DOCUMENT, type, source)
        this._sourceFormat = format
    }

    get content (): Promise<unknown> {
        return nullPromise
    }

    get currentPage () {
        return this._currentPage
    }
    set currentPage (value: number) {
        this._currentPage = value
        this.onPropertyUpdate('current-page')
    }

    get numPages () {
        return this._numPages
    }
    set numPages (value: number) {
        this._numPages = value
        this.onPropertyUpdate('num-pages')
    }

    get sourceFormat () {
        return this._sourceFormat
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    nextPage () {
        if (this._numPages > this._currentPage) {
            this.currentPage = this.currentPage + 1
        }
    }

    prevPage () {
        if (this._currentPage > 1) {
            this.currentPage = this.currentPage - 1
        }
    }
}
