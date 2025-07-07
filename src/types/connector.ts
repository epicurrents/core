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
 * A connector for a dataset. The connector can be used to access and manage datasets on a remote server.
 */
export interface DatasourceConnector extends BaseAsset {
    /** Source URL of the dataset(s). */
    source: string
    /**
     * Authenticate to the dataset source.
     * @returns A promise that resolves to true if authentication was successful, false otherwise.
     */
    authenticate () : Promise<boolean>
    /**
     * Get the content of a file at the specified `subpath`.
     * @param subpath - The subpath to the file or directory to get contents for.
     * @param probe - If true, don't report error if the file doesn't exist or is a directory.
     * @returns A promise that resolves with the file contents. Returned value type depends on the file type:
     * - For text files, returns a string.
     * - For JSON files, returns a parsed object.
     * - For binary files, returns a Blob.
     * - If the file doesn't exist or is a directory (or an error occurs), returns null.
     */
    getFileContents (subpath: string, probe?: boolean): Promise<Blob|object|string|null>
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
     * Recreate the WebDAV client with new credentials and optional source URL.
     * @param credentials - Credentials for the connection.
     * @param source - Optional new source URL for the connection.
     */
    recreateClient (credentials: ConnectorCredentials, source?: string): void
}
