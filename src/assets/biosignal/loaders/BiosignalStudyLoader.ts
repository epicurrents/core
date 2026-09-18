/**
 * Biosignal study loader.
 * @package    epicurrents/core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { VideoAttachment } from '#types/biosignal'
import type { ConfigStudyContext, ConfigStudyLoader } from '#types/config'
import type { FileFormatExporter, FileFormatImporter } from '#root/src/types/reader'
import type { StudyContext } from '#types/study'
import GenericStudyLoader from '#assets/study/GenericStudyLoader'

//const SCOPE = 'BiosignalStudyLoader'

export default class BiosignalStudyLoader extends GenericStudyLoader {

    constructor (name: string, modalities: string[], importer: FileFormatImporter, exporter?: FileFormatExporter) {
        super(name, modalities, importer, exporter)
    }

    async loadFromUrl(fileUrl: string, config?: ConfigStudyLoader, preStudy?: StudyContext):
    Promise<StudyContext | null> {
        const study = await super.loadFromUrl(fileUrl, config, preStudy)
        if (!study) {
            return null
        }
        return study
    }

    async useStudy (study: StudyContext, config?: ConfigStudyContext) {
        const nextIdx = await super.useStudy(study)
        // Iterated over a snapshot of the list. Each converted video appends a `media` entry
        // carrying the same URL and removes the original, leaving the length unchanged; walking the
        // live list therefore arrives at the entry just appended, matches it on that same URL and
        // converts it again, without end and creating a video element every pass.
        const originalFiles = [...study.files]
        for (const studyFile of originalFiles) {
            // Go through additional file types.
            const urlEnd = studyFile.url.split('/').pop()
            const fName = config?.name || urlEnd || ''
            if (
                fName.endsWith('.mp4') || fName.endsWith('.m4v') || fName.endsWith('.webm')
            ) {
                // HTML5-compatible video file.
                // Fetch the file name end as file format.
                const format = fName.split('.').pop() as string
                study.files.push({
                    file: null,
                    format: format,
                    mime: null,
                    name: fName,
                    partial: false,
                    range: [],
                    role: 'media',
                    modality: 'video',
                    // Video files require a URL to play in the browser.
                    url: studyFile.url,
                })
                // Video files can be attachments, so only update study format and type if they are empty.
                if (!study.format) {
                    study.format = format
                }
                if (!study.modality) {
                    study.modality = 'video'
                }
                const startDif = 0
                const group = 0
                // Figuring out video duration requires creating a video element and preloading the metadata.
                const loadVideoMeta = (url: string) => new Promise<number[]>((resolve, reject) => {
                    try {
                        const video = document.createElement('video')
                        video.preload = 'metadata'
                        video.onloadedmetadata = () => {
                            // Save metadata before removing the element
                            const meta = [ video.duration ]
                            resolve(meta)
                        }
                        video.onerror = () => {
                            reject(new Error(`Could not load video metadata from ${url}.`))
                        }
                        video.src = url
                    } catch (e) {
                        reject(e instanceof Error ? e : new Error(`Could not create a video element for ${url}.`))
                    }
                })
                const [ duration ] = await loadVideoMeta(studyFile.url) || [ 0 ]
                const meta = study.meta as { videos?: VideoAttachment[] }
                if (meta.videos === undefined) {
                    meta.videos = []
                }
                // Add the video as attachment and remove it from prime files.
                meta.videos.push({
                    group: group,
                    endTime: startDif + duration,
                    startTime: startDif,
                    syncPoints: [],
                    url: studyFile.url
                } as VideoAttachment)
                // Remove the entry this was converted from, wherever it now sits: the appends above
                // leave its index unchanged, but a preceding conversion's removal does not.
                const fileIdx = study.files.indexOf(studyFile)
                if (fileIdx > -1) {
                    study.files.splice(fileIdx, 1)
                }
            }
        }
        return nextIdx
    }
}
