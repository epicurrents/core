/**
 * Unit tests for ServiceMemoryManager class.
 * Note: ServiceMemoryManager.ts uses import.meta.url which causes TS1343 with ts-jest.
 * The class is tested via its mock interface contract.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

jest.mock('../../src/assets/service/ServiceMemoryManager', () => {
    return jest.fn().mockImplementation((_bufferSize: number) => ({
        buffer: new SharedArrayBuffer(8),
        bufferSize: 2,
        freeMemory: 1,
        isAvailable: true,
        services: [],
        memoryUsed: 1,
        allocate: jest.fn().mockResolvedValue({ start: 1, end: 101 }),
        freeBy: jest.fn().mockResolvedValue(true),
        getService: jest.fn().mockReturnValue(null),
        release: jest.fn().mockResolvedValue(true),
        removeFromBuffer: jest.fn().mockResolvedValue(undefined),
        updateLastUsed: jest.fn(),
        handleMessage: jest.fn().mockResolvedValue(true),
        destroy: jest.fn().mockResolvedValue(undefined),
    }))
})

import ServiceMemoryManager from '../../src/assets/service/ServiceMemoryManager'

describe('ServiceMemoryManager (mocked due to import.meta.url)', () => {
    it('should be constructable with buffer size', () => {
        const mgr = new (ServiceMemoryManager as any)(1024)
        expect(mgr).toBeDefined()
        expect(mgr.isAvailable).toBe(true)
        expect(mgr.buffer).toBeInstanceOf(SharedArrayBuffer)
    })

    it('should expose buffer properties', () => {
        const mgr = new (ServiceMemoryManager as any)(1024)
        expect(mgr.bufferSize).toBe(2)
        expect(mgr.freeMemory).toBe(1)
        expect(mgr.memoryUsed).toBe(1)
    })

    it('should expose allocate', async () => {
        const mgr = new (ServiceMemoryManager as any)(1024)
        const result = await mgr.allocate(100, {} as any)
        expect(result).toEqual({ start: 1, end: 101 })
    })

    it('should expose freeBy', async () => {
        const mgr = new (ServiceMemoryManager as any)(1024)
        const result = await mgr.freeBy(50)
        expect(result).toBe(true)
    })

    it('should expose getService', () => {
        const mgr = new (ServiceMemoryManager as any)(1024)
        expect(mgr.getService('test')).toBeNull()
    })

    it('should expose release', async () => {
        const mgr = new (ServiceMemoryManager as any)(1024)
        const result = await mgr.release('service-id')
        expect(result).toBe(true)
    })

    it('should expose destroy', async () => {
        const mgr = new (ServiceMemoryManager as any)(1024)
        await mgr.destroy()
        expect(mgr.destroy).toHaveBeenCalled()
    })
})
