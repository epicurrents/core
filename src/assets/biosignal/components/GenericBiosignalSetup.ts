/**
 * Generic biosignal setup.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BiosignalChannel,
    BiosignalChannelDerivationTemplate,
    BiosignalChannelTemplate,
    BiosignalReferenceChannelTemplate,
    BiosignalSetup,
    DerivedChannelProperties,
    SetupChannel,
    SetupDerivation,
} from '#types/biosignal'
import type { ConfigBiosignalSetup } from '#types/config'
import { INDEX_NOT_ASSIGNED } from '#util'

export default class GenericBiosignalSetup implements BiosignalSetup {
    protected _label: string
    protected _name: string
    protected _channels: SetupChannel[] = []
    protected _derivations: SetupDerivation[] = []
    protected _missing: SetupChannel[] = []
    protected _unmatched: SetupChannel[] = []

    constructor (name: string, channels?: BiosignalChannel[], config?: ConfigBiosignalSetup) {
        this._name = name
        this._label = config?.label || name
        if (channels && config) {
            this.loadConfig(channels, config)
        }
    }
    // Getters and setters
    get channels () {
        return this._channels
    }
    set channels (channels: SetupChannel[]) {
        this._channels = channels
    }
    get derivations () {
        return this._derivations
    }
    set derivations (channels: SetupDerivation[]) {
        this._derivations = channels
    }
    get label () {
        return this._label
    }
    set label (label: string) {
        this._label = label
    }
    get missingChannels () {
        return this._missing
    }
    set missingChannels (channels: SetupChannel[]) {
        this._missing = channels
    }
    get name () {
        return this._name
    }
    get unmatchedSignals () {
        return this._unmatched
    }
    set unmatchedSignals (signals: SetupChannel[]) {
        this._unmatched = signals
    }

    ///////////////////////////////////////////////////
    //                   METHODS                     //
    ///////////////////////////////////////////////////

    loadConfig (recordSignals: BiosignalChannel[], config: ConfigBiosignalSetup) {
        // Helper method for producing a prototype channel.
        const getChannel = (index: number, config?: Partial<BiosignalChannelTemplate>) => {
            return {
                averaged: config?.averaged || false,
                displayPolarity: config?.polarity || 0,
                index: index,
                label: config?.label || '??',
                laterality: config?.laterality || '',
                modality: config?.modality || undefined,
                name: config?.name || '',
                samplingRate: config?.samplingRate || 0,
                scale: config?.scale || 0,
                unit: config?.unit || '?',
            } as SetupChannel
        }
        // Helper method for producing a prototype derivation.
        const getDerivation = (
            active: number | DerivedChannelProperties,
            reference: DerivedChannelProperties,
            config?: Partial<BiosignalChannelDerivationTemplate>
        ) => {
            return {
                active,
                reference,
                averaged: config?.averaged || false,
                displayPolarity: config?.polarity || 0,
                label: config?.label || '??',
                laterality: config?.laterality || '',
                modality: config?.modality || undefined,
                name: config?.name || '',
                samplingRate: config?.samplingRate || 0,
                scale: config?.scale || 0,
                unit: config?.unit || '?',
            } as SetupDerivation
        }
        // Helper method to get a channel index or properties.
        const getProps = (tpl: BiosignalReferenceChannelTemplate) => {
            let props = INDEX_NOT_ASSIGNED as DerivedChannelProperties[number]
            if (!config.derivations) {
                return props
            }
            // Match against the setup channels.
            if (tpl.name) {
                for (const i of matchedSigs) {
                    if (tpl.name === this._channels[i].name) {
                        return tpl.weight ? [i, tpl.weight] : i
                    }
                }
                // Failing that, try matching against the config channels.
                for (const i of matchedSigs) {
                    if (tpl.name === recordSignals[i].name) {
                        return tpl.weight ? [i, tpl.weight] : i
                    }
                }
            }
            // Finally, try to match by pattern against the source signals.
            if (tpl.pattern) {
                for (const i of matchedSigs) {
                    if (recordSignals[i].name.match(new RegExp(tpl.pattern, 'i')) !== null) {
                        return tpl.weight ? [i, tpl.weight] : i
                    }
                }
            }
            return props
        }
        // Use config label if present.
        if (config.label) {
            this._label = config.label
        }
        // Don't rematch already matched signals.
        const matchedSigs = [] as number[]
        // Try to match config channels to record signals.
        if (config.channels) {
            config_loop:
            for (const chan of config.channels) {
                // First try matching exact names.
                if (chan.name) {
                    for (let i=0; i<recordSignals.length; i++) {
                        if (matchedSigs.includes(i)) {
                            continue
                        }
                        if (chan.name === recordSignals[i].name) {
                            this._channels.push(
                                getChannel(i, {
                                    averaged: chan.averaged,
                                    polarity: chan.polarity,
                                    label: chan.label,
                                    laterality: chan.laterality,
                                    modality: chan.modality,
                                    name: chan.name,
                                    samplingRate: recordSignals[i].samplingRate,
                                    scale: chan.scale,
                                    unit: chan.unit,
                                })
                            )
                            matchedSigs.push(i)
                            continue config_loop
                        }
                    }
                }
                // No match, try pattern.
                if (chan.pattern) {
                    for (let i=0; i<recordSignals.length; i++) {
                        if (matchedSigs.includes(i)) {
                            continue
                        }
                        if (recordSignals[i].name.match(new RegExp(chan.pattern, 'i')) !== null) {
                            this._channels.push(
                                getChannel(i, {
                                    averaged: chan.averaged,
                                    polarity: chan.polarity,
                                    label: chan.label,
                                    laterality: chan.laterality,
                                    modality: chan.modality,
                                    name: chan.name,
                                    samplingRate: recordSignals[i].samplingRate,
                                    scale: chan.scale,
                                    unit: chan.unit,
                                })
                            )
                            matchedSigs.push(i)
                            continue config_loop
                        }
                    }
                }
                // Channel is missing from recording.
                this._missing.push(
                    getChannel(INDEX_NOT_ASSIGNED, {
                        averaged: chan.averaged,
                        label: chan.label,
                        laterality: chan.laterality,
                        modality: chan.modality,
                        name: chan.name,
                        scale: chan.scale,
                        unit: chan.unit,
                    })
                )
            }
            // Source channels missing from config.
            for (let i=0; i<recordSignals.length; i++) {
                if (matchedSigs.includes(i)) {
                    continue
                }
                this._unmatched.push(
                    getChannel(INDEX_NOT_ASSIGNED, {
                        label: recordSignals[i].label,
                        name: recordSignals[i].name,
                    })
                )
            }
        }
        if (config.derivations && config.derivations.length > 0) {
            for (const chan of config.derivations) {
                this._derivations.push(
                    getDerivation(
                        Array.isArray(chan.active)
                            ? chan.active.map((a) => getProps(a))
                            : getProps(chan.active),
                        chan.reference.map((r) => getProps(r)),
                        {
                            averaged: chan.averaged,
                            polarity: chan.polarity,
                            label: chan.label,
                            laterality: chan.laterality,
                            modality: chan.modality,
                            name: chan.name,
                            samplingRate: chan.samplingRate,
                            scale: chan.scale,
                            unit: chan.unit,
                        }
                    )
                )
            }
            // Source channels missing from config.
            for (let i=0; i<recordSignals.length; i++) {
                if (matchedSigs.includes(i)) {
                    continue
                }
                this._unmatched.push(
                    getChannel(INDEX_NOT_ASSIGNED, {
                        label: recordSignals[i].label,
                        name: recordSignals[i].name,
                    })
                )
            }
        }
    }
}
