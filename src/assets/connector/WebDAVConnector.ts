/**
 * A generic WebDAV connector.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    AuthType,
    createClient,
    FileStat,
    type WebDAVClient,
} from 'webdav'
import GenericAsset from '#assets/GenericAsset'
import type {
    ConnectorCredentials,
    DatasourceConnector,
    FileSystemItem,
} from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'WebDAVConnector'

export default class WebDAVConnector extends GenericAsset implements DatasourceConnector {
    protected _credentials: ConnectorCredentials
    protected _source: string
    protected _webDavClient: WebDAVClient
    /**
     * Create a new WebDAV connector with the given properties.
     * @param name - Name of the connector.
     * @param credentials - Credentials for the connector.
     * @param source - The source URL for the connector.
     */
    constructor (name: string, credentials: ConnectorCredentials, source: string) {
        super(name, 'connector')
        this._credentials = credentials
        this._source = source
        this._webDavClient = createClient(source, {
            username: credentials.username,
            password: credentials.password,
            authType: AuthType.Auto,
        })
    }
    get credentials () {
        return this._credentials
    }
    set credentials (value: ConnectorCredentials) {
        this._setPropertyValue('credentials', value)
    }
    get source () {
        return this._source
    }
    set source (value: string) {
        this._setPropertyValue('source', value)
    }

    async authenticate (): Promise<boolean> {
        try {
            await this._webDavClient.exists('/')
        } catch (e) {
            Log.error(`Failed to authenticate to WebDAV server: ${e}`, SCOPE)
            return false
        }
        return true
    }
    async listContents (subpath?: string): Promise<FileSystemItem|null> {
        const path = subpath ? `/${subpath}` : '/'
        const items = await this._webDavClient.getDirectoryContents(path) as FileStat[]
        return this.webDAVFilesToFileSystemItem(path, items)
    }
    webDAVFilesToFileSystemItem (path: string, items: FileStat[], rootItem?: FileSystemItem): FileSystemItem {
        const fsItems = [] as FileSystemItem[]
        const fileSystemItem = rootItem || {
            name: '',
            directories: [] as FileSystemItem[],
            files: [] as FileSystemItem[],
            path: path,
            type: 'directory',
            url: `${this._source}/${path}`,
        } as FileSystemItem
        for (const item of items) {
            const basePath = item.filename.split('/').slice(0, -1).join('/')
            const parent = fsItems.find((i) => i.path === basePath)
            const fsItem = {
                name: item.basename,
                directories: [],
                files: [],
                mime: item.mime || undefined,
                path: `${path}/${item.filename}`,
                size: item.size || undefined,
                type: item.type,
                url: `${this._source}/${path}/${item.filename}`,
            }
            if (parent) {
                if (item.type === 'directory') {
                    parent.directories.push(fsItem)
                } else {
                    parent.files.push(fsItem)
                }
            }
            fsItems.push(fsItem)
        }
        return fileSystemItem
    }
}
