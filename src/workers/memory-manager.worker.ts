/**
 * Memory manager worker.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type WorkerMessage } from '#types/service'
import IOMutex from 'asymmetric-io-mutex'
import { Log } from 'scoped-ts-log'
import { validateCommissionProps } from '../util'

let BUFFER = null as SharedArrayBuffer | null
let VIEW = null as Int32Array | null

const SCOPE = 'MemoryManagerWorker'
const WAIT_TIMEOUT = 5000

onmessage = async (message: WorkerMessage) => {
    if (!message?.data?.action) {
        return
    }
    const action = message.data.action
    let success = false
    const props = {} as { [key: string]: unknown }
    if (action === 'release-and-rearrange') {
        const data = validateCommissionProps(
            message.data,
            {
                rearrange: 'Array',
                release: 'Array',
            }
        )
        if (!data) {
            return
        }
        const remove = data.release as number[][] || []
        const rearrange = data.rearrange as { id: string, range: number[] }[] || []
        success = removeAndRearrange(remove, rearrange)
        props.result = { rearrange: rearrange }
    } else if (action === 'set-buffer') {
        const data = validateCommissionProps(
            message.data,
            {
                buffer: 'SharedArrayBuffer',
            }
        )
        if (!data) {
            return
        }
        const buffer = data.buffer as SharedArrayBuffer
        if (data.buffer) {
            BUFFER = buffer
            VIEW = new Int32Array(buffer)
            success = true
        } else {
            Log.error('set-buffer did not contain a value for the buffer.', SCOPE)
            props.reason = 'set-buffer did not contain a value for the buffer.'
        }
    }
    postMessage(
        Object.assign(props, {
            action: action,
            success: success,
            rn: message.data.rn
        })
    )
}

/**
 * Remove the given index ranges from buffer and rearrange the remaining elements to fill the empty spaces.
 * This method will update the new index values to `rearrange` member in-place.
 * @param remove - The index ranges to remove.
 * @param rearrange - The elements to rearrange.
 * @returns success (true/false)
 */
const removeAndRearrange = (remove: number[][], rearrange: { id: string, range: number[] }[]): boolean => {
    if (!BUFFER || !VIEW) {
        Log.error('Cannot remove and rearrange buffer when the buffer is not set.', SCOPE)
        return false
    }
    // The master array lock must be zero (off).
    if (Atomics.compareExchange(VIEW, 0, 0, 1) !== 0) {
        Log.error('Encountered a locked master buffer when trying to remove and rearrange.', SCOPE)
        return false
    }
    if (!rearrange.length) {
        Log.error('release-and-rearrange did not contain any elements to rearrange.', SCOPE)
        return false
    }
    // Wait that each of the arrays to rearrange to be unlocked.
    for (const toRetain of rearrange) {
        let keepWaiting = true
        while (keepWaiting) {
            // Lock byte is at the start of the array.
            const prevValue = Atomics.load(VIEW, toRetain.range[0])
            if (prevValue === IOMutex.UNLOCKED_VALUE) {
                keepWaiting = false
                break
            }
            // Else, keep waiting for the lock to release.
            if (Atomics.wait(VIEW, toRetain.range[0], prevValue, WAIT_TIMEOUT) === 'timed-out') {
                Log.error(
                    'Timed out when waiting for a memory buffer to unlock for release-and-rearrange.',
                SCOPE)
                Atomics.exchange(VIEW, 0, 0) // Release lock.
                return false
            }
        }
    }
    // Check for and remove possible empty or invalid ranges.
    for (let i=0; i<remove.length; i++) {
        if (remove[i][0] === remove[i][1] || remove[i][0] > remove[i][1]) {
            Log.warn(
                `Range '${remove[i][0]}-${remove[i][1]}' given to release-and-rearrange was invalid and was ignored.`,
            SCOPE)
            remove.splice(i, 1)
            i--
        }
    }
    // Sort both the ranges to remove and the ranges to rearrange.
    rearrange.sort((a, b) => a.range[0] - b.range[0])
    remove.sort((a, b) => a[0] - b[0])
    // Combine possible consecutive removable ranges.
    for (let i=1; i<remove.length; i++) {
        if (remove[i][0] === remove[i - 1][1]) {
            remove[i][0] = remove[i - 1][0]
            remove.splice(i - 1, 1)
            i--
        }
    }
    // Go through each remove entry.
    let prevRemoves = 0
    for (let i=0; i<remove.length; i++) {
        const toRemove = remove[i]
        const removeRange = toRemove[1] - toRemove[0]
        const nextRemove = remove[i + 1]
        let prevShifts = 0
        for (const toRetain of rearrange) {
            if (
                toRetain.range[0] > toRemove[0] &&
                (
                    nextRemove === undefined ||
                    toRetain.range[0] < nextRemove[0]
                )
            ) {
                // Move the array members down and set new index values.
                VIEW.set(
                    VIEW.subarray(toRetain.range[0], toRetain.range[1]),
                    toRemove[0] - prevRemoves + prevShifts
                )
                toRetain.range[0] -= removeRange
                toRetain.range[1] -= removeRange
                prevShifts += toRetain.range[1] - toRetain.range[0]
            }
        }
        prevRemoves += removeRange
    }
    if (Atomics.compareExchange(VIEW, 0, 1, 0) !== 1) {
        // This is really just here to catch possible bugs in buffer management.
        Log.warn('Master buffer was not in locked state at the end of release-and-rearrange.', SCOPE)
    }
    return true
}
