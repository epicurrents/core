/**
 * Export selection: the format-agnostic reduction of a biosignal recording to a time range, an ordered set of
 * channels under output labels, one output rate and an amplitude range. An exporter applies it before encoding, so
 * every exporter offers the same operations and none of them knows why a selection was made.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    AnnotationEventTemplate,
    BiosignalExportConstraints,
    BiosignalExportSelection,
} from '#types/biosignal'
import { downsampleSignal } from './dsp'

/**
 * A channel of the recording as the selection reads it. The list passed to the functions below is the recording's
 * full channel list, so a channel's position in it is the index a selection and an event refer to it by. A channel
 * of `meta` modality, or without a positive sampling rate, carries no signal and cannot be exported.
 */
export type ExportSourceChannel = {
    /** The channel's label. */
    label: string
    /** The channel's modality; `meta` marks a channel that carries no numeric signal, such as an annotation channel. */
    modality?: string
    /** Identifying name of the channel, which an event's string channel references match. The label when omitted. */
    name?: string
    /** Number of samples the channel holds over the whole recording. */
    sampleCount: number
    /** Sampling rate in Hz. */
    samplingRate: number
    /** Physical unit of the channel's samples. */
    unit?: string
}
/**
 * A source channel together with its signal data, for {@link applyExportSelection}.
 */
export type ExportSourceSignalChannel = ExportSourceChannel & {
    /**
     * The channel's samples, starting at the data time given by `dataOffset` in the transform's input. May be absent
     * for a channel the selection does not export.
     */
    signal?: Float32Array
}
/**
 * Everything {@link applyExportSelection} transforms.
 */
export type ExportSourceData = {
    /** The recording's full channel list, in source order. */
    channels: ExportSourceSignalChannel[]
    /** Data time, in seconds, of the first sample of every channel's `signal`. Defaults to 0. */
    dataOffset?: number
    /** The recording's events. Their `start` is in recording time. */
    events: AnnotationEventTemplate[]
    /** The recording's interruptions as `[start, duration]` pairs, with `start` in recording time. */
    interruptions: [number, number][]
}
/**
 * One output channel of an applied selection.
 */
export type ExportSelectedChannel = {
    /** Output label. */
    label: string
    /** Output sampling rate in Hz. */
    samplingRate: number
    /** Output samples. */
    signal: Float32Array
    /** Index of the source channel in the recording's channel list. */
    source: number
}
/**
 * The result of applying a selection. Times are relative to the start of the exported range.
 */
export type ExportSelectionResult = {
    /** Output channels in output order. */
    channels: ExportSelectedChannel[]
    /** Length of the exported signal data in seconds, excluding interruptions. */
    dataDuration: number
    /** Events overlapping the range, clipped to it, with channel references remapped to the output. */
    events: AnnotationEventTemplate[]
    /** Interruptions inside the range as `[start, duration]` pairs, `start` in recording time. */
    interruptions: [number, number][]
    /** The exported range in the source recording, as {@link resolveExportRange} resolved it. */
    range: ExportRange
    /** Length of the exported range in seconds of recording time, interruptions included. */
    recordingDuration: number
}
/**
 * The resolved bounds of a selection's range.
 */
export type ExportRange = {
    /** `[start, end]` in data time, the signal positions to read. */
    data: [number, number]
    /** `[start, end]` in recording time, after moving an end that fell inside an interruption to the data edge. */
    recording: [number, number]
}
/**
 * A reason a selection cannot be applied or does not meet a destination's constraints. `code` is stable for
 * programmatic use; `message` is written for the person making the selection.
 */
export type ExportSelectionViolation = {
    code: 'amplitude_range' | 'channel_template' | 'duplicate_channel' | 'duration' | 'empty_range' | 'invalid_rate'
          | 'invalid_range' | 'no_channels' | 'no_signal' | 'sampling_rate' | 'unit' | 'unknown_channel'
          | 'upsampling'
    message: string
}

/** Tolerance for comparing times and rates that went through floating-point arithmetic. */
const EPSILON = 1e-6
/**
 * Seconds of real signal read on each side of the range, where the source has them, before an anti-aliasing filter
 * runs, so that the filter's edge transient falls outside the exported samples.
 */
const FILTER_MARGIN_SECONDS = 1

/**
 * Does the channel carry a numeric signal that can be exported.
 */
const carriesSignal = (channel: ExportSourceChannel) => channel.samplingRate > 0 && channel.modality !== 'meta'

/**
 * Total length of the recording's signal data in seconds: the shortest channel that carries a signal.
 */
const dataLength = (channels: ExportSourceChannel[]) => {
    let length = Number.POSITIVE_INFINITY
    for (const channel of channels) {
        if (carriesSignal(channel)) {
            length = Math.min(length, channel.sampleCount/channel.samplingRate)
        }
    }
    return Number.isFinite(length) ? length : 0
}

/**
 * Sorted interruptions with the positive durations only.
 */
const sortedInterruptions = (interruptions: [number, number][]) => {
    return interruptions.filter(([, duration]) => duration > 0).sort((a, b) => a[0] - b[0])
}

/**
 * Convert a recording time to data time. A time inside an interruption maps to the data position where the
 * interruption sits.
 * @param time - Time in seconds of recording time.
 * @param interruptions - Interruptions as `[start, duration]` in recording time, sorted by start.
 */
const recordingToDataTime = (time: number, interruptions: [number, number][]) => {
    let data = time
    for (const [start, duration] of interruptions) {
        if (start >= time) {
            break
        }
        data -= Math.min(duration, time - start)
    }
    return data
}

/**
 * The output channels a selection names, with the default applied: every channel that carries a signal.
 */
const selectedChannels = (channels: ExportSourceChannel[], selection: BiosignalExportSelection) => {
    if (selection.channels) {
        return selection.channels.map(channel => ({
            amplitudeRange: channel.amplitudeRange ?? selection.amplitudeRange,
            label: channel.label ?? channels[channel.source]?.label ?? '',
            source: channel.source,
        }))
    }
    return channels.map((channel, index) => ({
        amplitudeRange: selection.amplitudeRange,
        label: channel.label,
        source: index,
    })).filter(({ source }) => carriesSignal(channels[source]))
}

/**
 * Resolve a selection's range against the recording: the recording-time bounds after moving an end that falls inside
 * an interruption to the edge of the signal data, and the matching data-time bounds.
 * @param channels - The recording's full channel list.
 * @param interruptions - The recording's interruptions as `[start, duration]` in recording time.
 * @param range - The selection's range in recording time; the whole recording when omitted.
 * @returns The resolved range, or null when it is invalid or holds no signal data.
 */
export const resolveExportRange = (
    channels: ExportSourceChannel[],
    interruptions: [number, number][],
    range?: [number, number]
): ExportRange | null => {
    const gaps = sortedInterruptions(interruptions)
    const totalData = dataLength(channels)
    const totalRecording = totalData + gaps.reduce((total, [, duration]) => total + duration, 0)
    let [start, end] = range ?? [0, totalRecording]
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < -EPSILON || end > totalRecording + EPSILON) {
        return null
    }
    start = Math.max(0, start)
    end = Math.min(totalRecording, end)
    for (const [gapStart, duration] of gaps) {
        const gapEnd = gapStart + duration
        if (start >= gapStart && start < gapEnd) {
            start = gapEnd
        }
    }
    for (const [gapStart, duration] of [...gaps].reverse()) {
        const gapEnd = gapStart + duration
        if (end > gapStart && end <= gapEnd) {
            end = gapStart
        }
    }
    const data: [number, number] = [recordingToDataTime(start, gaps), recordingToDataTime(end, gaps)]
    if (data[1] - data[0] <= EPSILON) {
        return null
    }
    return { data, recording: [start, end] }
}

/**
 * Check a selection against the recording and, optionally, against a destination's constraints. An empty result
 * means {@link applyExportSelection} can apply the selection and the result meets every constraint given.
 * @param channels - The recording's full channel list.
 * @param interruptions - The recording's interruptions as `[start, duration]` in recording time.
 * @param selection - The selection to check.
 * @param constraints - Limits of the export destination, if any.
 * @returns Every violation found, in a stable order.
 */
export const checkExportSelection = (
    channels: ExportSourceChannel[],
    interruptions: [number, number][],
    selection: BiosignalExportSelection,
    constraints?: BiosignalExportConstraints
): ExportSelectionViolation[] => {
    const violations = [] as ExportSelectionViolation[]
    const outputs = selectedChannels(channels, selection)
    if (!outputs.length) {
        violations.push({ code: 'no_channels', message: 'The selection exports no channels.' })
    }
    if (selection.samplingRate !== undefined && !(selection.samplingRate > 0)) {
        violations.push({
            code: 'invalid_rate',
            message: `The output sampling rate must be positive (got ${selection.samplingRate} Hz).`,
        })
    }
    const seen = new Set<number>()
    for (const output of outputs) {
        const source = channels[output.source]
        if (!source) {
            violations.push({
                code: 'unknown_channel',
                message: `The selection names channel ${output.source}, which the recording does not have.`,
            })
            continue
        }
        if (seen.has(output.source)) {
            violations.push({
                code: 'duplicate_channel',
                message: `Channel ${source.label} is selected more than once.`,
            })
        }
        seen.add(output.source)
        if (!carriesSignal(source)) {
            violations.push({ code: 'no_signal', message: `Channel ${source.label} carries no signal.` })
            continue
        }
        const rate = selection.samplingRate ?? source.samplingRate
        if (rate > source.samplingRate + EPSILON) {
            violations.push({
                code: 'upsampling',
                message: `Channel ${source.label} is recorded at ${source.samplingRate} Hz, below the output rate of ` +
                         `${rate} Hz.`,
            })
        }
        if (constraints?.samplingRate !== undefined && Math.abs(rate - constraints.samplingRate) > EPSILON) {
            violations.push({
                code: 'sampling_rate',
                message: `Channel ${output.label} would be exported at ${rate} Hz; the destination requires ` +
                         `${constraints.samplingRate} Hz.`,
            })
        }
        if (constraints?.unit !== undefined && source.unit !== constraints.unit) {
            violations.push({
                code: 'unit',
                message: `Channel ${output.label} is in ${source.unit || 'no unit'}; the destination requires ` +
                         `${constraints.unit}.`,
            })
        }
        const amplitude = output.amplitudeRange
        if (amplitude && !(amplitude[0] < amplitude[1])) {
            violations.push({
                code: 'amplitude_range',
                message: `The amplitude range of channel ${output.label} must have its minimum below its maximum.`,
            })
        } else if (
            constraints?.amplitudeRange
            && (!amplitude || amplitude[0] !== constraints.amplitudeRange[0]
                           || amplitude[1] !== constraints.amplitudeRange[1])
        ) {
            violations.push({
                code: 'amplitude_range',
                message: `Channel ${output.label} must be clipped to ${constraints.amplitudeRange[0]} … ` +
                         `${constraints.amplitudeRange[1]}.`,
            })
        }
    }
    if (constraints?.channels) {
        const labels = outputs.map(({ label }) => label)
        const matches = labels.length === constraints.channels.length
                        && labels.every((label, index) => label === constraints.channels![index])
        if (!matches) {
            violations.push({
                code: 'channel_template',
                message: `The output channels must be ${constraints.channels.join(', ')}, in that order.`,
            })
        }
    }
    if (selection.range && !(selection.range[0] < selection.range[1])) {
        violations.push({ code: 'invalid_range', message: 'The range must end after it starts.' })
        return violations
    }
    const range = resolveExportRange(channels, interruptions, selection.range)
    if (!range) {
        violations.push({
            code: selection.range ? 'empty_range' : 'no_signal',
            message: selection.range
                     ? 'The range lies outside the recording or holds no signal data.'
                     : 'The recording holds no signal data.',
        })
        return violations
    }
    if (constraints?.durations?.length) {
        const duration = range.data[1] - range.data[0]
        if (!constraints.durations.some(allowed => Math.abs(allowed - duration) <= EPSILON)) {
            violations.push({
                code: 'duration',
                message: `The range holds ${duration} s of signal; the destination accepts ` +
                         `${constraints.durations.join(', ')} s.`,
            })
        }
    }
    return violations
}

/**
 * Clip and re-base the events that overlap the range, and remap their channel references to the output. A number
 * refers to a channel by its index in the recording's channel list and becomes the output position; a string refers
 * by name, case-insensitively and possibly to several channels, and becomes the output labels of those kept.
 * References to channels the selection drops are removed, and an event whose every reference is removed is dropped
 * with them; an event that refers to no channel covers the whole recording and is kept.
 */
const selectEvents = (
    events: AnnotationEventTemplate[],
    range: [number, number],
    sources: ExportSourceChannel[],
    outputs: { label: string, source: number }[]
) => {
    const indexBySource = new Map(outputs.map(({ source }, index) => [source, index]))
    const labelsByName = new Map<string, string[]>()
    for (const { label, source } of outputs) {
        const name = (sources[source].name ?? sources[source].label).toLowerCase()
        const labels = labelsByName.get(name) ?? []
        if (!labels.includes(label)) {
            labels.push(label)
        }
        labelsByName.set(name, labels)
    }
    const [start, end] = range
    const selected = [] as AnnotationEventTemplate[]
    for (const event of events) {
        const eventEnd = event.start + (event.duration || 0)
        const overlaps = event.duration
                         ? eventEnd > start && event.start < end
                         : event.start >= start && event.start < end
        if (!overlaps) {
            continue
        }
        let channels = event.channels
        if (channels?.length) {
            const remapped = new Set<number | string>()
            for (const ref of channels) {
                if (typeof ref === 'number') {
                    const index = indexBySource.get(ref)
                    if (index !== undefined) {
                        remapped.add(index)
                    }
                } else {
                    for (const label of labelsByName.get(ref.toLowerCase()) ?? []) {
                        remapped.add(label)
                    }
                }
            }
            channels = [...remapped]
            if (!channels.length) {
                continue
            }
        }
        const clippedStart = Math.max(event.start, start)
        selected.push({
            ...event,
            channels,
            duration: event.duration ? Math.min(eventEnd, end) - clippedStart : event.duration,
            start: clippedStart - start,
        })
    }
    return selected
}

/**
 * Apply a selection to a recording's signals, events and interruptions. The range is cut, the channels are taken in
 * the selection's order under their output labels, each is downsampled to the output rate with an anti-aliasing
 * filter and then clipped to its amplitude range, and events and interruptions are clipped to the range, re-based to
 * its start and, for events, remapped to the output channels.
 *
 * The signals may start at any data time (`dataOffset`), so a caller can read just the range from
 * {@link resolveExportRange} plus a second on each side for the filter, rather than the whole recording.
 * @param source - The recording's channels, signals, events and interruptions.
 * @param selection - What to export.
 * @returns The transformed data, or the violations that prevent applying the selection.
 */
export const applyExportSelection = (
    source: ExportSourceData,
    selection: BiosignalExportSelection
): ExportSelectionResult | { violations: ExportSelectionViolation[] } => {
    const violations = checkExportSelection(source.channels, source.interruptions, selection)
    if (violations.length) {
        return { violations }
    }
    const range = resolveExportRange(source.channels, source.interruptions, selection.range)!
    const [dataStart, dataEnd] = range.data
    const offset = source.dataOffset ?? 0
    const outputs = selectedChannels(source.channels, selection)
    const channels = [] as ExportSelectedChannel[]
    for (const output of outputs) {
        const channel = source.channels[output.source]
        const signal = channel.signal
        const rate = channel.samplingRate
        const outRate = selection.samplingRate ?? rate
        const first = Math.round((dataStart - offset)*rate)
        const last = Math.round((dataEnd - offset)*rate)
        if (!signal || first < 0 || last > signal.length) {
            return {
                violations: [{
                    code: 'no_signal',
                    message: `The signal of channel ${channel.label} does not cover the range.`,
                }],
            }
        }
        const outLength = Math.round((dataEnd - dataStart)*outRate)
        let samples: Float32Array
        if (Math.abs(outRate - rate) <= EPSILON) {
            samples = signal.slice(first, first + outLength)
        } else {
            const margin = Math.ceil(FILTER_MARGIN_SECONDS*rate)
            const lead = Math.min(margin, first)
            const context = signal.subarray(first - lead, Math.min(signal.length, last + margin))
            samples = downsampleSignal(context, rate, outRate, outLength, lead)
        }
        const amplitude = output.amplitudeRange
        if (amplitude) {
            for (let i = 0; i < samples.length; i++) {
                samples[i] = Math.min(amplitude[1], Math.max(amplitude[0], samples[i]))
            }
        }
        channels.push({ label: output.label, samplingRate: outRate, signal: samples, source: output.source })
    }
    const [start, end] = range.recording
    const interruptions = sortedInterruptions(source.interruptions)
        .filter(([gapStart, duration]) => gapStart + duration > start && gapStart < end)
        .map(([gapStart, duration]): [number, number] => {
            const clippedStart = Math.max(gapStart, start)
            return [clippedStart - start, Math.min(gapStart + duration, end) - clippedStart]
        })
    return {
        channels,
        dataDuration: dataEnd - dataStart,
        events: selectEvents(source.events, range.recording, source.channels, outputs),
        interruptions,
        range,
        recordingDuration: end - start,
    }
}
