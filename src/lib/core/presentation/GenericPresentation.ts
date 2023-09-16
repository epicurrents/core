/**
 * Generic presentation.
 * This class serves only as as superclass for more spesific presentation classes.
 * This concept is under consideration and will likely be removed.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { MultimediaPresentation } from "TYPES/lib/core"
import GenericAsset from "LIB/core/GenericAsset"

const SCOPE = 'GenericPresentation'

export default abstract class GenericPresentation extends GenericAsset implements MultimediaPresentation {
    protected _presenters: string[]

    constructor (name: string, presenters: string[]) {
        super(name, GenericAsset.SCOPES.PRESENTATION, '')
        this._presenters = presenters
    }

    get presenters () {
        return this._presenters
    }

    public addPresenter = (presenter: string, index = -1) => {
        // Don't add the same presenter twice.
        for (const existingPres of this._presenters) {
            if (existingPres === presenter) {
                return
            }
        }
        if (index >= 0 && index < this._presenters.length -1) {
            this._presenters.splice(index, 0, presenter)
        } else {
            this._presenters.push(presenter)
        }
    }
}
