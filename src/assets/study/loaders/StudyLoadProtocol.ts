/**
 * Study load protocol.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type FileSystemItem } from '#root/src/types/reader'
import { type StudyContext, type OrderedLoadingProtocol } from '#types/study'
import GenericStudyLoader from './GenericStudyLoader'
import { Log } from 'scoped-ts-log'
import StudyCollection from '../StudyCollection'

const SCOPE = "StudyLoadProtocol"

/**
 * Protocol that tries to match an ordered list of loaders against the given
 * collection of studies. First matching loader will be used to load each study.
 * @remarks
 * This concept is not finished and not in use yet.
 */
export default class StudyLoadProtocol implements OrderedLoadingProtocol {
    /** Array of study loaders to check the item against. First matching loader will be used. */
    protected _loaders: GenericStudyLoader[] = []

    constructor (...loaders: GenericStudyLoader[]) {
        if (loaders) {
            this._loaders = loaders
        }
    }

    addLoader(loader: GenericStudyLoader, position?: number) {
        if (position === undefined || position === this._loaders.length) {
            this._loaders.push(loader)
        } else if (position >= 0 && position < this._loaders.length) {
            this._loaders.splice(position, 0, loader)
        } else {
            Log.error(`Cannot add loader to position ${position} (out of bounds for array of ${this._loaders.length} items).`, SCOPE)
        }
    }

    async loadStudies (item: FileSystemItem, singleStudy = false) {
        console.log(1, item, singleStudy)
        const collection = new StudyCollection(item.name)
        if (singleStudy) {
            if (item.type === 'directory') {
                console.log('directory')
                let study = null as StudyContext | null
                for (const subItem of item.files) {
                    if (!subItem.url) {
                        continue
                    }
                    for (const loader of this._loaders) {
                        if (study) {
                            if (await loader.loadFromUrl(subItem.url, undefined, study)) {
                                break
                            }
                        } else {
                            study = await loader.loadFromUrl(subItem.url)
                            if (study) {
                                break
                            }
                        }
                    }
                }
                if (study) {
                    collection.studies.push(study)
                }
            } else if (item.url) {
                console.log('file')
                console.log(2, this._loaders)
                for (const loader of this._loaders) {
                    console.log(3, loader)
                    const study = await loader.loadFromUrl(item.url)
                    console.log(4, study)
                    if (study) {
                        collection.studies.push(study)
                        break
                    }
                }
            }
        } else {
            for (const loader of this._loaders) {
                // Check if we should load a directory or file
                if (item.type === 'directory') {
                    const study = await loader.loadFromDirectory(item)
                    if (study) {
                        collection.studies.push(study)
                    }
                } else if (item.url) {
                    console.log(3, loader)
                    const study = await loader.loadFromUrl(item.url)
                    if (study) {
                        collection.studies.push(study)
                        break
                    }
                }
            }
        }
        console.log(9, collection)
        return collection
    }

    removeLoader(loader: number | GenericStudyLoader): void {
        if (typeof loader === 'number') {
            if (loader >= 0 && loader < this._loaders.length) {
                this._loaders.splice(loader, 1)
            } else {
                Log.error(`Cannot remove loader at position ${loader} (out of bounds for array of ${this._loaders.length} items).`, SCOPE)
            }
        } else {
            for (let i=0; i<this._loaders.length; i++) {
                if (this._loaders[i] === loader) {
                    this._loaders.splice(i, 1)
                    return
                }
            }
            Log.warn(`Could not remove given loader (loader was not found).`, SCOPE)
        }
    }
}
