/**
 * EpiCurrents local file reader.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type FileReader } from '#root/src/types/reader'
import MixedFileSystemItem from './filesystem/MixedFileSystemItem'

export default class LocalFileReader implements FileReader {
    /**
     * Read all files from the dropped file system resource.
     * @param event - Mouse drag-n-drop event.
     * @return Promise with an object containing the direcotory structure and files, or undefined.
     */
    async readFilesFromSource (event: DragEvent) {
        // First prevent the browser from opening the files.
        event.stopPropagation()
        event.preventDefault()
        if (event.dataTransfer && event.dataTransfer.items) {
            const fileTree = await this.readDirectoryItems('/', '', null, event.dataTransfer.items)
            return fileTree
        }
        return undefined
    }
    private readDirectoryItems = async (
        name: string,
        path: string,
        reader: FileSystemDirectoryReader | null,
        items?: DataTransferItemList
    ): Promise<MixedFileSystemItem> => {
        // The directory item that we'll return in the end (single files are handled separately).
        const dir = new MixedFileSystemItem(name, path, 'directory')
        // At least Chrome may not return the entire list at once (max 100 entires)
        // so we need to cache returned items in a separate list.
        const cache = [] as (FileSystemEntry | MixedFileSystemItem)[]
        if (reader) {
            // Use the reader to read directory contents.
            let items = await this.readItems(reader) // Get first batch of items.
            while (items && items.length) {
                // Add all directory contents to cache, one batch at a time.
                cache.push(...items.splice(0))
                items = items.concat(await this.readItems(reader))
            }
        } else if (items && items.length) {
            // Go through the initial list of items
            for (let i=0; i<items.length; i++) {
                cache.push(items[i].webkitGetAsEntry() as FileSystemEntry)
            }
        }
        if (!Array.isArray(cache)) {
            throw new Error("Reader did not return a file list!")
        }
        // Go through the queue until it is empty.
        while (cache.length > 0) {
            const entry = cache.shift()
            if (!entry) {
                continue
            }
            if ((entry as FileSystemEntry).isFile) {
                // Add files to root directory.
                const file = await new Promise(
                    (resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)
                ) as File
                dir.files.push(new MixedFileSystemItem(
                    file.name,
                    `${dir.path}/${file.name}`,
                    'file',
                    file,
                    URL.createObjectURL(file)
                ))
            } else if ((entry as FileSystemEntry).isDirectory) {
                // New directory encountered.
                const dirReader = (entry as FileSystemDirectoryEntry).createReader()
                cache.push(await this.readDirectoryItems(entry.name, `${dir.path}/${entry.name}`, dirReader))
            } else {
                // Item is a MixedFileSystemItem that represents a directory.
                dir.directories?.push(entry as MixedFileSystemItem)
            }
        }
        return dir
    }
    private async readItems (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
        try {
            return await new Promise((resolve, reject) => {
                reader.readEntries(resolve, reject)
            })
        } catch (error) {
            throw new Error((error as Error).message || (error as string))
        }
    }

}
