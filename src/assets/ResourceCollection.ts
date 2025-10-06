/**
 * Resource collection.
 * This is a resource that acts as a collection for other resources.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericResource from '#assets/GenericResource'
import type { DataResource, DataResourceCollection } from '#types/application'
import type { StudyContext } from '#types/study'
import { Log } from 'scoped-event-log'

const SCOPE = 'ResourceCollection'

export default abstract class ResourceCollection extends GenericResource implements DataResourceCollection {
    /**
     * Core events emitted by this resource (not including property change events).
     */
    static readonly EVENTS = { ...GenericResource.EVENTS }

    protected _date: Date | null
    protected _defaultResource = 0
    protected _resources: DataResource[] = []

    constructor (name: string, source?: StudyContext, date?: Date) {
        super(name, 'collection', source)
        this._date = date || null
    }

    get date () {
        return this._date
    }
    set date (value: Date | null) {
        this._setPropertyValue('date', value)
    }
    get defaultResource () {
        return this._defaultResource
    }
    set defaultResource (value: number) {
        if (value < 0 || value >= this._resources.length) {
            Log.error(SCOPE, `Default resource index is out of bounds: ${value}.`)
            return
        }
        this._setPropertyValue('defaultResource', value)
    }
    get resources () {
        return this._resources
    }
    set resources (value: DataResource[]) {
        this._setPropertyValue('resources', value)
    }

    addResource (resource: DataResource, setAsDefault = false) {
        this.resources = [...this._resources, resource]
        if (setAsDefault) {
            this.defaultResource = this._resources.length - 1
        }
    }
    getMainProperties () {
        const props = super.getMainProperties()
        props.set('{n} resources', { n: this._resources.length })
        if (this._date) {
            props.set('date', this._date)
        }
        return props
    }
    getResource (resource: number | string) {
        return typeof resource === 'number'
               ? this._resources[resource] || null
               : this._resources.find(r => r.name === resource) || null
    }
    async prepare () {
        // Override this in a child class.
        this.state = 'ready'
        return true
    }

    removeResource (resource: DataResource | number | string) {
        let idx = -1
        if (typeof resource === 'number') {
            idx = resource
        } else if (typeof resource === 'string') {
            idx = this._resources.findIndex(r => r.name === resource)
        } else {
            idx = this._resources.indexOf(resource)
        }
        if (idx !== -1) {
            if (idx === this._defaultResource) {
                this.defaultResource = 0
            }
            const newArray = [...this._resources]
            const removed = newArray.splice(idx, 1)
            this.resources = newArray
            if (removed.length > 0) {
                removed[0].destroy()
                Log.debug(`Resource removed: ${removed[0].name}`, SCOPE)
            }
        } else {
            const resourceName = typeof resource === 'string' || typeof resource === 'number'
                               ? resource : resource.name
            Log.warn(`Resource to remove was not found: ${resourceName}`, SCOPE)
        }
    }
    async unload () {
        for (const resource of this._resources) {
            await resource.unload()
        }
    }
}
