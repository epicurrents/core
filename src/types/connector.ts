/**
 * Connector types.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BaseAsset } from './application'
import { FileSystemItem } from './reader'
import type { WebDAVClient } from 'webdav'

/**
 * Credentials for authenticating to a data source.
 */
export type ConnectorCredentials = {
    password: string
    username: string
    /** Pre-generated HA1 for authentication instead of password. */
    ha1?: string
    /** Parameters for token-based authentication. */
    token?: {
        access_token: string
        token_type: string
        expires_in: number
        refresh_token: string
    }
}
/**
 * Options for getting file contents from a connector.
 * @property asJson - If true, return the file contents as a JSON object.
 * @property asText - If true, return the file contents as a string.
 * @property ignoreMode - If true, ignore the file mode and always return contents.
 * @property probe - If true, don't report error if the file doesn't exist or is a directory.
 * @privateRemarks
 * Method option types are not exported from the types index file and must be imported directly from the source file.
 */
export type ConnectorGetFileContentsOptions = {
    /** If true, return the file contents as a JSON object. */
    asJson?: boolean
    /** If true, return the file contents as a string. */
    asText?: boolean
    /** If true, ignore the file mode and always return contents. */
    ignoreMode?: boolean
    /** If true, don't report error if the file doesn't exist or is a directory. */
    probe?: boolean
}
/** Supported I/O modes for dataset connectors. */
export type ConnectorMode = 'r' | 'w' | 'rw'
/**
 * Options for writing a file to a connector.
 * @property handleExisting - How to handle an existing file when overwriting with a new one.
 * @property ignoreMode - If true, overwrite the file if it already exists.
 * @property overwrite - If true, overwrite the file if it already exists (otherwise fail if file exists).
 */
export type ConnectorWriteFileOptions = {
    /**
     * How to handle a possible existing file when overwriting with a new one.
     * If not set, the old file is overwritten (destroying the old file).
     */
    handleExisting?: {
        /** Rename the file with the given new name (including path relative to ). */
        rename?: string
        /** Append a datetime to the old file name (`file_vYYYYMMDDHHmmSS.txt`). */
        version?: boolean
    }
    /** If true, overwrite the file if it already exists. */
    ignoreMode?: boolean
    /** If true, overwrite the file if it already exists (otherwise fail if file exists). */
    overwrite?: boolean
}
/**
 * A connector for a dataset. The connector can be used to access and manage datasets on a remote server.
 */
export interface DatasourceConnector extends BaseAsset {
    /** The I/O mode the connector supports. */
    mode: ConnectorMode
    /** Source URL of the dataset(s). */
    source: string
    /**
     * Authenticate to the dataset source.
     * @returns A promise that resolves to true if authentication was successful, false otherwise.
     */
    authenticate () : Promise<boolean>
    /**
     * Create a WebDAV client with the supplied `credentials` and optional `source` URL.
     * @param credentials - Credentials for the connection.
     * @param source - Optional new source URL for the connection.
     * @param useDigestAuth - If true, always use Digest authentication for username-based authentication.
     */
    createClient (credentials: ConnectorCredentials, source?: string, useDigestAuth?: boolean): void
    /**
     * Get the content of a file at the specified `subpath`.
     * @param subpath - The subpath to the file or directory to get contents for.
     * @param options - Optional options to change the behavior of the request.
     * @returns A promise that resolves with the file contents. Returned value type depends on the file type:
     * - For text files, returns a string.
     * - For JSON files, returns a parsed object.
     * - For binary files, returns a Blob.
     * - If the file doesn't exist or is a directory (or an error occurs), returns null.
     */
    getFileContents (subpath: string, options?: ConnectorGetFileContentsOptions): Promise<Blob|object|string|null>
    /**
     * List the contents of the dataset source.
     * @param id - The ID of the dataset to list contents for.
     * @returns A promise that resolves to an array of file system items representing the contents of the dataset or null if the request fails.
     */
    listContents (id: string): Promise<FileSystemItem|null>
    /**
     * Set the WebDAV client to use for the connection.
     * @param client - WebDAV client to set for the connection.
     */
    setClient (client: WebDAVClient): void
    /**
     * Write a file to the WebDAV server.
     * @param subpath - The subpath to the file to write.
     * @param content - The content to write to the file, either as an ArrayBuffer or a string.
     * @param options - Optional options for writing the file, such as how to handle existing files.
     * @returns A promise that resolves to true if the file was written successfully, false otherwise.
     */
    writeFile (subpath: string, content: ArrayBuffer | string, options?: ConnectorWriteFileOptions): Promise<boolean>
}
