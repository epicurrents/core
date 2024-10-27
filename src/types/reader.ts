/**
 * Reader types.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { MutexExportProperties } from 'asymmetric-io-mutex'
import { BaseAsset } from './application'
import {
    AnnotationTemplate,
    SignalDataCache,
    SignalDataGap,
    SignalDataGapMap,
} from './biosignal'
import {
    MemoryManager,
    SignalCachePart,
} from './service'
import {
    StudyContext,
    StudyContextFile,
    StudyLoader,
} from './study'

/**
 * An object describing a file type associated with a file reader. This object is meant to emulate the File System API
 * file/directory picker types parameter so it can be directly passed to the picker.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker#types for documentation.
 */
export type AssociatedFileType = {
    /**
     * Mime types and their possible extensions that the reader accepts as this file type.
     * These are the only files visible (by default) in the file picker when opening a file for this reader.
     * @example
     * {
     *  "application/edf": ['.edf'] // Only EDF files with .edf extension.
     * }
     * {
     *  "image/*": [".png", ".gif", ".jpeg", ".jpg"] // Any image mime type file with one of the given extensions.
     * }
     */
    accept: {
        [mime: string]: string[]
    }
    /**
     * A description of the file types allowed, shown also in the file picker.
     */
    description: string
}
/**
 * Header reader optional configuration.
 * @param byteSize - Byte size of the header part of the file.
 */
export type ConfigReadHeader = {
    byteSize?: number
}
/**
 * Signal reader optional configuration.
 * @param signals - Array of objects describing the loaded signals.
 */
export type ConfigReadSignals = {
    signals: {
        label?: string
        name?: string
        samplingRate?: number
        type?: string
    }[]
}

/**
 * URL reader optional configuration.
 * @param headerReader - Header reader configuration.
 * @param mime - Mime type of the file.
 * @param name - Name of the file.
 * @param signalReader - Signal reader configuration.
 * @param url - Study file URL, if different from the source URL.
 */
export type ConfigReadUrl = {
    headerReader?: ConfigReadHeader
    mime?: string
    name?: string
    signalReader?: ConfigReadSignals
    url?: string
}

export interface FileDecoder {
    /** Decoded input data. */
    output: unknown
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
export interface FileFormatReader extends BaseAsset {
    /** File types associated with this reader. */
    fileTypes: AssociatedFileType[]
    /** Only allow selecting accepted types in the file picker. */
    onlyAcceptedTypes: boolean
    /** `StudyContext` registered to this reader. */
    study: StudyContext | null
    /** The study loader instance that this file reader serves. */
    studyLoader: StudyLoader | null
    /**
     * Get the appropriate worker for this file type.
     * @param sab - Use SharedArrayBuffer implementation.
     * @returns Worker or null
     */
    getFileTypeWorker (sab?: boolean): Worker | null
    /**
     * Read a local file from the filesystem.
     * @param file - The `File` to load.
     */
    readFile (file: StudyContextFile | File, config?: unknown): Promise<StudyContextFile | null>
    /**
     * Load a remote file from the give `url`.
     * @param url - The URL to load the file from.
     */
    readUrl (url: StudyContextFile | string, config?: unknown): Promise<StudyContextFile | null>
    /**
     * See if the given scope is supported by this reader.
     * @param scope - Scope to check.
     * @return True if supported, false if not.
     */
    isSupportedContext (scope: string): boolean
    /**
     * Match the given file name against files supported by this reader.
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
     * Register a study with the file reader.
     * @param study - `StudyContext` to modify and add the loaded files to.
     */
    registerStudy (study: StudyContext): void
    /**
     * Override a default worker with a method that returns a worker instance.
     * @param name - Name of the worker to override.
     * @param getWorker - The worker method to use instead, or null to use default.
     */
    setWorkerOverride (name: string, getWorker: (() => Worker)|null): void
}
export type FileFormatReaderSpecs = {
    /** Patterns to match the filename against. */
    matchPatters: RegExp[]
}
export interface FileReader {
    readFilesFromSource(source: unknown): Promise<FileSystemItem|undefined>
}

/**
 * A FileSystemItem describes data storage structure in local and remote file systems.
 * @remarks
 * This whole group of types should probably be removed in favor of webkit's FileSystemEntry and plain urls?
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
export type FileSystemItemType = 'directory' | 'file'
/**
 * Identifiers for indicating the direction in which to continue when reading continuous data.
 */
export type ReadDirection = 'backward' | 'alternate' | 'forward'
export type ReaderMode = 'file' | 'folder' | 'study' | 'url'
/**
 * SignalDataProcessers provide methods for storing and processing signal data.
 */
export interface SignalDataProcesser {
    /**
     * Has the cache been initialized.
     */
    cacheReady: boolean
    /**
     * Length of the actual data in seconds (excluding gaps).
     */
    dataLength: number
    /**
     * Is the source file discontinuous.
     */
    discontinuous: boolean
    /**
     * Total length of the recording in seconds (including gaps).
     */
    totalLength: number
    /**
     * Add new, unique annotations to the annotation cache.
     * @param annotations - New annotations to check and cache.
     */
    cacheNewAnnotations (...annotations: AnnotationTemplate[]): void
    /**
     * Add new, unique data gaps to the data gap cache.
     * @param newGaps - New data gaps to check and cache.
     */
    cacheNewDataGaps (newGaps: SignalDataGapMap): void
    /**
     * Get any cached annotations from data units in the provided `range`.
     * @param range - Recording range in seconds [inluded, excluded].
     * @returns List of annotations as BiosignalAnnotation[].
     */
    getAnnotations (range?: number[]): AnnotationTemplate[]
    /**
     * Retrieve data gaps in the given `range`.
     * @param range - Time range to check in seconds.
     * @param useCacheTime - Consider range in cache time without prior data gaps (for internal use, default false).
     * @remarks
     * For file structures based on data units, both the starting and ending data unit are excluded,
     * because there cannot be a data gap inside just one unit.
     */
    getDataGaps (range?: number[], useCacheTime?: boolean): SignalDataGap[]
    /**
     * Get signals for the given part.
     * @param range - Range in seconds as [start, end].
     * @param config - Optional configuration.
     * @returns SignalCachePart or null, if an error occurred.
     */
    getSignals (range: number[], config?: unknown): Promise<SignalCachePart|null>
    /**
     * Release buffers removing all references to them and returning to initial state.
     */
    releaseCache (): Promise<void>
    /**
     * Set new data gaps for the source data.
     * @param dataGaps - The new gaps.
     */
    setDataGaps (dataGaps: SignalDataGapMap): void
    /**
     * Initialize a new, plain reader cache.
     * @returns Created cache on success, null on failure.
     */
    setupCache (): SignalDataCache | null
    /**
     * Set up a simple signal cache as the data source for this montage.
     * @param cache - The data cache to use.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including gaps) in seconds.
     * @param dataGaps - Possible data gaps in the recording.
     */
    setupCacheWithInput (
        cache: SignalDataCache,
        dataDuration: number,
        recordingDuration: number,
        dataGaps?: SignalDataGap[],
    ): void
    /**
     * Initialize a new shared array mutex using the given `buffer`.
     * @param buffer - Buffer to store the signal data in.
     * @param start - Starting index within the buffer allocated to this mutex.
     * @returns Export properties of the new mutex or null on failure.
     */
    setupMutex (buffer: SharedArrayBuffer, bufferStart: number): Promise<MutexExportProperties|null>
    /**
     * Set up an input mutex as the source for signal data loading. This will create a new mutex for storing processed
     * signal data and can only be done once.
     * @param input - Properties of the input data mutex.
     * @param bufferStart - Starting index of the new mutex array in the buffer.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including gaps) in seconds.
     * @param dataGaps - Possible data gaps in the recording.
     * @returns Newly created mutex properties or null on failure.
     */
    setupMutexWithInput (
        input: MutexExportProperties,
        bufferStart: number,
        dataDuration: number,
        recordingDuration: number,
        dataGaps?: SignalDataGap[]
    ): Promise<MutexExportProperties|null>
    /**
     * Set up a shared worker as the source for signal data loading.
     * @param input - Message port from the input worker.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including gaps) in seconds.
     * @param dataGaps - Possible data gaps in the recording.
     */
    setupSharedWorkerWithInput (
        input: MessagePort,
        dataDuration: number,
        recordingDuration: number,
        dataGaps?: SignalDataGap[]
    ): Promise<boolean>
}
/**
 * SignalDataReader serves as an interface for file reading. After setting the required metadata, parts of the signal
 * file can be loaded using time indices and the class handles all coversions between file time and byte positions,
 * taking into account possible data unit (record) lengths and maximum allowed single load (chunk) sizes.
 *
 * For larger files it will keep loading the file progressively until the maximum cache size has been reached (NYI).
 *
 * Data loading methods return a promise which resolves when the requested data has been loaded or rejects if there
 * is an error.
 */
export interface SignalDataReader extends SignalDataProcesser {
    /**
     * Source file URL.
     */
    url: string
    /**
     * Start loading signal data from the given file.
     * @param file - File object.
     * @param startFrom - Optional starting point of the loading process in seconds of file duration.
     */
    cacheFile (file: File, startFrom?: number): Promise<void>
    /**
     * Read and cache the entire file from the given URL.
     * @param url - Optional URL of the file (defaults to cached URL).
     * @returns Loading success (true/false).
     */
    readFileFromUrl (url?: string): Promise<boolean>
    /**
     * Read a single part from the cached file.
     * @param startFrom - Starting point of the loading process in seconds of file duration.
     * @param dataLength - Length of the requested data in seconds.
     * @returns Promise containing the signal file part or null.
     */
    readPartFromFile (startFrom: number, dataLength: number): Promise<SignalFilePart | null>
}
/**
 * SignalFileReader has additional methods for reading the signal header and actuals signal data.
 */
export interface SignalFileReader extends FileFormatReader {
    /**
     * Read information about the recording contained in this file from the file header. Information is also saved
     * into the cached study's `meta.header` property for later use.
     * @param source - Data source as an ArrayBuffer.
     * @param config - Optional configuration for the operation.
     * @returns Loaded header entity.
     */
    readHeader: (source: ArrayBuffer, config?: ConfigReadHeader) => unknown
    /**
     * Read signal information into the cached study's `meta.channels` property. Signal data is loaded directly into
     * the channel's `signal` property if direct loading is possible; otherwise the data is meant to be loaded
     * asynchronously later.
     * @param source - Signal data source as an ArrayBuffer.
     * @param config - Optional configuration for the operation.
     */
    readSignals: (source: ArrayBuffer, config?: ConfigReadSignals) => Promise<void>
}
/**
 * Partially loaded signal file containing:
 * - `data` as a pseudo-File object.
 * - `dataLen` as length of the actual signal data in seconds.
 * - `length` of the loaded part in seconds (recording time).
 * - `start` position of the loaded part in seconds (recording time).
 */
export type SignalFilePart = {
    /** Signal data as a pseudo-File object. */
    data: File
    /** Length of the actual data in seconds. */
    dataLength: number
    /** Length of the loaded part in seconds (recording time, i.e. containing possible gaps). */
    length: number
    /** Starting time of the loaded part in seconds (recording time, i.e. including possible prior gaps). */
    start: number
}
export type SuccessReject = (reason: string) => void
export type SuccessResolve = (response: SuccessResponse) => void
export type SuccessResponse = boolean
