/**
 * Base class for biosignal montage channels.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BiosignalChannelProperties,
    BiosignalMontage,
    DerivedChannelProperties,
    MontageChannel,
} from '#types'
import { Log } from 'scoped-event-log'
import GenericBiosignalChannel from './GenericBiosignalChannel'

const SCOPE = 'GenericMontageChannel'

/**
 * Base class for biosignal montage channels.
 */
export default abstract class GenericMontageChannel extends GenericBiosignalChannel implements MontageChannel {

    protected _active: number | DerivedChannelProperties
    protected _chanPairName = ''
    protected _contralateralChannel: MontageChannel | null = null
    protected _montage: BiosignalMontage
    protected _reference: DerivedChannelProperties

    constructor (
        montage: BiosignalMontage,
        name: string,
        label: string,
        type: string,
        active: number | DerivedChannelProperties,
        reference: DerivedChannelProperties,
        averaged: boolean,
        samplingRate: number,
        unit: string,
        visible: boolean,
        extraProperties = {} as Partial<BiosignalChannelProperties>
    ) {
        super(name, label, type, averaged, samplingRate, unit, visible, extraProperties)
        this._active = active
        this._montage = montage
        this._reference = reference
        if (extraProperties.contralateralChannel) {
            // Save the channel name for later matching.
            this._chanPairName = extraProperties.contralateralChannel
        }
    }

    get active () {
        return this._active
    }
    set active (value: number | DerivedChannelProperties) {
        this._setPropertyValue('active', value)
    }

    get contralateralChannel () {
        if (this.modality !== 'eeg') {
            return null
        } else if (this._contralateralChannel) {
            return this._contralateralChannel
        }
        // Midline channels don't have a contralateral pair.
        if (this._laterality === 'z') {
            return null
        }
        // Constructing and adding montage channels is a dynamic process and we shouldn't check for the existence of
        // a channel pair until it is requested for the first time.
        let exactName = this._chanPairName
        let fuzzyName = ''
        if (!exactName) {
            // If no contralateral channel name was given, we try to deduce it from the channel name.
            // This works only for standard EEG channel names in a common reference montage.
            if (!this._montage.hasCommonReference) {
                Log.warn(
                    `Cannot deduce contralateral channel name for '${this.name}' without a common reference montage.`,
                    SCOPE
                )
                return null
            }
            const nameProps = this.name.match(/([a-zA-Z]+)(\d+)(.+)?/)
            if (!nameProps) {
                Log.warn(
                    `Cannot deduce contralateral channel name for non-standard channel name '${this.name}'.`,
                    SCOPE
                )
                return null
            }
            // Check if this is a left or right hemisphere channel.
            const laterality = this._laterality ? this._laterality
                            : parseInt(nameProps[2])%2 ? 's' : 'd'
            // Depending on the side,  we either add or subtract one from the number in the name.
            const contraNum = laterality === 's' ? parseInt(nameProps[2]) + 1 : parseInt(nameProps[2]) - 1
            fuzzyName = `${nameProps[1] + contraNum}`
            exactName = fuzzyName + `${nameProps[3] ?? ''}`
        }
        // At least the starting part of the names should match. First try an exact match.
        const contra = this._montage.channels.find((chan) => {
            return chan.name.toLowerCase() === exactName.toLowerCase()
        })
        if (contra) {
            // Cache the found channel for future reference.
            this._contralateralChannel = contra as MontageChannel
            Log.debug(`Found exact channel pair match for '${this.name}': '${this._contralateralChannel.name}'.`, SCOPE)
            return this._contralateralChannel
        }
        // If an exact match was not found, try a more fuzzy match.
        const contraFuzzy = this._montage.channels.find((chan) => {
            return chan.name.toLowerCase().startsWith(fuzzyName.toLowerCase())
        })
        if (contraFuzzy) {
            this._contralateralChannel = contraFuzzy as MontageChannel
            Log.debug(`Found fuzzy channel pair match for '${this.name}': '${this._contralateralChannel.name}'.`, SCOPE)
            return this._contralateralChannel
        }
        // No contralateral channel found.
        return null
    }

    get reference () {
        return this._reference
    }
    set reference (value: DerivedChannelProperties) {
        this._setPropertyValue('reference', value)
    }
}
