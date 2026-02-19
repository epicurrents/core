/**
 * Unit tests for StudyCollection class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import StudyCollection from '../../src/assets/study/StudyCollection'

describe('StudyCollection', () => {
    describe('constructor', () => {
        it('should create a collection with a name', () => {
            const collection = new StudyCollection('Test Collection')
            expect(collection.name).toBe('Test Collection')
            expect(collection.studies).toEqual([])
            expect(collection.date).toBeNull()
        })

        it('should accept optional studies', () => {
            const studies = [
                { name: 'study1' } as any,
                { name: 'study2' } as any,
            ]
            const collection = new StudyCollection('Test', studies)
            expect(collection.studies).toEqual(studies)
        })
    })

    describe('getters/setters', () => {
        it('should set and get date', () => {
            const collection = new StudyCollection('Test')
            const date = new Date('2025-01-01')
            collection.date = date
            expect(collection.date).toBe(date)
        })

        it('should set date to null', () => {
            const collection = new StudyCollection('Test')
            collection.date = new Date()
            collection.date = null
            expect(collection.date).toBeNull()
        })

        it('should set and get name', () => {
            const collection = new StudyCollection('Original')
            collection.name = 'Updated'
            expect(collection.name).toBe('Updated')
        })

        it('should set and get studies', () => {
            const collection = new StudyCollection('Test')
            const studies = [{ name: 'new-study' } as any]
            collection.studies = studies
            expect(collection.studies).toEqual(studies)
        })
    })
})
