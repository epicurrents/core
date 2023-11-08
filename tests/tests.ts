/**
 * EpiCurrents core tests.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalService, EpiCurrents, SETTINGS, ServiceMemoryManager } from "../src"
// Mock module.
import * as mod from "./module"
import { ResourceModule } from "../src/types"
// Biosignal resource
import { BiosignalDataService, BiosignalResource } from "../src/types"
import { BiosignalRecording } from "./biosignal/BiosignalRecording"
import { BIOSIG_MODULE } from "./biosignal/BiosignalRuntime"
import { BIOSIG_SETTINGS } from "./biosignal/BiosignalSettings"
import AssetInstance from "./application/AssetInstance"

/*
 * Mocks.
 */
type MessageHandler = (msg: MessageEvent<any>) => void
/** A simple worker mock. */
class Worker {
    url: string;
    onmessage: MessageHandler
    constructor(stringUrl: string) {
        this.url = stringUrl
        this.onmessage = (msg: MessageEvent<any>) => {}
    }
    addEventListener (event: string, hander: ((event: any) => void)) {
        // Possible tests for the event listeners?
    }
    dispatchEvent (ev: Event) {
        return true
    }
    onerror () {

    }
    onmessageerror () {

    }
    postMessage(msg: MessageEvent<any>): void {
        this.onmessage(msg)
    }
    removeEventListener (listener: any) {

    }
    terminate () {

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
     * ASSET TESTS
     */
    test("Generic asset", () => {
        const asset = new AssetInstance('Test asset', 'test', 'asset')
        expect(asset).toBeDefined()
        // Base property tests.
        expect(asset.id.length).toBeGreaterThan(0)
        expect(asset.name).toStrictEqual('Test asset')
        expect(asset.scope).toStrictEqual('unk')
        expect(asset.type).toStrictEqual('asset')
        expect(asset.isActive).toStrictEqual(false)
        // Property update handler tests.
        let callbackCounter = 0
        const updateCallback = () => {
            callbackCounter++
        }
        asset.addPropertyUpdateHandler('test-property', updateCallback)
        asset.testProperty = null
        expect(callbackCounter).toStrictEqual(1)
        asset.removePropertyUpdateHandler('test-property', updateCallback)
        asset.testProperty = null
        expect(callbackCounter).toStrictEqual(1)
        asset.addPropertyUpdateHandler('test-property', updateCallback) // We already tested this.
        asset.removeAllPropertyUpdateHandlers()
        asset.testProperty = null
        expect(callbackCounter).toStrictEqual(1)
        asset.addPropertyUpdateHandler('test-property', updateCallback, 'test-caller')
        asset.removeAllPropertyUpdateHandlersFor('foo-bar') // Wrong caller.
        asset.testProperty = null
        expect(callbackCounter).toStrictEqual(2)
        asset.removeAllPropertyUpdateHandlersFor('test-caller')
        asset.testProperty = null
        expect(callbackCounter).toStrictEqual(2)
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
        epic.registerModule('sig', { runtime: BIOSIG_MODULE, settings: BIOSIG_SETTINGS })
        const biosig = new BiosignalRecording('Test biosig', manager)
        expect(biosig).toBeDefined()
        expect(biosig.name).toStrictEqual('Test biosig')
        expect(biosig.activeMontage).toBeNull()
        expect(biosig.type).toStrictEqual('sig')
        expect(biosig.sensitivity).toStrictEqual(100)
        const service = new BiosignalService(biosig, new Worker('test'), manager)
        expect(service).toBeDefined()
    })
})
