import { DataResource, StateManager } from '../../src/types'

export const BIOSIG_MODULE = {
    __proto__: null,
    moduleName: {
        code: 'sig',
        full: 'Biosignal',
        short: 'SIG',
    },
    setPropertyValue (property: string, value: unknown, resource?: DataResource, state?: StateManager) {
    },
}