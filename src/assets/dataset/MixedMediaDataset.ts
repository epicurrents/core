/**
 * Mixed media dataset for all media/data types.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type ResourceState } from '#types/application'
import { type MediaDataset } from '#types/dataset'
import { type StudyContext } from '#types/study'
import GenericDataset from '#assets/dataset/GenericDataset'
import GenericResource from '#assets/GenericResource'

export default class MixedMediaDataset extends GenericDataset implements MediaDataset {
    protected _scope = ''
    protected _source: StudyContext | null = null
    protected _state: ResourceState = 'added'
    /**
     * Create a new media dataset with the given properties.
     * @param name - Name of the dataset.
     */
    constructor (name: string) {
        super(name)
    }

    get isReady () {
        return this._state === 'ready'
    }
    get resources () {
        return this._resources as GenericResource[]
    }
    set resources (value: GenericResource[]) {
        this._resources = value
        this.onPropertyUpdate('resources')
    }
    get scope () {
        return this._scope
    }
    set scope (value: string) {
        if (this._scope !== value) {
            const oldVal = this._scope
            this._scope = value
            this.onPropertyUpdate('scope', value, oldVal)
        }
    }
    get source () {
        return this._source
    }
    set source (value: StudyContext | null) {
        this._source = value
        this.onPropertyUpdate('source')
    }
    get state () {
        return this._state
    }
    set state (value: ResourceState) {
        const prevState = this._state
        this._state = value
        this.onPropertyUpdate('state', value, prevState)
    }

    addResource (resource: GenericResource) {
        super.addResource(resource)
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
