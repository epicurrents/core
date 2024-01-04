import { GenericAsset } from '../../src'
import { BaseAsset } from '../../src/types'

export default class AssetInstance extends GenericAsset implements BaseAsset {
    constructor (name: string, scope: string, type: string) {
        super(name, scope, type)
    }
    get testProperty () {
        return null
    }
    set testProperty (value: any) {
        this.onPropertyUpdate('test-property')
    }
}