/**
 * Loader types.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { MemoryManager } from "./assets"
import {
    StudyContext,
    StudyContextFile,
    StudyLoader,
} from "./study"

export interface FileDecoder {
    /** Decoded input data. */
    output: any
    /**
     * Decode the data part of the input buffer.
     * @param header - Header to use for decoding.
     * @param buffer - Optional buffer to use instead of input buffer.
     */
    decodeData (header: unknown, buffer?: ArrayBuffer): unknown
    /**
     * Decode the header part of the input buffer.
     */
    decodeHeader (): unknown
    /**
     * Decode the entire input buffer, returning a separate header and data parts.
     * @returns `{ data: Float32Array, header: unknown }` or null if decoding failed.
     */
    decode (): { data: unknown, header: unknown } | null
    /**
     * Set a new `buffer` to use as input for decoding.
     * @param buffer - The buffer to use as input.
     */
    setInput (buffer: ArrayBuffer): void
}
export interface FileFormatLoader {
    fileType: string
    /** `StudyContext` registered to this loader. */
    study: StudyContext | null
    /** The study loader instance that this file loader serves. */
    studyLoader: StudyLoader | null
    /**
     * Get the appropriate worker for this file type.
     * @param sab - Use SharedArrayBuffer implementation.
     * @returns Worker or null
     */
    getFileTypeWorker (sab?: boolean): Worker | null
    /**
     * Load a file from the filesystem.
     * @param file - The `File` to load.
     */
    loadFile (file: StudyContextFile | File, config?: any): Promise<StudyContextFile | null>
    /**
     * Load a file from the give `url`.
     * @param url - The URL to load the file from.
     */
    loadUrl (url: StudyContextFile | string, config?: any): Promise<StudyContextFile | null>
    /**
     * See if the given scope is supported by this loader.
     * @param scope - Scope to check.
     * @return True if supported, false if not.
     */
    isSupportedScope (scope: string): boolean
    /**
     * Match the given file name against files supported by this loader.
     * @param fileName - Name of the file to match.
     * @return True if match, false if no match.
     */
    matchName (fileName: string): boolean
    /**
     * Register a memory manager to use with asynchronous study loading operations.
     * @param manager - The memory manager to use.
     */
    registerMemoryManager (manager: MemoryManager): void
    /**
     * Register a study with the file loader.
     * @param study - `StudyContext` to modify and add the loaded files to.
     */
    registerStudy (study: StudyContext): void
}
export type FileFormatLoaderSpecs = {
    /** Patterns to match the filename against. */
    matchPatters: RegExp[]
}
export interface FileReader {
    readFilesFromSource(source: any): Promise<FileSystemItem|undefined>
}

export type FileSystemItemType = 'directory' | 'file'
/**
 * A FileSystemItem describes data storage structure in local and
 * remote file systems.
 */
export interface FileSystemItem {
    /** List of directories contained in this item (only if this is a directory). */
    directories: FileSystemItem[]
    /** List of files contained in this item (only if this is a directory). */
    files: FileSystemItem[]
    /** Name of this item within the file system. */
    name: string
    /** Path to this item within the file system. */
    path: string
    /** Type of this item (directory or file). */
    type: FileSystemItemType
    /** Possible file object (if this is a file). */
    file?: File
    /** Possible url to the file object (if this is a file). */
    url?: string
}
/**
 * Identifiers for indicating the direction in which to continue when
 * loading continuous data.
 */
export type LoadDirection = 'backward' | 'alternate' | 'forward'
export type LoaderMode = 'file' | 'folder' | 'study'
export type SuccessReject = (reason: string) => void
export type SuccessResolve = (response: SuccessResponse) => void
export type SuccessResponse = boolean

/**
 * Parser for text format study/recording export files.
 */
export interface TextFileParser {
    /**
     * Add a child parser to try with unknown text files.
     * @param parser - the text parser to add
     */
    addChildParser (parser: any): void
    /**
     * Remove a parser from the list of child parsers.
     * @param parser - the text parser to remove
     */
    removeChildParser (parser: any): void
    /**
     * Parse the given `file` and add recordings to the given `study` object.
     * @param file - file containing the recordings
     * @param study - the study to add parsed recodings to
     * @return true if file contents were parsed
     */
    parseFile (file: File, study: StudyContext): Promise<boolean>
    /**
     * Parse the given `lines` and add recordings to the given `study` object.
     * @param lines - lines of text containing the recordings
     * @param study - the study to add parsed recodings to
     * @return true if contents were parsed
     */
    parseLines (lines: string[], study: StudyContext): boolean
    /**
     * Parse the given `text` and add recordings to the given `study` object.
     * @param text - text containing the recordings
     * @param study - the study to add parsed recodings to
     * @return true if text was parsed
     */
    parseText (text: string, study: StudyContext): boolean
    /**
     * Parse the given `source` buffer and add recordings to the given `study` object.
     * @param source - buffer source containing the recordings
     * @param study - the study to add parsed recodings to
     * @return true if source was parsed
     */
    parseSource (source: ArrayBuffer, study: StudyContext): Promise<boolean>
}
