/**
 * Study types.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 * @remarks
 * I admit that the names of the types in this file are not the most imaginative and could benefit
 * from some renovation.
 */

import { DataResource } from './application'
import { FileSystemItem, FileFormatReader, ReaderMode } from './reader'
import { MemoryManager } from './service'


export interface OrderedLoadingProtocol {
    /**
     * Add a new loader to the array of loaders to try.
     * @param loader - StudyLoader to add.
     * @param position - Optional array position for the new loader (will be appended by default).
     */
    addLoader (loader: StudyLoader, position?: number): void
    /**
     * Load the given item and return the contained studies as a StudyCollection.
     * @param item - A MixedFileSystemItem containing the study or collection of studies.
     * @param singleStudy - Treat all files as part of a single study (default false).
     * @returns StudyCollection
     */
    loadStudies (item: FileSystemItem, singleStudy: boolean): Promise<StudyContextCollection>
    /**
     * Remove a loader from the array of loaders to try.
     * @param loader - The StudyLoader to remove or array index of the loader.
     */
    removeLoader (loader: StudyLoader | number): void
}
/**
 * A generic study.
 */
 export type StudyContext = {
    /** Any data that should be immediately available, such as the parsed EDF headers. */
    data: unknown
    /** An array files contained in the study. */
    files: StudyContextFile[]
    /** Primary file format of this study. */
    format: string
    /** Metadata detailing the resource. */
    meta: unknown
    /** Resource modality. */
    modality: string
    /** Descriptive name of the resource. */
    name: string
    /** Study object definition version. */
    version: string
}
/**
 * A collection of studies.
 */
export interface StudyContextCollection {
    /** Descriptive name for this collection. */
    name: string
    studies: StudyContext[]
    /** Possible date of the studies in this collection. */
    date: Date | null
    /** Possible context of this collection. */
    context?: string
    /** Alternative to date, an order number to sort collections. */
    order?: number
}
/**
 * The file (data source) for this study context.
 */
export type StudyContextFile = {
    /** File object, if this study is loaded from the local file system. */
    file: File | null
    /** File format, e.g. edf, dicom. */
    format: string | null
    /** MIME type for the file, if available. */
    mime: string | null
    name: string
    /**
     * Is this a partial file, e.g. only a part of the whole data.
     * If partial, range must contain the confines of this part.
     */
    partial: boolean
    /**
     * Data range for a partial file, in a unit appropriate for the file type.
     * - For time series data and audio/video, the unit is in seconds of recording time.
     */
    range: number[]
    /**
     * The role which this file has in the study.
     * - `data` contains the actual study data, usually signals.
     * - `media` contains video, audio or some other additional study media.
     * - `meta` contains additional information about the study or the data.
     */
    role: StudyContextFileRole
    /**
     * Modality of the data in this file. More general modality can be used if the exact modality is unknown,
     * e.g. `signal` for a file containing biosignal signal, or `unknown` if the modality is not known.
     */
    modality: string
    /**
     * URL poiting to the study data.
     * Must contain an object URL for the data file, even if study is loaded from local filesystem.
     */
    url: string
}

export type StudyContextFileRole = 'data' | 'media' | 'meta'
/**
 * Context containing a study file and relevant metadata.
 */
export type StudyFileContext = {
    file: File | null
    /** File format, e.g. edf, dicom. */
    format: string | null
    mime: string | null
    name: string
    modality: string
    url: string
}
/**
 * Base interface for classes that are used to load and form studies from various data resources.
 */
export interface StudyLoader {
    /** File reader associated with this study loader. */
    fileReader: null | FileFormatReader
    resourceModality: string
    /** Resource modalities supported by this loader. */
    supportedModalities: string[]
    /**
     * Use the loaded study to get a resource of the appropriate type.
     * @param idx - Optional array index or ID string of the resource (defaults to last loaded study).
     * @return DataResource or null if none could be retrieved.
     */
    getResource (idx?: number | string): Promise<DataResource | null>
    /**
     * Check if this loader supports the given study `modality`.
     * @param modality - Study modality.
     * @returns true/false
     */
    isSupportedModality (modality: string): boolean
    /**
     * Load directory files as part of a single study.
     * @param dir - Directory as FileSystemItem.
     * @param config - Optional configuration.
     * @returns StudyCollection, which contains the study if loading was successful.
     */
    loadFromDirectory (dir: FileSystemItem, config?: object): Promise<StudyContext|null>
    /**
     * Load study properties from a single file.
     * @param fsItem - File containing the data.
     * @param config - Optional study configuration.
     * @param study - Optional StudyContext to append file to.
     * @return A promise containing the loaded study as StudyContext
     */
    loadFromFile (file: File, config?: object, study?: StudyContext): Promise<StudyContext|null>
    /**
     * Recurse a given FileSystemItem and load each contained study.
     * @param fileTree - FileSystemItem generated by one of the file loaders.
     * @param config - Optional configuration detailing the contained studies.
     * @return A promise containing the loaded studies as { title: string, date?: string, studies: StudyContext[] }
     */
    loadFromFsItem (fileTree: FileSystemItem, config?: object): Promise<StudyContextCollection[]>
    /**
     * Load study properties from a single file.
     * @param fileUrl - URL to the file.
     * @param config - Optional study configuration.
     * @param preStudy - Optional study object to load the meta data into.
     * @return Promise containing the loaded study as StudyContext
     */
    loadFromUrl (fileUrl: string, config?: object, preStudy?: StudyContext): Promise<StudyContext|null>
    /**
     * Register a new file loader for this study loader.
     * @param loader - The new file loader.
     */
    registerFileReader (loader: FileFormatReader): void
    /**
     * Register the memory manager to use with this study loader.
     * @param manager - Memory manager to use.
     */
    registerMemoryManager (manager: MemoryManager): void
    /**
     * Use the given study in this loader.
     * @param study - The study to use.
     * @param config - Optional configuration.
     * @returns Next available resource array index (= this resource's index, if loaded next).
     */
    useStudy (study: StudyContext, config?: object): Promise<UseStudyResponse>
}
/**
 * Context for a study loader.
 */
export type StudyLoaderContext = {
    /** Label for the loader (to be displayed in the UI). */
    label: string
    /** The loader itself. */
    loader: StudyLoader
    /** Study modalities supported by this loader. */
    modalities: string[]
    /** Mode to use (file, folder, study or url). */
    mode: ReaderMode
}
/**
 * Context for a study load protocol.
 */
export type StudyLoaderProtocolContext = {
    /** Label for the protocol (to be displayed in the UI). */
    label: string
    /** Mode to use (file, folder, study or url). */
    mode: ReaderMode
    /** The protocol itself. */
    protocol: OrderedLoadingProtocol
    /** Study scopes supported by this loader. */
    scopes: string[]
    /** Study tyles supported by this loader. */
    types: string[]
}
/**
 * Returned value is the next available index in this loader's array of resources.
 */
export type UseStudyResponse = number