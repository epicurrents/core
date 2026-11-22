/**
 * Deferred resource.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericResource from '#assets/GenericResource'
import type { DataResource } from '#types/application'
import type { ConfigStudyLoader } from '#types/config'
import type { DeferredStudy } from '#types/dataset'

/**
 * A dataset member standing in for a study that has not been loaded. It holds the instructions for loading the study
 * and the properties to list it with, and nothing else: no reader, no worker and no signal data. Opening it goes
 * through `openDeferredResource`, which loads the study and puts the loaded resource in its place, so a deferred
 * resource is never itself made active.
 *
 * Its state is `added` until the load starts and `loading` while it runs. `isReady` stays false throughout, so code
 * that waits for a resource to be usable never mistakes one for a loaded study; test for one with `isDeferredResource`.
 */
export default class DeferredResource extends GenericResource implements DataResource {
    protected _study: DeferredStudy

    /**
     * Create a deferred resource for the given study.
     * @param study - The study to list and the instructions for loading it.
     * @param modality - Modality to list the study under.
     */
    constructor (study: DeferredStudy, modality: string) {
        super(study.name, modality)
        this._study = study
    }

    /** Always true; what `isDeferredResource` tests. */
    get isDeferred () {
        return true as const
    }
    /** The study this resource lists. */
    get study () {
        return this._study
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    getMainProperties () {
        if (this.state === 'added' && this._study.properties?.length) {
            return new Map(this._study.properties)
        }
        return super.getMainProperties()
    }
    /**
     * A deferred resource holds no study to set up from and is never loaded on itself, so this resolves false and
     * leaves the state alone. Open it with the application's `openDeferredResource`, which loads the study and puts
     * the loaded resource in this one's place.
     */
    load (_options?: ConfigStudyLoader) {
        return Promise.resolve(false)
    }
}
