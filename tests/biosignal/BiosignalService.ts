import { BiosignalService } from "../../src"
import { type BiosignalDataService, type BiosignalResource, type MemoryManager } from "../../src/types"

export class BiosignalServiceTest extends BiosignalService implements BiosignalDataService {

    constructor (recording: BiosignalResource, worker: Worker, manager?: MemoryManager) {
        super(recording, worker, manager)
    }
}
