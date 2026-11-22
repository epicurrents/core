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
    static failLoad: 'false' | 'reason' | 'throw' | null = null
    /** Held open by a test that needs the setup to be under way when something else happens. */
    static setupGate: Promise<void> | null = null
    loadCalls = [] as { options?: ConfigStudyLoader, source: StudyContext | null }[]
    worker = null as Worker | null
    constructor (name: string, modality: string) {
        super(name, modality)
    }
    protected async _load (options?: ConfigStudyLoader) {
        const generation = this._loadGeneration
        this.loadCalls.push({ options, source: this._source })
        if (ListedResource.failLoad === 'throw') {
            throw new Error('setup failed')
        }
        if (ListedResource.failLoad === 'false') {
            return false
        }
        if (ListedResource.failLoad === 'reason') {
            this._errorReason = 'No file worker'
            return false
        }
        if (ListedResource.setupGate) {
            await ListedResource.setupGate
            if (this._isLoadSuperseded(generation)) {
                return false
            }
        }
        this.worker = new Worker('worker.js')
        return true
    }
    async unload () {
        await super.unload()
        this.worker = null
        this.state = 'added'
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
        isSupportedModality: (modality: string) => loader.supportedModalities.includes(modality),
        loadFromUrl: vi.fn(async (url: string, options: ConfigStudyLoader = {}) => {
            // Like a real importer declaring no modalities of its own, which most do: asked to read for one, it
            // refuses.
            if (options.modality) {
                return null
            }
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
                modality: loader.readModality ?? 'test',
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
        ListedResource.setupGate = null
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
        expect(options.name).toBe('listed a')
        // The dataset places the resource and is never handed on.
        expect('dataset' in options).toBe(false)
        expect('dataset' in loader.loadFromUrl.mock.calls[0][1]!).toBe(false)
    })

    it('reads without asking the importer for the listed modality', async () => {
        const listed = list('a', { modality: 'other', options: { modality: 'other' } })
        expect(await listed.load()).toBe(true)
        expect('modality' in loader.loadFromUrl.mock.calls[0][1]!).toBe(false)
    })

    it('refuses to list a modality the loader does not support', () => {
        app.registerModule('third', { runtime: {}, settings: {} } as never)
        expect(list('a', { modality: 'third' })).toBeNull()
        expect(loader.createListedResource).not.toHaveBeenCalled()
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

    it('runs the load hook on the listed resource before its setup, beside the read', async () => {
        const order = [] as string[]
        let release = () => {}
        const listed = list('a', {
            onLoad: async resource => {
                order.push('hook')
                expect(resource).toBe(listed)
                await new Promise<void>(resolve => {
                    release = resolve
                })
                order.push('hook done')
            },
        })
        const load = listed.load()
        await vi.waitFor(() => expect(loader.useStudy).toHaveBeenCalledTimes(1))
        // The read has finished while the hook is still running, and the setup waits for it.
        expect(listed.loadCalls).toHaveLength(0)
        release()
        expect(await load).toBe(true)
        expect(order).toEqual(['hook', 'hook done'])
        expect(listed.loadCalls).toHaveLength(1)
    })

    it('loads despite a failing load hook, and calls it once per read', async () => {
        const onLoad = vi.fn(async () => {
            throw new Error('hook failed')
        })
        const listed = list('a', { onLoad })
        expect(await listed.load()).toBe(true)
        await listed.unload()
        expect(await listed.load()).toBe(true)
        expect(onLoad).toHaveBeenCalledTimes(1)
    })

    it('lists a study under a parent, not in the dataset, and loads it in place', async () => {
        const parent = list('parent')
        const listed = app.listStudy(
            { loader: 'test/url', name: 'attached', source: 'attached' },
            { parent }
        ) as ListedResource
        expect(parent.childResources).toEqual([listed])
        expect(dataset.resources.map(ctx => ctx.resource)).not.toContain(listed)
        expect(listed.isListed).toBe(true)
        expect(await listed.load()).toBe(true)
        expect(listed.source?.name).toBe('attached')
        expect(parent.childResources[0]).toBe(listed)
    })

    it('destroys the children of a destroyed resource', () => {
        const parent = list('parent')
        const first = app.listStudy({ loader: 'test/url', name: 'a', source: 'a' }, { parent })!
        const second = app.listStudy({ loader: 'test/url', name: 'b', source: 'b' }, { parent })!
        second.destroy()
        parent.activeChildResource = first
        parent.destroy()
        expect(first.state).toBe('destroyed')
        expect(second.state).toBe('destroyed')
        expect(parent.childResources).toEqual([])
        expect(parent.activeChildResource).toBeNull()
    })

    it('does not count a listing as open until its load is set going', async () => {
        const listed = list('a')
        expect(app.unloadNeedsConfirmation).toBe(false)
        const load = listed.load()
        expect(app.unloadNeedsConfirmation).toBe(true)
        await load
        expect(app.unloadNeedsConfirmation).toBe(true)
    })

    it('leaves an unload made while the study is read standing, and loads afresh afterwards', async () => {
        const listed = list('a')
        const first = listed.load()
        await listed.unload()
        expect(listed.state).toBe('added')
        expect(await first).toBe(false)
        expect(listed.state).toBe('added')
        expect(listed.isListed).toBe(true)
        expect(listed.source).toBeNull()
        expect(listed.loadCalls).toHaveLength(0)
        // The next load is a run of its own, not the superseded one.
        const second = listed.load()
        expect(second).not.toBe(first)
        expect(await second).toBe(true)
        expect(listed.state).toBe('ready')
        expect(listed.loadCalls).toHaveLength(1)
    })

    it('leaves an unload made during the setup standing, and tells the setup so', async () => {
        const setup = gate()
        ListedResource.setupGate = setup.closed
        const listed = list('a')
        const first = listed.load()
        await vi.waitFor(() => expect(listed.loadCalls).toHaveLength(1))
        await listed.unload()
        // A load asked for after the unload does not join the run the unload superseded.
        const second = listed.load()
        expect(second).not.toBe(first)
        setup.open()
        expect(await first).toBe(false)
        expect(await second).toBe(true)
        expect(listed.state).toBe('ready')
        // The superseded setup stopped at its own check, so only the second run made a worker.
        expect(listed.loadCalls).toHaveLength(2)
        expect(WorkerStub).toHaveBeenCalledTimes(1)
    })

    it('does not bring back a resource destroyed during its setup', async () => {
        const setup = gate()
        ListedResource.setupGate = setup.closed
        const listed = list('a')
        const load = listed.load()
        await vi.waitFor(() => expect(listed.loadCalls).toHaveLength(1))
        listed.destroy()
        setup.open()
        expect(await load).toBe(false)
        expect(listed.state).toBe('destroyed')
        expect(WorkerStub).not.toHaveBeenCalled()
    })

    it('runs no setup on a resource the loading state change unloaded or destroyed', async () => {
        const unloaded = list('a')
        await unloaded.load()
        await unloaded.unload()
        unloaded.onPropertyChange('state', (value) => {
            if (value === 'loading') {
                unloaded.unload()
            }
        }, 'test')
        expect(await unloaded.load()).toBe(false)
        expect(unloaded.loadCalls).toHaveLength(1)
        expect(unloaded.state).toBe('added')
        const destroyed = list('b')
        await destroyed.load()
        await destroyed.unload()
        destroyed.onPropertyChange('state', (value) => {
            if (value === 'loading') {
                destroyed.destroy()
            }
        }, 'test')
        expect(await destroyed.load()).toBe(false)
        expect(destroyed.loadCalls).toHaveLength(1)
        expect(destroyed.state).toBe('destroyed')
    })

    it('selects a resource again while it is still loading', async () => {
        const a = list('a')
        const b = list('b')
        app.selectActiveResource(a)
        app.selectActiveResource(b)
        expect(a.state).toBe('loading')
        expect(a.isActive).toBe(false)
        app.selectActiveResource(a.id)
        expect(a.isActive).toBe(true)
        expect(b.isActive).toBe(false)
        await vi.waitFor(() => expect(a.state).toBe('ready'))
        expect(a.loadCalls).toHaveLength(1)
    })

    it('selects a resource that has no listing and has not been set loading, but not a destroyed one', async () => {
        const plain = new ListedResource('plain', 'test')
        app.addResource(plain)
        app.selectActiveResource(plain)
        expect(plain.isActive).toBe(true)
        await vi.waitFor(() => expect(plain.state).toBe('ready'))
        const gone = list('gone')
        gone.destroy()
        app.selectActiveResource(gone)
        expect(gone.isActive).toBe(false)
    })

    it('counts a loaded child as open, and watches its annotations', async () => {
        const parent = list('parent')
        const nested = app.listStudy({ loader: 'test/url', name: 'child', source: 'child' }, { parent })!
        const deeper = app.listStudy({ loader: 'test/url', name: 'deep', source: 'deep' }, { parent: nested })!
        expect(app.unloadNeedsConfirmation).toBe(false)
        await deeper.load()
        expect(app.unloadNeedsConfirmation).toBe(true)
        await deeper.unload()
        expect(app.unloadNeedsConfirmation).toBe(false)
        nested.labels = [{ id: 'label' } as never]
        expect(app.unloadNeedsConfirmation).toBe(true)
    })

    it('destroys the resource of a listing it refuses', () => {
        const mismatched = new ListedResource('x', 'other')
        loader.createListedResource.mockReturnValueOnce(mismatched)
        expect(list('a')).toBeNull()
        expect(mismatched.state).toBe('destroyed')
        const first = list('b')
        const duplicate = new ListedResource('y', 'test')
        ;(duplicate as unknown as { _id: string })._id = first.id
        loader.createListedResource.mockReturnValueOnce(duplicate)
        expect(list('c')).toBeNull()
        expect(duplicate.state).toBe('destroyed')
        // A factory handing back the resource already listed loses nothing by the refusal.
        loader.createListedResource.mockReturnValueOnce(first)
        expect(list('d')).toBeNull()
        expect(first.state).toBe('added')
        expect(first.isListed).toBe(true)
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([first])
    })

    it('lists nothing under a destroyed parent', () => {
        const parent = list('parent')
        parent.destroy()
        expect(app.listStudy({ loader: 'test/url', name: 'a', source: 'a' }, { parent })).toBeNull()
        expect(loader.createListedResource).toHaveBeenCalledTimes(1)
    })

    it('takes a child destroyed on its own out of its parent', () => {
        const parent = list('parent')
        const first = app.listStudy({ loader: 'test/url', name: 'a', source: 'a' }, { parent })!
        const second = app.listStudy({ loader: 'test/url', name: 'b', source: 'b' }, { parent })!
        parent.activeChildResource = first
        first.destroy()
        expect(parent.childResources).toEqual([second])
        expect(parent.activeChildResource).toBeNull()
        expect(parent.state).toBe('added')
    })

    it('survives a child whose destroy rejects', async () => {
        const parent = list('parent')
        const child = app.listStudy({ loader: 'test/url', name: 'a', source: 'a' }, { parent })!
        child.destroy = () => Promise.reject(new Error('destroy failed'))
        const unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        parent.destroy()
        await new Promise(resolve => setTimeout(resolve, 5))
        process.off('unhandledRejection', unhandled)
        expect(unhandled).not.toHaveBeenCalled()
        expect(parent.state).toBe('destroyed')
    })

    it('announces the reason a setup wrote for itself', async () => {
        ListedResource.failLoad = 'reason'
        const listed = list('a')
        const seen = [] as string[]
        listed.onPropertyChange('errorReason', value => seen.push(`reason:${value}`), 'test')
        listed.onPropertyChange('state', (value) => {
            if (value === 'error') {
                seen.push(`state:${listed.errorReason}`)
            }
        }, 'test')
        expect(await listed.load()).toBe(false)
        expect(seen).toEqual(['reason:No file worker', 'state:No file worker'])
        // A reason set through the setter has been announced and is not announced again.
        ListedResource.failLoad = 'false'
        const second = list('b')
        const announced = vi.fn()
        second.onPropertyChange('errorReason', announced, 'test')
        expect(await second.load()).toBe(false)
        expect(announced).toHaveBeenCalledTimes(1)
        expect(announced.mock.calls[0][0]).toBe('Loading the study failed')
    })

    it('loads an opened study with its options when a listener of the add activates it', async () => {
        const opened = new ListedResource('opened', 'test')
        loader.getResource.mockResolvedValueOnce(opened as never)
        app.runtime.addEventListener('add-resource', () => {
            app.runtime.setActiveResource(opened)
        }, 'test')
        const result = await app.loadStudy('test/url', 'c', { authHeader: 'given', dataset })
        expect(result).toBe(opened)
        expect(opened.isActive).toBe(true)
        await vi.waitFor(() => expect(opened.state).toBe('ready'))
        expect(opened.loadCalls).toHaveLength(1)
        expect(opened.loadCalls[0].options?.authHeader).toBe('given')
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
