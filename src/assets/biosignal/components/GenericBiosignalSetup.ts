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
        // Suffix used for pre-correction original channels (e.g. Fp1_orig).
        // Only defined when the config explicitly provides it — if absent, auto-include
        // is skipped entirely so no assumptions are made about channel naming.
        // These channels are reserved for auto-include and must not be claimed by the
        // main config-loop pattern scan.
        const origSfx = config.correctedChannelSuffix?.toLowerCase()
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
                        if (chan.name.toLowerCase() === recordSignals[i].name.toLowerCase()) {
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
                        // Skip _orig channels here — they are reserved for auto-include
                        // after this loop.  Claiming them now would prevent auto-include
                        // from pairing them with their primary channel and could steal a
                        // setup slot meant for a different (non-_orig) channel.
                        if (origSfx && recordSignals[i].name.toLowerCase().endsWith(origSfx)) {
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
            // Auto-include original (pre-correction) counterparts for any matched channel that has one.
            // Only runs when the config explicitly provides a correctedChannelSuffix — if absent,
            // no auto-include is attempted so no assumptions are made about channel naming.
            // Snapshot to avoid iterating over entries we're about to add.
            const sfx = config.correctedChannelSuffix
            const primaryChannels = this._channels.slice()
            for (const primary of primaryChannels) {
                if (!sfx || !primary.name || primary.name.endsWith(sfx)) {
                    continue
                }
                // Use the actual matched source signal name (not the setup config name) to find the
                // _orig counterpart — they share the same casing as the file (e.g. "Fp1" → "Fp1_orig"),
                // while the config name may use a different case convention (e.g. "fp1").
                const sourceName = recordSignals[primary.index]?.name
                if (!sourceName) {
                    continue
                }
                for (let i=0; i<recordSignals.length; i++) {
                    if (matchedSigs.includes(i)) {
                        continue
                    }
                    if (recordSignals[i].name.toLowerCase() === (sourceName + sfx).toLowerCase()) {
                        // Store the channel with the setup's naming convention (primary.name + sfx)
                        // so that mapMontageChannels can locate it via a predictable name lookup.
                        this._channels.push(
                            getChannel(i, {
                                label: recordSignals[i].label,
                                laterality: recordSignals[i].laterality,
                                modality: recordSignals[i].modality,
                                name: primary.name + sfx,
                                polarity: recordSignals[i].displayPolarity,
                                samplingRate: recordSignals[i].samplingRate,
                                unit: recordSignals[i].unit,
                            })
                        )
                        matchedSigs.push(i)
                        break
                    }
                }
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
