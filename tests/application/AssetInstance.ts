import { GenericAsset } from '../../src'
import { BaseAsset } from '../../src/types'

export default class AssetInstance extends GenericAsset implements BaseAsset {
    constructor (name: string, modality: string) {
        super(name, modality)
    }
    get testProperty () {
        return null
    }
    set testProperty (value: any) {
        this.dispatchPropertyChangeEvent('testProperty', value, value)
    }
}