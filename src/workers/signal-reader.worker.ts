/**
 * Shared worker half of a signal reader. Registers the commissions every {@link GenericSignalReader}
 * answers the same way, leaving a format's own worker to add `setup-worker` — the one commission
 * where the formats genuinely differ, because that is where the file is opened.
 *
 * The vocabulary is a contract with `GenericBiosignalService`, not a menu. A commission the worker
 * has no handler for is answered by nothing at all, and the service is left holding a promise that
 * can no longer settle, so the caller waits forever with no error raised anywhere. Registering the
 * set in one place is what keeps a reader package from acquiring that failure by omission;
 * {@link BaseWorker.handleMessage} answering an unregistered action with an explicit failure is
 * what keeps the omission visible if it happens anyway.
 *
 * None of these handlers decide between the cache and the file. `getSignals` and `requestSignals`
 * on the reader compare the request against what the cache holds and decode only what it does not
 * cover, so a commission is a cache read that falls back to the source, and the worker is simply
 * where that read has to happen: the cache is guarded by a mutex whose contended path blocks on
 * `Atomics.wait`, which throws off a worker thread.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericSignalReader from '#assets/reader/GenericSignalReader'
import SETTINGS from '#config/Settings'
import type { BiosignalCacheDerivationSlot } from '#types/biosignal'
import type { ConfigChannelFilter } from '#types/config'
import type { SignalRequest, WorkerMessage } from '#types/service'
import { validateCommissionProps } from '#util'
import { Log } from 'scoped-event-log'
import { BaseWorker } from './base.worker'

const SCOPE = 'SignalReaderWorker'

export abstract class SignalReaderWorker<T extends GenericSignalReader = GenericSignalReader>
    extends BaseWorker
{
    protected _actionMap = new Map<string, (message: WorkerMessage['data']) => Promise<boolean>>([
        ['cache-signals', this.cacheSignals],
        ['get-signals', this.getSignals],
        ['release-cache', this.releaseCache],
        ['release-signal-arrays', this.releaseSignalArrays],
        ['request-signals', this.requestSignals],
        ['reset-network', this.resetNetwork],
        ['set-buffer-range', this.setBufferRange],
        ['set-interruptions', this.setInterruptions],
        ['set-signal-polarity', this.setSignalPolarity],
        ['setup-cache', this.setupCache],
        ['shutdown', this.shutdown],
        ['update-settings', this.updateSettings],
    ])
    /** The reader this worker drives. */
    protected _reader: T

    /**
     * @param reader - Reader to serve commissions from. A subclass registers `setup-worker` against
     *                 the same instance, since only it knows how the format's study is opened.
     */
    constructor (reader: T) {
        super()
        this._reader = reader
    }

    protected _getBufferRangeTarget () {
        return this._reader
    }

    /**
     * Extra response fields to accompany a `get-signals` reply.
     *
     * Empty by default. A format that discovers annotations or interruptions while decoding rather
     * than knowing them up front reports the ones falling in the range here, which is the route the
     * service expects them to arrive by.
     * @param _range - Range the signals were read for, in seconds of recording time.
     */
    protected _signalResponseExtras (_range: number[]): { [prop: string]: unknown } {
        return {}
    }

    /**
     * Fill the cache from the study, reporting progress through the reader's update callback.
     * @param msgData - Data property from the message to the worker.
     */
    async cacheSignals (msgData: WorkerMessage['data']) {
        const requested = (msgData as { startFrom?: unknown })?.startFrom
        const startFrom = typeof requested === 'number' ? requested : 0
        try {
            const complete = await this._reader.cacheSignals(startFrom)
            return this._success(msgData, { complete })
        } catch (e: unknown) {
            // An abort, a decode failure and a cache insertion failure all have to settle the
            // commission; the caller has nothing else to wait on.
            Log.error(`Caching signals failed: ${(e as Error).message}.`, SCOPE, e as Error)
            return this._failure(msgData, `Caching signals failed: ${(e as Error).message}.`)
        }
    }

    /**
     * Serve a range of signals, decoding only what the cache does not already hold.
     * @param msgData - Data property from the message to the worker.
     */
    async getSignals (msgData: WorkerMessage['data']) {
        if (!this._reader.cacheReady) {
            return this._failure(msgData, `Cannot return signals if signal cache is not yet initialized.`)
        }
        const data = validateCommissionProps(
            msgData as WorkerMessage['data'] & { config?: ConfigChannelFilter, range: number[] },
            {
                config: 'Object?',
                range: ['Number', 'Number'],
            }
        )
        if (!data) {
            return false
        }
        try {
            const sigs = await this._reader.getSignals(data.range, data.config)
            if (!sigs) {
                return this._failure(msgData, `Reader did not return any signals.`)
            }
            return this._success(msgData, {
                range: data.range,
                ...sigs,
                ...this._signalResponseExtras(data.range),
            })
        } catch (e: unknown) {
            return this._failure(msgData, (e as Error).message)
        }
    }

    /**
     * Release the cache and the reader's views of it.
     * @param msgData - Data property from the message to the worker.
     */
    async releaseCache (msgData: WorkerMessage['data']) {
        await this._reader.releaseCache()
        return this._success(msgData)
    }

    /**
     * Drop the signal-array views but keep the cache layout, so re-activation can rebind the
     * existing shell instead of allocating a new one.
     * @param msgData - Data property from the message to the worker.
     */
    async releaseSignalArrays (msgData: WorkerMessage['data']) {
        await this._reader.releaseSignalArrays()
        return this._success(msgData)
    }

    /**
     * Serve a range through the view-anchored request protocol, positioning the rolling window over
     * the requested range first where one is in use.
     *
     * A promise cannot cross `postMessage`, so a request that is not yet terminal is answered twice:
     * the non-terminal state with `final: false`, then the terminal state under the same request
     * number once it settles. A request that is terminal on arrival is answered once.
     * @param msgData - Data property from the message to the worker.
     */
    async requestSignals (msgData: WorkerMessage['data']) {
        if (!this._reader.cacheReady) {
            return this._failure(msgData, `Cannot return signals if signal cache is not yet initialized.`)
        }
        const data = validateCommissionProps(
            msgData as WorkerMessage['data'] & {
                config?: ConfigChannelFilter
                range: number[]
                stream?: string
            },
            {
                config: 'Object?',
                range: ['Number', 'Number'],
                stream: 'String?',
            }
        )
        if (!data) {
            return false
        }
        const postStage = (result: SignalRequest, final: boolean) => {
            const part = 'part' in result ? result.part : null
            postMessage({
                rn: msgData.rn,
                action: msgData.action,
                success: true,
                status: result.status,
                final: final,
                ...(part ? { start: part.start, end: part.end, signals: part.signals } : {}),
                ...(result.status === 'error' ? { reason: result.reason } : {}),
            })
        }
        try {
            const request = await this._reader.requestSignals(data.range, data.config, data.stream ?? 'view')
            if (request.status === 'pending' || request.status === 'partial') {
                postStage(request, false)
                postStage(await request.ready, true)
            } else {
                postStage(request, true)
            }
            return true
        } catch (e: unknown) {
            return this._failure(msgData, `Requesting signals failed: ${(e as Error).message}.`)
        }
    }

    /**
     * Clear this worker's network breakers so the next load is attempted afresh.
     *
     * Fire-and-forget from the service after re-authentication: it carries no request number and
     * waits for no reply, so none is posted. Readers that fetch through the resilient client
     * override this; the default is a no-op that keeps the commission from reading as unsupported.
     * @param _msgData - Data property from the message to the worker.
     */
    async resetNetwork (_msgData: WorkerMessage['data']) {
        return true
    }

    /**
     * Replace the reader's interruption table from external metadata.
     *
     * With `complete` the table is trusted to cover the whole recording, which lifts the
     * explored-span navigation restriction on a discontinuous file.
     * @param msgData - Data property from the message to the worker.
     */
    async setInterruptions (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as WorkerMessage['data'] & {
                complete?: boolean
                interruptions: [number, number][]
            },
            {
                complete: 'Boolean?',
                interruptions: 'Array',
            }
        )
        if (!data) {
            return false
        }
        this._reader.setInterruptions(new Map(data.interruptions), data.complete ?? false)
        return this._success(msgData)
    }

    /**
     * Mark signals as stored with an inverted phase, correcting a recording exported with a
     * reversed sign.
     *
     * The samples already cached were decoded under the previous setting, so the reader drops them;
     * the caller requests the view again and every sample is negated as it is read. Serving this
     * from the shared base rather than per format is what keeps the correction available to every
     * reader — the defect it corrects is a property of an export, not of a format.
     * @param msgData - Data property from the message to the worker.
     */
    async setSignalPolarity (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(
            msgData as WorkerMessage['data'] & {
                indices: number[]
                inverted: boolean
            },
            {
                indices: 'Array',
                inverted: 'Boolean',
            }
        )
        if (!data) {
            return false
        }
        const success = await this._reader.setSignalPolarityInverted(data.inverted, ...data.indices)
        return success ? this._success(msgData) : this._failure(msgData, `Setting signal polarity failed.`)
    }

    /**
     * Set up the signal cache, either in memory shared with the application or on this worker's own
     * heap when no memory manager is in use.
     *
     * Only the shared-memory case answers with cache properties, because only those describe memory
     * the application can reach. A cache on this worker's heap is reported as set up and nothing
     * more: the object itself would arrive on the other side as a structured clone with no link to
     * the memory it stands for. Serving that case to an application that has to read the cache is
     * the worker substitute's job, where the two live on one thread.
     * @param msgData - Data property from the message to the worker.
     */
    async setupCache (msgData: WorkerMessage['data']) {
        const derivationSlots = (msgData.derivationSlots as BiosignalCacheDerivationSlot[]) || []
        if (msgData.useMemoryManager) {
            const data = validateCommissionProps(
                msgData as WorkerMessage['data'] & {
                    buffer: SharedArrayBuffer
                    range: { start: number }
                },
                {
                    buffer: 'SharedArrayBuffer',
                    range: 'Object',
                }
            )
            if (!data) {
                return false
            }
            const exportProps = await this._reader.setupMutex(data.buffer, data.range.start, derivationSlots)
            if (!exportProps) {
                return this._failure(msgData, `Mutex setup failed.`)
            }
            return this._success(msgData, { cacheProperties: exportProps })
        }
        if (!this._reader.setupCache((msgData.dataDuration as number) || 0, derivationSlots)) {
            return this._failure(msgData, `Cache setup failed.`)
        }
        return this._success(msgData)
    }

    /**
     * Tear the reader down and close the worker.
     *
     * The reply is posted before the close, because the service awaits it before terminating the
     * worker and clearing the state that belongs to it.
     * @param msgData - Data property from the message to the worker.
     */
    async shutdown (msgData: WorkerMessage['data']) {
        await this._reader.destroy()
        const result = this._success(msgData)
        close()
        return result
    }

    /**
     * Apply an application settings snapshot to this worker's own copy.
     * @param msgData - Data property from the message to the worker.
     */
    async updateSettings (msgData: WorkerMessage['data']) {
        const data = validateCommissionProps(msgData, { settings: 'Object' })
        if (!data) {
            return false
        }
        Object.assign(SETTINGS, data.settings)
        return this._success(msgData)
    }
}
