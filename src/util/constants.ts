/**
 * App constants.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

// 32 bit range
/** 10^-9 = one billionth part. */
export const NANO = 0.000_000_001
/** 10^-6 = one millionth part. */
export const MICRO = 0.000_001
/** 10^-3 = one thousandth part. */
export const MILLI = 0.001
/** 10^3 = one thousand. */
export const KILO = 1000
/** 10^6 = one million. */
export const MEGA = 1_000_000
/** 10^9 = one billion. */
export const GIGA = 1_000_000_000

/** Number of bytes in one kibibyte. */
export const KB_BYTES = 1024
/** Number of bytes in one mibibyte. */
export const MB_BYTES = 1024*1024
/** Number of bytes in one gibibyte. */
export const GB_BYTES = 1024*1024*1024

/**
 * Numeric value to return when an error occurred.
 */
export const NUMERIC_ERROR_VALUE = -1

/**
 * Value indicating that any item in the array is not active.
 */
export const NO_ARRAY_ITEM_ACTIVE = -1

/**
 * Value indicating that no mouse button is pressed at the moment.
 */
export const NO_MOUSE_BUTTON_DOWN = -1
