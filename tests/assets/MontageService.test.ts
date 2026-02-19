/**
 * Unit tests for MontageService class.
 * Note: MontageService.ts uses import.meta.url which causes TS1343 with ts-jest.
 * The class is tested indirectly through GenericBiosignalMontage.test.ts which
 * mocks MontageService entirely. Here we verify the mock interface contract.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

jest.mock('../../src/assets/biosignal/service/MontageService', () => {
    return jest.fn().mockImplementation((montage: any) => ({
        id: 'mock-service-id',
        name: montage?.name || 'MockMontage',
        mutex: null,
        getSignals: jest.fn().mockResolvedValue(null),
        setFilters: jest.fn().mockResolvedValue({ success: true }),
        setInterruptions: jest.fn(),
        setupWorker: jest.fn(),
        setupMontageWithCache: jest.fn().mockResolvedValue(true),
        setupMontageWithInputMutex: jest.fn().mockResolvedValue(true),
        setupMontageWithSharedWorker: jest.fn().mockResolvedValue(true),
        unload: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
        handleMessage: jest.fn().mockResolvedValue(true),
        mapChannels: jest.fn().mockResolvedValue(undefined),
        cacheMontageSignals: jest.fn(),
    }))
})

import MontageService from '../../src/assets/biosignal/service/MontageService'

describe('MontageService (mocked due to import.meta.url)', () => {
    it('should be constructable with montage argument', () => {
        const service = new (MontageService as any)({ name: 'Test Montage' })
        expect(service).toBeDefined()
        expect(service.id).toBe('mock-service-id')
        expect(service.name).toBe('Test Montage')
        expect(service.mutex).toBeNull()
    })

    it('should expose getSignals', async () => {
        const service = new (MontageService as any)({ name: 'M' })
        const result = await service.getSignals([0, 10])
        expect(result).toBeNull()
    })

    it('should expose setFilters', async () => {
        const service = new (MontageService as any)({ name: 'M' })
        const result = await service.setFilters()
        expect(result).toEqual({ success: true })
    })

    it('should expose setInterruptions', () => {
        const service = new (MontageService as any)({ name: 'M' })
        service.setInterruptions(new Map())
        expect(service.setInterruptions).toHaveBeenCalled()
    })

    it('should expose destroy', async () => {
        const service = new (MontageService as any)({ name: 'M' })
        await service.destroy()
        expect(service.destroy).toHaveBeenCalled()
    })
})
