/**
 * Generic file writer.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import GenericAsset from '#assets/GenericAsset'
import type { FileFormatWriter } from '#types/reader'
import type {
    StudyContext,
} from '#types/study'
import { MediaDataset } from '#root/src/types'

export default abstract class GenericFileWriter extends GenericAsset implements FileFormatWriter {
    protected _description: string
    protected _format: string
    protected _sourceStudy: StudyContext | null = null

    constructor (name: string, format: string, description: string) {
        super(name, 'writer')
        this._description = description
        this._format = format
    }
    get description (): string {
        return this._description
    }
    set description (value: string) {
        this._setPropertyValue('description', value)
    }
    get format (): string {
        return this._format
    }

    destroy () {
        this._description = ''
        this._format = ''
        this._sourceStudy = null
        super.destroy()
    }
    setSourceStudy(study: StudyContext): void {
        this._sourceStudy = study
    }
    writeFileToDataset(_dataset: MediaDataset, _path: string): Promise<void> {
        throw new Error('writeFileToDataset must be overridden in the child class.')
    }
    writeFileToFileSystem(): Promise<void> {
        throw new Error('writeFileToFileSystem must be overridden in the child class.')
    }
}
