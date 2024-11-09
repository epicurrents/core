import {
    camelCaseToKebabCase,
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
} from '../../src/util/conversions'

describe('Unit conversion utilities', () => {
    describe('camelCaseToKebabCase', () => {
        // Expected functionality (happy paths).
        it('should convert simple camelCase to kebab-case', () => {
            expect(camelCaseToKebabCase('camelCase')).toBe('camel-case')
            expect(camelCaseToKebabCase('thisIsATest')).toBe('this-is-a-test')
        })

        it('should handle consecutive uppercase letters correctly', () => {
            expect(camelCaseToKebabCase('RGB')).toBe('rgb')
            expect(camelCaseToKebabCase('RGBColor')).toBe('rgb-color')
        })

        it('should handle numbers correctly', () => {
            expect(camelCaseToKebabCase('hex2RGB')).toBe('hex-2-rgb')
            expect(camelCaseToKebabCase('ISO9001Regulation')).toBe('iso-9001-regulation')
            expect(camelCaseToKebabCase('1stOrdinal')).toBe('1st-ordinal')
            expect(camelCaseToKebabCase('the11thHour')).toBe('the-11th-hour')
            expect(camelCaseToKebabCase('number1Station')).toBe('number-1-station')
            expect(camelCaseToKebabCase('version2')).toBe('version-2')
        })
    })

    describe('hexToSettingsColor', () => {
        it('should convert 8-character hex colors', () => {
            expect(hexToSettingsColor('#FF0000FF')).toEqual([1, 0, 0, 1])
            expect(hexToSettingsColor('#00FF0080')).toEqual([0, 1, 0, 0.5019607843137255])
        })

        it('should convert 6-character hex colors', () => {
            expect(hexToSettingsColor('#FF0000')).toEqual([1, 0, 0, 1])
            expect(hexToSettingsColor('#00FF00')).toEqual([0, 1, 0, 1])
        })

        it('should convert 4-character hex colors', () => {
            expect(hexToSettingsColor('#F00F')).toEqual([1, 0, 0, 1])
            expect(hexToSettingsColor('#0F08')).toEqual([0, 1, 0, 0.5333333333333333])
        })

        it('should convert 3-character hex colors', () => {
            expect(hexToSettingsColor('#F00')).toEqual([1, 0, 0, 1])
            expect(hexToSettingsColor('#0F0')).toEqual([0, 1, 0, 1])
        })

        it('should return null for invalid hex colors', () => {
            expect(hexToSettingsColor('#FF000')).toBeNull()
            expect(hexToSettingsColor('#FF00000')).toBeNull()
            expect(hexToSettingsColor('invalid')).toBeNull()
        })
    })

    describe('lastFractOnlyIfSignificant', () => {
        it('should handle zero digits correctly', () => {
            expect(lastFractOnlyIfSignificant(3.14159, 0)).toBe('3')
        })

        it('should include significant digits', () => {
            expect(lastFractOnlyIfSignificant(3.14159, 2)).toBe('3.14')
            expect(lastFractOnlyIfSignificant(3.10000, 2)).toBe('3.1')
        })

        it('should not return superfluous zeroes', () => {
            expect(lastFractOnlyIfSignificant(3.14159, 10)).toBe('3.14159')
        })
    })

    describe('padTime', () => {
        it('should pad single digits with default length', () => {
            expect(padTime(5)).toBe('05')
            expect(padTime(0)).toBe('00')
        })

        it('should handle custom lengths', () => {
            expect(padTime(5, 3)).toBe('005')
            expect(padTime(42, 4)).toBe('0042')
        })

        it('should not pad numbers that meet length requirement', () => {
            expect(padTime(42)).toBe('42')
            expect(padTime(123, 3)).toBe('123')
        })
    })

    describe('rgbaToSettingsColor', () => {
        it('should convert valid rgba strings', () => {
            expect(rgbaToSettingsColor('rgba(255,0,0,1)')).toEqual([1, 0, 0, 1])
            expect(rgbaToSettingsColor('rgba(0,255,0,0.5)')).toEqual([0, 1, 0, 0.5])
        })

        it('should handle whitespace', () => {
            expect(rgbaToSettingsColor('rgba(255, 0, 0, 1)')).toEqual([1, 0, 0, 1])
            expect(rgbaToSettingsColor('rgba( 255 , 0 , 0 , 1 )')).toEqual([1, 0, 0, 1])
        })

        it('should return null for invalid formats', () => {
            expect(rgbaToSettingsColor('rgb(255,0,0)')).toBeNull()
            expect(rgbaToSettingsColor('invalid')).toBeNull()
        })
    })

    describe('roundTo', () => {
        it('should round to specified precision', () => {
            expect(roundTo(3.14159, 2)).toBe(3.14)
            expect(roundTo(3.14159, 3)).toBe(3.142)
        })

        it('should handle zero precision', () => {
            expect(roundTo(3.14159, 0)).toBe(3)
        })
    })

    describe('secondsToTimeString', () => {
        it('should format seconds only', () => {
            expect(secondsToTimeString(45)).toBe('45 seconds')
            expect(secondsToTimeString(45.5)).toBe('45.5 seconds')
        })

        it('should format minutes and seconds', () => {
            expect(secondsToTimeString(125)).toBe('2 min 5 s')
        })

        it('should format hours, minutes, and seconds', () => {
            expect(secondsToTimeString(3725)).toBe('1 h 2 min')
        })

        it('should return components when requested', () => {
            expect(secondsToTimeString(3725, true)).toEqual([0, 1, 2, 5])
        })
    })

    describe('settingsColorToHexa', () => {
        it('should convert valid settings colors to hex', () => {
            expect(settingsColorToHexa([1, 0, 0, 1])).toBe('#ff0000ff')
            expect(settingsColorToHexa([0, 1, 0, 0.5])).toBe('#00ff0080')
        })

        it('should handle opacity multiplier', () => {
            expect(settingsColorToHexa([1, 0, 0, 1], 0.5)).toBe('#ff000080')
        })

        it('should clamp values to valid range', () => {
            expect(settingsColorToHexa([1.5, -0.5, 2, 1.5])).toBe('#ff00ffff')
        })

        it('should return error color for invalid input', () => {
            expect(settingsColorToHexa([1, 0, 0] as unknown as [number, number, number, number])).toBe('#00000000')
        })
    })

    describe('settingsColorToRgba', () => {
        it('should convert valid settings colors to rgba', () => {
            expect(settingsColorToRgba([1, 0, 0, 1])).toBe('rgba(255,0,0,1)')
            expect(settingsColorToRgba([0, 1, 0, 0.5])).toBe('rgba(0,255,0,0.5)')
        })

        it('should handle opacity multiplier', () => {
            expect(settingsColorToRgba([1, 0, 0, 1], 0.5)).toBe('rgba(255,0,0,0.5)')
        })

        it('should clamp values to valid range', () => {
            expect(settingsColorToRgba([1.5, -0.5, 2, 1.5])).toBe('rgba(255,0,255,1)')
        })

        it('should return error color for invalid input', () => {
            expect(settingsColorToRgba([1, 0, 0] as unknown as [number, number, number, number])).toBe('rgba(0,0,0,0)')
        })
    })

    describe('settingsDashArrayToSvgStrokeDasharray', () => {
        it('should convert valid dash arrays', () => {
            expect(settingsDashArrayToSvgStrokeDasharray([5, 2])).toBe('5 2')
        })

        it('should handle undefined input', () => {
            expect(settingsDashArrayToSvgStrokeDasharray(undefined)).toBe('')
        })

        it('should handle invalid array lengths', () => {
            expect(settingsDashArrayToSvgStrokeDasharray([5])).toBe('')
            expect(settingsDashArrayToSvgStrokeDasharray([5, 2, 1])).toBe('')
        })
    })

    describe('timePartsToShortString', () => {
        it('should format time parts correctly', () => {
            expect(timePartsToShortString([0, 1, 30, 45])).toBe('01:30:45')
            expect(timePartsToShortString([0, 0, 5, 45])).toBe('05:45')
        })

        it('should handle empty or zero parts', () => {
            expect(timePartsToShortString([])).toBe('00:00')
            expect(timePartsToShortString([0, 0, 0, 0])).toBe('00:00')
        })

        it('should handle single digit times', () => {
            expect(timePartsToShortString([0, 0, 5, 5])).toBe('05:05')
        })

        it('should strip leading zero for large times', () => {
            expect(timePartsToShortString([1, 2, 3, 4])).toBe('1:02:03:04')
        })
    })
})