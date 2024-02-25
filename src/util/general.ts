/**
 * General utilities.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Enumerate over an array, returning [index, item].
 * @param iterable - Any array.
 * @example
 * for (const [i, item] of enumerate(iterableArray)) {
 *      console.log(iterableArray[i] === item) // true
 * }
 */
export const enumerate = function* (iterable: unknown[]) {
    let i = 0
    for (const x of iterable) {
        yield [i, x]
        i++
    }
}

/**
 * Check if the given object is empty, i.e. doesn't have own properties.
 * @param obj - Object to check.
 * @returns True/false.
 */
export const isEmptyObject = (obj: object) => {
    if (
        obj
        && Object.keys(obj).length === 0
        && Object.getPrototypeOf(obj) === Object.prototype
    ) {
        return true
    }
    return false
}

/**
 * Get the value stored at the given `key` in the target Map.
 * If the key does not exist, it will be initiated with the given `value`
 * and a reference to the set value is returned.
 * @param map - The target Map.
 * @param key - Key to look for.
 * @param value - Default value to use as initiator, if the `key` doesn't exist.
 * @returns Map with the given key assigned.
 */
export const getOrSetValue = <T>(
    map: Map<typeof key, typeof value>,
    key: string|number,
    value: T
): T => {
    return map.has(key) ? map.get(key) as T : map.set(key, value).get(key) as T
}

/**
 * A promise that immediately returns the value null.
 */
export const nullPromise: Promise<null> = Promise.resolve(null)

/**
 * Create a safe (from prototype injection) object with the provided properties.
 * @param template - Object with properties to copy.
 * @returns Safe object without a pointer to object __prototype__.
 */
export const safeObjectFrom = (template: object) => {
    return Object.assign(Object.create(null), template)
}

/**
 * Returns a promise that will fulfill after the set amount of time.
 * Can be used to delay the execution of following code.
 * @param duration - Duration to sleep for in milliseconds.
 * @returns Promise that fulfills when the time has elapsed.
 * @example
 * const [item] = await Promise.all([
 *     queryItem(nextItem),
 *     sleep(1000)
 * ])
 */
export const sleep = async (duration: number): Promise<void> => {
    return new Promise<void>(resolve => setTimeout(resolve, duration))
}
