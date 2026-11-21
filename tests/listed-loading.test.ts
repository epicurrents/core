/**
 * Tests for listing studies without reading them and loading them in place.
 *
 * A listed resource is created in its module's own class with no worker behind it, and the dataset keeps that object:
 * activating it reads the study and finishes the setup on the same resource. What these tests pin is that listing
 * reads nothing and starts no worker, that the object loaded is the object listed, that a failure stays on it, that the
 * study the resource sets up from is the one read rather than what the listing carried, that a read finding another
 * modality fails, and that reads through one importer neither overlap nor trade studies.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Epicurrents } from '../src'
import GenericResource from '../src/assets/GenericResource'
import type { ConfigStudyLoader } from '../src/types/config'
import type { MediaDataset, StudyListing } from '../src/types/dataset'
import type { StudyContext } from '../src/types/study'

/** A module resource that, like the real ones, creates its worker only when it loads. */
class ListedResource extends GenericResource {
    static failLoad: 'false' | 'throw' | null = null
    loadCalls = [] as { options?: ConfigStudyLoader, source: StudyContext | null }[]
    worker = null as Worker | null
    constructor (name: string, modality: string) {
        super(name, modality)
    }
    protected async _load (options?: ConfigStudyLoader) {
        this.loadCalls.push({ options, source: this._source })
        if (ListedResource.failLoad === 'throw') {
            throw new Error('setup failed')
        }
        if (ListedResource.failLoad === 'false') {
            return false
        }
        this.worker = new Worker('worker.js')
        return true
    }
    async unload () {
        this.worker = null
        this.state = 'added'
    }
}

/**
 * An importer that holds the study it is reading in one field, with pauses, so two overlapping reads on it would
 * hand each other's study back.
 */
const makeLoader = () => {
    const loader = {
        current: null as null | StudyContext,
        fail: new Set<string>(),
        inFlight: 0,
        maxInFlight: 0,
        readModality: null as string | null,
        resourceModality: 'test',
        supportedModalities: ['test', 'other'],
        createListedResource: vi.fn((listing: StudyListing) => {
            return new ListedResource(listing.name, listing.modality!)
        }),
        getResource: vi.fn(async () => null),
        loadFromUrl: vi.fn(async (url: string, options: ConfigStudyLoader = {}) => {
            // A read holds the importer until `useStudy` has taken its study.
            loader.inFlight++
            loader.maxInFlight = Math.max(loader.maxInFlight, loader.inFlight)
            await new Promise(resolve => setTimeout(resolve, 5))
            if (loader.fail.has(url)) {
                loader.inFlight--
                return null
            }
            const study = {
                files: [],
                meta: { header: { duration: 60 } },
                modality: loader.readModality ?? options.modality ?? 'test',
                name: url,
            } as unknown as StudyContext
            loader.current = study
            return study
        }),
        registerMemoryManager: vi.fn(),
        useStudy: vi.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, 5))
            loader.inFlight--
            return 0
        }),
    }
    return loader
}

describe('listed studies', () => {
    let app: Epicurrents
    let dataset: MediaDataset
    let loader: ReturnType<typeof makeLoader>
    const WorkerStub = vi.fn()

    const list = (url: string, extra: Partial<StudyListing> = {}) => app.listStudy(
        { loader: 'test/url', name: `listed ${url}`, source: url, ...extra },
        { dataset }
    ) as ListedResource

    beforeEach(() => {
        // The runtime wraps a module-level state singleton, so datasets outlive the application that created them.
        ;(window as unknown as { __EPICURRENTS__: undefined }).__EPICURRENTS__ = undefined
        app = new Epicurrents()
        app.runtime.APP.datasets.length = 0
        app.runtime.APP.activeDataset = null
        app.registerModule('test', { runtime: {}, settings: {} } as never)
        app.registerModule('other', { runtime: {}, settings: {} } as never)
        ListedResource.failLoad = null
        loader = makeLoader()
        app.registerStudyImporter('test/url', 'Test', 'url', loader as never)
        dataset = app.createDataset('dataset', true)
        WorkerStub.mockClear()
        vi.stubGlobal('Worker', WorkerStub)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('lists a study in its module class without reading it or starting a worker', () => {
        const listed = list('a', { properties: [['duration', 60], ['signals', 21]] })
        expect(listed).toBeInstanceOf(ListedResource)
        expect(listed.modality).toBe('test')
        expect(listed.state).toBe('added')
        expect(listed.isListed).toBe(true)
        expect(listed.isReady).toBe(false)
        expect([...listed.getMainProperties()]).toEqual([['duration', 60], ['signals', 21]])
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([listed])
        expect(loader.loadFromUrl).not.toHaveBeenCalled()
        expect(WorkerStub).not.toHaveBeenCalled()
    })

    it('lists under the given modality and passes it to the factory', () => {
        const listed = list('a', { modality: 'other' })
        expect(listed.modality).toBe('other')
        expect(loader.createListedResource.mock.calls[0][0].modality).toBe('other')
    })

    it('refuses a study no importer, module or factory can list', () => {
        expect(app.listStudy({ loader: 'none/url', name: 'x', source: 'x' }, { dataset })).toBeNull()
        expect(app.listStudy({ loader: 'test/url', modality: 'absent', name: 'x', source: 'x' }, { dataset }))
            .toBeNull()
        loader.createListedResource.mockReturnValueOnce(null as never)
        expect(list('a')).toBeNull()
        loader.createListedResource.mockReturnValueOnce(new ListedResource('x', 'other'))
        expect(list('b')).toBeNull()
        expect(dataset.resources).toHaveLength(0)
    })

    it('loads the listed resource in place when it is activated', async () => {
        const listed = list('a')
        app.runtime.setActiveResource(listed)
        expect(listed.isActive).toBe(true)
        expect(listed.isListed).toBe(false)
        expect(listed.state).toBe('loading')
        await vi.waitFor(() => expect(listed.state).toBe('ready'))
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([listed])
        expect(listed.source?.name).toBe('a')
        expect(WorkerStub).toHaveBeenCalledTimes(1)
    })

    it('selects a listed resource as active', async () => {
        const listed = list('a')
        app.selectActiveResource(listed.id)
        expect(listed.isActive).toBe(true)
        await vi.waitFor(() => expect(listed.state).toBe('ready'))
    })

    it('loads with the listing options under those given to load', async () => {
        const listed = list('a', { options: { authHeader: 'listed', dataset } })
        await listed.load({ authHeader: 'given' })
        const options = listed.loadCalls[0].options!
        expect(options.authHeader).toBe('given')
        expect(options.modality).toBe('test')
        expect(options.name).toBe('listed a')
        // The dataset places the resource and is never handed on.
        expect('dataset' in options).toBe(false)
        expect('dataset' in loader.loadFromUrl.mock.calls[0][1]!).toBe(false)
    })

    it('sets up from the study read, not from what the listing carried', async () => {
        const listed = list('a', { properties: [['duration', 999]] })
        await listed.load()
        const source = listed.loadCalls[0].source!
        expect(source).toBe(loader.current)
        expect((source.meta as { header: { duration: number } }).header.duration).toBe(60)
        expect([...listed.getMainProperties()]).not.toContainEqual(['duration', 999])
    })

    it('shares one load between concurrent calls', async () => {
        const listed = list('a')
        const [first, second] = await Promise.all([listed.load(), listed.load()])
        expect(first).toBe(true)
        expect(second).toBe(true)
        expect(loader.loadFromUrl).toHaveBeenCalledTimes(1)
        expect(listed.loadCalls).toHaveLength(1)
        expect(await listed.load()).toBe(true)
        expect(listed.loadCalls).toHaveLength(1)
    })

    it('reads one study at a time through one importer, each into its own resource', async () => {
        const a = list('a')
        const b = list('b')
        const opened = app.loadStudy('test/url', 'c')
        await Promise.all([a.load(), b.load(), opened])
        expect(loader.loadFromUrl).toHaveBeenCalledTimes(3)
        expect(loader.maxInFlight).toBe(1)
        expect(a.source?.name).toBe('a')
        expect(b.source?.name).toBe('b')
    })

    it('shares the load with a call made from the loading state change', async () => {
        const listed = list('a')
        const nested = [] as Promise<boolean>[]
        listed.onPropertyChange('state', (value) => {
            if (value === 'loading') {
                nested.push(listed.load())
            }
        }, 'test')
        const load = listed.load()
        expect(nested).toEqual([load])
        await load
        expect(loader.loadFromUrl).toHaveBeenCalledTimes(1)
        expect(listed.loadCalls).toHaveLength(1)
    })

    it('leaves a failed read in error on the same resource', async () => {
        loader.fail.add('a')
        const listed = list('a')
        expect(await listed.load()).toBe(false)
        expect(listed.state).toBe('error')
        expect(listed.errorReason).toBe('Reading the study failed')
        expect(listed.loadCalls).toHaveLength(0)
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([listed])
        // A failed resource is not loaded again by asking.
        expect(await listed.load()).toBe(false)
        expect(loader.loadFromUrl).toHaveBeenCalledTimes(1)
    })

    it('leaves a failed setup in error on the same resource', async () => {
        ListedResource.failLoad = 'false'
        const resolved = list('a')
        expect(await resolved.load()).toBe(false)
        expect(resolved.state).toBe('error')
        ListedResource.failLoad = 'throw'
        const thrown = list('b')
        expect(await thrown.load()).toBe(false)
        expect(thrown.state).toBe('error')
        expect(thrown.errorReason).toBe('Loading the study failed')
    })

    it('fails a read that finds another modality', async () => {
        loader.readModality = 'video'
        const listed = list('a')
        expect(await listed.load()).toBe(false)
        expect(listed.state).toBe('error')
        expect(listed.loadCalls).toHaveLength(0)
    })

    it('accepts a read the loader claims as its own modality', async () => {
        loader.readModality = 'test'
        const listed = list('a', { modality: 'other' })
        expect(await listed.load()).toBe(true)
    })

    it('sets nothing up on a resource destroyed while its study is read', async () => {
        const listed = list('a')
        const load = listed.load()
        listed.destroy()
        expect(await load).toBe(false)
        expect(listed.loadCalls).toHaveLength(0)
        expect(listed.state).toBe('destroyed')
    })

    it('loads again from the study it kept once unloaded back to listed', async () => {
        const listed = list('a')
        await listed.load()
        await listed.unload()
        expect(listed.isListed).toBe(true)
        expect(await listed.load()).toBe(true)
        expect(listed.loadCalls).toHaveLength(2)
        expect(loader.loadFromUrl).toHaveBeenCalledTimes(1)
        expect(WorkerStub).toHaveBeenCalledTimes(2)
    })

    it('does not count a listing as open until its load is set going', async () => {
        const listed = list('a')
        expect(app.unloadNeedsConfirmation).toBe(false)
        const load = listed.load()
        expect(app.unloadNeedsConfirmation).toBe(true)
        await load
        expect(app.unloadNeedsConfirmation).toBe(true)
    })
})

describe('loading a resource created complete', () => {
    it('prepares it once and resolves at once when ready', async () => {
        class Complete extends GenericResource {
            prepared = 0
            async prepare () {
                this.prepared++
                this.state = 'ready'
                return true
            }
        }
        const resource = new Complete('complete', 'test')
        expect(resource.isListed).toBe(false)
        expect(await Promise.all([resource.load(), resource.load()])).toEqual([true, true])
        expect(await resource.load()).toBe(true)
        expect(resource.prepared).toBe(1)
    })

    it('fails a resource whose prepare fails, keeping its own reason', async () => {
        class Failing extends GenericResource {
            async prepare () {
                this.errorReason = 'Worker setup failed'
                this.state = 'error'
                return false
            }
        }
        const resource = new Failing('failing', 'test')
        expect(await resource.load()).toBe(false)
        expect(resource.state).toBe('error')
        expect(resource.errorReason).toBe('Worker setup failed')
    })
})
