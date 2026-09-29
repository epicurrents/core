/**
 * Tests for the unload guard the application exposes.
 *
 * Leaving the document ends a review session: the resources open in the viewer are closed and any
 * annotation edits go with them, and neither is recoverable — finding a long recording again and
 * navigating back to the same position is expensive at best. The application's job is to say whether
 * there is anything to lose; the prompting is the interface's (`beforeunload`) and an embedding
 * host's (its router).
 *
 * What these tests pin is the two conditions and where each stops: an open resource counts while it
 * is open, an annotation edit counts from the moment it is made and outlives the resource, a
 * recording's own annotations and a failed load count for nothing, and the waiver covers both so an
 * application-initiated reload does not prompt about itself.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Epicurrents } from '../src'
import type { DataResource } from '../src/types/application'

/** Property-change callbacks a resource received, by event name. */
type Listeners = Record<string, ((event: unknown) => void)[]>

/** A resource that records what the application subscribed to, in place of a loaded recording. */
const fakeResource = (listeners: Listeners) => ({
    addEventListener: (event: string, callback: (event: unknown) => void) => {
        (listeners[event] ??= []).push(callback)
    },
}) as unknown as DataResource

/**
 * Hand the application a resource the way the runtime does when one is added to a dataset — the
 * announcement only, without putting it in a dataset, so the annotation condition is measured on its
 * own. {@link openResource} is the other half.
 */
const addResource = (app: Epicurrents, listeners: Listeners) => {
    ;(app.runtime as unknown as {
        dispatchPayloadEvent: (event: string, payload: unknown) => void
    }).dispatchPayloadEvent('add-resource', { resource: fakeResource(listeners) })
}

/** Open a resource in the viewer, by putting it in a dataset the way a loaded study ends up. */
const openResource = (app: Epicurrents, id: string, state = 'added') => {
    // A dataset subscribes to each resource's active state, and on removal unsubscribes and unloads it.
    const resource = {
        id,
        name: id,
        state,
        destroy: () => Promise.resolve(),
        onPropertyChange: () => {},
        removeAllEventListeners: () => {},
        unload: () => Promise.resolve(),
    } as unknown as DataResource
    const dataset = app.runtime.APP.activeDataset ?? app.createDataset(`dataset for ${id}`, true)
    dataset.addResource({ resource })
    return resource
}

/** Announce a change to an annotation property with the given source. */
const change = (listeners: Listeners, property: string, source?: 'system' | 'user') => {
    for (const callback of listeners[`property-change:${property}`] ?? []) {
        callback({ detail: { property, source } })
    }
}

describe('unload guard', () => {
    let app: Epicurrents
    let listeners: Listeners
    beforeEach(() => {
        // Each application takes over the document's globals, so the previous one is discarded. Its
        // datasets are not: the runtime wraps a module-level state singleton, so they outlive the
        // application that created them and have to be cleared by hand between tests.
        ;(window as unknown as { __EPICURRENTS__: undefined }).__EPICURRENTS__ = undefined
        app = new Epicurrents()
        app.runtime.APP.datasets.length = 0
        app.runtime.APP.activeDataset = null
        listeners = {}
    })

    it('needs no confirmation with nothing open and nothing annotated', () => {
        addResource(app, listeners)
        expect(app.unloadNeedsConfirmation).toBe(false)
    })
    it('needs confirmation while a resource is open', () => {
        // The review session is the work: relocating a long recording and navigating back to the
        // same position is expensive at best, so an open resource is enough on its own.
        openResource(app, 'recording-1')
        expect(app.unloadNeedsConfirmation).toBe(true)
    })
    it('stops needing confirmation once the last resource is closed', () => {
        const resource = openResource(app, 'recording-1')
        openResource(app, 'recording-2')
        const dataset = app.runtime.APP.activeDataset!
        dataset.removeResource(resource)
        expect(app.unloadNeedsConfirmation).toBe(true)
        dataset.removeResource('recording-2')
        expect(app.unloadNeedsConfirmation).toBe(false)
    })
    it('does not count a resource that failed to load or was destroyed', () => {
        // An ErrorResource is added to the dataset like any other, and there is nothing to return to.
        openResource(app, 'broken', 'error')
        openResource(app, 'gone', 'destroyed')
        expect(app.unloadNeedsConfirmation).toBe(false)
    })
    it('counts a resource that is still loading', () => {
        // The user set it going and would have to set it going again.
        openResource(app, 'recording-1', 'loading')
        expect(app.unloadNeedsConfirmation).toBe(true)
    })
    it('counts an annotation edit after the resource it was made on is closed', () => {
        // The edit is gone either way, so closing the recording must not make leaving look safe.
        const resource = openResource(app, 'recording-1')
        addResource(app, listeners)
        change(listeners, 'events', 'user')
        app.runtime.APP.activeDataset!.removeResource(resource)
        expect(app.unloadNeedsConfirmation).toBe(true)
    })
    it('waives an open resource as well as an annotation edit', () => {
        openResource(app, 'recording-1')
        app.allowUnload()
        expect(app.unloadNeedsConfirmation).toBe(false)
    })
    it('subscribes to both annotation properties of every resource added', () => {
        addResource(app, listeners)
        expect(Object.keys(listeners).sort()).toStrictEqual([
            'property-change:events', 'property-change:labels',
        ])
    })
    it('ignores the annotations a recording arrives with', () => {
        // The reader applies a file's own events with a 'system' source. Counting those would make
        // the guard fire on closing a tab in which nothing was edited, which is every ordinary exit.
        addResource(app, listeners)
        change(listeners, 'events', 'system')
        change(listeners, 'labels', 'system')
        expect(app.unloadNeedsConfirmation).toBe(false)
    })
    it('counts a user edit to either property', () => {
        addResource(app, listeners)
        change(listeners, 'events', 'user')
        expect(app.unloadNeedsConfirmation).toBe(true)
        const second = new Epicurrents()
        const secondListeners: Listeners = {}
        addResource(second, secondListeners)
        change(secondListeners, 'labels', 'user')
        expect(second.unloadNeedsConfirmation).toBe(true)
    })
    it('counts a change whose source was left unspecified', () => {
        // An omitted source means 'user' throughout the codebase, and a viewer component adding an
        // event the user drew passes no context. Over-warning is the safe direction here.
        addResource(app, listeners)
        change(listeners, 'events', undefined)
        expect(app.unloadNeedsConfirmation).toBe(true)
    })
    it('tracks resources added after the first', () => {
        addResource(app, listeners)
        const later: Listeners = {}
        addResource(app, later)
        change(later, 'events', 'user')
        expect(app.unloadNeedsConfirmation).toBe(true)
    })
    it('stops needing confirmation once the application waives it', () => {
        addResource(app, listeners)
        change(listeners, 'events', 'user')
        app.allowUnload()
        expect(app.unloadNeedsConfirmation).toBe(false)
    })
    it('keeps the waiver in effect for edits made after it', () => {
        // The waiver is taken immediately before a reload, so anything after it belongs to a
        // document that is already on its way out.
        addResource(app, listeners)
        app.allowUnload()
        change(listeners, 'events', 'user')
        expect(app.unloadNeedsConfirmation).toBe(false)
    })
})
