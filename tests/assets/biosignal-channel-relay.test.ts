/**
 * A raw-mode channel edit must reach a listener watching the resource.
 *
 * The montage installs an equivalent relay on its own channels, so a per-channel sensitivity or
 * polarity edit repainted while a montage was active but silently reached nobody in raw mode —
 * the plot redrew the edit only when some later view change happened to rebuild the trace. The
 * test runs on a real event bus, because a mocked bus records the dispatch call without ever
 * delivering it, which is the half that broke.
 *
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import EventBus from '../../src/events/EventBus'
import GenericBiosignalResource from '../../src/assets/biosignal/GenericBiosignalResource'
import GenericSourceChannel from '../../src/assets/biosignal/components/GenericSourceChannel'
import type { SourceChannel } from '../../src/types'

class TestBiosignalResource extends GenericBiosignalResource {
    /** Add `channels` the way a module recording does: straight into `_channels`, then relay. */
    addSourceChannels (...channels: SourceChannel[]) {
        const from = this._channels.length
        this._channels.push(...channels)
        this._relaySourceChannelChanges(this._channels.slice(from))
    }
    getMainProperties () {
        return new Map<string, { [key: string]: string | number } | null>()
    }
    async prepare () {
        this.state = 'ready'
        return true
    }
}

/** `GenericSourceChannel` is abstract; a module ships the concrete class. */
class TestSourceChannel extends GenericSourceChannel {}

const sourceChannel = (index: number) => new TestSourceChannel(
    `ch_${index}`, `Channel ${index}`, 'eeg', index, false, 100, 'uV', true
)

describe('raw-mode channel property relay', () => {
    let originalWindow: typeof global.window

    beforeEach(() => {
        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: { __EPICURRENTS__: { APP: {}, EVENT_BUS: new EventBus(), RUNTIME: null } },
            writable: true,
        })
    })

    afterEach(() => {
        Object.defineProperty(global, 'window', { value: originalWindow, writable: true })
    })

    it('dispatches a resource-level channels change when a source channel property changes', () => {
        const resource = new TestBiosignalResource('test', 'eeg')
        const channel = sourceChannel(0)
        resource.addSourceChannels(channel)
        const onChannels = vi.fn()
        resource.onPropertyChange('channels', onChannels, 'test-subscriber')
        channel.sensitivity = 1e-4
        expect(onChannels).toHaveBeenCalledTimes(1)
        channel.displayPolarity = -1
        expect(onChannels).toHaveBeenCalledTimes(2)
    })

    it('relays every channel it was given, and each of them only once', () => {
        const resource = new TestBiosignalResource('test', 'eeg')
        const channels = [sourceChannel(0), sourceChannel(1)]
        resource.addSourceChannels(...channels)
        // A second call with the channels added earlier would double their events; passing only
        // the new ones is the contract the relay documents.
        resource.addSourceChannels(sourceChannel(2))
        const onChannels = vi.fn()
        resource.onPropertyChange('channels', onChannels, 'test-subscriber')
        for (const channel of resource.channels) {
            channel.sensitivity = 1e-4
        }
        expect(onChannels).toHaveBeenCalledTimes(3)
    })

    it('carries the channel list as the event value', () => {
        const resource = new TestBiosignalResource('test', 'eeg')
        const channel = sourceChannel(0)
        resource.addSourceChannels(channel)
        let value: unknown = null
        resource.onPropertyChange('channels', (newValue) => { value = newValue }, 'test-subscriber')
        channel.sensitivity = 1e-4
        expect(value).toBe(resource.channels)
    })
})
