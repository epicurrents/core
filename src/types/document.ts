/**
 * Document types.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { DataResource } from './application'

/**
 * Resource holding (usually paginated) text and images.
 */
export interface DocumentResource extends DataResource {
    /** Promise that resolves with the content of the document. */
    content: Promise<unknown>
    /** Current page number of the document, starting from 1. */
    currentPage: number
    /** Total number of pages in the document. */
    numPages: number
    /** Format of the source file. */
    sourceFormat: string
    /** Increase page number by one, if there is a following page. */
    nextPage (): void
    /** Reduce page number by one, if there is a preceding page. */
    prevPage (): void
}

export type DocumentServiceReject = (reason: string) => void
export type DocumentServiceResolve = (response: DocumentServiceResponse) => void
export type DocumentServiceResponse = {
    html: string
}
