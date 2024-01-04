import { GenericBiosignalService } from '../../src'
import { type BiosignalDataService, type BiosignalResource, type MemoryManager } from '../../src/types'

export class BiosignalService extends GenericBiosignalService implements BiosignalDataService {

    constructor (recording: BiosignalResource, worker: Worker, manager?: MemoryManager) {
        super(recording, worker, manager)
    }
}
