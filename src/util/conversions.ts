/**
 * Value conversion utilities.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type SettingsColor } from "TYPES/config"

/**
 * Convert the given hex color string to settings color array.
 * @param rgba - Hex string in the form of `#[rgb|rgba|rrggbb|rrggbbaa]`.
 * @returns SettingsColor presentation of the color or null.
 */
 export const hexToSettingsColor = (rgba: string): SettingsColor | null => {
    const color = rgba.match(/#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f]?)([0-9a-f]?)([0-9a-f]?)([0-9a-f]?)([0-9a-f]?)/)
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
 * Get the rounded version of the given number, including the last
 * fraction digit only if it is significant (not zero).
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
    return num.toFixed(digits - 1)
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
    const color = rgba.match(/rgba\((\d+),(\d+),(\d+),(\d+)\)/)
    if (color) {
        return [
            parseInt(color[1])/255,
            parseInt(color[2])/255,
            parseInt(color[3])/255,
            parseInt(color[4])/255
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
    return Math.round(value*(10**precision)/(10**precision))
}

/**
 * Convert seconds into a more human-readable time string.
 * @param secs - Number of seconds to convert.
 * @param components - Only return the components as an array of numbers (default false).
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
    const sPart = secs.toFixed() !== '0' ? ` ${secs.toFixed()} s` : ''
    const mPart = mins ? ` ${mins} min ` : ''
    const hPart = hours ? ` ${hours} h ` : ''
    if (days) {
        `${days} d${hPart}`
    } else if (hours) {
        return `${hPart.trim()}${mPart}`
    }
    return `${mPart.trim()}${sPart}`
}

/**
 * Turn settings color fraction array into a CSS-compliant rgba string.
 * @param color - Rractions of r, g, b and a as an array of numbers.
 * @param opacity - Optional multiplier for the alpha value.
 * @return Color string in the form of `rgba(r, g, b, a)` or on error `rgba(0,0,0,0)`.
 */
export const settingsColorToHex8 = (color: [number, number, number, number], opacity?: number) => {
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
    const hexR = Math.floor(r*255).toString(16).padStart(2, '0')
    const hexG = Math.floor(g*255).toString(16).padStart(2, '0')
    const hexB = Math.floor(b*255).toString(16).padStart(2, '0')
    const hexA = (a*opacity*255).toString(16).padStart(2, '0')
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
    return `rgba(${Math.floor(r*255)},${Math.floor(g*255)},${Math.floor(b*255)},${a*opacity})`
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
                            .map(n => n.toFixed().padStart(2, '0'))
                            .join(':')
    // Strip possible leading zero
    if (timeShort.length === 2) {
        return `00:${timeShort}`
    } else if (timeShort.length > 6) {
        return timeShort.startsWith('0') ? timeShort.substring(1) : timeShort
    }
    return timeShort
}
