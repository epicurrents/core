/**
 * Reader types.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { MutexExportProperties } from 'asymmetric-io-mutex'
import { BaseAsset } from './application'
import {
    AnnotationEventTemplate,
    AnnotationLabelTemplate,
    AnnotationTemplate,
    BiosignalHeaderRecord,
    SignalDataCache,
    SignalInterruption,
    SignalInterruptionMap,
} from './biosignal'
import { MemoryManager, SignalCachePart } from './service'
import {
    StudyContext,
    StudyContextFile,
    StudyLoader,
} from './study'
import { MediaDataset } from './dataset'
import {
    Modify,
    TypedNumberArray,
    TypedNumberArrayConstructor,
} from './util'
import { UrlAccessOptions } from './config'

export type AnonymizationProperties = {
    /**
     * Anonymize the patient ID.
     */
    anonymizePatientId?: boolean
    /**
     * Anonymize the patient name.
     */
    anonymizePatientName?: boolean
    /**
     * Anonymize the patient birth date.
     */
    anonymizePatientBirthDate?: boolean
}

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
        modality?: string
    }[]
}

/**
 * URL reader optional configuration.
 * @param authHeader - Authorization header to include in the request.
 * @param headerReader - Header reader configuration.
 * @param mime - Mime type of the file.
 * @param name - Name of the file.
 * @param signalReader - Signal reader configuration.
 * @param url - Study file URL, if different from the source URL.
 */
export type ConfigReadUrl = UrlAccessOptions & {
    headerReader?: ConfigReadHeader
    mime?: string
    name?: string
    signalReader?: ConfigReadSignals
    url?: string
}
/**
 * A generic cache for storing data.
 * @remarks
 * The data cache does not have to extend BaseAsset, as it is only used to store immutable data and to process
 * asynchronous requests, it does not need a serializable state of its own.
 */
export interface DataProcessorCache {
    /**
     * Read and cache properties from an entire file.
     * @param file - The File object to read.
     * @param startFrom - Optional starting byte position to start reading from.
     * @remarks
     * This method must have a format-specific implementation in the child class.
     */
    cacheFile (file: File, startFrom?: number): Promise<void>
    /**
     * Destroy the cache by removing all references and releasing any reserved resources. This process is irreversible.
     */
    destroy (): void | Promise<void>
    /**
     * Release allocated buffers and return to initial state.
     * @returns Promise that resolves when the cache has been released.
     */
    releaseCache (): Promise<void>
    /**
     * Initialize a new, plain reader cache.
     * @param bufferSize - Buffer size in bytes, if known.
     * @returns Created cache on success, null on failure.
     */
    setupCache (bufferSize?: number): unknown | null
    /**
     * Set up a simple data cache as the data source for this montage.
     * @param params - Implementation specific parameters for setting up the cache.
     * @remarks
     * This method must have an appropriate implementation in the child class.
     */
    setupCacheWithInput (...params: unknown[]): void
    /**
     * Initialize a new shared array mutex using the given `buffer`.
     * @param buffer - Buffer to store the data in.
     * @param bufferStart - Starting index within the buffer allocated to this mutex.
     * @param bufferSize - Optional size of the buffer allocated to this mutex.
     * @returns Export properties of the new mutex or null on failure.
     */
    setupMutex (
        buffer: SharedArrayBuffer,
        bufferStart: number,
        bufferSize?: number,
    ): Promise<MutexExportProperties|null>
    /**
     * Set up an input mutex as the source for file loading. This will create a new mutex for storing processed data
     * and can only be done once.
     * @param params - Implementation specific parameters for setting up the mutex.
     * @returns Newly created mutex properties or null on failure.
     * @remarks
     * This method must have an appropriate implementation in the child class.
     */
    setupMutexWithInput (...params: unknown[]): Promise<MutexExportProperties|null>
    /**
     * Set up a shared worker for file loading. This will use a shared worker to query for input data.
     * @param params - Implementation specific parameters for setting up the worker.
     * @return Promise resolving to true on success, false on failure.
     * @remarks
     * This method must have an appropriate implementation in the child class.
     */
    setupSharedWorkerWithInput (...params: unknown[]): Promise<boolean>
}

export interface FileDecoder {
    /** Decoded input data. */
    output: unknown
    /**
     * Decode the data part of the input buffer.
     * @param header - Header to use for decoding.
     * @param buffer - Optional buffer to use instead of input buffer.
     * @param extraParams - Optional decoder-specific parameters.
     */
    decodeData (header: unknown, buffer?: ArrayBuffer, ...extraParams: unknown[]): unknown
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
export interface FileEncoder extends BaseAsset {
    dataEncoding: TypedNumberArrayConstructor
}
export interface FileFormatImporter extends BaseAsset {
    /** File types associated with this reader. */
    fileTypes: AssociatedFileType[]
    /** Only allow selecting accepted types in the file picker. */
    onlyAcceptedTypes: boolean
    /** `StudyContext` registered to this reader. */
    study: StudyContext | null
    /** The study loader instance that this file reader serves. */
    studyLoader: StudyLoader | null
    /**
     * Destroy the file reader and release all resources.
     */
    destroy (): void
    /**
     * Get the appropriate worker for this file type.
     * @param override - Possible override to use for certain test modalities etc.
     * @returns Worker or null
     */
    getFileTypeWorker (override?: string): Worker | null
    /**
     * Import a local file from the filesystem.
     * @param file - The `File` to load.
     */
    importFile (file: StudyContextFile | File, config?: unknown): Promise<StudyContextFile | null>
    /**
     * Import a remote file from the give `url`.
     * @param url - The URL to load the file from.
     */
    importUrl (url: StudyContextFile | string, config?: ConfigReadUrl): Promise<StudyContextFile | null>
    /**
     * See if the given `modality` is supported by this reader.
     * @param modality - Modality to check.
     * @return True if supported, false if not.
     */
    isSupportedModality (modality: string): boolean
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
/**
 * A file format module must export a reader and may optionally export a writer for the file type.
 */
export type FileFormatModule = {
    /** Reader instance for this file type (mandatory). */
    reader: FileFormatImporter
    /** Writer instance for this file type (null if not supported by the module). */
    writer: FileFormatExporter | null
}
export type FileFormatReaderSpecs = {
    /** Patterns to match the filename against. */
    matchPatters: RegExp[]
}
/**
 * FileFormatExporter is an interface for exporting studies in a specific format.
 */
export interface FileFormatExporter extends BaseAsset {
    /** Description of the produced files(s). */
    description: string
    /** The file format that this exporter produces. */
    readonly format: string
    /**
     * Export the study to the given dataset.
     * @param dataset - The dataset to export the study to.
     * @param path - Path within the dataset to write the study to.
     * @returns Promise that resolves when the study has been exported.
     */
    exportStudyToDataset (dataset: MediaDataset, path: string): Promise<void>
    /**
     * Export the study to the file system.
     * @returns Promise that resolves when the study has been exported.
     */
    exportStudyToFileSystem (): Promise<void>
    /**
     * Set the source study for this exporter.
     * @param study - The `StudyContext` to use as the source for exporting.
     */
    setSourceStudy (study: StudyContext): void
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
    /** Possible file mime type. */
    mime?: string
    /** Possible file size in bytes. */
    size?: number
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
 * Options for reading a file from a URL.
 * @param authHeader - Optional authorization header to include in the request.
 * @param callbackOnProgress - Optional callback for monitoring progress.
 * @param chunkSize - Optional chunk size to use when loading the file, in bytes.
 * @param startFrom - Optional starting point of the loading process, in bytes.
 */
export type ReadFileFromUrlOptions = UrlAccessOptions & {
    /**
     * Optional callback for monitoring progress.
     * @param content - Content of the loaded batch.
     * @param loaded - Amount of data loaded so far in bytes.
     * @param total - Total size of the file in bytes.
     */
    callbackOnProgress?: (content: unknown, loaded: number, total: number) => void
    /** Optional chunk size to use when loading the file, in bytes. */
    chunkSize?: number
    /** Optional starting point of the loading process, in bytes. */
    startFrom?: number
}
export type ReadTextFromUrlOptions = Modify<ReadFileFromUrlOptions, {
    /**
     * Optional callback for monitoring progress.
     * @param content - Text content of the loaded batch.
     * @param loaded - Amount of data loaded so far in bytes.
     * @param total - Total size of the file in bytes.
     */
    callbackOnProgress?: (content: string, loaded: number, total: number) => void
}>
export interface SignalDataDecoder extends FileDecoder {
    /**
    * Decode signal file data. Can only be called after the header is decoded or a header object is provided.
    * @param header - Signal header to use instead of stored header.
    * @param buffer - Buffer to use instead of stored buffer data (optional).
    * @param dataOffset - Byte size of the header or byte index of the record to start from (optional).
    * @param startRecord - Record number at dataOffset (default 0).
    * @param range - Range of records to decode from buffer (optional, but required if a buffer is provided).
    * @param priorOffset - Time offset of the prior data (i.e. total interruption time before buffer start, optional, default 0).
    * @param returnRaw -Return the raw digital signals instead of physical signals (default false).
    * @returns An object holding the decoded signals with possible annotations and data interruptions, or null if an error occurred.
    */
    decodeData (
        header: unknown,
        buffer?: ArrayBuffer,
        dataOffset?: number,
        startRecord?: number,
        range?: number,
        priorOffset?: number,
        returnRaw?: boolean
    ): SignalDecodeResult | null
}
/**
 * SignalDataEncoder provides methods for encoding signal data into a specific format.
 */
export interface SignalDataEncoder extends FileEncoder {
    /**
     * Create a new header for the signal data.
     * @param properties - Properties to use for creating the header.
     */
    createHeader (properties?: Partial<BiosignalHeaderRecord>): BiosignalHeaderRecord
    /**
     * Encode the header and signal data into a specific format.
     * @param anonymize - Whether to anonymize the data before encoding.
     * @returns Promise resolving to an ArrayBuffer containing the encoded data, or null if encoding failed.
     */
    encode (anonymize?: boolean): Promise<ArrayBuffer | null>
    /**
     * Set the annotations to include in the encoded data.
     * @param annotations - Annotations to include.
     */
    setAnnotations (annotations: AnnotationTemplate[]): void
    /**
     * Set new values to the given header `properties`.
     * @param properties - Properties to use for creating the header.
     * @returns The created header.
     */
    setHeader (properties?: Partial<BiosignalHeaderRecord>): BiosignalHeaderRecord
    /**
     * Set the recording interruptions to include in the encoded data.
     * @param interruptions - Recording interruptions to include.
     */
    setInterruptions (interruptions: SignalInterruptionMap): void
    /**
     * Set the signals to include in the encoded data.
     * @param signals - Array of signal indices (according to the header) to include.
     */
    setSignalsToInclude (signals: number[]): void
}
/**
 * SignalDataReader serves as an interface for file reading. After setting the required metadata, parts of the signal
 * file can be loaded using time indices and the class handles all conversions between file time and byte positions,
 * taking into account possible data unit (record) lengths and maximum allowed single load (chunk) sizes.
 *
 * For larger files it will keep loading the file progressively until the maximum cache size has been reached (NYI).
 *
 * Data loading methods return a promise which resolves when the requested data has been loaded or rejects if there
 * is an error.
 */
export interface SignalDataReader extends SignalProcessorCache {
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
     * Cache raw signals from the file at the given URL.
     * @param startFrom - Start caching from the given time point (in seconds) - optional.
     * @returns Success (true/false).
     */
    cacheSignals (startFrom?: number): Promise<boolean>
    /**
     * Destroy the reader and release all resources.
     * @returns Promise that resolves when the reader has been destroyed.
     */
    destroy (): void | Promise<void>
    /**
     * Read and cache the entire file from the given URL.
     * @param url - Optional URL of the file (defaults to cached URL).
     * @returns Loading success (true/false).
     */
    readFileFromUrl (url?: string): Promise<boolean>
    /**
     * Set the update callback to get loading updates.
     * @param callback - A method that takes the loading update as a parameter.
     */
    setUpdateCallback (callback: ((update: { [prop: string]: unknown }) => void) | null): void
}
/**
 * SignalDataReader serves as an interface for file writing. After setting the required metadata and a signal data
 * cache, a new file can be created and retrieved as an array buffer.
 */
export interface SignalDataWriter extends SignalProcessorCache {
    /**
     * Set the biosignal header for the file to be written.
     * @param header - The biosignal header to use.
     */
    setBiosignalHeader (header: BiosignalHeaderRecord): void
    /**
     * Set the file type specific header for the file to be written.
     * @param header - The file type header to use.
     */
    setFileTypeHeader (header: unknown): void
    /**
     * Set the source data array for copying the original signal data from. The single array should contain all the
     * signals for the recording; header information will be used to parse the data.
     * @param buffer - The ArrayBuffer containing the signal data.
     */
    setSourceArrayBuffer (buffer: ArrayBuffer): void
    /**
     * Set the source digital signals to copy the original signal data from.
     * Source and target files must use the same encoding for the signal data.
     * The signals should be in the same order as defined in the header.
     * @param signals - Array of TypedNumberArrays containing the digital signal data.
     */
    setSourceDigitalSignals (signals: TypedNumberArray[]): void
    /**
     * Write the recording to an array buffer.
     * @returns Promise that resolves when the file has been written.
     */
    writeRecordingToArrayBuffer (): Promise<ArrayBuffer | null>
    /**
     * Write the recording to a File object.
     * @param fileName - Name of the file to write.
     * @returns Promise that resolves with the File object or null if an error occurred.
     */
    writeRecordingToFile (fileName: string): Promise<File | null>
    /**
     * Write the recording to a ReadableStream.
     * @returns A ReadableStream that will relay the file data as it is being encoded or null if not available.
     */
    writeRecordingToStream (): ReadableStream | null
}
/**
 * Result of decoding a signal part.
 */
export type SignalDecodeResult = {
    /** Decoded signals as an array of channels each containing a time series of values. */
    signals: number[][]
    /** Possible events for the decoded signals. */
    events?: AnnotationEventTemplate[]
    /** Possible interruptions in the decoded signals. */
    interruptions?: SignalInterruptionMap
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
/**
 * SignalProcessorCache provide methods for storing and processing signal data. It doesn't have any direct interaction
 * with the file source, so it can be used both in the main thread and in workers.
 */
export interface SignalProcessorCache extends Modify<DataProcessorCache, {
    /**
     * Set up a simple signal cache as the data source for this montage.
     * @param cache - The data cache to use.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including gaps) in seconds.
     * @param interruptions - Possible interruptions in the recording.
     */
    setupCacheWithInput (
        cache: SignalDataCache,
        dataDuration: number,
        recordingDuration: number,
        interruptions?: SignalInterruption[],
    ): void
    /**
     * Set up an input mutex as the source for signal data loading. This will create a new mutex for storing processed
     * signal data and can only be done once.
     * @param input - Properties of the input data mutex.
     * @param bufferStart - Starting index of the new mutex array in the buffer.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including gaps) in seconds.
     * @param interruptions - Possible interruptions in the recording.
     * @returns Newly created mutex properties or null on failure.
     */
    setupMutexWithInput (
        input: MutexExportProperties,
        bufferStart: number,
        dataDuration: number,
        recordingDuration: number,
        interruptions?: SignalInterruption[]
    ): Promise<MutexExportProperties|null>
    /**
     * Set up a shared worker for file loading. This will use a shared worker to query for raw signal data.
     * @param input - Message port from the input worker.
     * @param dataDuration - Duration of actual signal data in seconds.
     * @param recordingDuration - Total duration of the recording (including interruptions) in seconds.
     * @param interruptions - Possible interruptions in the recording.
     */
    setupSharedWorkerWithInput (
        input: MessagePort,
        dataDuration: number,
        recordingDuration: number,
        interruptions?: SignalInterruption[]
    ): Promise<boolean>
}> {
    /**
     * Is the source file discontinuous.
     */
    discontinuous: boolean
    /**
     * Total length of the recording in seconds (including gaps).
     */
    totalLength: number
    /**
     * Add new, unique events to the event cache.
     * @param events - New events to check and cache.
     */
    addNewEvents (...events: AnnotationEventTemplate[]): void
    /**
     * Add new, unique interruptions to the recording interruption cache.
     * @param newInterruptions - New interruptions to check and cache.
     */
    addNewInterruptions (newInterruptions: SignalInterruptionMap): void
    /**
     * Add new, unique labels to the cache.
     * @param labels - New labels to check and cache.
     */
    addNewLabels (...labels: AnnotationLabelTemplate[]): void
    /**
     * Get any cached events from data units in the provided `range`.
     * @param range - Recording range in seconds [included, excluded].
     * @returns List of events as AnnotationEventTemplate[].
     */
    getEvents (range?: number[]): AnnotationEventTemplate[]
    /**
     * Get cached annotation labels.
     * @returns List of labels as AnnotationLabelTemplate[].
     */
    getLabels (): AnnotationLabelTemplate[]
    /**
     * Retrieve recording interruptions in the given `range`.
     * @param range - Time range to check in seconds.
     * @param useCacheTime - Consider range in cache time without prior interruptions (for internal use, default false).
     * @remarks
     * For file structures based on data units, both the starting and ending data unit are excluded,
     * because there cannot be an interruption inside just one unit.
     */
    getInterruptions (range?: number[], useCacheTime?: boolean): SignalInterruption[]
    /**
     * Get signals for the given part.
     * @param range - Range in seconds as [start, end].
     * @param config - Optional configuration.
     * @returns SignalCachePart or null, if an error occurred.
     */
    getSignals (range: number[], config?: unknown): Promise<SignalCachePart|null>
    /**
     * Overwrite current events with a new set of events.
     * @param events - Events to set.
     */
    setEvents (events: AnnotationEventTemplate[]): void
    /**
     * Set new recording interruptions for the source data.
     * @param interruptions - The new interruptions.
     */
    setInterruptions (interruptions: SignalInterruptionMap): void
    /**
     * Overwrite current labels with a new set of labels.
     * @param labels - The new labels.
     */
    setLabels (labels: AnnotationLabelTemplate[]): void
}
/**
 * SignalStudyImporter has additional methods for reading the file header.
 */
export interface SignalStudyImporter extends FileFormatImporter {
    /**
     * Read information about the recording contained in this file from the file header. Information is also saved
     * into the cached study's `meta.header` property for later use.
     * @param source - Data source as an ArrayBuffer.
     * @param config - Optional configuration for the operation.
     * @returns Promise that resolves with the loaded header entity or null if an error occurred.
     */
    readHeader: (source: ArrayBuffer, config?: ConfigReadHeader) => Promise<unknown | null>
}

export type SuccessReject = (reason: string) => void
export type SuccessResolve = (response: SuccessResponse) => void
export type SuccessResponse = boolean

export interface TextDataReader extends DataProcessorCache {
    /**
     * Read and cache the entire file from a URL.
     * @param url - Optional override for the URL to read from.
     * @param options - Optional method options.
     * @returns True if successful, false otherwise.
     */
    readFileFromUrl (url?: string, options?: ReadTextFromUrlOptions): Promise<boolean>
    /**
     * Read a part of the text data from the source file.
     * @param start - Starting byte position of the part to read.
     * @param length - Length of the part to read.
     * @returns The requested part of the file as a text string, or null if unable to read.
     */
    readPartFromFile (start: number, length: number): Promise<string | null>
}

/** Target for writing study export files. */
export type WriterMode = 'file' | 'dataset'
