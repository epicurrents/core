/**
 * A generic database REST API connector.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import { modifyStudyContext } from '#util/conversions'
import type {
    ConnectorCredentials,
    DatabaseConnector,
    StudyContext,
    TaskResponse,
} from '#types'
import type { ConnectorMode, DatabaseQueryOptions } from '#types/connector'
import { Log } from 'scoped-event-log'

const SCOPE = 'DatabaseAPIConnector'

/**
 * A REST API implementation of a database connector.
 */
export default class DatabaseAPIConnector extends GenericAsset implements DatabaseConnector {
    protected _authHeader = ''
    protected _credentials?: ConnectorCredentials
    protected _listContentsOptions?: DatabaseQueryOptions
    protected _path: string = ''
    protected _source: string
    /**
     * Create a new API connector with the given properties.
     * @param name - Name of the connector.
     * @param source - The source URL for the connector.
     * @param method - HTTP request method ('GET' or 'POST').
     * @param apiCredentials - Optional credentials for the API.
     * @param webCredentials - Optional credentials for accessing the server (HTTP Basic Auth).
     * 
     */
    constructor (
        name: string,
        source: string,
        apiCredentials?: ConnectorCredentials,
        webCredentials?: ConnectorCredentials,
        listContentsOptions?: DatabaseQueryOptions,
    ) {
        super(name, 'connector')
        this._credentials = apiCredentials
        this._source = source
        this._listContentsOptions = listContentsOptions
        if (webCredentials?.username && webCredentials?.password) {
            // Create basic auth header if username and password are provided.
            this._authHeader = `Basic ${btoa(`${webCredentials.username}:${webCredentials.password}`)}`
        }
    }

    get authHeader () {
        return this._authHeader
    }
    set authHeader (value: string) {
        this._setPropertyValue('authHeader', value)
    }

    get mode () {
        // Database connectors cannot control the mode of the operation, they are always considered read-write.
        return 'rw' as ConnectorMode
    }

    get source () {
        return this._source
    }
    set source (value: string) {
        this._setPropertyValue('source', value)
    }

    get type () {
        return 'database' as const
    }
    
    /**
     * Combine multiple URL parts into a single URL path.
     * @param parts - URL parts to combine.
     * @returns The combined URL path.
     */
    protected _combineURLPath (...parts: string[]) {
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i]?.length) {
                // Remove empty parts.
                parts.splice(i, 1)
                i--
                continue
            }
            // Only retain leading slash for the first part and trailing slash for the last part.
            if (i < parts.length - 1 && parts[i].endsWith('/')) {
                parts[i] = parts[i].slice(0, -1)
            }
            if (i > 0 && parts[i].startsWith('/')) {
                parts[i] = parts[i].slice(1)
            }
        }
        return parts.join('/')
    }
    /**
     * Convert the query result to CSV format. Only works for tabular data results (array of objects).
     * @param result - The query result to convert.
     * @param separator - The separator to use between values (default is comma).
     * @returns A promise that resolves to the CSV string.
     */
    protected async _resultToCSV (result: unknown, separator = ','): Promise<string> {
        if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
            const keys = Object.keys(result[0] as Record<string, unknown>)
            const csvRows = result.map(row => {
                return keys.map(key => {
                    const value = (row as Record<string, unknown>)[key]
                    return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
                }).join(',')
            })
            return `${keys.join(separator)}\n${csvRows.join('\n')}`
        }
        return ''
    }
    /**
     * Convert the query result to XML format. Only works for tabular data results (array of objects).
     * @param result - The query result to convert.
     * @returns A promise that resolves to the XML string.
     */
    protected async _resultToXML (result: unknown): Promise<string> {
        // Simple JSON to XML conversion for array of objects.
        // TODO: This method needs to know the column names to create proper XML.
        if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
            const xmlRows = result.map(row => {
                const rowXml = Object.entries(row as Record<string, unknown>).map(([key, value]) => {
                    return `<${key}>${value}</${key}>`
                }).join('')
                return `<item>${rowXml}</item>`
            })
            return `<root>${xmlRows.join('')}</root>`
        }
        return '<root></root>'
    }

    /**
     * Authenticate to the data source.
     * @param path - Optional subpath to authenticate against (if not the default 'auth').
     * @returns A promise that resolves to true if authentication was successful, otherwise returns a `TaskResponse`.
     */
    async authenticate (path?: string) {
        try {
            const url = this._combineURLPath(this._source, path || 'auth/')
            const response = await fetch(url, {
                method: 'POST',
                headers: this._authHeader ? {
                    'Authorization': this._authHeader
                } : undefined,
                body: this._credentials ? JSON.stringify(this._credentials) : undefined,
            })
            if (!response.ok) {
                Log.error(`Authentication failed with status ${response.status}: ${response.statusText}`, SCOPE)
                return {
                    message: `Authentication failed with status ${response.status}: ${response.statusText}`,
                    response,
                    success: false,
                } as TaskResponse
            }
            // Include possible additional information like user properties from the response.
            const data = response.headers.get('Content-Type') === 'application/json' ? await response.json() : null
            // If authentication was successful, return a success response.
            return { success: true, ...data }
        } catch (e) {
            Log.error(`Failed to authenticate with API server. ${e as string}`, SCOPE)
            return {
                error: e,
                message: `Failed to authenticate with API server.`,
                // Include response if it is returned with the error.
                response: (e as { response?: unknown }).response ? (e as { response: unknown }).response : undefined,
                success: false,
            } as TaskResponse
        } 
    }
    async listContents (subpath?: string, options = this._listContentsOptions): Promise<StudyContext[]|null> {
        try {
            const url = this._combineURLPath(this._source, subpath || 'contents')
            const response = await fetch(url, {
                method: 'GET',
                headers: this._authHeader ? {
                    'Authorization': this._authHeader
                } : undefined,
            })
            if (!response.ok) {
                Log.error(`Listing contents failed with status ${response.status}: ${response.statusText}`, SCOPE)
                return null
            }
            // TODO: Other responses in addition to JSON.
            if (response.headers.get('Content-Type') === 'application/json') {
                const data = modifyStudyContext(await response.json(), options) as StudyContext[]
                return data
            }
        } catch (e) {
            Log.error(`Failed to list contents from API server. ${e as string}`, SCOPE)
            return null
        }
        return null
    }
    /**
     * Execute a query against the database API.
     * @param path - The path to append to the API endpoint.
     * @param params - Optional parameters for the query.
     * @param options - Optional query options.
     * @returns A promise that resolves to a `TaskResponse` containing the results of the query.
     */
    async query (
        path: string,
        params?: Record<string, unknown>,
        options?: DatabaseQueryOptions
    ): Promise<TaskResponse> {
        // Make sure that source and path are separated by a single slash.
        let url = this._combineURLPath(this._source, path)
        const fetchOptions: RequestInit = {
            // Method may be overridden for example for login requests.
            method: options?.paramMethod === 'post' ? 'POST' : 'GET',
            headers: {
                'Authorization': this._authHeader,
                'Content-Type': 'application/json',
            },
        }
        if (params && options?.paramMethod === 'inject') {
            // Replace URL parameters in the path with values from params.
            Object.keys(params).forEach(key => {
                url = url.replace(new RegExp(`{${key}}`), encodeURIComponent(String(params[key])))
            })
        } else if (params && options?.paramMethod === 'post') {
            // Include parameters in the request body as JSON.
            fetchOptions.body = JSON.stringify(params)
        } else if (params) {
            // Default: Include parameters as URL query parameters.
            const urlObj = new URL(url)
            Object.keys(params).forEach(key => {
                urlObj.searchParams.append(key, String(params[key]))
            })
            url = urlObj.toString()
        }
        try {
            const response = await fetch(url, fetchOptions)
            if (!response.ok) {
                Log.error(`Query failed with status ${response.status}: ${response.statusText}`, SCOPE)
                return {
                    message: `Query failed with status ${response.status}: ${response.statusText}`,
                    response,
                    success: false,
                }
            }
            const data = modifyStudyContext(await response.json(), options) as StudyContext[]
            if (options?.overrideProperties) {
                Object.assign(data, options.overrideProperties)
            }
            if (!options?.format || options.format === 'json') {
                // Default to JSON format.
                return { data: data, success: true }
            } else if (options.format === 'csv') {
                const csv = await this._resultToCSV(data, options.csvDelimiter)
                return { data: csv, success: true }
            } else if (options.format === 'xml') {
                const xml = await this._resultToXML(data)
                return { data: xml, success: true }
            }
        } catch (error) {
            Log.error(`Failed to fetch ${url}: ${error}`, SCOPE)
            return {
                error: error as Error,
                message: `Failed to fetch ${url}`,
                success: false,
            }
        }
        return { success: false, message: 'Could not process query.' }
    }
}
