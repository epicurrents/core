import { Log } from 'scoped-event-log'
import { 
    deepClone,
    enumerate,
    getOrSetValue,
    isEmptyObject,
    nullPromise,
    safeObjectFrom,
    sleep
} from '../../src/util/general'

// Mock the Log.error function
jest.mock('scoped-event-log', () => ({
    Log: {
        error: jest.fn()
    }
}))

describe('General utilities', () => {
    describe('deepClone', () => {
        // Expected functionality (happy paths).
        it('should clone primitive values', () => {
            expect(deepClone(42)).toBe(42)
            expect(deepClone('test')).toBe('test')
            expect(deepClone(true)).toBe(true)
        })
        // A JSON-serializable objects.
        it('should create a deep clone of an object', () => {
            const original = {
                a: 1,
                b: { c: 2 },
                d: [1, 2, { e: 3 }]
            }
            const clone = deepClone(original)
            expect(clone).toEqual(original)
            expect(clone).not.toBe(original)
            expect(clone?.b).not.toBe(original.b)
        })
        // Non-serializable properties.
        it('should strip non-JSON-serializable properties', () => {
            const method = {
                a: (b: any) => { return b },
                c: 'test',
            }
            const clone = deepClone(method)
            expect(clone).toEqual({ c: 'test' })
        })
        // Non-serializable objects.
        it('should return null for non-JSON-serializable objects', () => {
            const circular: any = { a: 1 }
            circular.self = circular
            const result = deepClone(circular)
            expect(result).toBeNull()
            expect(Log.error).toHaveBeenCalled()
            jest.resetAllMocks()
        })
    })

    describe('enumerate', () => {
        // Expected functionality (happy paths).
        it('should yield index-value pairs', () => {
            const array = ['a', 'b', 'c']
            const result = Array.from(enumerate(array))
            expect(result).toEqual([[0, 'a'], [1, 'b'], [2, 'c']])
        })
        it('should handle empty arrays', () => {
            const result = Array.from(enumerate([]))
            expect(result).toEqual([])
        })
    })

    describe('getOrSetValue', () => {
        // Expected functionality (happy paths).
        it('should return existing value if key exists', () => {
            const map = new Map<string, number>()
            map.set('test', 42)
            
            const result = getOrSetValue(map, 'test', 0)
            expect(result).toBe(42)
        })
        it('should set and return new value if key does not exist', () => {
            const map = new Map<string, number>()
            const result = getOrSetValue(map, 'test', 42)
            
            expect(result).toBe(42)
            expect(map.get('test')).toBe(42)
        })
    })

    describe('isEmptyObject', () => {
        // Expected functionality (happy paths).
        it('should return true for empty objects', () => {
            expect(isEmptyObject({})).toBe(true)
        })
        it('should return false for non-empty objects', () => {
            expect(isEmptyObject({ a: 1 })).toBe(false)
        })
        // Falsy non-objects.
        it('should return false for null or undefined', () => {
            expect(isEmptyObject(null as unknown as object)).toBe(false)
            expect(isEmptyObject(undefined as unknown as object)).toBe(false)
        })
        // Extended object classes.
        it('should return false for objects with inherited properties', () => {
            class Test {}
            expect(isEmptyObject(new Test())).toBe(false)
        })
    })

    describe('nullPromise', () => {
        it('should resolve to null', async () => {
            const result = await nullPromise
            expect(result).toBeNull()
        })
    })

    describe('safeObjectFrom', () => {
        // Expected functionality (happy paths).
        it('should create object without prototype', () => {
            const template = { a: 1, b: 2 }
            const result = safeObjectFrom(template)
            expect(result).toEqual(template)
            expect(Object.getPrototypeOf(result)).toBeNull()
            expect(result['__proto__']).toBeUndefined()
        })
        it('should copy all properties', () => {
            const template = { a: 1, b: { c: 2 } }
            const result = safeObjectFrom(template)
            expect(result).toEqual(template)
        })
    })

    describe('sleep', () => {
        beforeEach(() => {
            jest.useFakeTimers()
        })
        afterEach(() => {
            jest.useRealTimers()
        })
        // Expected functionality (happy paths).
        it('should resolve after specified duration', async () => {
            const promise = sleep(1000)
            jest.advanceTimersByTime(1000)
            await promise
            // Test passes if promise resolves.
        })
        it('should not resolve before duration', async () => {
            const promise = sleep(1000)
            jest.advanceTimersByTime(999)
            const immediateResult = await Promise.race([
                promise,
                Promise.resolve('not done')
            ])
            expect(immediateResult).toBe('not done')
        })
    })
})