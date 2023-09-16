/**
 * Config types.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalAnnotation } from "./lib/biosignal"

type BaseModuleSettings = {
    /**
     * An object defining the composition of the settings menu of
     * this module.
     */
    _settingsMenu?: {
        /** Description text right under the main header. */
        description: string
        /**
         * The actual fileds of the menu, also containing section
         * subtitles and descriptions. Any settings listed here must
         * also be listed under _userDefinable, or changes in them
         * will be ignored.
         */
        fields: {
            /**
             * Optional component name, only applicable to setting type.
             * Subtitle and description types always use `div`.
             */
            component?: string
            /** Preset options for this setting. */
            options?: {
                /** Optional prefix printed before the actual value. */
                prefix?: string
                /** Optional suffix printed after the actual value. */
                suffix?: string
                /** The value in the format that it is in the settings. */
                value: (string | number)
            }[]
            presets?: {
                setting: string
                value: string | number | boolean
            }[]
            /** Path and name of the settings field. */
            setting?: string
            /**
             * Accompanying text.
             * * For a setting this is the description of the setting.
             * * For a subtitle and description this is the content of the field.
             */
            text: string
            /**
             * Type of the field.
             */
            type: 'description' | 'preset' | 'setting' | 'subtitle'
        }[],
        name: {
            full: string
            short: string
        }
    }
    /**
     * All the properties (settings) in this module that can be
     * modified by the user and saved locally. Key is the name
     * of the setting and value is the constructor of the allowed
     * value type.
     */
    _userDefinable?: { [field: string]: any }
}
/**
 * Color with values for [`red`, `green`, `blue`, `alpha`] as fraction of 1.
 */
export type SettingsColor = [number, number, number, number]
type CircleStyles = {
    color: SettingsColor
    dasharray?: number[]
    radius: number
    show?: boolean
    style: string
    width: number
}
type LineStyles = {
    color: SettingsColor
    dasharray?: number[]
    show?: boolean
    style: string
    width: number
}
export type SettingsValue = SettingsColor | boolean | number | string | undefined
export type CommonBiosignalSettings = {
    annotations: {
        color: SettingsColor
        convertPatterns: [string, BiosignalAnnotation][]
        idColors: { [id: string]: SettingsColor }
        ignorePatterns: string[]
        typeColors: { [type: string]: SettingsColor }
        width: number
    }
    /** Should antialiasing be used when drawing tha trace. */
    antialiasing: boolean
    border: {
        bottom?: LineStyles
        left?: LineStyles
        right?: LineStyles
        top?: LineStyles
    }
    channelSpacing: number
    defaultMontages: { [setup: string]: [string, string][] }
    defaultSetups: string[]
    displayPolarity: 1 | -1
    /**
     * The sampling rate limit when applying downsampling to signals.
     * The sampling rate will never fall below this value, meaning that
     * the minimum sampling rate that downsampling can be applied to is
     * 2*downsampleLimit. Zero will disable downsampling.
     */
    downsampleLimit: number
    /**
     * The amount of padding is always a compromise between overhead from the
     * extra signal data that needs to be processed and possible artefacts
     * introduced by filtering; the slower and larger amplitude the waves,
     * the more padding is needed to avoid significant artefacts. Use this amount
     * of signal data (in seconds) as padding at both ends.
     */
    filterPaddingSeconds: number
    filters: {
        highpass: {
            availableValues: number[]
            default: number
        }
        lowpass: {
            availableValues: number[]
            default: number
        }
        notch: {
            availableValues: number[]
            default: number
        }
    }
    groupSpacing: number
    majorGrid: LineStyles
    minorGrid: LineStyles
    montages: {
        /** Maximum number of montages to keep cached. */
        cacheMax: number
        /** Should montage signals be pre-cached into a biosignal mutex. */
        preCache: boolean
    }
    /** The default length of one page when browsing forward or backward. */
    pageLength: 10
    sensitivity: {
        [unit: string]: {
            availableValues: number[]
            default: number
        }
    }
    sensitivityUnit: string
    /** Show channels that tha have been marked hidden on the EEG trace. */
    showHiddenChannels: boolean
    /** Show channels that are missing from the source file on the EEG trace. */
    showMissingChannels: boolean
    /** Default timebase in the  */
    timebase: {
        [unit: string]: {
            availableValues: number[]
            default: number
        }
    }
    timebaseUnit: string
    timeline: {
        labelSpacing: number
    }
    yPadding: number
}
type ValueConstructor = BooleanConstructor | NumberConstructor | StringConstructor
export interface AppSettings {
    _CLONABLE: BaseModuleSettings & AppSettings
    app: BaseModuleSettings & {
        /** Maximum number of bytes to load in one chunk. This will be
         * rounded down to the nearest whole data record size - 1
         * (because one data record may be added for signal interpolation).
         * If the size of a single data record is larger than dataChunkSize,
         * the value will be rounded up to match one data record.
        . */
        dataChunkSize: number
        fontawesomeLib: string
        iconLib: string
        isMainComponent: boolean
        /** Messages ≥ this level will be logged. */
        logThreshold: keyof typeof Log.LEVELS
        /** Load files of this size directly. */
        maxDirectLoadSize: number
        /**
         * Maximum amount of raw EEG signal data to cache in bytes.
         * Signal data type conversion must be taken into account, so if
         * data is loaded as 16 bit EDF and cached as 32 bit float array,
         * only half this amount of EDF signal data can be loaded.
         */
        maxLoadCacheSize: number
        screenPPI: number
        theme: string
    }
    modules: { [name: string]: BaseModuleSettings }
    services: BaseModuleSettings & {
        MNE: boolean
        ONNX: boolean
    },
    addPropertyUpdateHandler: (field: string, handler: (value?: any) => any, caller?: string) => void
    getFieldValue: (field: string, depth?: number) => SettingsValue
    registerModule: (name: string, moduleSettings: BaseModuleSettings) => void
    removeAllPropertyUpdateHandlersFor: (caller: string) => void
    removeAllPropertyUpdateHandlers: () => void
    removePropertyUpdateHandler: (field: string, handler: ((value?: any) => any)) => void
}
export type EegModuleSettings = BaseModuleSettings & CommonBiosignalSettings & {
    continuousBrowseDelay: number
    continuousBrowseInterval: number
    cursor: {
        color: SettingsColor
        width: number
    }
    excludeActiveFromAvg: boolean
    fft: {
        frequencyBands: { name: string, upperLimit: number }[]
    }
    highlights: {
        /** Display a fading collar before and after a highlight. */
        showCollars: boolean
    }
    isoelLine: LineStyles
    labelMatchers: {
        /** All possible signal labels that should be classified as EEG. */
        eeg: string[]
        /** All possible signal labels that should be classified as EKG. */
        ekg: string[]
        /** All possible signal labels that should be classified as EMG. */
        emg: string[]
        /** All possible signal labels that should be classified as EOG. */
        eog: string[]
        /** All possible signal labels that should be classified as respiration. */
        res: string[]
    }
    /**
     * Maximum length of new signals in the cache to load in one go when running
     * a new montage signal cache cycle (measured in seconds of signal data).
     * Setting this value too high may cause cache cycles to run quite slow.
     */
    maxNewSignalCacheCycleLength: number
    /**
     * Minimum length of new signals in the cache in order to trigger a montage
     * signal cache cycle (measured in seconds of signal data). Setting this value
     * lower will increase overhead from padding and setting it higher will
     * cause cycles to run at greater intervals when loading new signal data.
     */
    minNewSignalCacheCycleLength: number
    navigator: {
        annotationColor: SettingsColor
        borderColor: SettingsColor
        cachedColor: SettingsColor
        gapColor: SettingsColor
        loadedColor: SettingsColor
        loadingColor: SettingsColor
        theme: string
        tickColor: SettingsColor
        viewBoxColor: SettingsColor
    }
    tools: {
        cursorLine: LineStyles
        excludeArea: LineStyles
        guideLine: LineStyles
        guideLineSymbol: {
            color: SettingsColor
        }
        highlightArea: {
            color: SettingsColor
        }
        poiMarkerCircle: CircleStyles
        poiMarkerLine: LineStyles
        signals: LineStyles[]
        signalBaseline: LineStyles
    },
    trace: {
        color: {
            eeg: SettingsColor
                sin: SettingsColor
                dex: SettingsColor
                mid: SettingsColor
            ekg: SettingsColor
            emg: SettingsColor
            eog: SettingsColor
            res: SettingsColor
            meta: SettingsColor
            default: SettingsColor
        }
        colorSides: boolean
        selections: {
            color: SettingsColor
        }
        theme: string
        width: {
            eeg: number
            ekg: number
            eog: number
        }
    }
}
export type EmgModuleSettings = BaseModuleSettings & CommonBiosignalSettings & {
    cursor: {
        active: LineStyles
        focused: LineStyles
        inactive: LineStyles
    }
    defaultTriggerValue: number
    scaleUnit: 'div' | 'page'
    findingGroups: string[]
    findingTypes: {
        [group: string]: {
            default: string | number
            label: string
            name: string
            values: string[] | number[]
        }
    }
    jitter: {
        highlight: {
            borderColor: SettingsColor
            borderWidth: number
            fillColor: SettingsColor
            height: number
        }
        pair: {
            borderColor: SettingsColor
            borderWidth: number
            fillColor: SettingsColor
            size: number
        }
        rowHeight: number
        trigger: {
            borderColor: SettingsColor
            borderWidth: number
            fillColor: SettingsColor
            size: number
        }
        upcoming: {
            borderColor: SettingsColor
            borderWidth: number
            fillColor: SettingsColor
            size: number
        }
    }
    markerColor: SettingsColor
    markerSize: number
    masterAxis: 'x' | 'y'
    navigator: {
        borderColor: SettingsColor
        signalColor: SettingsColor
        theme: string
        tickColor: SettingsColor
        outOfViewBackground: SettingsColor
        outOfViewSignal: SettingsColor
    }
    results: {
        display: boolean
        width: number
    }
    trace: {
        color: SettingsColor
        theme: string
        width: number
    }
    xDivCount: number
    yDivCount: number
}
export type MegModuleSettings = BaseModuleSettings & CommonBiosignalSettings & {
    continuousBrowseDelay: number
    continuousBrowseInterval: number
    cursor: {
        color: SettingsColor
        width: number
    }
    excludeActiveFromAvg: boolean
    fft: {
        frequencyBands: { name: string, upperLimit: number }[]
    }
    isoelLine: LineStyles
    /**
     * Maximum length of new signals in the cache to load in one go when running
     * a new montage signal cache cycle (measured in seconds of signal data).
     * Setting this value too high may cause cache cycles to run quite slow.
     */
    maxNewSignalCacheCycleLength: number
    /**
     * Minimum length of new signals in the cache in order to trigger a montage
     * signal cache cycle (measured in seconds of signal data). Setting this value
     * lower will increase overhead from padding and setting it higher will
     * cause cycles to run at greater intervals when loading new signal data.
     */
    minNewSignalCacheCycleLength: number
    navigator: {
        annotationColor: SettingsColor
        borderColor: SettingsColor
        cachedColor: SettingsColor
        gapColor: SettingsColor
        loadedColor: SettingsColor
        loadingColor: SettingsColor
        theme: string
        tickColor: SettingsColor
        viewBoxColor: SettingsColor
    }
    tools: {
        cursorLine: LineStyles
        excludeArea: LineStyles
        guideLine: LineStyles
        guideLineSymbol: {
            color: SettingsColor
        }
        highlightArea: {
            color: SettingsColor
        }
        poiMarkerCircle: CircleStyles
        poiMarkerLine: LineStyles
        signals: LineStyles[]
        signalBaseline: LineStyles
    },
    trace: {
        color: {
            eeg: SettingsColor
                sin: SettingsColor
                dex: SettingsColor
                mid: SettingsColor
            ekg: SettingsColor
            emg: SettingsColor
            eog: SettingsColor
            res: SettingsColor
            meta: SettingsColor
            default: SettingsColor
        }
        colorSides: boolean
        selections: {
            color: SettingsColor
        }
        theme: string
        width: {
            eeg: number
            ekg: number
            eog: number
        }
    }
}
export type NcsModuleSettings = BaseModuleSettings & CommonBiosignalSettings & {
    cursor: {
        active: LineStyles
        focused: LineStyles
        inactive: LineStyles
    }
    defaultTimebase: {
        f: {
            div: number
            page: number
        }
        h: {
            div: number
            page: number
        }
        m: {
            div: number
            page: number
        }
        s: {
            div: number
            page: number
        }
        u: {
            div: number
            page: number
        }
    }
    defaultSensitivity: {
        f: {
            div: number
            page: number
        }
        h: {
            div: number
            page: number
        }
        m: {
            div: number
            page: number
        }
        s: {
            div: number
            page: number
        }
        u: {
            div: number
            page: number
        }
    }
    scaleUnit: 'div' | 'page'
    marker: {
        active: LineStyles | CircleStyles
        focused: LineStyles | CircleStyles
        inactive: LineStyles | CircleStyles
    }
    markerColor: SettingsColor
    markerSize: number
    masterAxis: 'x' | 'y' | null
    results: {
        display: boolean
        width: number
    }
    trace: {
        color: SettingsColor
        theme: string
        width: number
    }
    xDivCount: number
    yDivCount: number
}
