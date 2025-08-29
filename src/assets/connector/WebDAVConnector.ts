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
    ConnectorMode,
    DatasourceConnector,
    FileSystemItem,
    TaskResponse,
} from '#types'
import type { ConnectorGetFileContentsOptions, ConnectorWriteFileOptions } from '#types/connector'
import { Log } from 'scoped-event-log'

const SCOPE = 'WebDAVConnector'

export default class WebDAVConnector extends GenericAsset implements DatasourceConnector {
    /** Connector I/O operation modes. */
    static readonly ConnectorMode = {
        /** Read-only mode. */
        Read: 'r',
        /** Write-only mode. */
        Write: 'w',
        /** Read and write mode. */
        ReadWrite: 'rw',
    } as Record<string, ConnectorMode>
    protected _authHeader = ''
    protected _client: WebDAVClient
    protected _mode: ConnectorMode
    protected _path: string = ''
    protected _source: string
    /**
     * Create a new WebDAV connector with the given properties.
     * @param name - Name of the connector.
     * @param credentials - Credentials for the connector.
     * @param source - The source URL for the connector.
     * @param mode - The mode of the connector ('read', 'write', or 'readwrite').
     * @param useDigestAuth - If true, always use Digest authentication for username-based authentication.
     * @param client - Optional WebDAV client instance to use.
     */
    constructor (
        name: string,
        credentials: ConnectorCredentials,
        source: string,
        mode: ConnectorMode,
        useDigestAuth = false,
        client?: WebDAVClient
    ) {
        super(name, 'connector')
        if (source.endsWith('/')) {
            this._source = source.slice(0, -1)
        } else {
            this._source = source
        }
        this._mode = mode
        if (client) {
            this._client = client
        } else {
            this._client = this.createClient(credentials, source, useDigestAuth)
        }
    }

    get path () {
        return this._path
    }
    set path (value: string) {
        if (value.endsWith('/')) {
            // Never end paths with a slash.
            value = value.slice(0, -1)
        }
        this._setPropertyValue('path', value)
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
        // Keep a list of file system items for easily finding parent directories.
        const fsItems = [] as FileSystemItem[]
        const fileSystemItem = rootItem || {
            name: '',
            directories: [] as FileSystemItem[],
            files: [] as FileSystemItem[],
            path: path,
            type: 'directory',
            url: `${this._source}${path}`,
        } as FileSystemItem
        fsItems.push(fileSystemItem)
        for (const item of items) {
            const basePath = item.filename.split('/').slice(0, -1).join('/')
            const parent = basePath.split('/').length > 1
                         ? fsItems.find((i) => i.path === basePath)
                         : fileSystemItem // Use root item as parent.
            if (!parent) {
                Log.warn(`Parent directory not found for item: ${item.filename}`, SCOPE)
                continue
            }
            const link = `${this._source}/${item.filename}`
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
            if (fsItem.type === 'directory') {
                // Add item to list of potential parent items.
                fsItems.push(fsItem)
            }
        }
        return fileSystemItem
    }

    get authHeader () {
        return this._authHeader
    }
    set authHeader (value: string) {
        this._setPropertyValue('authHeader', value)
    }
    get mode () {
        return this._mode
    }
    set mode (value: ConnectorMode) {
        this._setPropertyValue('mode', value)
    }

    async authenticate () {
        try {
            await this._client.exists('/')
        } catch (e) {
            Log.error([`Failed to authenticate with WebDAV server.`, e as string], SCOPE)
            return {
                error: e,
                message: `Failed to authenticate with WebDAV server.`,
                // Include response if it is returned with the error.
                response: (e as { response?: unknown }).response ? (e as { response: unknown }).response : undefined,
            } as TaskResponse
        }
        return { success: true }
    }

    createClient (credentials: ConnectorCredentials, source?: string, useDigestAuth = false) {
        const authType = credentials.token
                        ? AuthType.Token
                        : credentials.username && (credentials.ha1 || useDigestAuth)
                            ? AuthType.Digest
                            : credentials.username && credentials.password
                            ? AuthType.Password
                            : AuthType.Auto
        if (authType === AuthType.Password) {
            this._authHeader = `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`
        } else {
            this._authHeader = ''
        }
        return createClient(source || this._source,
            {
                authType: authType,
                ha1: credentials.ha1 || undefined,
                password: credentials.password || undefined,
                token: credentials.token || undefined,
                username: credentials.username || undefined,
            }
        )
    }

    async createDirectory (path: string) {
        if (this._mode === WebDAVConnector.ConnectorMode.Read) {
            Log.error('Cannot create a directory in read-only mode.', SCOPE)
            return {
                success: false,
                message: 'Cannot create a directory in read-only mode.'
            }
        }
        if (await this._client.exists(path)) {
            Log.error(`Directory already exists on WebDAV server: ${path}`, SCOPE)
            return {
                success: false,
                message: `Path already exists on WebDAV server: ${path}`
            }
        }
        try {
            await this._client.createDirectory(path)
            return { success: true }
        } catch (e) {
            Log.error(`Failed to create directory on WebDAV server: ${e}`, SCOPE)
            return {
                success: false,
                message: `Failed to create directory on WebDAV server. Make sure you have the necessary permissions.`
            }
        }
    }

    async getFileContents (path: string, options?: ConnectorGetFileContentsOptions) {
        if (this._mode === WebDAVConnector.ConnectorMode.Write && !options?.ignoreMode) {
            Log.warn('Cannot read file contents in write mode.', SCOPE)
            return null
        }
        try {
            const exists = await this._client.exists(path)
            const logFn = options?.probe ? Log.debug : Log.error
            if (!exists) {
                logFn(`File not found on WebDAV server: ${path}`, SCOPE)
                return null
            }
            const stats = await this._client.stat(path) as FileStat
            if (stats.type !== 'file') {
                logFn(`Path is not a file: ${path}`, SCOPE)
                return null
            }
            const response = await this._client.getFileContents(
                path, { format: options?.asJson || options?.asText ? 'text' : 'binary' }
            )
            if (response instanceof Blob) {
                return response
            } else if (typeof response === 'string') {
                if (options?.asJson || (stats.mime && stats.mime === 'application/json')) {
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

    async listContents (subpath?: string, deep = true) {
        const path = subpath
                   ? subpath.startsWith('/') ? subpath : `/${subpath}`
                     : this._path
        const items = await this._client.getDirectoryContents(
            path,
            { deep: deep }
        ) as FileStat[]
        return this._webDAVFilesToFileSystemItem(path, items)
    }

    setClient (client: WebDAVClient) {
        this._client = client
    }

    async writeFile (subpath: string, content: ArrayBuffer | string, options?: ConnectorWriteFileOptions) {
        if (this._mode === WebDAVConnector.ConnectorMode.Read && !options?.ignoreMode) {
            Log.error('Cannot write a file in read-only mode.', SCOPE)
            return {
                success: false,
                message: 'Cannot write a file in read-only mode.'
            }
        }
        const path = this._path + (subpath.startsWith('/') ? subpath : `/${subpath}`)
        let exists = false
        try {
            exists = await this._client.exists(path)
        } catch (e) {
            if ((e as { status?: number }).status === 404) {
                Log.debug(`File to write does not exist on WebDAV server: ${path}`, SCOPE)
            } else {
                Log.error(`Failed to check if file exists on WebDAV server: ${e}`, SCOPE)
                return {
                    success: false,
                    message: 'Failed to check if file exists on WebDAV server. Make sure you have the necessary permissions.'
                }
            }
        }
        if (exists) {
            if (!options?.overwrite) {
                Log.error(`File already exists at ${path}.`, SCOPE)
                return {
                    success: false,
                    message: 'File already exists at the specified path.'
                }
            }
            let filePath = ''
            if (options.handleExisting?.rename) {
                filePath = options.handleExisting.rename.startsWith('/')
                    ? options.handleExisting.rename
                    : `/${options.handleExisting.rename}`
                Log.debug(`Renaming existing file from ${path} to ${filePath}`, SCOPE)
            }
            if (options.handleExisting?.version) {
                // Append a version number to the file name.
                const timestamp = new Date().toISOString().replace(/[^\d]/g, '')
                // Add version number before the file extension.
                const extRegex = /(\.[^.\/]+)$/
                filePath = filePath.match(extRegex)
                         // A file with extension e.g. `file.txt` becomes `file_v20250101123456.txt`.
                         ? filePath.replace(extRegex, `_v${timestamp}$1`)
                         // A file without an extension becomes `file_v20250101123456`.
                         : `${filePath}_v${timestamp}`
                Log.debug(`Versioning existing file to ${filePath}`, SCOPE)
            }
            if (options.handleExisting?.rename || options.handleExisting?.version) {
                try {
                    await this._client.moveFile(path, filePath, { overwrite: true })
                } catch (e) {
                    Log.warn(`Failed to rename old file on WebDAV server: ${e}`, SCOPE)
                }
            } else {
                // If no instructions are provided, the default behavior is to overwrite the existing file.
                Log.debug(`No instructions for existing file at ${path}, overwriting.`, SCOPE)
            }
        }
        try {
            await this._client.putFileContents(path, content, { overwrite: true })
            Log.debug(`File written successfully to ${path}`, SCOPE)
        } catch (e) {
            Log.error(`Failed to write file to WebDAV server: ${e}`, SCOPE)
            return {
                success: false,
                message: 'Failed to write file to WebDAV server. Make sure you have the necessary permissions.'
            }
        }
        return { success: true }
    }
}
