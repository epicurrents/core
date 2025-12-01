/**
 * A biosignal channel marker.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BiosignalChannel, BiosignalChannelMarker } from '#types/biosignal'
import GenericAsset from '#assets/GenericAsset'

export default class GenericBiosignalMarker extends GenericAsset implements BiosignalChannelMarker {
    protected _channel: BiosignalChannel
    protected _dragging = false
    protected _label: string
    protected _position: number | null = null
    protected _value: number | null = null

    constructor (
        name: string,
        channel: BiosignalChannel,
        label: string,
        position: number | null = null,
        value: number | null = null
    ) {
        super(name, 'marker')
        this._channel = channel
        this._label = label
        if (value !== null) {
            this._position = position
            this._value = value
        } else if (position !== null) {
            // Try to get the value from the position.
            this.setPosition(position)
        }
    }

    get channel () {
        return this._channel
    }
    get dragging () {
        return this._dragging
    }
    set dragging (value: boolean) {
        this._setPropertyValue('dragging', value)
    }
    get label () {
        return this._label
    }
    set label (value: string) {
        this._setPropertyValue('label', value)
    }
    get position () {
        return this._position
    }
    set position (value: number | null) {
        this._setPropertyValue('position', value)
    }
    get value () {
        return this._value
    }
    set value (value: number | null) {
        this._setPropertyValue('value', value)
    }

    setPosition (position: number | null): void {
        this.position = position
    }

    setValue (value: number | null): void {
        this.value = value
    }
}
