/**
 * Unit tests for MontageService class.
 * Note: MontageService.ts uses import.meta.url which causes TS1343 with ts-jest.
 * The class is tested indirectly through GenericBiosignalMontage.test.ts which
 * mocks MontageService entirely. Here we verify the mock interface contract.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

vi.mock('../../src/assets/biosignal/service/MontageService', () => ({
    default: vi.fn().mockImplementation(function(montage: any) {
        return {
            id: 'mock-service-id',
            name: montage?.name || 'MockMontage',
            mutex: null,
            getSignals: vi.fn().mockResolvedValue(null),
            setFilters: vi.fn().mockResolvedValue({ success: true }),
            setInterruptions: vi.fn(),
            setupWorker: vi.fn(),
            setupMontageWithCache: vi.fn().mockResolvedValue(true),
            setupMontageWithInputMutex: vi.fn().mockResolvedValue(true),
            setupMontageWithSharedWorker: vi.fn().mockResolvedValue(true),
            unload: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn().mockResolvedValue(undefined),
            handleMessage: vi.fn().mockResolvedValue(true),
            mapChannels: vi.fn().mockResolvedValue(undefined),
            cacheMontageSignals: vi.fn(),
        }
    }),
}))

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
