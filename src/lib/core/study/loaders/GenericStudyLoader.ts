/**
 * Generic study loader.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type DataResource, type MemoryManager } from 'TYPES/lib/core'
import { type FileFormatLoader, type FileSystemItem } from "TYPES/lib/loader"
import { type StudyContext, type StudyLoader } from 'TYPES/lib/study'
import Log from 'scoped-ts-log'
import ServiceMemoryManager from 'LIB/core/service/ServiceMemoryManager'
import StudyCollection from '../StudyCollection'

export const studyContextTemplate = () => {
    return {
        data: null,
        files: [] as {
            file: File | null,
            format: string | null,
            mime: string | null,
            type: string,
            url :string,
        }[],
        format: '',
        meta: {},
        name: '',
        scope: '',
        type: '',
        version: '1.0'
    } as StudyContext
}
const CONFIG_FILE_NAME = 'epicurrents_study_config.json'
const SCOPE = 'GenericStudyLoader'

export default class GenericStudyLoader implements StudyLoader {
    protected _fileLoader: FileFormatLoader | null = null
    protected _memoryManager: MemoryManager | null = null
    protected _name: string
    protected _resources: DataResource[] = []
    protected _study: StudyContext | null = null
    protected _supportedScopes: string[]
    protected _supportedTypes: string[]
    /**
     * Create a new study loader.
     * @param name - Name of the loader.
     * @param scopes - Array of supported study scopes.
     * @param types - Array of supported study types.
     * @param loader - Optional file loader to use when loading studies. Can also be set with `registerFileLoader`.
     */
    constructor (
        name: string,
        scopes: string[],
        types: string[],
        loader?: FileFormatLoader,
        memoryManager?: ServiceMemoryManager
    ) {
        this._name = name
        this._supportedScopes = scopes
        this._supportedTypes = types
        if (loader) {
            this.registerFileLoader(loader)
            loader.studyLoader = this
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
    protected _canLoadResource (config: any): boolean {
        if (config.loader && config.loader !== this._name) {
            return false
        }
        if (config.scope && !this.isSupportedScope(config.scope)) {
            return false
        }
        if (config.type && !this.isSupportedType(config.type)) {
            return false
        }
        return true
    }

    get resourceScope () {
        // Override this in the child loader.
        return 'UNKNOWN'
    }

    get supportedScopes () {
        return this._supportedScopes
    }

    get supportedTypes () {
        return this._supportedTypes
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

    public isSupportedScope (scope: string): boolean {
        for (const supported of this._supportedScopes) {
            if (supported === scope) {
                return true
            }
        }
        return false
    }

    public isSupportedType (type: string): boolean {
        const typeParams = type.split(':')
        if (typeParams.length === 2) {
            for (const context of this._supportedScopes) {
                if (context === typeParams[0]) {
                    for (const supported of this._supportedTypes) {
                        if (supported === typeParams[1]) {
                            return true
                        }
                    }
                }
            }
        } else if (typeParams.length === 1) {
            for (const supported of this._supportedTypes) {
                if (supported === type) {
                    return true
                }
            }
        }
        return false
    }

    public async loadFromDirectory (dir: FileSystemItem, config = {} as any): Promise<StudyContext|null> {
        if (!this._canLoadResource(config)) {
            return null
        }
        // Pass the directory name as default study name.
        const study = studyContextTemplate()
        Object.assign(study, { name: dir.name }, config)
        if (study) {
            for (let i=1; i<dir.files.length; i++) {
                if (dir.files[i].file && !dir.files[i].url) {
                    dir.files[i].url = URL.createObjectURL(dir.files[i].file as File)
                }
                study.files.push({
                    file: dir.files[i].file || null,
                    format: '',
                    mime: null,
                    name: dir.files[i].name,
                    // Assume that the files contained are full data files.
                    // This can be changed later on, when the files have been properly identified.
                    partial: false,
                    range: [],
                    role: 'data',
                    type: '',
                    url: dir.files[i].url as string,
                })
            }
        }
        this._study = study
        return study
    }

    public async loadFromFile (file: File, config = {} as any, study?: StudyContext): Promise<StudyContext|null> {
        if (!this._fileLoader) {
            Log.error(`Cannot load study from a file, file loader has not been set.`, SCOPE)
            return null
        }
        if (!this._canLoadResource(config)) {
            return null
        }
        if (config.context && !this._fileLoader.isSupportedScope(config.scope)) {
            Log.error(`Current file loader does not support context ${config.scope}.`, SCOPE)
            return null
        }
        if (!study) {
            study = studyContextTemplate()
            if (config) {
                Object.assign(study, config)
            }
        }
        if (!study.name) {
            // Use file name as default.
            study.name = config.name || 'Study'
        }
        Log.debug(`Started loading a study from file ${file.name} (${config.name}).`, SCOPE)
        // Try to load the file, according to extension.
        const fName = config.name || file.name || ''
        if (this._fileLoader.matchName(fName)) {
            this._fileLoader.registerStudy(study)
            if (!(await this._fileLoader.loadFile(file, { name: fName }))) {
                Log.error(`Failed to load study ${study.name}.`, SCOPE)
                return null
            }
        }
        this._study = study
        return study
    }

    public async loadFromFsItem (fileTree: FileSystemItem, config: any = {}): Promise<StudyCollection[]> {
        if (!this._fileLoader) {
            Log.error(`Cannot load study from a filesystem item, file loader has not been set.`, SCOPE)
            return []
        }
        if (!this._canLoadResource(config)) {
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
                        reader.onloadend = (e: any) => {
                            const result = JSON.parse(e.target.result)
                            resolve(result)
                        }
                        reader.onerror = (e: any) => {
                            reject(e)
                        }
                        config = reader.readAsText(confFile.file as File)
                    }).then((json: any) => {
                        config = Object.assign(json, config)
                    }).catch(e => {
                        Log.error(`Could not load config from ${confFile.path}.`, SCOPE, e)
                    })
                    break
                }
            }
        }
        // Make sure there is a collections and studies property on config.
        if (!config.hasOwnProperty('collections')) {
            config.collections = {}
        }
        if (!config.hasOwnProperty('studies')) {
            config.studies = {}
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
                const study = this.loadFromDirectory(rootDir, config)
                if (study) {
                    // Only add successfully loaded studies.
                    studies.push(study)
                }
            }
            collections.push(
                Object.assign(
                    { studies: studies },
                    { title: rootDir.name },
                    config.collections[rootDir.name],
                    config.collections[rootDir.path]
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
            for (let visitDir of visitDirs) {
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
                        const study = await this.loadFromDirectory(curDir, config)
                        if (study) {
                            // Only add successfully loaded studies.
                            studies.push(study)
                        }
                    }
                }
                const collection = Object.assign(
                    { studies: studies },
                    { title: visitDir.name },
                    config.collections[visitDir.name],
                    config.collections[visitDir.path]
                )
                collections.push(collection)
            }
        } else {
            Log.warn("Dropped item had an empty root directory!", SCOPE)
        }
        // Order > date when sorting.
        collections.sort((a, b) => { return (parseInt(a.date) || 0) - (parseInt(b.date) || 0) })
        collections.sort((a, b) => { return (parseInt(a.order) || 0) - (parseInt(b.order) || 0) })
        return collections
    }

    public async loadFromUrl (fileUrl: string, config = {} as any, study?: StudyContext): Promise<StudyContext|null> {
        if (!this._fileLoader) {
            Log.error(`Cannot load study from a URL, file loader has not been set.`, SCOPE)
            return null
        }
        if (!this._canLoadResource(config)) {
            return null
        }
        if (config.context && !this._fileLoader.isSupportedScope(config.context)) {
            Log.error(`Current file loader does not support context ${config.context}.`, SCOPE)
            return null
        }
        if (!study) {
            study = studyContextTemplate()
            if (config) {
                Object.assign(study, config)
            }
        }
        if (!study.name) {
            // Use file name as default.
            study.name = config.name || 'Study'
        }
        Log.debug(`Started loading a study from URL ${fileUrl} (${config.name}).`, SCOPE)
        // Try to load the file, according to extension.
        const urlEnd = fileUrl.split('/').pop()
        const fName = config.name || urlEnd || ''
        if (this._fileLoader.matchName(fName)) {
            this._fileLoader.registerStudy(study)
            if (!(await this._fileLoader.loadUrl(fileUrl, { name: fName }))) {
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

    public async useStudy (study: StudyContext, config = {} as any): Promise<number> {
        for (const studyFile of study.files) {
            // Once more check that all files have an URL.
            if (!studyFile.url) {
                if (studyFile.file) {
                    studyFile.url = URL.createObjectURL(studyFile.file)
                } else {
                    continue
                }
            }
        }
        this._study = study
        this._fileLoader?.registerStudy(this._study)
        return this._resources.length
    }

    public registerFileLoader (loader: FileFormatLoader) {
        this._fileLoader = loader
        if (this._memoryManager) {
            loader.registerMemoryManager(this._memoryManager)
        }
    }
    public registerMemoryManager (manager: MemoryManager) {
        this._memoryManager = manager
        if (this._fileLoader) {
            this._fileLoader.registerMemoryManager(manager)
        }
    }
}
