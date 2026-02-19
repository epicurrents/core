/**
 * Unit tests for GenericStudyExporter class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import EventBus from '../../src/events/EventBus'
import GenericStudyExporter from '../../src/assets/study/GenericStudyExporter'
import GenericAsset from '../../src/assets/GenericAsset'

jest.mock('scoped-event-log', () => ({
    Log: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() }
}))

jest.mock('../../src/events/EventBus')

jest.mock('../../src/util', () => ({
    deepClone: jest.fn((obj) => {
        if (obj === null || obj === undefined) return obj
        try { return JSON.parse(JSON.stringify(obj)) } catch { return null }
    }),
    safeObjectFrom: jest.fn((obj) => {
        if (!obj) return obj
        const result = Object.assign({}, obj)
        Object.setPrototypeOf(result, null)
        return result
    }),
}))

class TestStudyExporter extends GenericStudyExporter {
    constructor(name: string, format: string, description: string) {
        super(name, format, description)
    }
}

describe('GenericStudyExporter', () => {
    let mockEventBus: any
    let originalWindow: any

    beforeEach(() => {
        (GenericAsset as any).USED_IDS.clear()

        mockEventBus = {
            addScopedEventListener: jest.fn(),
            dispatchScopedEvent: jest.fn().mockReturnValue(true),
            getEventHooks: jest.fn(),
            removeAllScopedEventListeners: jest.fn(),
            removeScopedEventListener: jest.fn(),
            removeScope: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
            unsubscribeAll: jest.fn(),
        }

        originalWindow = global.window
        Object.defineProperty(global, 'window', {
            value: {
                __EPICURRENTS__: { APP: {}, EVENT_BUS: mockEventBus, RUNTIME: null }
            } as any,
            writable: true,
        })

        ;(EventBus as jest.MockedClass<typeof EventBus>).mockImplementation(() => mockEventBus as any)
    })

    afterEach(() => {
        global.window = originalWindow
    })

    describe('constructor', () => {
        it('should create an exporter', () => {
            const exp = new TestStudyExporter('EDF Exporter', 'edf', 'Export to EDF format')
            expect(exp.name).toBe('EDF Exporter')
            expect(exp.format).toBe('edf')
            expect(exp.description).toBe('Export to EDF format')
            expect(exp.modality).toBe('writer')
        })
    })

    describe('description setter', () => {
        it('should set description', () => {
            const exp = new TestStudyExporter('Test', 'edf', 'old')
            exp.description = 'new description'
            expect(exp.description).toBe('new description')
        })
    })

    describe('setSourceStudy', () => {
        it('should set the source study', () => {
            const exp = new TestStudyExporter('Test', 'edf', 'desc')
            const study = { name: 'Study 1' } as any
            exp.setSourceStudy(study)
            // No getter for _sourceStudy but shouldn't throw
        })
    })

    describe('exportStudyToDataset', () => {
        it('should throw when not overridden', () => {
            const exp = new TestStudyExporter('Test', 'edf', 'desc')
            expect(() => exp.exportStudyToDataset({} as any, '/path')).toThrow()
        })
    })

    describe('exportStudyToFileSystem', () => {
        it('should throw when not overridden', () => {
            const exp = new TestStudyExporter('Test', 'edf', 'desc')
            expect(() => exp.exportStudyToFileSystem()).toThrow()
        })
    })

    describe('destroy', () => {
        it('should clean up properties', () => {
            const exp = new TestStudyExporter('Test', 'edf', 'desc')
            exp.destroy()
            expect(exp.description).toBe('')
            expect(exp.format).toBe('')
            expect(exp.state).toBe('destroyed')
        })
    })
})
