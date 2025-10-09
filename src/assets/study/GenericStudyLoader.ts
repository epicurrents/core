/**
 * Generic study loader.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { DataResource } from '#types/application'
import type { ConfigStudyLoader } from '#types/config'
import type {
    FileFormatExporter,
    FileFormatImporter,
    FileSystemItem,
} from '#root/src/types/reader'
import type { MemoryManager } from '#types/service'
import type {
    StudyContext,
    StudyContextCollection,
    StudyLoader,
    UseStudyResponse,
} from '#types/study'
import { Log } from 'scoped-event-log'
import ServiceMemoryManager from '#assets/service/ServiceMemoryManager'

export const studyContextTemplate = () => {
    return {
        api: null,
        data: null,
        files: [],
        format: '',
        meta: {},
        modality: 'unknown',
        name: '',
        version: '1.0'
    } as StudyContext
}
const CONFIG_FILE_NAME = 'epicurrents_study_config.json'
const SCOPE = 'GenericStudyLoader'

export default class GenericStudyLoader implements StudyLoader {
    protected _studyExporter: FileFormatExporter | null = null
    protected _studyImporter: FileFormatImporter | null = null
    protected _memoryManager: MemoryManager | null = null
    protected _name: string
    protected _resources: DataResource[] = []
    protected _study: StudyContext | null = null
    protected _supportedModalities: string[]
    /**
     * Create a new study loader.
     * @param name - Name of the loader.
     * @param scopes - Array of supported study scopes.
     * @param types - Array of supported study types.
     * @param importer - Optional study importer to use when loading studies. Can also be set with `registerStudyImporter`.
     * @param exporter - Optional study exporter to use for transcoding studies. Can also be set with `registerStudyExporter`.
     * @param memoryManager - Optional memory manager to use with this loader.
     */
    constructor (
        name: string,
        modalities: string[],
        importer?: FileFormatImporter,
        exporter?: FileFormatExporter,
        memoryManager?: ServiceMemoryManager
    ) {
        this._name = name
        this._supportedModalities = modalities
        if (importer) {
            this.registerStudyImporter(importer)
        }
        if (exporter) {
            this.registerStudyExporter(exporter)
        }
        if (memoryManager) {
            this.registerMemoryManager(memoryManager)
        }
    }
    /**
     * Check if this loader can be used to load a study with the given configuration.
     * @param config - Study configuration.
     * @returns True/false.
     */
    protected _canLoadResource (config: ConfigStudyLoader): boolean {
        if (config.loader && config.loader !== this._name) {
            return false
        }
        if (config.modality && !this.isSupportedModality(config.modality)) {
            return false
        }
        return true
    }

    get resourceModality () {
        // Override this in the child loader.
        return 'unknown'
    }

    get studyExporter () {
        return this._studyExporter
    }

    get studyImporter () {
        return this._studyImporter
    }

    get supportedModalities () {
        return this._supportedModalities
    }

    async getResource (idx: number | string = -1): Promise<DataResource | null> {
        if (typeof idx === 'string') {
            // Find resource by ID.
            for (const resource of this._resources) {
                if (resource.id === idx) {
                    return resource
                }
            }
            return null
        }
        if (idx >= 0) {
            return this._resources[idx] || null
        }
        if (!this._study) {
            if (this._resources.length) {
                return this._resources[this._resources.length - 1]
            } else {
                return null
            }
        }
        return null
    }

    isSupportedModality (modality: string): boolean {
        for (const supported of this._supportedModalities) {
            if (supported === modality) {
                return true
            }
        }
        return false
    }

    async loadFromDirectory (dir: FileSystemItem, options?: ConfigStudyLoader): Promise<StudyContext|null> {
        if (!this._studyImporter) {
            Log.error(`Cannot load study from directory, file loader has not been set.`, SCOPE)
            return null
        }
        if (!this._canLoadResource(options || {})) {
            return null
        }
        // Pass the directory name as default study name.
        const study = studyContextTemplate()
        Object.assign(study, { name: dir.name }, options)
        if (study) {
            Log.debug(`Started loading a study from directory (${dir.name}).`, SCOPE)
            for (let i=1; i<dir.files.length; i++) {
                const dirFile = dir.files[i]
                // Try to load the file, according to extension.
                const fileConfig = { name: dirFile.name }
                if (this._studyImporter.matchName(dirFile.name)) {
                    this._studyImporter.registerStudy(study)
                    const readResult = dirFile.file
                                        ? await this._studyImporter.importFile(dirFile.file, fileConfig)
                                        : dirFile.url
                                          ? await this._studyImporter.importUrl(dirFile.url, fileConfig)
                                          : null
                    if (!(readResult)) {
                        Log.error(`Failed to load study ${study.name}.`, SCOPE)
                        return null
                    }
                } else {
                    Log.debug(`No file loaders matched the given file name.`, SCOPE)
                    study.files.push({
                        file: dirFile.file || null,
                        format: '',
                        mime: null,
                        name: dirFile.name,
                        // Assume that the files contained are full data files.
                        // This can be changed later on, when the files have been properly identified.
                        partial: false,
                        range: [],
                        role: 'data',
                        modality: '',
                        url: dirFile.url as string,
                    })
                }
            }
        }
        this._study = study
        return study
    }

    async loadFromFile (file: File, options: ConfigStudyLoader = {}, study?: StudyContext):
                       Promise<StudyContext|null>
    {
        if (!this._studyImporter) {
            Log.error(`Cannot load study from a file, file loader has not been set.`, SCOPE)
            return null
        }
        if (!this._canLoadResource(options)) {
            return null
        }
        if (options.modality && !this._studyImporter.isSupportedModality(options.modality)) {
            Log.error(`Current file loader does not support modality ${options.modality}.`, SCOPE)
            return null
        }
        if (!study) {
            study = studyContextTemplate()
            if (options) {
                Object.assign(study, options)
            }
        }
        if (!study.name) {
            // Use file name as default.
            study.name = options.name || 'Study'
        }
        Log.debug(`Started loading a study from file ${file.name} (${options.name}).`, SCOPE)
        // Try to load the file, according to extension.
        const fName = options.name || file.name
        if (this._studyImporter.matchName(fName)) {
            this._studyImporter.registerStudy(study)
            if (!(await this._studyImporter.importFile(file, { name: fName }))) {
                Log.error(`Failed to load study ${study.name}.`, SCOPE)
                return null
            }
        }
        this._study = study
        return study
    }

    async loadFromFsItem (fileTree: FileSystemItem, options: ConfigStudyLoader = {}):
                         Promise<StudyContextCollection[]>
    {
        if (!this._studyImporter) {
            Log.error(`Cannot load study from a filesystem item, file loader has not been set.`, SCOPE)
            return []
        }
        if (!this._canLoadResource(options)) {
            return []
        }
        if (!fileTree) {
            return []
        }
        const collections = []
        let rootDir = fileTree
        while (!rootDir.files.length && rootDir.directories.length === 1) {
            // Recurse until we arrive at the root folder of the image sets.
            rootDir = rootDir.directories[0]
        }
        // Check for possible config file in the root directory.
        if (rootDir.files.length) {
            for (let i=0; i<rootDir.files.length; i++) {
                if (rootDir.files[i].name === CONFIG_FILE_NAME) {
                    // Remove the config file from the directory.
                    const confFile = rootDir.files.splice(i, 1)[0]
                    // Attempt to read config from the file.
                    await new Promise((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onloadend = (e: ProgressEvent<FileReader>) => {
                            const result = JSON.parse(e.target?.result as string)
                            resolve(result)
                        }
                        reader.onerror = (e: unknown) => {
                            reject(e)
                        }
                        reader.readAsText(confFile.file as File)
                    }).then((json) => {
                        options = Object.assign(json as { [key: string]: unknown }, options)
                    }).catch(e => {
                        Log.error(`Could not load config from ${confFile.path}.`, SCOPE, e)
                    })
                    break
                }
            }
        }
        // Make sure there is a collections and studies property on options.
        if (!Object.hasOwn(options, 'collections')) {
            options.collections = {}
        }
        if (!Object.hasOwn(options, 'studies')) {
            options.studies = {}
        }
        // Next, check if this is a single file dir or several dirs.
        if (!rootDir.directories.length && rootDir.files.length) {
            const studies = []
            if (!rootDir.path) {
                // If this is the "pseudo" root directory, add each file as a separate study
                // (as they were dragged as separate files into the viewer).
                for (let i=0; i<rootDir.files.length; i++) {
                    const curFile = rootDir.files[i]
                    let study
                    if (curFile.file && !curFile.url) {
                        curFile.url = URL.createObjectURL(curFile.file)
                    }
                    studies.push(study)
                }
            } else {
                // Add all files as parts of the same study.
                const study = this.loadFromDirectory(rootDir, options)
                if (study) {
                    // Only add successfully loaded studies.
                    studies.push(study)
                }
            }
            collections.push(
                Object.assign(
                    { studies: studies },
                    { title: rootDir.name },
                    options.collections ? options.collections[rootDir.name] : undefined,
                    options.collections ? options.collections[rootDir.path] : undefined
                )
            )
        } else if (rootDir.directories.length) {
            // Check if this directory contains several collections.
            let visitDirs = [rootDir]
            for (let i=0; i<rootDir.directories.length; i++) {
                // Allow single nested directories inside studies as well.
                while (!rootDir.directories[i].files.length && rootDir.directories[i].directories.length === 1) {
                    rootDir.directories[i] = rootDir.directories[i].directories[0]
                }
                if (rootDir.directories[i].directories.length) {
                    visitDirs = rootDir.directories
                }
            }
            // Try to add each individual dir as a separate study.
            // First check that each directory really contains only files, skip those that don't.
            for (const visitDir of visitDirs) {
                const studies = [] as StudyContext[]
                for (let i=0; i<visitDir.directories.length; i++) {
                    const curDir = visitDir.directories[i]
                    if (curDir.directories.length) {
                        Log.warn(`${curDir.path} was omitted because it contained subdirectories.`, SCOPE)
                        continue
                    } else if (!curDir.files.length) {
                        Log.warn(`${curDir.path} was omitted because it was empty.`, SCOPE)
                        continue
                    } else {
                        const study = await this.loadFromDirectory(curDir, options)
                        if (study) {
                            // Only add successfully loaded studies.
                            studies.push(study)
                        }
                    }
                }
                const collection = Object.assign(
                    { studies: studies },
                    { title: visitDir.name },
                    options.collections ? options.collections[visitDir.name] : undefined,
                    options.collections ? options.collections[visitDir.path] : undefined
                )
                collections.push(collection)
            }
        } else {
            Log.warn("Dropped item had an empty root directory!", SCOPE)
        }
        // Order by date.
        collections.sort((a, b) => { return ((a.date?.getTime() || 0) - (b.date?.getTime() || 0)) })
        return collections
    }

    async loadFromUrl (fileUrl: string, options: ConfigStudyLoader = {}, study?: StudyContext):
                      Promise<StudyContext|null>
    {
        if (!this._studyImporter) {
            Log.error(`Cannot load study from a URL, file loader has not been set.`, SCOPE)
            return null
        }
        if (!this._canLoadResource(options)) {
            return null
        }
        if (options.modality && !this._studyImporter.isSupportedModality(options.modality)) {
            Log.error(`Current file loader does not support modality ${options.modality}.`, SCOPE)
            return null
        }
        if (!study) {
            study = studyContextTemplate()
            if (options) {
                Object.assign(study, options)
            }
        }
        if (!study.name) {
            // Use file name as default.
            study.name = options.name || 'Study'
        }
        // Try to load the file, according to extension.
        const urlEnd = fileUrl.split('/').pop()
        const fName = options.name || urlEnd || ''
        Log.debug(`Started loading a study from URL ${fileUrl} (${fName}).`, SCOPE)
        if (this._studyImporter.matchName(fName)) {
            options.name = fName
            this._studyImporter.registerStudy(study)
            if (!(await this._studyImporter.importUrl(fileUrl, options))) {
                Log.error(`Failed to load study ${study.name}.`, SCOPE)
                return null
            }
        } else {
            Log.error(`No file loaders matched the given file name.`, SCOPE)
            return null
        }
        this._study = study
        return study
    }

    async useStudy (study: StudyContext): Promise<UseStudyResponse> {
        for (const studyFile of study.files) {
            // Once more check that all files have a URL.
            if (!studyFile.url) {
                if (studyFile.file) {
                    studyFile.url = URL.createObjectURL(studyFile.file)
                } else {
                    continue
                }
            }
        }
        this._study = study
        this._studyImporter?.registerStudy(this._study)
        return this._resources.length
    }

    registerMemoryManager (manager: MemoryManager) {
        this._memoryManager = manager
        if (this._studyImporter) {
            this._studyImporter.registerMemoryManager(manager)
        }
    }

    registerStudyExporter (writer: FileFormatExporter) {
        this._studyExporter = writer
    }

    registerStudyImporter (reader: FileFormatImporter) {
        this._studyImporter = reader
        reader.studyLoader = this
        if (this._memoryManager) {
            reader.registerMemoryManager(this._memoryManager)
        }
    }
}
