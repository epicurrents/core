/**
 * EpiCurrents core tests.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { EpiCurrents, SETTINGS, ServiceMemoryManager } from "../src"
// Mock module.
import * as mod from "./module"
import { BiosignalDataService, BiosignalResource, ResourceModule } from "../src/types"


/*
 * Mocks.
 */
type MessageHandler = (msg: string) => void
/** A simple worker mock. */
class Worker {
    url: string;
    onmessage: MessageHandler
    constructor(stringUrl: string) {
        this.url = stringUrl
        this.onmessage = (msg: string) => {}
    }
    addEventListener (event: string, hander: ((event: any) => void)) {
        // Possible tests for the event listeners?
    }
    postMessage(msg: string): void {
        this.onmessage(msg)
    }
}
Object.defineProperty(window, 'Worker', {
    writable: true,
    value: Worker
})

/*
 * Constants
 */
/** Bytes in one megabyte. */
const MB_BYTES = 1024*1024

describe('EpiCurrents core tests', () => {
    var epic: EpiCurrents
    var manager: ServiceMemoryManager
    var biosignalService: BiosignalDataService
    var biosignalResource: BiosignalResource
    /**
     * INITIALIZATION TESTS
     */
    test("Create core application with log level debug", () => {
        epic = new EpiCurrents()
        expect(epic).toBeDefined()
    })
    /**
     * CONFIGURATION TESTS
     */
    test("Pre-launch configuration", () => {
        // Changing default settings should be very deliberate and must be changed here as well.
        expect(SETTINGS.app.dataChunkSize).toBeDefined()
        expect(SETTINGS.app.dataChunkSize).toStrictEqual(5*MB_BYTES)
        expect(SETTINGS.app.fontawesomeLib).toBeDefined()
        expect(SETTINGS.app.fontawesomeLib).toStrictEqual('free')
        expect(SETTINGS.app.iconLib).toBeDefined()
        expect(SETTINGS.app.iconLib).toStrictEqual('fa')
        expect(SETTINGS.app.isMainComponent).toBeDefined()
        expect(SETTINGS.app.isMainComponent).toStrictEqual(true)
        expect(SETTINGS.app.logThreshold).toBeDefined()
        expect(SETTINGS.app.logThreshold).toStrictEqual('WARN')
        expect(SETTINGS.app.maxDirectLoadSize).toBeDefined()
        expect(SETTINGS.app.maxDirectLoadSize).toStrictEqual(10*MB_BYTES)
        expect(SETTINGS.app.maxLoadCacheSize).toBeDefined()
        expect(SETTINGS.app.maxLoadCacheSize).toStrictEqual(1000*MB_BYTES)
        expect(SETTINGS.app.screenPPI).toBeDefined()
        expect(SETTINGS.app.screenPPI).toStrictEqual(96)
        expect(SETTINGS.app.theme).toBeDefined()
        expect(SETTINGS.app.theme).toStrictEqual('default')
        // Modules.
        expect(Object.keys(SETTINGS.modules).length).toStrictEqual(0)
        // Services.
        expect(SETTINGS.services.onnx).toBeDefined()
        expect(SETTINGS.services.onnx).toStrictEqual(false)
        expect(SETTINGS.services.pyodide).toBeDefined()
        expect(SETTINGS.services.pyodide).toStrictEqual(false)
        epic.configure({
            "app.isMainComponent": false,
            "app.logThreshold": "DEBUG",
            "services.pyodide": true
        })
        expect(SETTINGS.app.isMainComponent).toStrictEqual(false)
        expect(SETTINGS.app.logThreshold).toStrictEqual("DEBUG")
        expect(SETTINGS.services.pyodide).toStrictEqual(true)
    })
    /**
     * MODULE TESTS
     */
    test("Resource module registration and configuration", () => {
        epic.registerModule("test", mod as ResourceModule)
        const testMod = SETTINGS.modules.test as any
        expect(testMod).toBeDefined()
        expect(testMod.testProperty).toStrictEqual(true)
        SETTINGS.setFieldValue("modules.test.testProperty", false)
        expect(testMod.testProperty).toStrictEqual(false)
    })
    /**
     * MODULE TESTS
     */
    test("Service memory manager", () => {
        manager = new ServiceMemoryManager(128*MB_BYTES)
        expect(manager).toBeDefined()
        expect(manager.bufferSize).toStrictEqual(128*MB_BYTES/4 + 1) // In 32-bit units.
        expect(manager.buffer.byteLength).toStrictEqual(128*MB_BYTES + 4)
        expect(manager.memoryUsed).toStrictEqual(0)
        expect(manager.services.length).toStrictEqual(0)
    })
    /**
     * BIOSIGNAL TESTS
     */
    test("Biosignal resource", () => {

    })
})
