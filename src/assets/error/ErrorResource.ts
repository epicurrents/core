/**
 * Error resource.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type DataResource } from '#types/application'
import { type StudyContext } from '#types/study'
import GenericResource from '#assets/GenericResource'

//const SCOPE = 'ErrorResource'

/**
 * Generic error resource that can be uden instead of an actual resource if it failed to load during study preparation
 * (i.e. before a proper resource entity could be created). The `reason` property can be used to store and retrieve
 * detailed information about the error that occurred.
 */
export default class ErrorResource extends GenericResource implements DataResource {
    protected _reason: string = 'Unknown error'

    constructor (name: string, scope: string, type: string, source?: StudyContext) {
        super(name, scope, type, source)
        this.state = 'error'
    }

    get reason () {
        return this._reason
    }
    set reason (value: string) {
        this._setPropertyValue('reason', value)
        this.onPropertyUpdate('reason') // TODO: Deprecated.
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    getMainProperties () {
        const props = super.getMainProperties()
        props.set(
            'error',
            {
                title: this._reason
            }
        )
        return props
    }

    removeResource () {
        if (window.__EPICURRENTS__?.RUNTIME) {
            window.__EPICURRENTS__?.RUNTIME.removeResource(this)
        }
    }
}
