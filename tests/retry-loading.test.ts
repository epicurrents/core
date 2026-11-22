/**
 * Tests for a failed load: the runtime deactivates the resource, the reason stays on it, and `retryLoad` loads it
 * again on the same object.
 *
 * What these pin is that a retry releases what the failed attempt left before it loads, reads the study again only
 * when the read is what failed, runs the listing's hook with that read, shares itself with `load`, and that the
 * runtime retries a failed resource on activation and never leaves a failed one active.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Epicurrents } from '../src'
import ErrorResource from '../src/assets/error/ErrorResource'
import GenericBiosignalResource from '../src/assets/biosignal/GenericBiosignalResource'
import GenericResource from '../src/assets/GenericResource'
import type { BiosignalDataService } from '../src/types/biosignal'
import type { ConfigStudyLoader } from '../src/types/config'
import type { MediaDataset, StudyListing } from '../src/types/dataset'
import type { StudyContext } from '../src/types/study'

/** A module resource that creates a worker when it loads and lets it go when it is unloaded. */
class RetryResource extends GenericResource {
    static failLoad = false
    /** Held open by a test that needs the release to be under way when something else happens. */
    static releaseGate: Promise<void> | null = null
    loadCalls = [] as { options?: ConfigStudyLoader, source: StudyContext | null }[]
    unloads = 0
    worker = null as { alive: boolean } | null
    constructor (name: string, modality: string) {
        super(name, modality)
    }
    protected async _load (options?: ConfigStudyLoader) {
        this.loadCalls.push({ options, source: this._source })
        // Like a module that leaves the worker of a failed setup running.
        this.worker = { alive: true }
        if (RetryResource.failLoad) {
            this._errorReason = 'Worker setup failed'
            return false
        }
        return true
    }
    async unload () {
        await super.unload()
        this.unloads++
        if (RetryResource.releaseGate) {
            await RetryResource.releaseGate
        }
        if (this.worker) {
            this.worker.alive = false
            this.worker = null
        }
    }
}

/** A biosignal resource holding a service, as a module recording does after a failed setup. */
class RetryRecording extends GenericBiosignalResource {
    created = [] as BiosignalDataService[]
    failLoad = true
    getMainProperties () {
        return new Map<string, { [key: string]: string | number } | null>()
    }
    protected async _load () {
        if (!this._service) {
            const service = {
                destroy: vi.fn(async () => {}),
                id: `service-${this.created.length}`,
                unload: vi.fn(async () => {}),
            } as unknown as BiosignalDataService
            this.created.push(service)
            this._service = service
        }
        return !this.failLoad
    }
    get heldService () {
        return this._service
    }
    setSource (source: StudyContext) {
        this._source = source
    }
}

/** A promise and the function that resolves it. */
const gate = () => {
    let open = () => {}
    const closed = new Promise<void>(resolve => {
        open = resolve
    })
    return { closed, open }
}

const makeLoader = () => {
    const loader = {
        fail: new Set<string>(),
        /** Held open by a test that needs a read to be under way when something else happens. */
        readGate: null as Promise<void> | null,
        resourceModality: 'test',
        supportedModalities: ['test'],
        createListedResource: vi.fn((listing: StudyListing) => {
            return new RetryResource(listing.name, listing.modality!)
        }),
        getResource: vi.fn(async () => null),
        isSupportedModality: (modality: string) => loader.supportedModalities.includes(modality),
        loadFromUrl: vi.fn(async (url: string) => {
            if (loader.readGate) {
                await loader.readGate
            }
            if (loader.fail.has(url)) {
                return null
            }
            return { files: [], meta: {}, modality: 'test', name: url } as unknown as StudyContext
        }),
        registerMemoryManager: vi.fn(),
        useStudy: vi.fn(async () => 0),
    }
    return loader
}

describe('retrying a failed load', () => {
    let app: Epicurrents
    let dataset: MediaDataset
    let loader: ReturnType<typeof makeLoader>

    const list = (url: string, extra: Partial<StudyListing> = {}) => app.listStudy(
        { loader: 'test/url', name: `listed ${url}`, source: url, ...extra },
        { dataset }
    ) as RetryResource

    beforeEach(() => {
        ;(window as unknown as { __EPICURRENTS__: undefined }).__EPICURRENTS__ = undefined
        app = new Epicurrents()
        app.runtime.APP.datasets.length = 0
        app.runtime.APP.activeDataset = null
        app.registerModule('test', { runtime: {}, settings: {} } as never)
        RetryResource.failLoad = false
        RetryResource.releaseGate = null
        loader = makeLoader()
        app.registerStudyImporter('test/url', 'Test', 'url', loader as never)
        dataset = app.createDataset('dataset', true)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('reads the study again, and runs the listing hook again, when the read is what failed', async () => {
        const onLoad = vi.fn(async () => {})
        loader.fail.add('a')
        const listed = list('a', { onLoad })
        expect(await listed.load()).toBe(false)
        expect(listed.canRetryLoad).toBe(true)
        expect(listed.loadCalls).toHaveLength(0)
        loader.fail.clear()
        const seen = [] as string[]
        listed.onPropertyChange('errorReason', value => seen.push(`reason:${value}`), 'test')
        listed.onPropertyChange('state', value => seen.push(`state:${value}`), 'test')
        const retry = listed.retryLoad()
        // The reason is cleared and `loading` announced within the call.
        expect(seen).toEqual(['reason:', 'state:loading'])
        expect(listed.errorReason).toBe('')
        expect(listed.isListed).toBe(false)
        expect(await retry).toBe(true)
        expect(seen).toEqual(['reason:', 'state:loading', 'state:ready'])
        expect(listed.canRetryLoad).toBe(false)
        expect(loader.loadFromUrl).toHaveBeenCalledTimes(2)
        expect(onLoad).toHaveBeenCalledTimes(2)
        expect(listed.source?.name).toBe('a')
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([listed])
    })

    it('sets up again from the study it kept, after releasing what the failed setup left', async () => {
        RetryResource.failLoad = true
        const listed = list('a')
        expect(await listed.load({ authHeader: 'first' })).toBe(false)
        expect(listed.errorReason).toBe('Worker setup failed')
        const failed = listed.worker!
        expect(failed.alive).toBe(true)
        RetryResource.failLoad = false
        expect(await listed.retryLoad({ authHeader: 'second' })).toBe(true)
        expect(listed.state).toBe('ready')
        expect(listed.unloads).toBe(1)
        // The worker of the failed attempt is gone, and the retry made its own.
        expect(failed.alive).toBe(false)
        expect(listed.worker).not.toBe(failed)
        expect(listed.worker?.alive).toBe(true)
        expect(loader.loadFromUrl).toHaveBeenCalledTimes(1)
        expect(listed.loadCalls).toHaveLength(2)
        expect(listed.loadCalls[1].source).toBe(listed.loadCalls[0].source)
        expect(listed.loadCalls[1].options?.authHeader).toBe('second')
        expect(listed.loadCalls[1].options?.name).toBe('listed a')
    })

    it('leaves a retry that fails in error with the new reason, ready to be retried again', async () => {
        loader.fail.add('a')
        const listed = list('a')
        await listed.load()
        loader.fail.clear()
        RetryResource.failLoad = true
        const announced = vi.fn()
        listed.onPropertyChange('errorReason', announced, 'test')
        expect(await listed.retryLoad()).toBe(false)
        expect(listed.state).toBe('error')
        expect(listed.errorReason).toBe('Worker setup failed')
        expect(announced.mock.calls.map(call => call[0])).toEqual(['', 'Worker setup failed'])
        RetryResource.failLoad = false
        expect(await listed.retryLoad()).toBe(true)
        expect(listed.worker?.alive).toBe(true)
    })

    it('is a load in every state but error', async () => {
        const listed = list('a')
        expect(await listed.retryLoad()).toBe(true)
        expect(listed.loadCalls).toHaveLength(1)
        expect(await listed.retryLoad()).toBe(true)
        expect(listed.loadCalls).toHaveLength(1)
        expect(listed.unloads).toBe(0)
        const loading = list('b')
        const load = loading.load()
        expect(loading.retryLoad()).toBe(load)
        await load
        listed.destroy()
        expect(await listed.retryLoad()).toBe(false)
    })

    it('refuses a failure with nothing behind it to load', async () => {
        const failure = new ErrorResource('failed', 'test')
        expect(failure.canRetryLoad).toBe(false)
        expect(await failure.retryLoad()).toBe(false)
        expect(failure.state).toBe('error')
    })

    it('shares one retry between concurrent calls, load among them', async () => {
        RetryResource.failLoad = true
        const listed = list('a')
        await listed.load()
        RetryResource.failLoad = false
        const release = gate()
        RetryResource.releaseGate = release.closed
        const first = listed.retryLoad()
        expect(listed.retryLoad()).toBe(first)
        // While the release is awaited the retry is the load in progress.
        expect(listed.load()).toBe(first)
        release.open()
        expect(await first).toBe(true)
        expect(listed.unloads).toBe(1)
        expect(listed.loadCalls).toHaveLength(2)
        // A settled retry is not handed out again.
        expect(await listed.load()).toBe(true)
        expect(listed.loadCalls).toHaveLength(2)
    })

    it('sets nothing up on a resource destroyed while the failed attempt is released', async () => {
        RetryResource.failLoad = true
        const listed = list('a')
        await listed.load()
        RetryResource.failLoad = false
        const release = gate()
        RetryResource.releaseGate = release.closed
        const retry = listed.retryLoad()
        listed.destroy()
        release.open()
        expect(await retry).toBe(false)
        expect(listed.state).toBe('destroyed')
        expect(listed.loadCalls).toHaveLength(1)
    })

    it('supersedes a retry with an unload, so the next load starts its own', async () => {
        loader.fail.add('a')
        const listed = list('a')
        await listed.load()
        loader.fail.clear()
        const read = gate()
        loader.readGate = read.closed
        const retry = listed.retryLoad()
        // The read is under way once the release has finished, so the unload below is not the retry's own.
        await vi.waitFor(() => expect(loader.loadFromUrl).toHaveBeenCalledTimes(2))
        await listed.unload()
        expect(listed.state).toBe('added')
        const next = listed.load()
        expect(next).not.toBe(retry)
        read.open()
        expect(await retry).toBe(false)
        expect(await next).toBe(true)
    })

    it('lets the service of a failed biosignal load go and creates another', async () => {
        const recording = new RetryRecording('recording', 'test')
        recording.setSource({ files: [], meta: {}, modality: 'test', name: 'r' } as unknown as StudyContext)
        expect(await recording.load()).toBe(false)
        const failed = recording.heldService!
        expect(failed).toBe(recording.created[0])
        recording.failLoad = false
        expect(await recording.retryLoad()).toBe(true)
        expect(failed.unload).toHaveBeenCalledTimes(1)
        expect(failed.destroy).toHaveBeenCalledTimes(1)
        expect(recording.created).toHaveLength(2)
        expect(recording.heldService).toBe(recording.created[1])
        expect(recording.dataCache).toBeNull()
    })

    describe('through the runtime', () => {
        it('deactivates a resource whose load on activation fails, keeping the reason', async () => {
            loader.fail.add('a')
            const listed = list('a')
            const active = [] as (string | null)[]
            app.runtime.addEventListener('set-active-resource', (event) => {
                active.push((event.detail.payload as RetryResource | null)?.name ?? null)
            }, 'test')
            const activeSets = vi.fn()
            dataset.onPropertyChange('activeResources', activeSets, 'test')
            app.runtime.setActiveResource(listed)
            expect(listed.isActive).toBe(true)
            await vi.waitFor(() => expect(listed.state).toBe('error'))
            expect(listed.isActive).toBe(false)
            expect(listed.errorReason).toBe('Reading the study failed')
            expect(dataset.activeResources).toEqual([])
            expect(active).toEqual(['listed a', null])
            expect(activeSets.mock.calls.at(-1)?.[0]).toEqual([])
        })

        it('deactivates a resource that was already loading when it was activated', async () => {
            loader.fail.add('a')
            const listed = list('a')
            const load = listed.load()
            app.runtime.setActiveResource(listed)
            expect(listed.isActive).toBe(true)
            expect(await load).toBe(false)
            expect(listed.isActive).toBe(false)
        })

        it('deactivates a resource that fails after it has loaded', async () => {
            const listed = list('a')
            app.runtime.setActiveResource(listed)
            await vi.waitFor(() => expect(listed.state).toBe('ready'))
            listed.errorReason = 'Signal caching failed'
            listed.state = 'error'
            expect(listed.isActive).toBe(false)
            expect(listed.canRetryLoad).toBe(true)
        })

        it('leaves a superseded load active', async () => {
            const listed = list('a')
            app.runtime.setActiveResource(listed)
            await listed.unload()
            expect(listed.state).toBe('added')
            expect(listed.isActive).toBe(true)
        })

        it('retries a failed resource when it is selected, and keeps it active once it loads', async () => {
            loader.fail.add('a')
            const listed = list('a')
            app.selectActiveResource(listed)
            await vi.waitFor(() => expect(listed.state).toBe('error'))
            loader.fail.clear()
            // What a module's activation listener does: load, and go on once the load has succeeded.
            const continued = [] as boolean[]
            listed.addEventListener('activate', () => {
                if (listed.isActive) {
                    listed.load().then(loaded => continued.push(loaded))
                }
            }, 'test')
            app.selectActiveResource(listed.id)
            expect(listed.isActive).toBe(true)
            expect(listed.state).toBe('loading')
            await vi.waitFor(() => expect(listed.state).toBe('ready'))
            expect(listed.isActive).toBe(true)
            expect(continued).toEqual([true])
            expect(loader.loadFromUrl).toHaveBeenCalledTimes(2)
        })

        it('deactivates again when the retry on activation fails', async () => {
            loader.fail.add('a')
            const listed = list('a')
            app.runtime.setActiveResource(listed)
            await vi.waitFor(() => expect(listed.state).toBe('error'))
            app.runtime.setActiveResource(listed)
            expect(listed.isActive).toBe(true)
            await vi.waitFor(() => expect(listed.state).toBe('error'))
            expect(listed.isActive).toBe(false)
            expect(loader.loadFromUrl).toHaveBeenCalledTimes(2)
        })

        it('activates a failure with nothing to retry as it stands', () => {
            const failure = new ErrorResource('failed', 'test')
            app.runtime.addResource('test', failure, { dataset })
            app.runtime.setActiveResource(failure)
            expect(failure.isActive).toBe(true)
            expect(failure.state).toBe('error')
        })
    })
})
