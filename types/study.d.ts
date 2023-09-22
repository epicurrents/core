/**
 * Study types.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 * @remarks
 * I admit that the names of the types in this file are not the most imaginative and could benefit
 * from some renovation.
 */

import { DataResource, MemoryManager } from "./assets"
import { FileSystemItem, FileFormatLoader, LoaderMode } from "./loader"


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
    loadStudies (item: FileSystemItem, singleStudy: boolean): Promise<StudyCollection>
    /**
     * Remove a loader from the array of loaders to try.
     * @param loader - The StudyLoader to remove or array index of the loader.
     */
    removeLoader (loader: StudyLoader | number): void
}
/**
 * A collection of studies.
 */
export interface StudyCollection {
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
 * A generic study.
 */
 export type StudyContext = {
    /** Any data that should be immediately available, such as the parsed EDF headers. */
    data: any
    /** An array files contained in the study. */
    files: StudyContextFile[]
    /** Primary file format of this study. */
    format: string
    /** Metadata detailing the resource. */
    meta: any
    /** Descriptive name of the resource. */
    name: string
    /** Resource scope, e.g. 'doc', 'sig'. */
    scope: string
    /** Resource type within the context. */
    type: string
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
     * Application type for this file, or scope if exact type is unknown.
     * E.g. `sig` for a file containing biosignal signal data or `eeg` for a file
     * containing EEG signal data.
     */
    type: string
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
    type: string
    url: string
}
/**
 * Base interface for classes that are used to load and form studies from various data resources.
 */
export interface StudyLoader {
    resourceScope: string
    /** Resource scopes supported by this loader. */
    supportedScopes: string[]
    /** Resource types supported by this loader. */
    supportedTypes: string[]
    /**
     * Use the loaded study to get a resource of the appropriate type.
     * @param idx - Optional array index or ID string of the resource (defaults to last loaded study).
     * @return DataResource or null if none could be retrieved.
     */
    getResource (idx?: number | string): Promise<DataResource | null>
    /**
     * Check if this loader supports the given study scope.
     * @param scope - Study scope.
     * @returns true/false
     */
    isSupportedScope (scope: string): boolean
    /**
     * Check if this loader supports the given study type.
     * @param type - Full study type (`scope:type`) or plain type.
     * @returns true/false
     */
    isSupportedType (type: string): boolean
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
    loadFromFsItem (fileTree: FileSystemItem, config?: object): Promise<StudyCollection[]>
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
    registerFileLoader (loader: FileFormatLoader): void
    /**
     * Register the memory manager to use with this study loader.
     * @param manager - Memory manager to use.
     */
    registerMemoryManager (manager: MemoryManager): void
    /**
     * Use the given study in this loader.
     * @param study - The study to use.
     * @param config - Optional configuration.
     * @returns Array index of the resource if loaded next.
     */
    useStudy (study: StudyContext, config?: object): Promise<number>
}
/**
 * Context for a study loader.
 */
export type StudyLoaderContext = {
    /** Label for the loader (to be displayed in the UI). */
    label: string
    /** Mode to use (file, folder). */
    mode: LoaderMode
    /** The loader itself. */
    loader: StudyLoader
    /** Study scopes supported by this loader. */
    scopes: string[]
    /** Study tyles supported by this loader. */
    types: string[]
}
/**
 * Context for a study load protocol.
 */
export type StudyLoaderProtocolContext = {
    /** Label for the protocol (to be displayed in the UI). */
    label: string
    /** Mode to use (file, folder). */
    mode: LoaderMode
    /** The protocol itself. */
    protocol: OrderedLoadingProtocol
    /** Study scopes supported by this loader. */
    scopes: string[]
    /** Study tyles supported by this loader. */
    types: string[]
}
