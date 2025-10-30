/**
 * Generic biosignal recording header.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import type {
    AnnotationEventTemplate,
    AnnotationLabelTemplate,
    BiosignalFilters,
    BiosignalHeaderRecord,
    BiosignalHeaderSignal,
    SignalInterruptionMap,
} from '#types/biosignal'

const SCOPE = 'GenericBiosignalHeader'

export default class GenericBiosignalHeader implements BiosignalHeaderRecord {
    private _dataDuration: number
    private _dataUnitCount: number
    private _dataUnitDuration: number
    private _dataUnitSize: number
    private _discontinuous: boolean
    private _duration: number
    private _events: AnnotationEventTemplate[]
    private _fileType: string
    private _interruptions: SignalInterruptionMap
    private _labels: AnnotationLabelTemplate[]
    private _maxSamplingRate: number = 0
    private _patientId: string
    private _recordingId: string
    private _recordingStartTime: Date | null = null
    private _signalCount: number
    private _signalProperties: BiosignalHeaderSignal[] = []

    constructor (
        fileType: string,
        recordingId: string,
        patientId: string,
        dataUnitCount: number,
        dataUnitDuration: number,
        dataUnitSize: number,
        signalCount: number,
        signalProperties: BiosignalHeaderSignal[],
        recordingStartTime = null as Date | null,
        discontinuous = false,
        events = [] as AnnotationEventTemplate[],
        labels = [] as AnnotationLabelTemplate[],
        interruptions = new Map() as SignalInterruptionMap,
    ) {
        this._dataDuration = dataUnitCount*dataUnitDuration
        this._dataUnitCount = dataUnitCount
        this._dataUnitDuration = dataUnitDuration
        this._dataUnitSize = dataUnitSize
        this._discontinuous = discontinuous
        this._duration = this._dataDuration +
                         Array.from(interruptions.values())
                              .reduce(function (a, b) { return a + b }, 0)
        this._events = events
        this._fileType = fileType
        this._interruptions = interruptions
        this._labels = labels
        this._patientId = patientId
        this._recordingId = recordingId
        this._recordingStartTime = recordingStartTime
        this._signalCount = signalCount
        this._signalProperties = signalProperties
    }

    get dataDuration () {
        return this._dataDuration
    }

    get dataUnitCount () {
        return this._dataUnitCount
    }

    get dataUnitDuration () {
        return this._dataUnitDuration
    }

    get dataUnitSize () {
        return this._dataUnitSize
    }

    get duration () {
        return this._duration
    }

    get events () {
        return this._events
    }

    get fileType () {
        return this._fileType
    }

    get interruptions () {
        return this._interruptions
    }

    get labels () {
        return this._labels
    }

    get maxSamplingRate () {
        return this._maxSamplingRate
    }

    get discontinuous () {
        return this._discontinuous
    }
    set discontinuous (value: boolean) {
        // This probably does not need a change event emitted.
        this._discontinuous = value
    }

    get patientId () {
        return this._patientId
    }

    get recordingId () {
        return this._recordingId
    }

    get recordingStartTime () {
        return this._recordingStartTime
    }

    get serializable () {
        return {
            dataUnitCount: this.dataUnitCount,
            dataUnitDuration: this.dataUnitDuration,
            dataUnitSize: this.dataUnitSize,
            discontinuous: this.discontinuous,
            events: [],
            fileType: this.fileType,
            interruptions: Array.from(this.interruptions.entries()),
            labels: [],
            patientId: this.patientId,
            recordingId: this.recordingId,
            recordingStartTime: this.recordingStartTime,
            signalCount: this.signalCount,
            signals: [...this._signalProperties]
        }
    }

    get signalCount () {
        return this._signalCount || this._signalProperties.length
    }

    get signals () {
        return this._signalProperties
    }

    get totalDuration () {
        return this._dataUnitCount*this._dataUnitDuration
    }

    addEvents (...items: AnnotationEventTemplate[]) {
        this._events.push(...items)
    }

    addInterruptions (items: SignalInterruptionMap) {
        for (const intr of items) {
            this._interruptions.set(intr[0], intr[1])
        }
    }

    addLabels (...items: AnnotationLabelTemplate[]) {
        this._labels.push(...items)
    }

    /* Helper methods for retrieving signal properties. */

    getSignalLabel (index: number): string | null {
        if (index < 0 || index >= this._signalProperties.length) {
            Log.warn(`Signal index ${index} is out of range, cannot return signal label.`, SCOPE)
            return null
        }
        return this._signalProperties[index].label
    }

    getSignalNumberOfSamplesPerRecord (index: number): number | null {
        if (index < 0 || index >= this._signalProperties.length) {
            Log.warn(`Signal index ${index} is out of range, cannot return number of samples per record.`, SCOPE)
            return null
        }
        return this._signalProperties[index].sampleCount
    }

    getSignalPhysicalUnit (index: number): string | null {
        if (index < 0 || index >= this._signalProperties.length) {
            Log.warn(`Signal index ${index} is out of range, cannot return physical signal unit.`, SCOPE)
            return null
        }
        return this._signalProperties[index].physicalUnit
    }

    getSignalPrefiltering (index: number): BiosignalFilters | null {
        if (index < 0 || index >= this._signalProperties.length) {
            Log.warn(`Signal index ${index} is out of range, cannot return prefiltering.`, SCOPE)
            return null
        }
        return this._signalProperties[index].prefiltering
    }

    getSignalSamplingFrequency (index: number): number | null {
        if (index < 0 || index >= this._signalProperties.length) {
            Log.warn(`Signal index ${index} is out of range, cannot return signal sampling frequency.`, SCOPE)
            return null
        }
        if (!this._dataUnitDuration) {
            Log.warn(`Signal index ${index} has a data record duration of zero, cannot determine sampling frequency.`, SCOPE)
            return null
        }
        return this._signalProperties[index].sampleCount / this._dataUnitDuration
    }
}
