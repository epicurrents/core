/**
 * Unit tests for GenericBiosignalSetup class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericBiosignalSetup from '../../src/assets/biosignal/components/GenericBiosignalSetup'

jest.mock('../../src/util', () => ({
    INDEX_NOT_ASSIGNED: -1,
}))

const makeChannel = (name: string, label?: string, samplingRate = 256) => ({
    name,
    label: label || name,
    samplingRate,
}) as any

describe('GenericBiosignalSetup', () => {
    describe('constructor', () => {
        it('should create a setup with name', () => {
            const setup = new GenericBiosignalSetup('Test Setup')
            expect(setup.name).toBe('Test Setup')
            expect(setup.label).toBe('Test Setup')
            expect(setup.channels).toEqual([])
            expect(setup.derivations).toEqual([])
        })

        it('should use config label if provided', () => {
            const setup = new GenericBiosignalSetup('setup', undefined, {
                label: 'Custom Label',
            } as any)
            expect(setup.label).toBe('Custom Label')
        })
    })

    describe('property setters', () => {
        it('should set channels', () => {
            const setup = new GenericBiosignalSetup('Test')
            const channels = [{ name: 'Fp1', index: 0 }] as any[]
            setup.channels = channels
            expect(setup.channels).toBe(channels)
        })

        it('should set derivations', () => {
            const setup = new GenericBiosignalSetup('Test')
            const derivations = [{ name: 'Fp1-Fp2', active: 0, reference: [1] }] as any[]
            setup.derivations = derivations
            expect(setup.derivations).toBe(derivations)
        })

        it('should set label', () => {
            const setup = new GenericBiosignalSetup('Test')
            setup.label = 'New Label'
            expect(setup.label).toBe('New Label')
        })

        it('should set missingChannels', () => {
            const setup = new GenericBiosignalSetup('Test')
            setup.missingChannels = [{ name: 'Missing' }] as any[]
            expect(setup.missingChannels).toHaveLength(1)
        })

        it('should set unmatchedSignals', () => {
            const setup = new GenericBiosignalSetup('Test')
            setup.unmatchedSignals = [{ name: 'Extra' }] as any[]
            expect(setup.unmatchedSignals).toHaveLength(1)
        })
    })

    describe('loadConfig', () => {
        it('should match channels by exact name', () => {
            const signals = [makeChannel('Fp1'), makeChannel('Fp2'), makeChannel('Cz')]
            const config = {
                channels: [
                    { name: 'Fp1', label: 'Fp1' },
                    { name: 'Fp2', label: 'Fp2' },
                ],
            } as any
            const setup = new GenericBiosignalSetup('Test', signals, config)
            expect(setup.channels).toHaveLength(2)
            expect(setup.channels[0].index).toBe(0)
            expect(setup.channels[1].index).toBe(1)
        })

        it('should match channels by pattern', () => {
            const signals = [makeChannel('EEG Fp1')]
            const config = {
                channels: [
                    { pattern: 'fp1', label: 'Fp1' },
                ],
            } as any
            const setup = new GenericBiosignalSetup('Test', signals, config)
            expect(setup.channels).toHaveLength(1)
            expect(setup.channels[0].index).toBe(0)
        })

        it('should track missing channels', () => {
            const signals = [makeChannel('Fp1')]
            const config = {
                channels: [
                    { name: 'Fp1', label: 'Fp1' },
                    { name: 'Fp2', label: 'Fp2' },
                ],
            } as any
            const setup = new GenericBiosignalSetup('Test', signals, config)
            expect(setup.channels).toHaveLength(1)
            expect(setup.missingChannels).toHaveLength(1)
            expect(setup.missingChannels[0].name).toBe('Fp2')
        })

        it('should track unmatched signals', () => {
            const signals = [makeChannel('Fp1'), makeChannel('Fp2'), makeChannel('EMG')]
            const config = {
                channels: [
                    { name: 'Fp1', label: 'Fp1' },
                ],
            } as any
            const setup = new GenericBiosignalSetup('Test', signals, config)
            expect(setup.unmatchedSignals).toHaveLength(2)
        })

        it('should process derivations', () => {
            const signals = [makeChannel('Fp1'), makeChannel('Fp2')]
            const config = {
                channels: [
                    { name: 'Fp1', label: 'Fp1' },
                    { name: 'Fp2', label: 'Fp2' },
                ],
                derivations: [
                    {
                        name: 'Fp1-Fp2',
                        label: 'Fp1-Fp2',
                        active: { name: 'Fp1' },
                        reference: [{ name: 'Fp2' }],
                    },
                ],
            } as any
            const setup = new GenericBiosignalSetup('Test', signals, config)
            expect(setup.derivations).toHaveLength(1)
            expect(setup.derivations[0]).toHaveProperty('active')
            expect(setup.derivations[0]).toHaveProperty('reference')
        })

        it('should use config label when loading', () => {
            const setup = new GenericBiosignalSetup('Test')
            setup.loadConfig([], { label: 'Loaded Label' } as any)
            expect(setup.label).toBe('Loaded Label')
        })
    })
})
