/**
 * Tests for listing studies before they are loaded, and loading them when opened.
 *
 * A dataset can hold far more studies than a tab can keep readers for, so a host lists them as deferred resources and
 * the application loads each one only when it is opened. What these tests pin is that listing touches no importer,
 * that opening puts the loaded resource exactly where the listing was, that concurrent opens neither duplicate a load
 * nor let two studies on one importer trade places, and that a deferred resource can never become the active one.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Epicurrents } from '../src'
import GenericResource from '../src/assets/GenericResource'
import { isDeferredResource } from '../src/util'
import type { DataResource } from '../src/types/application'
import type { MediaDataset } from '../src/types/dataset'

/** A loaded study's resource: prepares to ready and records whether it was destroyed. */
class LoadedResource extends GenericResource {
    static failDestroy = false
    destroyed = false
    constructor (name: string) {
        super(name, 'test')
    }
    destroy () {
        if (LoadedResource.failDestroy) {
            throw new Error('destroy failed')
        }
        this.destroyed = true
        super.destroy()
    }
    async prepare () {
        this.state = 'ready'
        return true
    }
}

/**
 * An importer that, like the real ones, holds the study it is working on in one field between reading it and creating
 * its resource, with a pause in between, so two overlapping loads on it would create each other's resource.
 */
const makeImporter = () => {
    const importer = {
        current: null as null | { name: string },
        fail: new Set<string>(),
        resources: [] as LoadedResource[],
        resourceModality: 'test',
        supportedModalities: ['test'],
        loadFromUrl: vi.fn(async (url: string) => {
            await new Promise(resolve => setTimeout(resolve, 5))
            return importer.fail.has(url) ? null : { name: url, modality: 'test' }
        }),
        registerMemoryManager: vi.fn(),
        useStudy: vi.fn(async (study: { name: string }) => {
            importer.current = study
            await new Promise(resolve => setTimeout(resolve, 5))
            return 0
        }),
        getResource: vi.fn(async () => {
            const resource = new LoadedResource(importer.current!.name)
            importer.resources.push(resource)
            return resource
        }),
    }
    return importer
}

describe('deferred studies', () => {
    let app: Epicurrents
    let dataset: MediaDataset
    let importer: ReturnType<typeof makeImporter>

    const list = (url: string, extra = {}) => app.addDeferredStudy(
        { loader: 'test/url', name: `listed ${url}`, source: url, ...extra },
        { dataset }
    )!

    beforeEach(() => {
        // The runtime wraps a module-level state singleton, so datasets outlive the application that created them.
        ;(window as unknown as { __EPICURRENTS__: undefined }).__EPICURRENTS__ = undefined
        app = new Epicurrents()
        app.runtime.APP.datasets.length = 0
        app.runtime.APP.activeDataset = null
        app.registerModule('test', { runtime: {}, settings: {} } as never)
        LoadedResource.failDestroy = false
        importer = makeImporter()
        app.registerStudyImporter('test/url', 'Test', 'url', importer as never)
        dataset = app.createDataset('dataset', true)
    })

    it('lists a study without touching its importer', () => {
        const listed = list('a', { properties: [['duration', 60], ['signals', 21]] })
        expect(isDeferredResource(listed)).toBe(true)
        expect(listed.isReady).toBe(false)
        expect(listed.state).toBe('added')
        expect([...listed.getMainProperties()]).toEqual([['duration', 60], ['signals', 21]])
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([listed])
        expect(importer.loadFromUrl).not.toHaveBeenCalled()
        expect(importer.getResource).not.toHaveBeenCalled()
    })

    it('refuses a study whose importer or module is missing', () => {
        expect(app.addDeferredStudy({ loader: 'none/url', name: 'x', source: 'x' }, { dataset })).toBeNull()
        expect(app.addDeferredStudy({ loader: 'test/url', modality: 'other', name: 'x', source: 'x' }, { dataset }))
            .toBeNull()
        expect(dataset.resources).toHaveLength(0)
    })

    it('loads an opened study into the place it was listed in', async () => {
        const before = list('a')
        const listed = list('b')
        const after = list('c')
        const onLoaded = vi.fn()
        ;(listed as unknown as { study: { onLoaded: unknown } }).study.onLoaded = onLoaded
        const loaded = await app.openDeferredResource(listed)
        expect(loaded).toBeInstanceOf(LoadedResource)
        expect(loaded!.name).toBe('b')
        expect(loaded!.isReady).toBe(true)
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([before, loaded, after])
        expect(dataset.resourceSorting.order).toEqual([before.id, loaded!.id, after.id])
        expect(onLoaded).toHaveBeenCalledWith(loaded)
        expect(listed.state).toBe('destroyed')
        expect(importer.loadFromUrl).toHaveBeenCalledTimes(1)
    })

    it('passes the listed name and options to the importer', async () => {
        const listed = list('a', { options: { authHeader: 'Bearer x' } })
        await app.openDeferredResource(listed)
        expect(importer.loadFromUrl).toHaveBeenCalledWith('a', { authHeader: 'Bearer x', name: 'listed a' })
    })

    it('keeps the dataset option from the importer', async () => {
        const listed = list('a', { options: { authHeader: 'Bearer x', dataset } })
        await app.openDeferredResource(listed)
        expect(importer.loadFromUrl).toHaveBeenCalledWith('a', { authHeader: 'Bearer x', name: 'listed a' })
    })

    it('shares one load between calls made while it runs', async () => {
        const listed = list('a')
        const [first, second] = await Promise.all([app.openDeferredResource(listed), app.openDeferredResource(listed)])
        expect(first).toBe(second)
        expect(importer.loadFromUrl).toHaveBeenCalledTimes(1)
    })

    it('loads two studies on one importer one at a time', async () => {
        const a = list('a')
        const b = list('b')
        const [loadedA, loadedB] = await Promise.all([app.openDeferredResource(a), app.openDeferredResource(b)])
        expect(loadedA!.name).toBe('a')
        expect(loadedB!.name).toBe('b')
    })

    it('shows the listing as loading while the study loads', async () => {
        const listed = list('a', { properties: [['duration', 60]] })
        const load = app.openDeferredResource(listed)
        expect(listed.state).toBe('loading')
        expect([...listed.getMainProperties().keys()]).toEqual(['Loading details...'])
        await load
    })

    it('puts an error resource in place of a study that fails to load', async () => {
        importer.fail.add('a')
        const listed = list('a')
        expect(await app.openDeferredResource(listed)).toBeNull()
        expect(dataset.resources).toHaveLength(1)
        expect(dataset.resources[0].resource.state).toBe('error')
        expect(isDeferredResource(dataset.resources[0].resource)).toBe(false)
    })

    it('destroys a study loaded for a listing that has left its dataset', async () => {
        const listed = list('a')
        const load = app.openDeferredResource(listed)
        dataset.removeResource(listed)
        expect(await load).toBeNull()
        expect(importer.resources[0].destroyed).toBe(true)
        expect(dataset.resources).toHaveLength(0)
    })

    it('answers with null, and forgets the load, when the unused study cannot be destroyed', async () => {
        LoadedResource.failDestroy = true
        const listed = list('a')
        const load = app.openDeferredResource(listed)
        dataset.removeResource(listed)
        expect(await load).toBeNull()
        // A load still remembered would be handed out again instead of the listing being looked for anew.
        expect(app.openDeferredResource(listed)).not.toBe(load)
    })

    it('counts an annotation edit on a study loaded from a listing', async () => {
        const loaded = (await app.openDeferredResource(list('a')))!
        loaded.dispatchPropertyChangeEvent('events' as never, [], [], 'after', { source: 'user' } as never)
        dataset.removeResource(loaded)
        expect(app.unloadNeedsConfirmation).toBe(true)
    })

    it('returns a resource that is not deferred as it is', async () => {
        const resource = new LoadedResource('loaded')
        expect(await app.openDeferredResource(resource as DataResource)).toBe(resource)
    })

    it('never makes a deferred resource active', () => {
        const listed = list('a')
        app.runtime.setActiveResource(listed)
        expect(listed.isActive).toBe(false)
        expect(dataset.activeResources).toHaveLength(0)
    })

    it('does not count a listing as open until its load is set going', async () => {
        const listed = list('a')
        expect(app.unloadNeedsConfirmation).toBe(false)
        const load = app.openDeferredResource(listed)
        expect(app.unloadNeedsConfirmation).toBe(true)
        await load
        expect(app.unloadNeedsConfirmation).toBe(true)
    })
})
