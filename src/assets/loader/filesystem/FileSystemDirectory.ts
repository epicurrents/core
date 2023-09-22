/**
 * Dilesystem directory.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type FileSystemItem, type FileSystemItemType } from "TYPES/loader"
import Log from "scoped-ts-log"
import FileSystemFile from "./FileSystemFile"

const SCOPE = 'FileSystemDirectory'

/**
 * An item describing a directory on a local or remote file system.
 *
 * Directories can only contain other FileSytemItems. Use the static
 * methods to convert true files and directories into FileSystemItems:
 * - FilesToFsDirecotry - Turns a list of files into a FileSystemDirectory
 *                        that contains the given files.
 * - FileListToFsDirectory - Turns a Webkit FileList into a directory
 *                           tree containing the given files.
 * - UrlsToFsDirectory - Turns a list of URLs to a FileSystemDirectory.
 *
 * Both the `file` and `url`properties should be falsy.
 */
export default class FileSystemDirectory implements FileSystemItem {
    /**
     * Turn a Webkit FileList into a FileSystemDirectory.
     * @param filelist - The FileList item returned by the file selector.
     * @return FileSystemDirectory with nested folder structure.
     */
    public static FileListToFsDirectory (filelist: FileList): FileSystemDirectory {
        // Create the fs item to hold this list.
        const fsItem = new FileSystemDirectory('', '')
        const files = Object.values(filelist)
        if (!files.length) {
            return fsItem
        }
        if (files.some((f) => !f.webkitRelativePath)) {
            Log.error(
                `At least one of the files given to ${SCOPE}. ` +
                `FileListToFsItem does not have a valid webkitRelativePath property.`,
            SCOPE)
            return fsItem
        }
        // Not sure if file names can have escaped slashes on any file system, but just in case.
        const pathDelim = /(?<!\\\\)\//
        for (const file of files) {
            const path = file.webkitRelativePath.split(pathDelim)
            if (path.length < 2) {
                Log.error(
                    `File path ${file.webkitRelativePath} is invalid, it should contain at least two elements `+
                    `(<rootDir>/<fileName>).`,
                SCOPE)
                continue
            }
            // Remove root directory name from path.
            const root = path.shift() as string
            if (!fsItem.name) {
                fsItem.name = root
            }
            const fileName = path.pop() as string
            const newItem = new FileSystemFile(fileName, path.join('/'), fileName, file.webkitRelativePath)
            // Traverse and create path if needed.
            let fsLevel = fsItem
            let fsPath = ''
            path_loop:
            while (path.length) {
                const pathDir = path.shift() as string // This must exist if path has length.
                fsPath += `/${pathDir}`
                for (const existing of fsLevel.directories) {
                    if (existing.name === pathDir) {
                        fsLevel = existing
                        continue path_loop
                    }
                }
                // Create the missing directory.
                const newDir = new FileSystemDirectory(pathDir, fsPath)
                fsLevel.directories.push(newDir)
                fsLevel = newDir
            }
            fsLevel.files.push(newItem)
        }
        return fsItem
    }
    /**
     * Turn a list of files into a FileSystemDirectory that contains
     * the given `files` as FileSystemFiles.
     * @param files - List of files.
     * @returns FileSystemDirectory.
     */
    public static FilesToFsDirectory (...files: File[]): FileSystemDirectory {
        const dir = new FileSystemDirectory(
            '',
            ''
        )
        for (const file of files) {
            dir.files.push(new FileSystemFile(
                file.name,
                '/',
                file,
                URL.createObjectURL(file)
            ))
        }
        return dir
    }
    /**
     * Convert an array of URLs to a FileSystemDirectory containing
     * the URLs as FileSystemFiles.
     *
     * The URL(s) can be actual URL objects a just the href strings.
     * @param urls - URL or array of URLs.
     * @returns - FileSystemDirectory.
     */
    public static UrlsToFsItem (...urls: (string | URL)[]): FileSystemDirectory {
        const fsItem = new FileSystemDirectory('Remote dir', '')
        for (let i=0; i<urls.length; i++) {
            const url = urls[i]
            const loc = typeof url === 'string'
                        ? url : url.href
            fsItem.files.push(new FileSystemFile(
                loc.split('/').pop() || `Remote file ${i + 1}`,
                `/`,
                loc,
            ))
        }
        return fsItem
    }
    /* Class properties */
    protected _directories: FileSystemDirectory[] = []
    protected _files: FileSystemFile[] = []
    protected _name: string
    protected _path: string
    protected _type = 'directory' as FileSystemItemType
    protected _file?: File
    protected _url?: string
    /**
     * Create a new mixed filesystem item.
     * @param name - Name of this item on the file system.
     * @param path - Path to this item on the file system (excluding root dir and item names).
     */
    constructor (name: string, path: string) {
        this._name = name
        this._path = path
    }

    get directories () {
        return this._directories
    }
    set directories (value: FileSystemDirectory[]) {
        this._directories = value
    }
    get files () {
        return this._files
    }
    set files (value: FileSystemFile[]) {
        this._files = value
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
    get url () {
        return this._url
    }
}
