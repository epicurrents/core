/**
 * Memory manager worker.
 * @package    epicurrents/core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type MemoryManagerWorkerCommission, type WorkerMessage } from '#types/service'
import { Log } from 'scoped-event-log'
import { validateCommissionProps } from '../util'
import { BaseWorker } from './base.worker'

const SCOPE = 'MemoryManagerWorker'

export class MemoryManagerWorker extends BaseWorker {
    protected _buffer = null as SharedArrayBuffer | null
    protected _view = null as Int32Array | null

    constructor () {
        super()
        this.extendActionMap([
            ['release-and-rearrange', this.releaseAndRearrange],
            ['set-buffer', this.setBuffer],
        ])
    }
    /**
     * Remove the given index ranges from buffer and rearrange the remaining elements to fill the empty spaces.
     * This method will update the new index values to `rearrange` member in-place.
     * @param remove - The index ranges to remove.
     * @param rearrange - The elements to rearrange.
     * @returns success (true/false)
     */
    _removeAndRearrange (remove: number[][], rearrange: { id: string, range: number[] }[]): boolean {
        if (!this._buffer || !this._view) {
            Log.error('Cannot remove and rearrange buffer when the buffer is not set.', SCOPE)
            return false
        }
        if (!rearrange.length) {
            // Validate before taking the master lock — an early return after the lock is
            // acquired would leave it permanently held.
            Log.error('release-and-rearrange did not contain any elements to rearrange.', SCOPE)
            return false
        }
        // The master array lock must be zero (off).
        if (Atomics.compareExchange(this._view, 0, 0, 1) !== 0) {
            Log.error('Encountered a locked master buffer when trying to remove and rearrange.', SCOPE)
            return false
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
        // Shift every retained range down by the total size of the removed regions before it.
        // Retained ranges are processed in ascending start order, so each leftward copy lands in
        // space that is already vacated (removed, or previously shifted out of), and no source
        // region is clobbered before it has been copied. The shift amount must accumulate over
        // ALL removed regions preceding the range — shifting by only the nearest removed region's
        // size would leave the recorded range diverged from where the bytes were actually copied.
        let removedBefore = 0
        let removeIdx = 0
        for (const toRetain of rearrange) {
            while (removeIdx < remove.length && remove[removeIdx][1] <= toRetain.range[0]) {
                removedBefore += remove[removeIdx][1] - remove[removeIdx][0]
                removeIdx++
            }
            if (removedBefore > 0) {
                this._view.set(
                    this._view.subarray(toRetain.range[0], toRetain.range[1]),
                    toRetain.range[0] - removedBefore
                )
                toRetain.range[0] -= removedBefore
                toRetain.range[1] -= removedBefore
            }
        }
        if (Atomics.compareExchange(this._view, 0, 1, 0) !== 1) {
            // This is really just here to catch possible bugs in buffer management.
            Log.warn('Master buffer was not in locked state at the end of release-and-rearrange.', SCOPE)
        }
        // Wake any thread parked in `Atomics.wait` on the master lock — without the notify a
        // waiter sleeps its full timeout even though the lock cleared immediately.
        Atomics.notify(this._view, 0)
        return true
    }
    async releaseAndRearrange (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MemoryManagerWorkerCommission['release-and-rearrange'],
            {
                rearrange: 'Array',
                release: 'Array',
            }
        )
        if (!data) {
            return this._failure(msgData)
        }
        if (this._removeAndRearrange(data.release, data.rearrange)) {
            return this._success(msgData, { result: { rearrange: data.rearrange } })
        } else {
            return this._failure(msgData, `Remove and rearrange action failed.`)
        }
    }
    async setBuffer (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as MemoryManagerWorkerCommission['set-buffer'],
            {
                buffer: 'SharedArrayBuffer',
            }
        )
        if (!data) {
            return this._failure(msgData)
        }
        const buffer = data.buffer as SharedArrayBuffer
        if (data.buffer) {
            this._buffer = buffer
            this._view = new Int32Array(buffer)
            return this._success(msgData)
        } else {
            return this._failure(msgData, `Commission 'set-buffer' did not contain a value for the buffer.`)
        }
    }
}

const MEMORY_MANAGER = new MemoryManagerWorker()

onmessage = async (message: WorkerMessage) => {
    MEMORY_MANAGER.handleMessage(message)
}
