/**
 * Filesystem item of unspecified type.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type FileSystemItem, type FileSystemItemType } from "#types/loader"
import { Log } from 'scoped-ts-log'

const SCOPE = 'MixedFileSystemItem'

/**
 * An item describing either a directory or a file on a local or remote
 * file system.
 *
 * The `type` property should always contain the actual type of the
 * item, which is either *file* or *directory*.
 *
 * Directories can only contain other FileSytemItems. Use the static
 * methods to convert true files and directories into FileSystemItems:
 * - FilesToFsItem - Turns a single file into a _file_ type item and
 *                   multiple files into a _directory_ type item that
 *                   contains the given files.
 * - FileListToFsItem - Turns a Webkit FileList into a _directory_
 *                      tree containing the given files.
 * - UrlsToFsItem - Turns a single URL to a _file_ type FileSystemItem
 *                  or a list of URLs to a _directory_ type item.
 *
 * When determining which the actual source is, the `file` property
 * should be checked first; if it is non-falsy, then the source is
 * located on the local file system. Otherwise the a URL to the source
 * should be in the `url` proprety. Both of these properties should be
 * falsy only if the item is of type *directory*.
 */
export default class MixedFileSystemItem implements FileSystemItem {
    /**
     * Turn a Webkit FileList into a MixedFileSystemItem.
     * @param filelist - The FileList item returned by the file selector.
     * @return MixedFileSystemItem with nested folder structure.
     */
    static FileListToFsItem (filelist: FileList): MixedFileSystemItem {
        // Create the fs item to hold this list.
        const fsItem = new MixedFileSystemItem('', '', 'directory')
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
                    `File path ${file.webkitRelativePath} is invalid, it should contain at least two elements ` +
                    `(<rootDir>/<fileName>).`,
                SCOPE)
                continue
            }
            // Remove root directory name from path.
            const root = path.shift() as string
            if (!fsItem.name) {
                fsItem.name = root
            }
            const newItem = new MixedFileSystemItem(path.pop() as string, path.join('/'), 'file')
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
                const newDir = new MixedFileSystemItem(pathDir, fsPath, 'directory')
                fsLevel.directories.push(newDir)
                fsLevel = newDir
            }
            fsLevel.files.push(newItem)
        }
        return fsItem
    }
    /**
     * Turn either:
     * - a single file into a *file* type FileSystemItem, or
     * - a list of files into a *directory* type FileSystemItem
     *   that contains the given `files` as MixedFileSystemItems.
     * @param files - File or list of files.
     * @returns MixedFileSystemItem
     */
    static FilesToFsItem (...files: File[]): MixedFileSystemItem {
        if (files.length > 1) {
            const dir = new MixedFileSystemItem(
                'root',
                '',
                'directory'
            )
            for (const file of files) {
                dir.files.push(new MixedFileSystemItem(
                    file.name,
                    '/',
                    'file',
                    file,
                    URL.createObjectURL(file)
                ))
            }
            return dir
        }
        return new MixedFileSystemItem(
            files[0].name,
            '',
            'file',
            files[0],
            URL.createObjectURL(files[0])
        )
    }
    /**
     * Convert either:
     * - a single URL to a MixedFileSystemItem *file*, or
     * - an array of URLs to a MixedFileSystemItem *directory* containing
     *   the URLs as MixedFileSystemItem *files*.
     *
     * The URL(s) can be actual URL objects a just the href strings.
     * @param urls - URL or array of URLs.
     * @returns - MixedFileSystemItem.
     */
    static UrlsToFsItem (...urls: (string | URL)[]): MixedFileSystemItem {
        if (urls.length > 1) {
            const fsItem = new MixedFileSystemItem(
                'Remote dir',
                '',
                'directory',
            )
            for (let i=0; i<urls.length; i++) {
                const url = urls[i]
                const loc = typeof url === 'string'
                            ? url : url.href
                fsItem.files.push(new MixedFileSystemItem(
                    loc.split('/').pop() || `Remote file ${i + 1}`,
                    `/`,
                    'file',
                    undefined,
                    loc,
                ))
            }
            return fsItem
        }
        const url = urls[0]
        return new MixedFileSystemItem(
            'Remote file',
            '',
            'file',
            undefined,
            typeof url === 'string' ? url : url.href
        )
    }
    /* Class properties */
    protected _directories: MixedFileSystemItem[] = []
    protected _files: MixedFileSystemItem[] = []
    protected _name: string
    protected _path: string
    protected _type: FileSystemItemType
    protected _file?: File
    protected _url?: string
    /**
     * Create a new mixed filesystem item.
     * @param name - Name of this item on the file system.
     * @param path - Path to this item on the file system (excluding root dir and item names).
     * @param type - Type of the item (`directory` or `file`)
     * @param file - File object (optional).
     * @param url - Url to file (optional).
     */
    constructor (name: string, path: string, type: FileSystemItemType, file?: File, url?: string) {
        this._name = name
        this._path = path
        this._type = type
        if (file) {
            this._file = file
        }
        if (url) {
            this._url = url
        }
    }

    get directories () {
        return this._directories
    }
    set directories (value: MixedFileSystemItem[]) {
        this._directories = value
    }
    get files () {
        return this._files
    }
    set files (value: MixedFileSystemItem[]) {
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
