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
    CodedEventTable,
    PropertyChangeContext,
} from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'GenericAnnotation'

/** The base table: no class-independent terms exist, so it is empty and every class stacks its own on it. */
const _CODED_EVENTS = safeObjectFrom({}) as CodedEventTable

export default abstract class GenericAnnotation extends GenericAsset implements Annotation {
    /**
     * Standardized coded events.
     * ```
     * CODED_EVENTS:
     * -- [category: string]:
     *    -- [eventName: string]: CodedEventProperties
     * ```
     * @remarks
     * A class that declares terms keeps them in a vocabulary file, loads it with `codedEventsFromVocabulary` and
     * overrides this getter to return `mergeCodedEvents(super.CODED_EVENTS, ownTable)`, so it sees every category
     * up its chain. The lookups and the extension methods below read `this.CODED_EVENTS`, which is what lets a
     * subclass inherit them over its own view rather than copy them.
     */
    static get CODED_EVENTS (): CodedEventTable {
        return _CODED_EVENTS
    }
    /**
     * Add standardized event codes to existing coded events. A term that already carries a code for `standard`
     * keeps it and is reported; a term or category the table does not have is reported and skipped.
     * @param standard - The external standard the codes follow.
     * @param codes - The codes to add following `CODED_EVENTS` structure.
     */
    public static addStandardEventCodes (standard: string, codes: Record<string, Record<string, number | string>>) {
        for (const [category, events] of Object.entries(codes)) {
            const categoryEvents = this.CODED_EVENTS[category]
            if (!categoryEvents) {
                if (Object.keys(events).length) {
                    Log.warn(
                        `The category '${
                            category
                        }' does not exist in CODED_EVENTS. Skipping adding standard codes for this category.`,
                        SCOPE
                    )
                }
                continue
            }
            for (const [eventName, eventCode] of Object.entries(events)) {
                const event = categoryEvents[eventName]
                if (!event) {
                    Log.warn(
                        `The event name '${
                            eventName
                        }' does not exist in category '${
                            category
                        }' of CODED_EVENTS. Skipping adding standard code for this event.`,
                        SCOPE
                    )
                    continue
                }
                if (!event.standardCodes) {
                    // A term's own properties are read-only, but a term is extensible.
                    Object.assign(event, { standardCodes: {} })
                } else if (Object.hasOwn(event.standardCodes, standard)) {
                    Log.warn(
                        `The event '${eventName}' in category '${category}' already has a standard code for '${
                            standard
                        }'.`,
                        SCOPE
                    )
                    continue
                }
                Object.assign(event.standardCodes!, { [standard]: eventCode })
            }
        }
    }
    /**
     * Extend the given event category with new events.
     * @param category - The event category to extend; a category some class in the chain declares.
     * @param events - The events to add.
     * @throws Error if the category does not exist or an event key already exists in it.
     */
    public static extendEvents (category: string, events: Record<string, CodedEventProperties>) {
        const categoryEvents = this.CODED_EVENTS[category]
        if (!categoryEvents) {
            throw new Error(`${this.name}.extendEvents: Category '${category}' does not exist in CODED_EVENTS.`)
        }
        for (const eventKey of Object.keys(events)) {
            if (Object.hasOwn(categoryEvents, eventKey)) {
                Log.error(
                    `Mutating the existing event '${eventKey}' in category '${category}' is not allowed.`,
                    SCOPE
                )
                throw new Error(
                    `${this.name}.extendEvents: Event key '${eventKey}' already exists in category '${category}'.`
                )
            }
        }
        // A category object is extensible, so new keys land in the table that owns it.
        Object.assign(categoryEvents, events)
    }
    /**
     * Get a coded event by its code.
     * @param code - Event code.
     * @param standard - Possible external standard the code follows (a key of the term's `standardCodes`).
     * @returns The matching coded event properties or null if not found.
     */
    public static getEventForCode (code: string, standard?: string): CodedEventProperties | null {
        for (const category of Object.values(this.CODED_EVENTS)) {
            for (const event of Object.values(category)) {
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
     * Get a coded event by its label.
     * @param label - Event label.
     * @param labelMatchers - Optional custom regular expressions to match labels to specific event codes.
     * @returns The matching coded event properties or null if not found.
     */
    public static getEventForLabel (
        label: string,
        labelMatchers: Record<string, RegExp> = {}
    ): CodedEventProperties | null {
        for (const category of Object.values(this.CODED_EVENTS)) {
            for (const event of Object.values(category)) {
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
    /**
     * Explicit label, or `undefined` when none was given and {@link label} should render the value
     * instead. Left optional deliberately: defaulting it to `''` would make "no label supplied"
     * indistinguishable from "deliberately blank", and the value fallback unreachable.
     */
    protected _label: string | undefined
    protected _locked: boolean
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
        this._label = options?.label
        this._locked = options?.locked ?? false
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

    /**
     * Visible name of this annotation. An annotation given no label renders its {@link value}
     * instead, so one constructed from a value alone still has something to display; an explicitly
     * empty label is a deliberate blank and is returned as such.
     *
     * A null value renders as the empty string rather than the word "null".
     */
    get label (): string {
        if (this._label !== undefined) {
            return this._label
        }
        if (this._value === null) {
            return ''
        }
        return Array.isArray(this._value) ? this._value.join(', ') : String(this._value)
    }
    set label (value: string) {
        this._setPropertyValue('label', value)
    }

    get locked () {
        return this._locked
    }
    set locked (value: boolean) {
        if (this._locked) {
            return
        }
        this._setPropertyValue('locked', value)
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

    protected _setPropertyValue (property: keyof this, newValue: unknown, context?: PropertyChangeContext) {
        if (this._locked && property !== 'locked' && property !== 'isActive') {
            Log.error(`Attempted to modify locked annotation '${this._label}'.`, SCOPE)
            return
        }
        super._setPropertyValue(property, newValue, context)
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
            locked: this.locked,
            name: this.name || (options.nullIfEmpty?.includes('name') ? null : ''),
            priority: this.priority,
            text: this.text || (options.nullIfEmpty?.includes('text') ? null : ''),
            type: this.type || (options.nullIfEmpty?.includes('type') ? null : ''),
            value: finalValue,
            visible: this.visible,
        }
    }
}
