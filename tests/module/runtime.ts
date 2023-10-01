/**
 * Mock module runtime.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type DataResource, type RuntimeResourceModule, type StateManager, type SafeObject } from "../../src/types"
import { logInvalidMutation } from "../../src/runtime/util"

const runtime: RuntimeResourceModule = {
    __proto__: null,
    moduleName: {
        code: 'mock',
        full: 'Mock module',
        short: 'Mock',
    },
    setPropertyValue (property, value, resource?: DataResource, state?: StateManager) {
        // Resource-specific property mutations
        const activeRes: any = resource
                               ? resource
                               : state
                                 ? state.APP.activeDataset?.activeResources[0]
                                 : null
        if (!activeRes) {
            return
        }
        if (activeRes.type !== runtime.moduleName.code) {
            return
        }
        if (property === "test") {
            if (value as number < 0) {
                logInvalidMutation(property, value, "test-module", "Must be zero or greater")
            }
            if (activeRes[property as any] !== undefined) {
                activeRes[property as any] = value
            }
        }
    },
}
export { runtime }
