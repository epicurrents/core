/**
 * Document types.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { DataResource } from './application'
/**
 * Table column configuration.
 */
export type DataTableColumnConfiguration = {
    /** Value constructor type. */
    contentType: BooleanConstructor | DateConstructor | NumberConstructor | StringConstructor
    /** Label for UI. */
    label: string
    /** Unique name for programmatic access. */
    name: string
    /** If true, hide the column in the UI (useful for storing meta data). */
    hidden?: boolean
    /** Number of decimal places for number values. */
    precision?: number
}
/** Possible value types for data table cells. */
export type DataTableRowValue = {
    value: boolean | number | string | Date
    /** A contextual secondary value describing the main value. */
    descriptors?: Record<string, boolean | number | string>
    /** Id of the subcontext for this value. */
    subcontext?: string
    /** Tooltip text for UI. */
    tooltip?: string
} | null
/** Section for a data table. */
export type DataTableSection = {
    /** Section name for programmatic access. */
    name: string
    /** Data rows. Values must be in the same order as in the column configurations. Use null for empty values. */
    rows: DataTableRowValue[][]
    /** Id of the subcontext for this section. */
    subcontext: string | null
    /** Section title for UI. */
    title: string
}
/**
 * Template for constructing a data table.
 */
export type DataTableTemplate = {
    /** Column configurations. */
    configuration: DataTableColumnConfiguration[]
    /** Table label for UI. */
    label: string
    /** Table name for programmatic access. */
    name: string
    /** Data table sections. */
    sections: DataTableSection[]
    /** Id of the subcontext for this table. */
    subcontext: string | null
}

/**
 * A resource holding text and images.
 */
export interface DocumentResource extends DataResource {
    /** Promise that resolves with the content of the document. */
    content: Promise<unknown>
    /** Scale of the document, used for zooming in or out in the UI. */
    scale: number
    /** Format of the source file. */
    sourceFormat: string
}

export type DocumentServiceReject = (reason: string) => void
export type DocumentServiceResolve = (response: DocumentServiceResponse) => void
export type DocumentServiceResponse = {
    html: string
}
