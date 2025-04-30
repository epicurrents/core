/**
 * Connector types.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BaseAsset } from './application'
import { FileSystemItem } from './reader'

/**
 * Credentials for authenticating to a data source.
 */
export type ConnectorCredentials = {
    password: string
    username: string
}
/**
 * A connector for a dataset. The connector can be used to access and manage datasets on a remote server.
 */
export interface DatasourceConnector extends BaseAsset {
    /** Credentials needed to access the dataset source. */
    credentials: null | ConnectorCredentials
    /** Source URL of the datasets. */
    source: string
    /**
     * Authenticate to the dataset source.
     * @returns A promise that resolves to true if authentication was successful, false otherwise.
     */
    authenticate () : Promise<boolean>
    /**
     * List the contents of the dataset source.
     * @param id - The ID of the dataset to list contents for.
     * @returns A promise that resolves to an array of file system items representing the contents of the dataset or null if the request fails.
     */
    listContents (id: string): Promise<FileSystemItem|null>
}
