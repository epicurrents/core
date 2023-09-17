/**
 * Document resource.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type DocumentFormat, type DocumentResource } from "TYPES/document"
import { type StudyContext } from "TYPES/study"
import GenericResource from "LIB/core/GenericResource"
import { nullPromise } from 'LIB/util/general'

const SCOPE = 'GenericDocumentResource'

export default abstract class GenericDocumentResource extends GenericResource implements DocumentResource {

    protected _numPages = 0
    protected _pageNum = 0
    protected _sourceFormat: DocumentFormat

    constructor (name: string, type: string, format: DocumentFormat, source: StudyContext) {
        super(name, GenericResource.SCOPES.DOCUMENT, type, source)
        this._sourceFormat = format
    }

    get content (): Promise<any> {
        return nullPromise
    }

    get numPages () {
        return this._numPages
    }
    set numPages (value: number) {
        this._numPages = value
        this.onPropertyUpdate('num-pages')
    }

    get pageNum () {
        return this._pageNum
    }
    set pageNum (value: number) {
        this._pageNum = value
        this.onPropertyUpdate('page-num')
    }

    get sourceFormat () {
        return this._sourceFormat
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    nextPage () {
        if (this._numPages > this._pageNum) {
            this.pageNum = this.pageNum + 1
        }
    }

    prevPage () {
        if (this._pageNum > 1) {
            this.pageNum = this.pageNum - 1
        }
    }
}
