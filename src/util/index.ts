/**
 * A collection of utility constants and functions to help with maintaining consistency throughout the library
 * and any modules extending it.
 */

import {
    GB_BYTES,
    GIGA,
    INDEX_NOT_ASSIGNED,
    KB_BYTES,
    KILO,
    MB_BYTES,
    MEGA,
    MICRO,
    MILLI,
    NANO,
    NO_MOUSE_BUTTON_DOWN,
    NUMERIC_ERROR_VALUE,
} from './constants'
import {
    hexToSettingsColor,
    lastFractOnlyIfSignificant,
    padTime,
    rgbaToSettingsColor,
    roundTo,
    secondsToTimeString,
    settingsColorToHexa,
    settingsColorToRgba,
    settingsDashArrayToSvgStrokeDasharray,
    timePartsToShortString,
} from './conversions'
import {
    enumerate,
    isEmptyObject,
    getOrSetValue,
    nullPromise,
    safeObjectFrom,
    sleep
} from './general'
import {
    calculateSignalOffsets,
    combineAllSignalParts,
    combineSignalParts,
    concatTypedNumberArrays,
    fftAnalysis,
    filterSignal,
    floatsAreEqual,
    getFilterPadding,
    getIncludedChannels,
    interpolateSignalValues,
    isAnnotationSignal,
    isContinuousSignal,
    mapMontageChannels,
    mapSignalsToSamplingRates,
    partsNotCached,
    resampleSignal,
    shouldDisplayChannel,
    shouldFilterSignal,
} from './signal'
import {
    inlineWorker,
    syncSettings,
    validateCommissionProps,
    type RelayLogMessage,
} from './worker'
export {
    GB_BYTES,
    GIGA,
    INDEX_NOT_ASSIGNED,
    KB_BYTES,
    KILO,
    MB_BYTES,
    MEGA,
    MICRO,
    MILLI,
    NANO,
    NO_MOUSE_BUTTON_DOWN,
    NUMERIC_ERROR_VALUE,
}
export {
    calculateSignalOffsets,
    combineAllSignalParts,
    combineSignalParts,
    concatTypedNumberArrays,
    enumerate,
    fftAnalysis,
    filterSignal,
    floatsAreEqual,
    getFilterPadding,
    getIncludedChannels,
    getOrSetValue,
    hexToSettingsColor,
    inlineWorker,
    interpolateSignalValues,
    isAnnotationSignal,
    isContinuousSignal,
    isEmptyObject,
    lastFractOnlyIfSignificant,
    mapMontageChannels,
    mapSignalsToSamplingRates,
    nullPromise,
    padTime,
    partsNotCached,
    resampleSignal,
    RelayLogMessage,
    rgbaToSettingsColor,
    roundTo,
    safeObjectFrom,
    secondsToTimeString,
    settingsColorToHexa,
    settingsColorToRgba,
    settingsDashArrayToSvgStrokeDasharray,
    shouldDisplayChannel,
    shouldFilterSignal,
    sleep,
    syncSettings,
    timePartsToShortString,
    validateCommissionProps,
}