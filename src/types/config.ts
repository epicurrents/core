/**
 * Config types.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { PropertyChangeHandler } from './application'
import {
    BiosignalAnnotation,
    BiosignalChannelDerivationTemplate,
    BiosignalChannelTemplate,
    BiosignalFilterType,
    SetupChannel,
} from './biosignal'
import { StudyContextCollection } from './study'

/**
 * Core settings, expandable with modules.
 */
export interface AppSettings {
    _CLONABLE: ClonableAppSettings
    app: BaseModuleSettings & {
        /**
         * Maximum number of bytes to load in one chunk. This will be rounded down to the nearest whole data record
         * size - 1 (because one data record may be added for signal interpolation).
         * If the size of a single data record is larger than dataChunkSize, the value will be rounded up to match one
         * data record.
         */
        dataChunkSize: number
        /** Messages ≥ this level will be logged. */
        logThreshold: "DEBUG" | "INFO" | "WARN" | "ERROR" | "DISABLE"
        /** Load files of this size directly. */
        maxDirectLoadSize: number
        /**
         * Maximum amount of raw signal data to cache in bytes.
         * Signal data type conversion must be taken into account, so if
         * data is, for excample, loaded as 16 bit EDF and cached as 32 bit
         * float array, only half this amount of EDF signal data can be loaded.
         */
        maxLoadCacheSize: number
    }
    interface: unknown
    /**
     * Settings for registered app modules.
     */
    modules: { [name: string]: BaseModuleSettings }
    /**
     * List of available services and should they be initialized or not.
     */
    services: {
        /**
         * ONNX machine learning model service.
         * NOTE: Since there is no single all-encompassing ONNX service, setting this to true has no effect (yet).
         */
        onnx: boolean
        /** Pyodide Python interpreter service. */
        pyodide: boolean
    },
    /**
     * Add a new update handler for the settings `field`.
     * @param field - Name of the field to watch. Direct updates this this field and any of its children trigger the handler.
     * @param handler - Handler method for the update.
     * @param caller - Optional unique caller name (for bulk removals).
     * @example
     * // Setup
     * addPropertyUpdateHandler('high.level.field', handler, 'caller')
     * // Update scenarios
     * onPropertyUpdate('high.level.field') // Triggers handler (field updated).
     * onPropertyUpdate('high.level.field.grand.child') // Triggers handler (child field updated).
     * onPropertyUpdate('high.level') // Does not trigger update.
     */
    addPropertyUpdateHandler (field: string, handler: PropertyChangeHandler, caller?: string): void
    /**
     * Get the value stored at the given settings `field`.
     * @param field - Name of the settings field.
     * @param depth - Optional settings field depth. Positive values function as an index to the "field array"
     *                and negative values as an offset to the depth.
     * @example
     * getFieldValue('settings.field.somewhere.deep') // Returns the value of the property 'deep'.
     * getFieldValue('settings.field.somewhere.deep', 1) // Returns the value of 'field' ('settings' being index 0).
     * getFieldValue('settings.field.somewhere.deep', -1) // Returns the value of 'somewhere' (-1 offset from 'deep').
     */
    getFieldValue (field: string, depth?: number): SettingsValue
    /**
     * Signal that a settings property has updated, executing any handlers watching it or its parents.
     * @param field - Name of the updated field.
     * @param newValue - New value set to the field (optional).
     * @param oldValue - Previous value of the field (optional).
     */
    onPropertyUpdate (field: string, newValue?: SettingsValue, oldValue?: SettingsValue): void
    /**
     * Register a module's settings to the main settings object.
     * @param name - Unique name for the module.
     * @param moduleSettings - Settings for the module.
     */
    registerModule (name: string, moduleSettings: BaseModuleSettings): void
    /**
     * Remove all registered property update handlers.
     */
    removeAllPropertyUpdateHandlers (): void
    /**
     * Remove all property update handlers registered to the given `caller`.
     * @param caller - Unique name of the caller.
     */
    removeAllPropertyUpdateHandlersFor (caller: string): void
    /**
     * Remove the given `handler` from the given `field`'s watchers.
     * @param field - Name of the settings field. Applies to handlers watching this field and any of its children.
     * @param handler - The handler to remove.
     * @example
     * // Setup
     * addPropertyUpdateHandler('high.level.field', handler)
     * // Removal scenarios
     * removePropertyUpdateHandler('high.level.field', handler) // Handler is removed (field match).
     * removePropertyUpdateHandler('high.level', handler) // Handler is removed (parent field match).
     * removePropertyUpdateHandler('high.level.field.grand.child', handler) // Not removed (child field match).
     */
    removePropertyUpdateHandler (field: string, handler: PropertyChangeHandler): void
    /**
     * Set a new `value` the the given settings `field`.
     * @param field - Name of the settings field.
     * @param value - New value for the field.
     * @returns true if a field value was changed, false otherwise.
     */
    setFieldValue (field: string, value: SettingsValue): boolean
    /**
     * Unregister a module's settings from the main settings object.
     * @param name - Unique name of the module.
     */
    unregisterModule (name: string): void
}
/**
 * Common settings for all modules.
 */
export type BaseModuleSettings = {
    /**
     * All the properties (settings) in this module that can be  modified by the user and saved locally.
     * Key is the name of the setting and value is the constructor of the allowed value type.
     */
    _userDefinable?: { [field: string]: SettingsValueConstructor }
    /** Should a centralized manager be used to control memory available to resources. */
    useMemoryManager: boolean
}
/**
 * Core app settings with the non-serializable properties removed.
 */
export type ClonableAppSettings = Pick<AppSettings, "app" | "modules">
export type ClonableModuleSettings = {
    [key: string]: unknown
    useMemoryManager: boolean
}
/**
 * Settings common to all biosignal type resources.
 */
export type CommonBiosignalSettings = {
    annotations: {
        convertPatterns: [string, BiosignalAnnotation][]
        ignorePatterns: string[]
    }
    /** Show channels that tha have been marked hidden on the EEG trace. */
    showHiddenChannels: boolean
    /** Show channels that are missing from the source file on the EEG trace. */
    showMissingChannels: boolean
    /** Should the resource be automatically unloaded from memory when it is closed. */
    unloadOnClose: boolean
    /////////////////////
    // Filter settings //
    /////////////////////
    /** Default filters to apply to new biosignal recordings. */
    defaultFilters?: {
        /** Default highpass filter frequency in Hz (0 to disable). */
        highpass: number
        /** Default lowpass filter frequency in Hz (0 to disable). */
        lowpass: number
        /** Default notch filter frequency in Hz (0 to disable). */
        notch: number
    }
    /**
     * Channel types and the associated default filter types that should be applied to this channel.
     * @example
     * { eeg: ['highpass', 'lowpass', 'notch'] }
     */
    filterChannelTypes?: {
        [type: string]: BiosignalFilterType[]
    }
    /**
     * The amount of padding is always a compromise between overhead from the extra signal data that needs to be
     * processed and possible artefacts introduced by filtering; the slower and larger amplitude the waves,
     * the more padding is needed to avoid significant artefacts. Use this amount of signal data (in seconds) as
     * padding at both ends.
     */
    filterPaddingSeconds?: number
    /////////////////////////
    // Setups and montages //
    /////////////////////////
    /** Default montages for different setups. */
    defaultMontages?: { [setup: string]: [string, string][] }
    defaultSetups?: string[]
    /** How many montages to precache. */
    precacheMontages?: number
}
export type ConfigBiosignalMontage = {
    /** Descriptive name for this montage (overrides possible default name). */
    label?: string
    /** Name of a override worker to use for ontage processing. */
    overrideWorker?: string
    /** Skip setups in parent classes (setup must be performed in the final extending class). */
    skipSetup?: true
}
// Method config properties.
export type ConfigBiosignalSetup = {
    /** Channel templates for raw channel properties. */
    channels: BiosignalChannelTemplate[]
    /** Channel derivations that are precalculated and stored as source signals. */
    derivations?: BiosignalChannelDerivationTemplate[]
    /** Descriptive label for this montage. */
    label: string
    /** Unique name used for matching this setup. */
    name: string
}
export type ConfigChannelFilter  = {
    exclude?: number[]
    include?: number[]
}
/**
 * Properties to define a biosignal recording's channel layout.
 */
export type ConfigChannelLayout = {
    /** Relative space between two channels within a group. */
    channelSpacing?: number
    /** Relative space between two channel groups. */
    groupSpacing?: number
    /** Use raw montage layout (all channels evenly spaced). */
    isRaw?: boolean
    /** Array defining the number of channels within each channel group. */
    layout?: number[]
    /** Relative padding between the first/last channel and the top/bottom of the trace display. */
    yPadding?: number
}
export type ConfigDatasetLoader = {
    name?: string
}
export type ConfigMapChannels = {
    channels: SetupChannel[]
    channelSpacing: number
    electrodes: string[]
    groupSpacing: number
    isRaw: boolean
    layout: number[]
    yPadding: number
}
export type ConfigReleaseBuffers = {
    /** Should the reserved buffer ranges be removed from the memory manager as well. */
    removeFromManager: boolean
}
export type ConfigSchema = {
    /** Context that identifies the resource type that this config schema describes. */
    context: string
    fields: ConfigSchemaField[]
    /** Unique name for this schema. Is used to match nested schema objects. */
    name: string
    type: 'epicurrents_configuration'
    /**
     * Version number of the schema (dot-delimited).
     * Full digits are used for major changes, decimal digits for minor changes.
     * Schemas are backwards compatible within the same major version.
     */
    version: string
}
export type ConfigSchemaField = {
    /** Name of the field. It must match the name of the setter in the target resource. */
    name: string
    /** Type of the field. */
    type: 'array' | 'boolean' | 'date' | 'number' | 'object' | 'schema' | 'string'
    /**
     * Name of the schema context that this field describes.
     * Only applies to fields of type 'schema'.
     */
    context?: string
    /**
     * Fields for a nested config schema.
     * Only applies to fields of type 'schema'.
     */
    fields?: ConfigSchemaField[]
    nullable?: boolean
    required?: boolean
}
export type ConfigStudyContext = {
    name?: string
}
export type ConfigStudyLoader = UrlAccessOptions & {
    collections?: { [key: string]: StudyContextCollection }
    loader?: string
    modality?: string
    name?: string
    studies?: { [key: string]: unknown }
}
export type ResourceConfig = Record<string, unknown>
/**
 * Color with values for [`red`, `green`, `blue`, `alpha`] as fraction of 1.
 */
export type SettingsColor = [number, number, number, number]
export type SettingsCircle = {
    color: SettingsColor
    dasharray?: number[]
    radius: number
    show?: boolean
    style: string
    width: number
}
export type SettingsLine = {
    color: SettingsColor
    dasharray?: number[]
    show?: boolean
    style: string
    width: number
}
export type SettingsValue = SettingsColor | boolean | number | string | undefined
export type SettingsValueConstructor = BooleanConstructor | NumberConstructor | StringConstructor
/**
 * Options for accessing URL resources.
 */
export type UrlAccessOptions = {
    /** Authorization header value to include in the request. */
    authHeader?: string
}
