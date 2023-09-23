/**
 * Config types.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { StudyCollection } from "#assets/study"
import { BiosignalAnnotation, BiosignalChannelTemplate, SetupChannel } from "./biosignal"

export interface AppSettings {
    _CLONABLE: ClonableAppSettings
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
        logThreshold: "DEBUG" | "INFO" | "WARN" | "ERROR" | "DISABLE"
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
    removeAllPropertyUpdateHandlers: () => void
    removeAllPropertyUpdateHandlersFor: (caller: string) => void
    removePropertyUpdateHandler: (field: string, handler: ((value?: any) => any)) => void
}
export type ClonableAppSettings = Omit<
    AppSettings,
    "_CLONABLE" |
    "addPropertyUpdateHandler" |
    "getFieldValue" |
    "registerModule" |
    "removeAllPropertyUpdateHandlers" |
    "removeAllPropertyUpdateHandlersFor" |
    "removePropertyUpdateHandler"
>
export type BaseModuleSettings = {
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
export type ClonableModuleSettings = { [key: string]: unknown }
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
        bottom?: PlotLineStyles
        left?: PlotLineStyles
        right?: PlotLineStyles
        top?: PlotLineStyles
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
    majorGrid: PlotLineStyles
    minorGrid: PlotLineStyles
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
// Method config properties.
export type ConfigBiosignalSetup = {
    channels: BiosignalChannelTemplate[]
    label: string
    skipConfig?: boolean
}
export type ConfigChannelFilter  = {
    exclude?: number[]
    include?: number[]
}
export type ConfigDatasetLoader = {
    name?: string
}
export type ConfigMapChannels = {
    channels: SetupChannel[]
    channelSpacing: number
    groupSpacing: number
    isRaw: boolean
    layout: number[]
    names: string[]
    yPadding: number
}
export type ConfigStudyContext = {
    name?: string
}
export type ConfigStudyLoader = {
    collections?: { [key: string]: StudyCollection }
    loader?: string
    name?: string
    scope?: string
    studies?: { [key: string]: unknown }
    type?: string
}
// Plot
export type PlotCircleStyles = {
    color: SettingsColor
    dasharray?: number[]
    radius: number
    show?: boolean
    style: string
    width: number
}
export type PlotLineStyles = {
    color: SettingsColor
    dasharray?: number[]
    show?: boolean
    style: string
    width: number
}
/**
 * Color with values for [`red`, `green`, `blue`, `alpha`] as fraction of 1.
 */
export type SettingsColor = [number, number, number, number]
export type SettingsValue = SettingsColor | boolean | number | string | undefined
export type SettingsValueConstructor = BooleanConstructor | NumberConstructor | StringConstructor
