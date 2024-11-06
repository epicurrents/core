/**
 * Generic biosignal recording header.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import {
    type AnnotationTemplate,
    type BiosignalFilters,
    type BiosignalHeaderRecord,
    type BiosignalHeaderSignal,
    type SignalDataGapMap,
} from '#types/biosignal'

const SCOPE = 'GenericBiosignalHeader'

export default class GenericBiosignalHeader implements BiosignalHeaderRecord {
    private _annotations: AnnotationTemplate[]
    private _dataGaps: SignalDataGapMap
    private _dataDuration: number
    private _dataRecordCount: number
    private _dataRecordDuration: number
    private _dataRecordSize: number
    private _discontinous: boolean
    private _duration: number
    private _fileType: string
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
        dataRecordCount: number,
        dataRecordDuration: number,
        dataRecordSize: number,
        signalCount: number,
        signalProperties: BiosignalHeaderSignal[],
        recordingStartTime = null as Date | null,
        discontinuous = false,
        annotations = [] as AnnotationTemplate[],
        dataGaps = new Map() as SignalDataGapMap,
    ) {
        this._annotations = annotations
        this._dataGaps = dataGaps
        this._dataDuration = dataRecordCount*dataRecordDuration
        this._dataRecordCount = dataRecordCount
        this._dataRecordDuration = dataRecordDuration
        this._dataRecordSize = dataRecordSize
        this._discontinous = discontinuous
        this._duration = this._dataDuration +
                         Array.from(dataGaps.values())
                              .reduce(function (a, b) { return a + b }, 0)
        this._fileType = fileType
        this._patientId = patientId
        this._recordingId = recordingId
        this._recordingStartTime = recordingStartTime
        this._signalCount = signalCount
        this._signalProperties = signalProperties
    }

    get annotations () {
        return this._annotations
    }

    get dataDuration () {
        return this._dataDuration
    }

    get dataGaps () {
        return this._dataGaps
    }

    get dataRecordCount () {
        return this._dataRecordCount
    }

    get dataRecordDuration () {
        return this._dataRecordDuration
    }

    get dataRecordSize () {
        return this._dataRecordSize
    }

    get duration () {
        return this._duration
    }

    get fileType () {
        return this._fileType
    }

    get maxSamplingRate () {
        return this._maxSamplingRate
    }

    get discontinuous () {
        return this._discontinous
    }
    set discontinuous (value: boolean) {
        // This probably does not need a change event emitted.
        this._discontinous = value
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
            annotations: [],
            dataGaps: Array.from(this.dataGaps.entries()),
            dataRecordCount: this.dataRecordCount,
            dataRecordDuration: this.dataRecordDuration,
            dataRecordSize: this.dataRecordSize,
            discontinuous: this.discontinuous,
            fileType: this.fileType,
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
        return this._dataRecordCount*this._dataRecordDuration
    }

    addAnnotations (...items: AnnotationTemplate[]) {
        this._annotations.push(...items)
    }

    addDataGaps (items: SignalDataGapMap) {
        for (const gap of items) {
            this._dataGaps.set(gap[0], gap[1])
        }
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
        if (!this._dataRecordDuration) {
            Log.warn(`Signal index ${index} has a data record duration of zero, cannot determine sampling frequency.`, SCOPE)
            return null
        }
        return this._signalProperties[index].sampleCount / this._dataRecordDuration
    }
}
