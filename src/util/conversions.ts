/**
 * Value conversion utilities.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { deepClone, safeObjectFrom } from './general'
import type {
    DatabaseQueryOptions,
    DeepReadonly,
    SettingsColor,
    StudyContext,
} from '#types'

/**
 * Convert a cameCase name into kebab-case.
 * @param name - Name (of the property or variable).
 * @returns Name of kebab-case.
 */
export const camelCaseToKebabCase = (name: string): string => {
    const kebabCase = name.replace(
        /((?<!^)((?<=[a-z\d])[A-Z]|(?<=[A-Z\d])[A-Z](?=[a-z])|(1st|2nd|3rd|\d+(th)?)))/g,
        '-$1'
    ).toLowerCase()
    return kebabCase
}

/**
 * Convert the given hex color string to settings color array.
 * @param rgba - Hex string in the form of `#[rgb|rgba|rrggbb|rrggbbaa]`.
 * @returns SettingsColor presentation of the color or null.
 */
 export const hexToSettingsColor = (rgba: string): SettingsColor | null => {
    const color = rgba.match(/#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f]?)([0-9a-f]?)([0-9a-f]?)([0-9a-f]?)([0-9a-f]?)/i)
    if (color) {
        if (color[8]) {
            // Full 8 character string
            return [
                parseInt(color[1]+color[2], 16)/255,
                parseInt(color[3]+color[4], 16)/255,
                parseInt(color[5]+color[6], 16)/255,
                parseInt(color[7]+color[8], 16)/255
            ]
        } else if (color[7]) {
            // Invalid string
            return null
        } else if (color[6]) {
            // 6 character RRGGBB string
            return [
                parseInt(color[1]+color[2], 16)/255,
                parseInt(color[3]+color[4], 16)/255,
                parseInt(color[5]+color[6], 16)/255,
                1 // Alpha defaults to 1
            ]
        } else if (color[5]) {
            // Invalid string
            return null
        } else if (color[4]) {
            // 4 character RGBA string
            return [
                parseInt(color[1]+color[1], 16)/255,
                parseInt(color[2]+color[2], 16)/255,
                parseInt(color[3]+color[3], 16)/255,
                parseInt(color[4]+color[4], 16)/255
            ]
        }
        // Three character RGB string
        return [
            parseInt(color[1]+color[1], 16)/255,
            parseInt(color[2]+color[2], 16)/255,
            parseInt(color[3]+color[3], 16)/255,
            1 // Alpha defaults to 1
        ]
    }
    return null
}

/**
 * Get the rounded version of the given number, including the last fraction digit only if it is significant (not zero).
 * @param num - The number to round.
 * @param digits - Number of digits to use at most.
 * @returns Rounded fraction, with the last number only if not zero.
 * @remarks
 * This is a simple text space saver method.
 */
export const lastFractOnlyIfSignificant = (num: number, digits: number) => {
    if (digits < 1) {
        return num.toFixed()
    }
    digits = Math.min(digits, 20) // Limitation in toFixed() method
    const fullDigs = num.toFixed(digits)
    if (!fullDigs.endsWith('0')) {
        return fullDigs
    }
    return fullDigs.replace(/\.?0+$/, '')
}

/**
 * Convert the fields in the given StudyContext item or items according to the provided options.
 * @param items - The StudyContext items to convert.
 * @param options - Conversion options.
 * @returns The converted items.
 */
export const modifyStudyContext = (items: unknown, options?: DatabaseQueryOptions): unknown => {
    if (
        (!options?.nameMap || Object.keys(options.nameMap).length === 0) &&
        (!options?.overrideProperties || Object.keys(options.overrideProperties).length === 0)
    ) {
        return items
    }
    const convert = (obj: StudyContext): StudyContext => {
        if (!obj || typeof obj !== 'object') {
            return obj
        }
        const newObj: Partial<StudyContext> = {}
        // Apply name mapping.
        if (options?.nameMap) {
            for (const [key, value] of Object.entries(obj)) {
                newObj[(options.nameMap[key] || key) as keyof StudyContext] = deepClone(value) as never
            }
        }
        // Assign any override properties.
        if (options?.overrideProperties) {
            Object.assign(newObj, deepClone(options.overrideProperties))
        }
        // Convert API URLs.
        if (options.paramMethod === 'inject') {
            if (newObj.api?.url) {
                const urlParts = newObj.api.url.split(/\{(\w+?)\}/g)
                let newUrl = urlParts[0]
                for (let i = 1; i < urlParts.length; i++) {
                    if (i % 2 === 0) {
                        newUrl += urlParts[i]
                    } else {
                        const paramValue = newObj[urlParts[i] as keyof StudyContext]
                        if (paramValue !== undefined && paramValue !== null) {
                            newUrl += encodeURIComponent(String(paramValue))
                        }
                    }
                }
                newObj.api.url = newUrl
            }
            // Convert file URLs.
            if (newObj.files?.length) {
                for (const file of newObj.files) {
                    const urlParts = file.url.split(/\{(\w+?)\}/g)
                    let newUrl = urlParts[0]
                    for (let i=1; i<urlParts.length; i++) {
                        if (i % 2 === 0) {
                            newUrl += urlParts[i]
                        } else {
                            const paramValue = file[urlParts[i] as keyof typeof file]
                            if (paramValue !== undefined && paramValue !== null) {
                                newUrl += encodeURIComponent(String(paramValue))
                            }
                        }
                    }
                    file.url = newUrl
                }
            }
        }
        return newObj as StudyContext
    }
    if (Array.isArray(items)) {
        return items.map(item => convert(item))
    } else if (items && typeof items === 'object') {
        return convert(items as StudyContext)
    }
    return items
}

/**
 * Convert the given object into a read-only version. This will only apply to existing custom properties; inherited
 * properties are not affected and new properties can still be added using Object.assign.
 * @param obj - The object to convert.
 * @returns Read-only version of the object.
 * @remarks
 * - The returned object is also converted into a safe object.
 * - Use `Object.freeze()` for full immutability.
 */
export const objectToReadOnly = <T extends object>(obj: T): DeepReadonly<T> => {
    /**
     * Transform the properties of the given object `obj` to read-only.
     */
    const propertiesToReadOnly = (subObj: object) => {
        const readonlyObj = {} as DeepReadonly<T>
        for (const [key, value] of Object.entries(subObj)) {
            // Only define own properties as read-only.
            if (Object.hasOwn(subObj, key)) {
                Object.defineProperty(readonlyObj, key, {
                    value: value && typeof value === 'object'
                           ? propertiesToReadOnly(value)
                           : value,
                    writable: false,
                })
            }
        }
        return readonlyObj
    }
    return propertiesToReadOnly(safeObjectFrom(obj))
}

/**
 * Pad the start of the given time with zeroes if needed.
 * @param time time to pad
 * @param len total length of the returned string (default 2)
 * @returns string, start padded with zeroes if needed
 */
export const padTime = (time: number, len = 2) => {
    return time.toString().padStart(len, '0')
}

/**
 * Convert the given RGBA color string to settings color array.
 * @param rgba - RGBA string in the form of `rgba(rrr,ggg,bbb,aaa)`.
 * @returns SettingsColor presentation of the color or null.
 */
export const rgbaToSettingsColor = (rgba: string): SettingsColor | null => {
    const color = rgba.replaceAll(/\s+/g, '').match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/i)
    if (color) {
        return [
            parseInt(color[1])/255,
            parseInt(color[2])/255,
            parseInt(color[3])/255,
            parseFloat(color[4])
        ]
    }
    return null
}

/**
 * Round a number to given `precision`.
 * @param value - The value to round.
 * @param precision - Precision in decimal values.
 * @returns Rounded value.
 */
export const roundTo = (value: number, precision: number) => {
    return Math.round(value*(10**precision))/(10**precision)
}

/**
 * Convert seconds into a more human-readable time string.
 * @param secs - Number of seconds to convert.
 * @param components - Only return the components as an array of numbers `[days, hrs, mins, secs]` (default false).
 * @returns
 * * `{d} d {h} hr {m} min {s} s` if time is 24 hours or more
 * * `{h} hr {m} min {s} s` if time is 1 hour or more
 * * `{m} min {s} s` if time is 60 seconds or more
 * * `{s} seconds` if time is less than 60 seconds
 */
export const secondsToTimeString = (secs: number, components: boolean = false) => {
    if (secs < 60) {
        return components ? [0, 0, 0, secs] : `${lastFractOnlyIfSignificant(secs, 1)} seconds`
    }
    const days = Math.floor(secs/86400)
    const hours = Math.floor((secs%86400)/3600)
    const mins = Math.floor((secs%3600)/60)
    secs = secs%60
    if (components) {
        return [days, hours, mins, secs]
    }
    const sPart = secs >= 1 ? `${Math.floor(secs).toString()} s` : ''
    const mPart = mins ? `${mins} min` : ''
    const hPart = hours ? `${hours} h` : ''
    if (days) {
        `${days} d ${hPart}`
    } else if (hours) {
        return `${hPart.trim()} ${mPart}`
    }
    return `${mPart.trim()} ${sPart}`
}

/**
 * Turn settings color fraction array into a CSS-compliant hex string.
 * @param color - Rractions of r, g, b and a as an array of numbers.
 * @param opacity - Optional multiplier for the alpha value.
 * @return Color string in the form of `#rrggbbaa` or on error `#00000000`.
 */
export const settingsColorToHexa = (color: [number, number, number, number], opacity?: number) => {
    if (color.length !== 4) {
        return '#00000000'
    }
    for (let param of color) {
        if (param < 0) {
            param = 0
        } else if (param > 1) {
            param = 1
        }
    }
    if (opacity === undefined) {
        opacity = 1
    } else if (opacity < 0 || opacity > 1) {
        opacity = 1
    }
    const [r, g, b, a] = color
    const hexR = toRGB(r).toString(16).padStart(2, '0')
    const hexG = toRGB(g).toString(16).padStart(2, '0')
    const hexB = toRGB(b).toString(16).padStart(2, '0')
    const hexA = toRGB(a*opacity).toString(16).padStart(2, '0')
    return `#${hexR}${hexG}${hexB}${hexA}`
}

/**
 * Turn settings color fraction array into a CSS-compliant rgba string.
 * @param color - Fractions of r, g, b and a as an array of numbers.
 * @param opacity - Optional multiplier for the alpha value.
 * @return Color string in the form of `rgba(r, g, b, a)` or on error `rgba(0,0,0,0)`.
 */
export const settingsColorToRgba = (color: [number, number, number, number], opacity?: number) => {
    if (color.length !== 4) {
        return 'rgba(0,0,0,0)'
    }
    for (let param of color) {
        if (param < 0) {
            param = 0
        } else if (param > 1) {
            param = 1
        }
    }
    if (opacity === undefined) {
        opacity = 1
    } else if (opacity < 0 || opacity > 1) {
        opacity = 1
    }
    const [r, g, b, a] = color
    return `rgba(${toRGB(r)},${toRGB(g)},${toRGB(b)},${toRGB(a*opacity, true)})`
}

/**
 * Convert a settings dash array into an SVG stroke-dasharray string.
 * @param array - Array of numbers or undefined.
 * @returns Stroke-dasharray string.
 */
export const settingsDashArrayToSvgStrokeDasharray = (array: number[] | undefined): string => {
    if (array && array.length === 2) {
        return `${array[0]} ${array[1]}`
    }
    return ''
}

/**
 * Convert an array of time parts into a short time string.
 * @param parts - Time parts as an array of numbers.
 * @returns String in the form of `<days>`:`<hours>`:`<minutes>`:`<seconds>`
 */
export const timePartsToShortString = (parts: number[]) => {
    let anyNonZero = false
    const timeShort = parts.filter(n => {
                                if (!anyNonZero && n > 0) {
                                    anyNonZero = true
                                }
                                return (anyNonZero || n > 0)
                            })
                            .map(n => Math.floor(n).toString().padStart(2, '0'))
                            .join(':')
    // Return a minimum of <mins>:<secs>.
    if (!timeShort) {
        return '00:00'
    } else if (timeShort.length === 2) {
        return `00:${timeShort}`
    } else if (timeShort.length > 8) {
        // Strip possible leading zero.
        return timeShort.startsWith('0') ? timeShort.substring(1) : timeShort
    }
    return timeShort
}
/**
 * Convert a fraction into an RGB value.
 * @param value - The RGB value.
 * @param alpha - Is this an alpha value (default false).
 * @returns An RBG value between 0 and 255 or `alpha` fraction between 0 and 1.
 */
const toRGB = (value: number, alpha = false) => {
    if (value > 1) {
        return (alpha ? 1 : 255)
    } else if (value < 0) {
        return 0
    }
    return alpha ? value : Math.round(255*value)
}
