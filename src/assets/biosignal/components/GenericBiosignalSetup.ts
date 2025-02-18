/**
 * Generic biosignal setup.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BiosignalChannel,
    BiosignalChannelTemplate,
    BiosignalSetup,
    SetupChannel,
} from '#types/biosignal'
import type { ConfigBiosignalSetup } from '#types/config'
import { INDEX_NOT_ASSIGNED } from '#util'

export default class GenericBiosignalSetup implements BiosignalSetup {
    protected _label: string
    protected _name: string
    protected _channels: SetupChannel[] = []
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
                amplification: config?.amplification || 1,
                averaged: config?.averaged || false,
                displayPolarity: config?.polarity || 0,
                index: index,
                label: config?.label || '??',
                laterality: config?.laterality || '',
                modality: config?.modality || undefined,
                name: config?.name || '',
                samplingRate: config?.samplingRate || 0,
                unit: config?.unit || '?',
            } as SetupChannel
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
                                    amplification: chan.amplification,
                                    averaged: chan.averaged,
                                    polarity: chan.polarity,
                                    label: chan.label,
                                    laterality: chan.laterality,
                                    modality: chan.modality,
                                    name: chan.name,
                                    samplingRate: recordSignals[i].samplingRate,
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
                                    amplification: chan.amplification,
                                    averaged: chan.averaged,
                                    polarity: chan.polarity,
                                    label: chan.label,
                                    laterality: chan.laterality,
                                    modality: chan.modality,
                                    name: chan.name,
                                    samplingRate: recordSignals[i].samplingRate,
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
                        amplification: chan.amplification,
                        averaged: chan.averaged,
                        label: chan.label,
                        laterality: chan.laterality,
                        modality: chan.modality,
                        name: chan.name,
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
    }
}
