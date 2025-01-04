/**
 * Document types.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { DataResource } from './application'

/**
 * A resource holding text and images.
 */
export interface DocumentResource extends DataResource {
    /** Promise that resolves with the content of the document. */
    content: Promise<unknown>
    /** Format of the source file. */
    sourceFormat: string
}

export type DocumentServiceReject = (reason: string) => void
export type DocumentServiceResolve = (response: DocumentServiceResponse) => void
export type DocumentServiceResponse = {
    html: string
}
