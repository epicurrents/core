/**
 * Study collection.
 * This concept is a work in prgoress.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { StudyContextCollection, StudyContext } from '#types/study'


export default class StudyCollection implements StudyContextCollection {
    protected _date: Date | null = null
    protected _name: string
    protected _studies: StudyContext[] = []

    constructor (name: string, studies?: StudyContext[]) {
        this._name = name
        if (studies) {
            this._studies = studies
        }
    }

    get date () {
        return this._date
    }
    set date (value: Date | null) {
        this._date = value
    }
    get name () {
        return this._name
    }
    set name (value: string) {
        this._name = value
    }
    get studies () {
        return this._studies
    }
    set studies (value: StudyContext[]) {
        this._studies = value
    }
}
