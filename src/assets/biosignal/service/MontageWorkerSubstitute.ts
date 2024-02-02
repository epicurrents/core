/**
 * EpiCurrents montage worker substitute. Allows using the EDF loader in the main thread without an actual worker.
 * @package    @epicurrents/edf-file-loader
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-ts-log'
import ServiceWorkerSubstitute from '#assets/service/ServiceWorkerSubstitute'

const SCOPE = 'MontageWorkerSubstitute'

export default class MontageWorkerSubstitute extends ServiceWorkerSubstitute {
    postMessage (message: any) {
        if (!message?.data?.action) {
            return
        }
        const action = message.data.action
        Log.debug(`Received message with action ${action}.`, SCOPE)
        if (action === 'get-signals') {
        } else {
            super.postMessage(message)
        }
    }
}