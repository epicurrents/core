import { GenericBiosignalHeaders, GenericBiosignalResourceSAB } from "../../src"
import { BiosignalChannel, BiosignalResource, MemoryManager } from "../../src/types"

export class BiosignalRecording extends GenericBiosignalResourceSAB implements BiosignalResource {
    constructor (
        name: string,
        channels: BiosignalChannel[],
        headers: GenericBiosignalHeaders,
        fileWorker: Worker,
        loaderManager: MemoryManager
    ) {
        super(name, 100, "test", loaderManager)
    }
}