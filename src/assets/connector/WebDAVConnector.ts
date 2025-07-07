/**
 * A generic WebDAV connector.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    AuthType,
    createClient,
    type FileStat,
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
    protected _client: WebDAVClient
    protected _credentials: ConnectorCredentials
    protected _source: string
    /**
     * Create a new WebDAV connector with the given properties.
     * @param name - Name of the connector.
     * @param credentials - Credentials for the connector.
     * @param source - The source URL for the connector.
     * @param client - Optional WebDAV client instance to use.
     */
    constructor (name: string, credentials: ConnectorCredentials, source: string, client?: WebDAVClient) {
        super(name, 'connector')
        this._credentials = credentials
        this._source = source
        if (client) {
            this._client = client
        } else {
            this._client = createClient(source,
                credentials.token
                ? {
                    token: credentials.token,
                  }
                : {
                    authType: AuthType.Auto,
                    ha1: credentials.ha1,
                    password: credentials.password,
                    username: credentials.username,
                  }
            )
        }
    }
    get source () {
        return this._source
    }
    set source (value: string) {
        this._setPropertyValue('source', value)
    }

    /**
     * Convert WebDAV file stats to a FileSystemItem.
     * @param path - The path to the directory or file.
     * @param items - Array of FileStat objects representing the files and directories.
     * @param rootItem - Optional root FileSystemItem to use as the root of the new item.
     */
    _webDAVFilesToFileSystemItem (path: string, items: FileStat[], rootItem?: FileSystemItem): FileSystemItem {
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
            const link = item.type === 'file'
                       ? this._client.getFileDownloadLink(item.filename)
                       : `${this._source}/${item.filename}`
            const fsItem = {
                name: item.basename,
                directories: [],
                files: [],
                mime: item.mime || undefined,
                path: item.filename,
                size: item.size || undefined,
                type: item.type,
                url: link,
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

    async authenticate () {
        try {
            await this._client.exists('/')
        } catch (e) {
            Log.error(`Failed to authenticate to WebDAV server: ${e}`, SCOPE)
            return false
        }
        return true
    }

    async getFileContents (subpath: string, probe?: boolean) {
        const path = subpath.startsWith('/') ? subpath : `/${subpath}`
        try {
            const exists = await this._client.exists(path)
            const logFn = probe ? Log.debug : Log.error
            if (!exists) {
                logFn(`File not found on WebDAV server: ${path}`, SCOPE)
                return null
            }
            const stats = await this._client.stat(path) as FileStat
            if (stats.type !== 'file') {
                logFn(`Path is not a file: ${path}`, SCOPE)
                return null
            }
            const response = await this._client.getFileContents(path)
            if (response instanceof Blob) {
                return response
            } else if (typeof response === 'string') {
                if (stats.mime && stats.mime === 'application/json') {
                    try {
                        return JSON.parse(response)
                    } catch (e) {
                        Log.error(`Failed to parse JSON from WebDAV server: ${e}`, SCOPE)
                        return null
                    }
                }
                return response
            } else {
                Log.error(`Unexpected response type from WebDAV server: ${typeof response}`, SCOPE)
                return null
            }
        } catch (e) {
            Log.error(`Failed to get file contents from WebDAV server: ${e}`, SCOPE)
            return null
        }
    }

    async listContents (subpath?: string) {
        const path = subpath ? `/${subpath}` : '/'
        const items = await this._client.getDirectoryContents(path) as FileStat[]
        return this._webDAVFilesToFileSystemItem(path, items)
    }

    setClient (client: WebDAVClient) {
        this._client = client
    }

    recreateClient (credentials: ConnectorCredentials, source?: string) {
        this._credentials = credentials
        this._client = createClient(source || this._source, {
            authType: AuthType.Auto,
            ha1: credentials.ha1,
            password: credentials.password,
            username: credentials.username,
        })
    }
}
