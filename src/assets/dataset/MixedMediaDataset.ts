/**
 * Mixed media dataset for all media/data types.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { ResourceState } from '#types/application'
import type { FileSystemConnector } from '#types/connector'
import type { MediaDataset } from '#types/dataset'
import type { StudyContext } from '#types/study'
import GenericDataset from '#assets/dataset/GenericDataset'
import GenericResource from '#assets/GenericResource'

export default class MixedMediaDataset extends GenericDataset implements MediaDataset {
    protected _errorReason = ''
    protected _source: StudyContext | null = null
    protected _state: ResourceState = 'added'
    /**
     * Create a new media dataset with the given properties.
     * @param name - Name of the dataset.
     */
    constructor (name: string, connectors?: { input?: FileSystemConnector, output?: FileSystemConnector }) {
        super(name, connectors)
    }
    get resources () {
        return this._resources as GenericResource[]
    }
    set resources (value: GenericResource[]) {
        this._setPropertyValue('resources', value)
    }
    get source () {
        return this._source
    }
    set source (value: StudyContext | null) {
        this._setPropertyValue('source', value)
    }

    addResource (resource: GenericResource) {
        super.addResource(resource)
    }

    destroy (): Promise<void> {
        this._source = null
        this._state = 'destroyed'
        return super.destroy()
    }

    getMainProperties(): Map<string, { [key: string]: string | number } | null> {
        return new Map<string, { [key: string]: string | number } | null>([
            [
                this._resources.length.toString(),
                {
                    icon: 'number',
                    n: this._resources.length,
                    title: '{n} resources'
                },
            ]
        ])
    }

    async prepare () {
        this.state = 'ready'
        return true
    }
}
