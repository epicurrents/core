/**
 * Generic annotation.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import { safeObjectFrom } from '#util'
import type {
    Annotation,
    AnnotationOptions,
    AssetSerializeOptions,
    CodedEventProperties,
} from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'GenericAnnotation'

/** The private property holding the coded events. */
const _CODED_EVENTS = safeObjectFrom({}) as Record<string,
    Record<string, CodedEventProperties>
>

export default abstract class GenericAnnotation extends GenericAsset implements Annotation {
    /**
     * Standardized coded events.
     * ```
     * CODED_EVENTS:
     * -- [category: string]:
     *    -- [eventName: string]: CodedEventProperties
     * ```
     * @remarks
     * The coded events of each subclass are isolated from each other. This should be overridden in subclasses to
     * provide class-specific coded events.
     */
    static get CODED_EVENTS () {
        return _CODED_EVENTS
    }
    /**
     * Add standardized event codes to existing coded events.
     * @param standard - The external standard the codes follow.
     * @param codes - The codes to add following `CODED_EVENTS` structure.
     */
    public static readonly addStandardEventCodes = (
        standard: string,
        codes: Record<string, Record<string, number | string>>
    ) => {
        for (const [category, events] of Object.entries(codes)) {
            if (!Object.hasOwn(GenericAnnotation.CODED_EVENTS, category) && Object.keys(events).length) {
                Log.warn(
                    `The category '${
                        category
                    }' does not exist in CODED_EVENTS. Skipping adding standard codes for this category.`,
                    SCOPE
                )
                continue
            }
            const categoryEvents = GenericAnnotation.CODED_EVENTS[category]
            for (const [eventName, eventCode] of Object.entries(events)) {
                const event = categoryEvents[eventName]
                if (event) {
                    if (!event.standardCodes) {
                        event.standardCodes = {}
                    }
                    event.standardCodes[standard] = eventCode
                } else {
                    Log.warn(
                        `The event name '${
                            eventName
                        }' does not exist in category '${
                            category
                        }' of CODED_EVENTS. Skipping adding standard code for this event.`,
                        SCOPE
                    )
                }
            }
        }
    }
    /**
     * Extend the given event category with new events.
     * @param category - The event category to extend.
     * @param events - The events to add.
     * @throws Error if an event key already exists in the category.
     */
    public static readonly extendEvents = (category: string, events: Record<string, CodedEventProperties> ) => {
        for (const eventKey of Object.keys(events)) {
            if (Object.hasOwn(GenericAnnotation.CODED_EVENTS[category], eventKey)) {
                Log.error(
                    SCOPE,
                    `GenericAnnotation.extendEvents: Mutating the existing event '${
                        eventKey
                    }' in category '${
                        category
                    }' is not allowed.`
                )
                throw new Error(
                    `GenericAnnotation.extendEvents: Event key '${eventKey}' already exists in category '${category}'.`
                )
            }
        }
        // CODED_EVENTS is a safe object so we can assign properties directly.
        Object.assign(GenericAnnotation.CODED_EVENTS[category], events)
    }
    /**
     * Get a standardized EEG event by its code.
     * @param code - Event code.
     * @param standard - Possible external standard the code follows ('dicom' or 'ieee').
     * @returns The matching EEG coded event properties or null if not found.
     */
    public static getEventForCode (code: string, standard?: string): CodedEventProperties | null {
        for (const categoryKey of Object.keys(GenericAnnotation.CODED_EVENTS)) {
            const category = GenericAnnotation.CODED_EVENTS[categoryKey as keyof typeof GenericAnnotation.CODED_EVENTS]
            for (const eventKey of Object.keys(category)) {
                const event = category[eventKey]
                if (standard && event.standardCodes && event.standardCodes[standard] === code) {
                    return event
                } else if (event.code === code) {
                    return event
                }
            }
        }
        return null
    }
    /**
     * Get a standardized EEG event by its label.
     * @param label - Event label.
     * @param labelMatchers - Optional custom regular expressions to match labels to specific event codes.
     * @returns The matching EEG coded event properties or null if not found.
     */
    public static getEventForLabel (
        label: string,
        labelMatchers: Record<string, RegExp> = {}
    ): CodedEventProperties | null {
        for (const categoryKey of Object.keys(GenericAnnotation.CODED_EVENTS)) {
            const category = GenericAnnotation.CODED_EVENTS[categoryKey as keyof typeof GenericAnnotation.CODED_EVENTS]
            for (const eventKey of Object.keys(category)) {
                const event = category[eventKey]
                const matcher = labelMatchers[event.code]
                if (matcher && matcher.test(label)) {
                    return event
                } else if (event.name.toLowerCase() === label.toLowerCase()) {
                    return event
                }
            }
        }
        return null
    }

    protected _annotator: string
    protected _class: Annotation['class']
    protected _codes: Record<string, number | string>
    protected _label: string
    protected _priority: number
    protected _text: string
    protected _type: string
    protected _value: boolean | number | number[] | string | string[] | null
    protected _visible: boolean

    constructor (
        // Required properties:
        name: string, value: boolean | number | number[] | string | string[] | null, type: string,
        // Optional properties:
        options?: AnnotationOptions,
    ) {
        super(name, type)
        this._value = value
        this._type = type
        // Optional properties.
        this._annotator = options?.annotator ?? ''
        this._class = options?.class ?? 'event'
        this._codes = options?.codes ?? {} as Record<string, number | string>
        this._label = options?.label ?? ''
        this._priority = options?.priority ?? 0
        this._text = options?.text ?? ''
        this._visible = options?.visible ?? true
    }

    get annotator () {
        return this._annotator
    }
    set annotator (value: string) {
        this._setPropertyValue('annotator', value)
    }

    get class () {
        return this._class
    }
    set class (value: Annotation['class']) {
        this._setPropertyValue('class', value)
    }

    get codes () {
        return this._codes
    }
    set codes (value: Record<string, number | string>) {
        this._setPropertyValue('codes', value)
    }

    get label () {
        return this._label !== undefined
                            ? this._label
                            : (Array.isArray(this._value) ? this._value.join(', ') : String(this._value))
    }
    set label (value: string) {
        this._setPropertyValue('label', value)
    }

    get priority () {
        return this._priority
    }
    set priority (value: number) {
        this._setPropertyValue('priority', value)
    }

    get text () {
        return this._text
    }
    set text (value: string) {
        this._setPropertyValue('text', value)
    }

    get type () {
        return this._type
    }
    set type (value: string) {
        this._setPropertyValue('type', value)
    }

    get value () {
        return this._value
    }
    set value (value: boolean | number | number[] | string | string[] | null) {
        this._setPropertyValue('value', value)
    }

    get visible () {
        return this._visible
    }
    set visible (value: boolean) {
        this._setPropertyValue('visible', value)
    }

    serialize (options: AssetSerializeOptions = {}) {
        let finalValue = this._value as boolean | number | number[] | string | string[] | null
        if ( // Handle values that should be set to null:
            options.nullIfEmpty?.includes('value') &&
            (Array.isArray(finalValue) || typeof finalValue === 'string') &&
            !finalValue.length
        ) {
            finalValue = null
        }
        return {
            annotator: this.annotator || (options.nullIfEmpty?.includes('annotator') ? null : ''),
            class: this.class || (options.nullIfEmpty?.includes('class') ? null : 'event'),
            codes: Object.keys(this.codes).length > 0
                   ? this.codes
                   : (options.nullIfEmpty?.includes('codes') ? null : {}),
            label: this.label || (options.nullIfEmpty?.includes('label') ? null : ''),
            name: this.name || (options.nullIfEmpty?.includes('name') ? null : ''),
            priority: this.priority,
            text: this.text || (options.nullIfEmpty?.includes('text') ? null : ''),
            type: this.type || (options.nullIfEmpty?.includes('type') ? null : ''),
            value: finalValue,
            visible: this.visible,
        }
    }
}
