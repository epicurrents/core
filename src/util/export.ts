/**
 * Export selection: the format-agnostic reduction of a signal recording to a time range, an ordered set of
 * channels under output labels, one output rate and an amplitude range. An exporter applies it before encoding, so
 * every exporter offers the same operations and none of them knows why a selection was made. Also the rule deciding
 * which resources may be sent to an export target, and the label matching an export dialog suggests channels with.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { DataResource } from '#types/application'
import type { AnnotationEventTemplate } from '#types/biosignal'
import type {
    SignalExportConstraints,
    SignalExportRange,
    SignalExportSelectedChannel,
    SignalExportSelection,
    SignalExportSelectionResult,
    SignalExportSource,
    SignalExportSourceChannel,
    SignalExportViolation,
} from '#types/reader'
import { downsampleSignal } from './dsp'

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
const carriesSignal = (channel: SignalExportSourceChannel) => channel.samplingRate > 0 && channel.modality !== 'meta'

/**
 * Total length of the recording's signal data in seconds: the shortest channel that carries a signal.
 */
const dataLength = (channels: SignalExportSourceChannel[]) => {
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
const selectedChannels = (channels: SignalExportSourceChannel[], selection: SignalExportSelection) => {
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
    channels: SignalExportSourceChannel[],
    interruptions: [number, number][],
    range?: [number, number]
): SignalExportRange | null => {
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
    channels: SignalExportSourceChannel[],
    interruptions: [number, number][],
    selection: SignalExportSelection,
    constraints?: SignalExportConstraints
): SignalExportViolation[] => {
    const violations = [] as SignalExportViolation[]
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
    sources: SignalExportSourceChannel[],
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
    source: SignalExportSource,
    selection: SignalExportSelection
): SignalExportSelectionResult | { violations: SignalExportViolation[] } => {
    const violations = checkExportSelection(source.channels, source.interruptions, selection)
    if (violations.length) {
        return { violations }
    }
    const range = resolveExportRange(source.channels, source.interruptions, selection.range)!
    const [dataStart, dataEnd] = range.data
    const offset = source.dataOffset ?? 0
    const outputs = selectedChannels(source.channels, selection)
    const channels = [] as SignalExportSelectedChannel[]
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

/**
 * Was the resource opened from a local file: does every data file of its source study carry a `File` object, as a
 * study loader sets one only for a file the person picked or dropped. A resource loaded from a URL, through a
 * connector, or from a source that says nothing about its files is not local.
 * @param resource - The resource to check.
 * @returns True if the resource was opened from a local file.
 */
export const isLocalResource = (resource: DataResource) => {
    const files = resource.source?.files.filter(file => file.role === 'data') ?? []
    return files.length > 0 && files.every(file => typeof File !== 'undefined' && file.file instanceof File)
}

/** Modality words a channel label may start with, which say nothing about the channel's position. */
const LABEL_MODALITY_PREFIX = /^(eeg|ecg|ekg|eog|emg|resp|misc)[\s:._-]+/i
/** Reference suffixes of a referential channel label. */
const LABEL_REFERENCE_SUFFIX = /[\s_-]+(ref|avg|av|average|le|a1a2|a12|m1m2|cz)$/i

/**
 * The comparable core of a channel label: lower case, without a leading modality word or a trailing reference.
 */
const labelCore = (label: string) => {
    return label.trim().replace(LABEL_MODALITY_PREFIX, '').replace(LABEL_REFERENCE_SUFFIX, '').toLowerCase()
}

/**
 * Suggest the source channel an output label should be exported from: the one whose label matches exactly, ignoring
 * case, or failing that the only one whose label matches once a leading modality word (`EEG Fp1`) and a trailing
 * reference (`Fp1-Ref`, `Fp1-AVG`) are removed from both. A suggestion for the person to confirm, never a mapping to
 * apply unseen; an ambiguous match suggests nothing.
 * @param label - The output label to find a source for.
 * @param channels - The recording's full channel list.
 * @returns Index of the suggested source channel, or null when there is no unambiguous match.
 */
export const suggestExportSource = (label: string, channels: SignalExportSourceChannel[]): number | null => {
    const candidates = channels.map((channel, index) => ({ channel, index })).filter(c => carriesSignal(c.channel))
    const exact = candidates.filter(c => c.channel.label.trim().toLowerCase() === label.trim().toLowerCase())
    if (exact.length === 1) {
        return exact[0].index
    }
    if (exact.length > 1) {
        return null
    }
    const core = labelCore(label)
    const loose = candidates.filter(c => labelCore(c.channel.label) === core)
    return loose.length === 1 ? loose[0].index : null
}
