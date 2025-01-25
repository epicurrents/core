/**
 * Base class for biosignal montage channels.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BiosignalChannel, MontageChannel } from '#types'
import GenericBiosignalChannel from './GenericBiosignalChannel'

export default abstract class GenericMontageChannel extends GenericBiosignalChannel implements MontageChannel {

    protected _active: number
    protected _reference: number[]

    constructor (
            name: string,
            label: string,
            type: string,
            active: number,
            reference: number[],
            averaged: boolean,
            samplingRate: number,
            unit: string,
            visible: boolean,
            extraProperties = {} as Partial<BiosignalChannel>
    ) {
        super(name, label, type, averaged, samplingRate, unit, visible, extraProperties)
        this._active = active
        this._reference = reference
    }

    get active () {
        return this._active
    }
    set active (value: number) {
        this._setPropertyValue('active', value)
    }

    get reference () {
        return this._reference
    }
    set reference (value: number[]) {
        this._setPropertyValue('reference', value)
    }
}