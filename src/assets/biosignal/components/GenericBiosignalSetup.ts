/**
 * Generic biosignal setup.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    type BiosignalChannel,
    type BiosignalChannelTemplate,
    type BiosignalSetup,
    type SetupChannel,
} from '#types/biosignal'
import { type ConfigBiosignalSetup } from '#types/config'
import { INDEX_NOT_ASSIGNED } from '#util'

export default class GenericBiosignalSetup implements BiosignalSetup {
    protected _id: string
    protected _name: string
    protected _channels: SetupChannel[] = []
    protected _missing: SetupChannel[] = []
    protected _unmatched: SetupChannel[] = []

    constructor (id: string, channels?: BiosignalChannel[], config?: ConfigBiosignalSetup) {
        this._id = id
        this._name = id
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
    get id () {
        return this._id
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
    set name (name: string) {
        this._name = name
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
                name: config?.name || '',
                samplingRate: config?.samplingRate || 0,
                type: config?.type || undefined,
                unit: config?.unit || '?',
            } as SetupChannel
        }
        const unmatchedSignals = [...recordSignals]
        // Use config name if present.
        this._name = config.label || this._name
        // Try to match config channels to record signals.
        if (config.channels) {
            config_loop:
            for (const chan of config.channels) {
                // First try matching exact names.
                if (chan.name) {
                    for (let i=0; i<unmatchedSignals.length; i++) {
                        if (chan.name === unmatchedSignals[i].name) {
                            this._channels.push(
                                getChannel(i, {
                                    amplification: chan.amplification,
                                    averaged: chan.averaged,
                                    polarity: chan.polarity,
                                    label: chan.label,
                                    laterality: chan.laterality,
                                    name: chan.name,
                                    samplingRate: unmatchedSignals[i].samplingRate,
                                    type: chan.type,
                                    unit: chan.unit,
                                })
                            )
                            unmatchedSignals.splice(i, 1)
                            continue config_loop
                        }
                    }
                }
                // No match, try pattern.
                if (chan.pattern) {
                    for (let i=0; i<unmatchedSignals.length; i++) {
                        if (unmatchedSignals[i].name.match(new RegExp(chan.pattern, 'i')) !== null) {
                            this._channels.push(
                                getChannel(i, {
                                    amplification: chan.amplification,
                                    averaged: chan.averaged,
                                    polarity: chan.polarity,
                                    label: chan.label,
                                    laterality: chan.laterality,
                                    name: chan.name,
                                    samplingRate: unmatchedSignals[i].samplingRate,
                                    type: chan.type,
                                    unit: chan.unit,
                                })
                            )
                            unmatchedSignals.splice(i, 1)
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
                        name: chan.name,
                        type: chan.type,
                        unit: chan.unit,
                    })
                )
            }
            // Source channels missing from config.
            for (const sig of unmatchedSignals) {
                this._unmatched.push(
                    getChannel(INDEX_NOT_ASSIGNED, {
                        label: sig.label,
                        name: sig.name,
                    })
                )
            }
        }
    }
}
