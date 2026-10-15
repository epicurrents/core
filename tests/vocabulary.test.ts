/**
 * The shipped vocabulary file and the loaders that turn it into a `CODED_EVENTS` table.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import vocabulary from '../src/assets/annotation/vocabulary/biosignal-events.json'
import { codedEventsFromVocabulary, mergeCodedEvents } from '../src/assets/annotation/vocabulary'
import type { CodedEventVocabulary } from '../src/types'

const VOCABULARY = vocabulary as CodedEventVocabulary
const EVENT_CLASSES = ['activation', 'answer', 'comment', 'event', 'example', 'question', 'technical', 'trigger']
const CROSSWALKS = ['dicom', 'hed', 'ieee', 'snomed']
/**
 * The code prefixes each category's terms carry. A code never changes once shipped, so a term that moves to another
 * category keeps the prefix it was given: the bedside signs carry `BIO_PHYS_` in OBSERVATION.
 */
const PREFIXES: Record<string, string[]> = {
    ENVIRONMENT: ['BIO_ENV_'],
    INTERVENTION: ['BIO_INT_'],
    OBSERVATION: ['BIO_OBS_', 'BIO_PHYS_'],
    TECHNICAL: ['BIO_TECH_'],
}
/** A HED tag in short form, with an optional value after a slash: `Speak`, `Prone`. */
const HED_TAG = /^[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*(\/[^/]+)?$/

const terms = () => Object.entries(VOCABULARY.categories).flatMap(
    ([category, { events }]) => Object.entries(events).map(([key, term]) => ({ category, key, term }))
)

describe('biosignal-events.json', () => {
    it('names its standard and version', () => {
        expect(VOCABULARY.standard).toBe('epicurrents.biosignal')
        expect(VOCABULARY.version).toMatch(/^\d+\.\d+$/)
    })

    it('scopes every category to acquisition', () => {
        expect(Object.keys(VOCABULARY.categories).sort()).toEqual(Object.keys(PREFIXES).sort())
        for (const category of Object.values(VOCABULARY.categories)) {
            expect(category.scope).toBe('acquisition')
            expect(Object.keys(category.events).length).toBeGreaterThan(0)
        }
    })

    it('gives every term a unique code carrying its category prefix, a name and a class', () => {
        const codes = new Set<string>()
        for (const { category, key, term } of terms()) {
            expect(term.code, key).toMatch(/^[A-Z][A-Z0-9_]+$/)
            const prefixed = PREFIXES[category].some(prefix => term.code.startsWith(prefix))
            expect(prefixed, `${term.code} in ${category}`).toBe(true)
            expect(codes.has(term.code), `duplicate ${term.code}`).toBe(false)
            codes.add(term.code)
            expect(term.name.length, key).toBeGreaterThan(0)
            expect(EVENT_CLASSES).toContain(term.class)
        }
    })

    it('uses only the four crosswalk columns', () => {
        for (const { key, term } of terms()) {
            for (const standard of Object.keys(term.standardCodes ?? {})) {
                expect(CROSSWALKS, `${key}: ${standard}`).toContain(standard)
            }
        }
    })

    it('names a HED tag in short form in its hed crosswalk', () => {
        const tags = terms().map(({ term }) => term.standardCodes?.hed).filter(tag => tag !== undefined)
        expect(tags.length).toBeGreaterThan(0)
        for (const tag of tags) {
            expect(String(tag)).toMatch(HED_TAG)
        }
    })

    it('describes every metadata key it names', () => {
        for (const { key, term } of terms()) {
            for (const [name, meaning] of Object.entries(term.meta ?? {})) {
                expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
                expect(meaning.length, `${key}.meta.${name}`).toBeGreaterThan(0)
            }
        }
    })
})

describe('codedEventsFromVocabulary', () => {
    const table = codedEventsFromVocabulary(VOCABULARY)

    it('loads every category and term', () => {
        expect(Object.keys(table)).toEqual(Object.keys(VOCABULARY.categories))
        for (const { category, key, term } of terms()) {
            expect(table[category][key].code).toBe(term.code)
        }
    })

    it('makes categories and terms read-only but extensible', () => {
        expect(() => {
            table.TECHNICAL = {}
        }).toThrow()
        expect(() => {
            table.TECHNICAL.CALIBRATION = { code: 'X', name: 'X' }
        }).toThrow()
        expect(() => {
            table.TECHNICAL.CALIBRATION.name = 'X'
        }).toThrow()
        Object.assign(table.TECHNICAL, { ADDED: { code: 'BIO_TECH_ADDED', name: 'Added' } })
        expect(table.TECHNICAL.ADDED.code).toBe('BIO_TECH_ADDED')
    })

    it('copies nested objects so the file data is never edited through the table', () => {
        const term = table.INTERVENTION.MEDICATION
        expect(term.meta).toEqual(VOCABULARY.categories.INTERVENTION.events.MEDICATION.meta)
        expect(term.meta).not.toBe(VOCABULARY.categories.INTERVENTION.events.MEDICATION.meta)
    })
})

describe('mergeCodedEvents', () => {
    it('lists the parent categories first and keeps the category objects live', () => {
        const parent = { A: { ONE: { code: 'A_ONE', name: 'One' } } }
        const own = { B: { TWO: { code: 'B_TWO', name: 'Two' } } }
        const merged = mergeCodedEvents(parent, own)
        expect(Object.keys(merged)).toEqual(['A', 'B'])
        expect(merged.A).toBe(parent.A)
        expect(merged.B).toBe(own.B)
    })

    it('refuses a category the parent already declares', () => {
        const parent = { A: {} }
        expect(() => mergeCodedEvents(parent, { A: {} })).toThrow(/'A' is already declared/)
    })
})
