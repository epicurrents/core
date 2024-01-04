/**
 * Generic biosignal setup.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type SetupChannel, type BiosignalSetup, BiosignalChannelTemplate, BiosignalChannel } from '#types/biosignal'
import { type ConfigBiosignalSetup } from '#types/config'

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
        // Helper method for producing a prototype channel
        const getChannel = (index: number, config?: Partial<BiosignalChannelTemplate>) => {
            return {
                amplification: config?.amplification || 1,
                averaged: config?.averaged || false,
                displayPolarity: config?.polarity || 0,
                index: index,
                label: config?.label || '--',
                laterality: config?.laterality || '',
                name: config?.name || '',
                samplingRate: config?.samplingRate || 0,
                type: config?.type || undefined,
                unit: config?.unit || '--',
            } as SetupChannel
        }
        // Use config name if present
        this._name = config.label || this._name
        // Try to match config channels to record signals
        if (config.channels) {
            config_loop:
            for (const chan of config.channels) {
                // First try matching exact names
                if (chan.name) {
                    for (let i=0; i<recordSignals.length; i++) {
                        if (chan.name === recordSignals[i].name) {
                            this._channels.push(
                                getChannel(i, {
                                    amplification: chan.amplification,
                                    averaged: chan.averaged,
                                    polarity: chan.polarity,
                                    label: chan.label,
                                    laterality: chan.laterality,
                                    name: chan.name,
                                    samplingRate: recordSignals[i].samplingRate,
                                    type: chan.type,
                                    unit: chan.unit,
                                })
                            )
                            continue config_loop
                        }
                    }
                }
                // No match, try pattern
                if (chan.pattern) {
                    for (let i=0; i<recordSignals.length; i++) {
                        if (recordSignals[i].name.match(new RegExp(chan.pattern, 'i')) !== null) {
                            this._channels.push(
                                getChannel(i, {
                                    amplification: chan.amplification,
                                    averaged: chan.averaged,
                                    polarity: chan.polarity,
                                    label: chan.label,
                                    laterality: chan.laterality || '',
                                    name: chan.name,
                                    samplingRate: recordSignals[i].samplingRate,
                                    type: chan.type,
                                    unit: chan.unit,
                                })
                            )
                            continue config_loop
                        }
                    }
                }
                // Channel is missing from recording
                this._missing.push(
                    getChannel(-1, {
                        amplification: 1,
                        averaged: chan.averaged,
                        label: chan.label,
                        laterality: chan.laterality || '',
                        name: chan.name,
                        type: chan.type,
                        unit: chan.unit,
                    })
                )
            }
            // Lastly, check if there are any extra channels not present in the config
            record_loop:
            for (let i=0; i<recordSignals.length; i++) {
                for (const chan of this._channels) {
                    if (chan.index === i) {
                        continue record_loop
                    }
                }
                // Channel is missing from config
                this._unmatched.push(
                    getChannel(-1, {
                        label: recordSignals[i].label,
                        name: recordSignals[i].name,
                    })
                )
            }
        }
    }
}
