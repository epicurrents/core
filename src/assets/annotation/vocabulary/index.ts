/**
 * Coded event vocabularies: the files a package ships in this directory, the loader that turns one into a
 * `CODED_EVENTS` table, and the merge that stacks the tables of a class hierarchy into one view.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { CodedEventProperties, CodedEventTable, CodedEventVocabulary } from '#types'

/** Define `key` on `target` as an enumerable property that cannot be reassigned. */
const defineReadOnly = (target: object, key: string, value: unknown) => {
    Object.defineProperty(target, key, { enumerable: true, value, writable: false })
}

/**
 * A copy of `term` whose own properties cannot be reassigned. The nested `meta` and `standardCodes` objects are
 * shallow copies that stay writable, so `addStandardEventCodes` can add a crosswalk to a term after the fact.
 */
const readOnlyTerm = (term: CodedEventProperties): CodedEventProperties => {
    const copy = Object.create(null) as CodedEventProperties
    for (const [key, value] of Object.entries(term)) {
        defineReadOnly(copy, key, value && typeof value === 'object' ? { ...value } : value)
    }
    return copy
}

/**
 * Build a `CODED_EVENTS` table from a vocabulary file.
 *
 * Categories and terms are defined read-only, so neither a category nor a term can be replaced through the table;
 * both objects stay extensible, which is what `extendEvents` relies on to add a term to a category.
 * @param vocabulary - The parsed vocabulary JSON.
 */
export const codedEventsFromVocabulary = (vocabulary: CodedEventVocabulary): CodedEventTable => {
    const table = Object.create(null) as CodedEventTable
    for (const [category, { events }] of Object.entries(vocabulary.categories)) {
        const terms = Object.create(null) as CodedEventTable[string]
        for (const [key, term] of Object.entries(events)) {
            defineReadOnly(terms, key, readOnlyTerm(term))
        }
        defineReadOnly(table, category, terms)
    }
    return table
}

/**
 * One table over a parent class's categories and a class's own, the parent's first. The category objects are the
 * originals rather than copies, so a term added through the merged view lands in the table that owns the category.
 * @param parent - The table of the class being extended.
 * @param own - The extending class's own table.
 * @throws Error when both tables declare the same category: a subclass cannot shadow a category it inherits.
 */
export const mergeCodedEvents = (parent: CodedEventTable, own: CodedEventTable): CodedEventTable => {
    const merged = Object.create(null) as CodedEventTable
    for (const [category, terms] of Object.entries(parent)) {
        defineReadOnly(merged, category, terms)
    }
    for (const [category, terms] of Object.entries(own)) {
        if (Object.hasOwn(merged, category)) {
            throw new Error(`Coded event category '${category}' is already declared by a parent class.`)
        }
        defineReadOnly(merged, category, terms)
    }
    return merged
}
