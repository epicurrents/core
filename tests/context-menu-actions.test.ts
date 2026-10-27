/**
 * The registry of actions hosts add to the interface's context menus.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Epicurrents } from '../src'
import type { ContextMenuAction } from '../src/types/application'

const action = (label = 'Action'): ContextMenuAction => ({
    label,
    targets: ['annotation'],
    run: () => {},
})

describe('context menu actions', () => {
    const app = new Epicurrents()

    afterEach(() => {
        for (const name of [...app.runtime.APP.contextMenuActions.keys()]) {
            app.unregisterContextMenuAction(name)
        }
    })

    it('lists every registered action by name', () => {
        app.registerContextMenuAction('a', action('A'))
        app.registerContextMenuAction('b', action('B'))
        expect([...app.getContextMenuActions().keys()]).toEqual(['a', 'b'])
    })

    it('replaces an action registered under the same name', () => {
        app.registerContextMenuAction('a', action('First'))
        app.registerContextMenuAction('a', action('Second'))
        const actions = app.getContextMenuActions()
        expect(actions.size).toBe(1)
        expect(actions.get('a')?.label).toBe('Second')
    })

    it('hands out a copy, so a caller cannot register behind the application', () => {
        app.getContextMenuActions().set('sneaked', action())
        expect(app.getContextMenuActions().has('sneaked')).toBe(false)
    })

    it('reports whether an action was removed', () => {
        app.registerContextMenuAction('a', action())
        expect(app.unregisterContextMenuAction('a')).toBe(true)
        expect(app.unregisterContextMenuAction('a')).toBe(false)
    })
})
