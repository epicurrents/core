/**
 * Base class for biosignal source channels.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BiosignalChannel, SourceChannel } from '#types'
import GenericBiosignalChannel from './GenericBiosignalChannel'

export default abstract class GenericSourceChannel extends GenericBiosignalChannel implements SourceChannel {

    protected _index: number
    protected _averaged: boolean

    constructor (
            name: string,
            label: string,
            type: string,
            index: number,
            averaged: boolean,
            samplingRate: number,
            unit: string,
            visible: boolean,
            extraProperties = {} as Partial<BiosignalChannel>
    ) {
        super(name, label, type, samplingRate, unit, visible, extraProperties)
        this._index = index
        this._averaged = averaged
    }

    get index () {
        return this._index
    }
    set index (value: number) {
        this._setPropertyValue('index', value)
    }
    
    get averaged () {
        return this._averaged
    }
    set averaged (value: boolean) {
        this._setPropertyValue('averaged', value)
    }
}