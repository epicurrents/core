import { describe, expect, it, vi } from 'vitest'
import SETTINGS from '../src/config/Settings'

describe('Settings.addPropertyUpdateHandler', () => {
    it('keeps one handler registered for each unrelated field it watches', () => {
        const redraw = vi.fn()
        SETTINGS.addPropertyUpdateHandler('app.screenPPI', redraw, 'shared')
        SETTINGS.addPropertyUpdateHandler('app.theme', redraw, 'shared')
        SETTINGS.onPropertyUpdate('app.screenPPI', 1, 2)
        SETTINGS.onPropertyUpdate('app.theme', 'dark', 'light')
        expect(redraw).toHaveBeenCalledTimes(2)
    })
    it('still collapses a repeat registration of the same field', () => {
        const redraw = vi.fn()
        SETTINGS.addPropertyUpdateHandler('app.screenPPI', redraw, 'dup')
        SETTINGS.addPropertyUpdateHandler('app.screenPPI', redraw, 'dup')
        SETTINGS.onPropertyUpdate('app.screenPPI', 1, 2)
        expect(redraw).toHaveBeenCalledTimes(1)
    })
})
