/**
 * Montage utilities.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { 
    type BiosignalChannel,
    type BiosignalSetup,
    type BiosignalType,
    type MontageChannel,
    type SetupChannel,
} from "TYPES/lib/biosignal"
import Log from 'scoped-ts-log'
import SETTINGS from "CONFIG/Settings"
import { NUMERIC_ERROR_VALUE } from "./constants"

const SCOPE = 'util:montage'

/**
 * Calculate and update signal offsets (from trace baseline) for given channels using the given layout configuration.
 * Will place each channel an equal distance from each other if configuration is omitted.
 * @param config - optional layout configuration in the form of
 *
 *               ```
 *               {
 *                  channelSpacing: number,
 *                  displayHidden: boolean, // optional
 *                  displayMissing: boolean, // optional
 *                  groupSpacing: number,
 *                  layout: number[],
 *                  yPadding: number,
 *               }
 *               ```
 *
 *               `channelSpacing` and `groupSpacing` values are used to calculate padding between individual channels 
 *                 and logical channel groups. The values of these two parameters are normalized, so only their
 *                 relative difference matters.\
 *               `yPadding` is the extra amount of padding (relative to channelSpacing) to add above the first channel 
 *                 and below the last channel.\
 *               `layout` is an array of logical channel group sizes. The number of channels in each element are 
 *                 considered a part of the same group.
 *
 * @example
 * calculateSignalOffsets({
 *      channelSpacing: 1,
 *      groupSpacing: 2,
 *      yPadding: 1,
 *      layout: [ 4, 4, 4, 4, 2]
 * })
 * // will produce five logical groups, the first four containing four channels and the last two channels,
 * // with each group separated by 2 times the amount of spacing of the individual channels inside each group.
 */
export const calculateSignalOffsets = (
     channels: BiosignalChannel[],
     config?: {
         channelSpacing: number,
         groupSpacing: number,
         isRaw: boolean,
         layout: number[],
         yPadding: number,
    }
) => {
    // Check if this is an 'as recorded' montage.
    if (!config || config?.isRaw) {
        // Remove channels that are not displayed.
        channels = channels.filter(chan => shouldDisplayChannel(chan, true))
        const layoutH = channels.length + 1
        const chanHeight = 1/channels.length
        let i = 0
        for (const chan of channels) {
            const baseline = 1.0 - ((i + 1)/layoutH)
            chan.offset = {
                baseline: baseline,
                bottom: baseline - 0.5*chanHeight,
                top: baseline + 0.5*chanHeight
            }
            i++
        }
        return
    }
    // Calculate channel offsets from the provided config.
    let nGroups = 0
    let nChannels = 0
    let nChanTotal = 0
    // Grab layout from default config if not provided.
    const configLayout = config.layout
    const layout = []
    for (const group of configLayout) {
        let nGroup = 0
        // Remove missing and hidden channels from the layout.
        for (let i=nChanTotal; i<nChanTotal+group; i++) {
            if (shouldDisplayChannel(channels[i], false)) {
                nGroup++
            }
        }
        nChannels += nGroup
        nChanTotal += group
        // Don't add empty groups.
        if (nGroup) {
            nGroups++
            layout.push(nGroup)
        }
    }
    // Check if the number of non-meta channels matches the constructed layout.
    const nSignalChannels = channels.filter((chan) => { return chan.type && chan.type !== 'meta' }).length
    if (nChannels !== nSignalChannels) {
        Log.warn("The number of channels does not match config layout!", SCOPE)
    }
    // Calculate total trace height, starting with top and bottom margins.
    let layoutH = 2*config.yPadding
    // Add channel heights.
    layoutH += (nChannels - (nGroups - 1) - 1)*config.channelSpacing
    // Add group heights.
    layoutH += (nGroups - 1)*config.groupSpacing
    // Go through the signals and add their respective offsets.
    // First trace is y-padding away from the top.
    let yPos = 1.0 - config.yPadding/layoutH
    let chanIdx = 0
    const chanHeight = config.channelSpacing/layoutH
    // Save into a variable if group spacing has been applied.
    // We cannot determine it by checking if this is the first channel in the group, because
    // the first channel may be missing or hidden for some other reason.
    let groupSpacing = true
    for (let i=0; i<configLayout.length; i++) {
        // Top and bottom margins are applied automatically, so skip first visible group spacing.
        if (i && !groupSpacing) {
            yPos -= (1/layoutH)*config.groupSpacing
            groupSpacing = true
        }
        for (let j=0; j<configLayout[i]; j++) {
            const chan = channels[chanIdx] as MontageChannel
            // Check that number of layout channels hasn't exceeded number of actual channels.
            if (chan === undefined) {
                Log.warn(
                    `Number of layout channels (${chanIdx + 1}) exceeds the number of channels in the EEG record ` + 
                    `(${channels.length})!`,
                SCOPE)
                continue
            }
            chanIdx++
            if (!shouldDisplayChannel(chan, false)) {
                continue
            }
            if (!groupSpacing) {
                yPos -= (1/layoutH)*config.channelSpacing
            } else {
                // Skip the first channel (group spacing has already been applied)
                groupSpacing = false
            }
            chan.offset = {
                baseline: yPos,
                bottom: yPos - 0.5*chanHeight,
                top: yPos + 0.5*chanHeight,
            }
            // Check if a meta channel has slipped into the visible layout
            if ((channels[chanIdx] as MontageChannel).type == 'meta') {
                Log.warn(`Metadata channel ${chan.label} has been included into visbile layout!`, SCOPE)
            }
        }
    }
}

/**
 * Filter an array of channels to contain only the included ones.
 * @param channels - List of channels to filter.
 * @param config - Configuration containing include and/or exclude directions as arrays of channel indices.
 * @returns Array containing the included channels.
 */
export const getIncludedChannels = <T extends Array<unknown>>(
    channels: T,
    config: { exclude?: number[], include?: number[] } = {}
): T => {
    // Filter channels, if needed.
    const included = [] as unknown as T
    // Prioritize include -> only process those channels.
    for (let i=0; i<channels.length; i++) {
        if (
            (!config.include && !config.exclude) ||
            // Prioritize includes.
            config.include?.includes(i) ||
            !config.exclude?.includes(i)
        ) {
            included.push(channels[i])
        }
    }
    return included
}

/**
 * Map the derived channels in this montage to the signal channels of the given setup.
 */
export const mapMontageChannels = (setup: BiosignalSetup, config?: any): MontageChannel[] => {
    /** Valid properties for the prototype channel. */
    type ChannelProperties = {
        active?: number
        amplification?: number
        avgRef?: boolean
        displayPolarity?: -1 | 0 | 1
        height?: number
        label?: string
        laterality?: string
        name?: string
        offset?: {
            baseline: number
            bottom: number
            top: number
        }
        reference?: number[]
        sampleCount?: number
        samplingRate?: number
        sensitivity?: number
        type?: string
        unit?: string,
        visible?: boolean
    }
    /**
     * Helper method for producing a prototype channel and injecting any available properties into it.
     */
    const getChannel = (props?: ChannelProperties): any => {
        // If visibility is set in config, use it. Otherwise hide if meta channel.
        const visible = props?.visible !== undefined ? props.visible
                        : props?.type === 'meta' ? false : true
        const newChan = {
            name: props?.name || '--',
            label: props?.label || '',
            type: (props?.type || '') as BiosignalType,
            laterality: props?.laterality || '',
            active: typeof props?.active === 'number' ? props.active : NUMERIC_ERROR_VALUE,
            reference: props?.reference || [],
            avgRef: props?.avgRef || false,
            samplingRate: props?.samplingRate || 0,
            sampleCount: props?.sampleCount || 0,
            amplification: props?.amplification || 1,
            sensitivity: props?.sensitivity || 0,
            displayPolarity: props?.displayPolarity || 0,
            offset: props?.offset || 0.5,
            visible: visible,
            unit: props?.unit || '?',
        } as ChannelProperties
        return newChan
    }
    // Check that we have a valid setup.
    if (!setup) {
        Log.error(`Cannot map channels for montage; missing an electrode setup.`, SCOPE)
        return []
    }
    const channels = []
    if (!config) {
        // Construct an 'as recorded' montage.
        for (const chan of setup.channels) {
            channels.push(
                getChannel({
                    label: chan.label,
                    name: chan.name,
                    type: chan.type,
                    laterality: chan.laterality,
                    active: chan.index,
                    samplingRate: chan.samplingRate,
                    amplification: chan.amplification,
                    displayPolarity: chan.displayPolarity,
                    unit: chan.unit,
                })
            )
        }
        calculateSignalOffsets(channels)
        return channels
    }
    const channelMap: { [name: string]: SetupChannel | null } = {}
    // First map names to correct channel indices.
    name_loop:
    for (const lbl of config.names) {
        for (const sChan of setup.channels) {
            if (lbl === sChan.name) {
                if (lbl.includes('__proto__')) {
                    Log.warn(`Channel label ${lbl} contains insecure field '_proto__', channel was ignored.`, SCOPE)
                    continue
                }
                channelMap[lbl] = sChan
                continue name_loop
            }
        }
        channelMap[lbl] = null // Not found.
    }
    // Next, map active and reference electrodes to correct signal channels.
    for (const chan of config.channels) {
        // Check that the active channel can be found.
        const actChan = channelMap[chan.active]
        if (actChan === null || actChan === undefined) {
            channels.push(
                getChannel({
                    label: chan.label,
                    name: chan.name,
                })
            )
            continue
        }
        const refs = [] as number[]
        if (chan.reference.length) {
            for (const ref of chan.reference) {
                // Store this in a separate const to avoid Typescript linter errors.
                const refChan = channelMap[ref]
                if (refChan !== null && refChan !== undefined &&
                    actChan.samplingRate === refChan.samplingRate
                ) {
                    refs.push(refChan.index)
                }
            }
            if (!refs.length) {
                // Not a single reference channel found.
                channels.push(
                    getChannel({
                        label: chan.label,
                        name: chan.name,
                    })
                )
            } else {
                // Construct the channel.
                channels.push(
                    getChannel({
                        label: chan.label,
                        name: chan.name,
                        type: chan.type || actChan.type,
                        laterality: chan.laterality || actChan.laterality,
                        active: actChan.index,
                        reference: refs,
                        avgRef: chan.averaged,
                        samplingRate: actChan.samplingRate,
                        amplification: actChan.amplification,
                        displayPolarity: chan.polarity || actChan.displayPolarity,
                        unit: chan.unit || actChan.unit,
                    })
                )
            }
        } else {
            // This is an as-recorded channel without a reference.
            channels.push(
                getChannel({
                    label: chan.label,
                    name: chan.name,
                    type: chan.type || actChan.type,
                    laterality: chan.laterality || actChan.laterality,
                    active: actChan.index,
                    samplingRate: actChan.samplingRate,
                    amplification: actChan.amplification,
                    displayPolarity: chan.polarity || actChan.displayPolarity,
                    unit: chan.unit || actChan.unit,
                })
            )
        }
    }
    // Calculate signal offsets for the loaded channels.
    calculateSignalOffsets(
        channels,
        {
            channelSpacing: config.channelSpacing || SETTINGS.eeg.channelSpacing,
            groupSpacing: config.groupSpacing || SETTINGS.eeg.groupSpacing,
            isRaw: false,
            layout: config.layout || [],
            yPadding: config.yPadding || SETTINGS.eeg.yPadding,
        }
    )
    return channels
}

/**
 * Check if the given channel should be displayed on the trace.
 */
export const shouldDisplayChannel = (channel: BiosignalChannel | null, useRaw: boolean) => {
    if (!channel || !channel.type || channel.type === 'meta') {
        return false
    } else if (useRaw) {
        return true
    } else if ((channel as MontageChannel).active === NUMERIC_ERROR_VALUE && !SETTINGS.eeg.showMissingChannels) {
        return false
    } else if (!(channel as MontageChannel).visible && !SETTINGS.eeg.showHiddenChannels) {
        return false
    }
    return true
}
