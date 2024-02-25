/**
 * Filesystem file.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { FileSystemItem, FileSystemItemType } from '#root/src/types/reader'

//const SCOPE = 'FileSystemFile'

/**
 * An item describing a file on a local or remote file system.
 *
 * When determining which the actual source is, the `file` property
 * should be checked first; if it is non-falsy, then the source is
 * located on the local file system. Otherwise the a URL to the source
 * should be in the `url` proprety.
 */
export default class FileSystemFile implements FileSystemItem {
    /**
     * Turn a single file into a *file* type FileSystemFile.
     * @param file - The file to use.
     * @returns FileSystemFile
     */
    static FileToFsFile (file: File): FileSystemFile {
        return new FileSystemFile(
            file.name,
            '',
            file,
            URL.createObjectURL(file)
        )
    }
    /**
     * Turn a single URL object or string to a FileSystemFile.
     * @param urls - URL or string.
     * @returns FileSystemFile.
     */
    static UrlToFsFile(url: string | URL): FileSystemFile {
        return new FileSystemFile(
            'Remote file',
            '',
            url
        )
    }
    /* Class properties. */
    protected _name: string
    protected _path: string
    protected _type = 'file' as FileSystemItemType
    protected _file?: File
    protected _url?: string
    /**
     * Create a new filesystem file from either a File or URL.
     * @param name - Name of this file on the file system.
     * @param path - Path to this file on the file system (excluding root dir and item names).
     * @param fileOrUrl - The File object or a URL to the file.
     * @param url - URL to file (optional, if file was used for `fileOrUrl`).
     */
    constructor (name: string, path: string, fileOrUrl: File | URL | string, url?: string) {
        this._name = name
        this._path = path
        if (fileOrUrl instanceof File) {
            this._file = fileOrUrl
            if (url) {
                this._url = url
            } else {
                this._url = URL.createObjectURL(fileOrUrl)
            }
        } else if (fileOrUrl instanceof URL) {
            this._url = (fileOrUrl as URL).href
        } else {
            this._url = fileOrUrl
        }
    }

    get directories () {
        return []
    }
    get files () {
        return []
    }
    get name () {
        return this._name
    }
    set name (value: string) {
        this._name = value
    }
    get path () {
        return this._path
    }
    set path (value: string) {
        this._path = value
    }
    get type () {
        return this._type
    }

    get file () {
        return this._file
    }
    set file (value: File | undefined) {
        this._file = value
    }
    get url () {
        return this._url
    }
    set url (value: string | undefined) {
        this._url = value
    }
}
