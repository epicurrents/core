import { GenericBiosignalResource } from '../../src'
import { BiosignalResource, MemoryManager } from '../../src/types'

export class BiosignalRecording extends GenericBiosignalResource implements BiosignalResource {
    constructor (
        name: string,
        loaderManager: MemoryManager
    ) {
        super(name, 100, "sig")
        this.setMemoryManager(loaderManager)
    }
}