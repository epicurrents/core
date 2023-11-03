/**
 * Biosignal study loader.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type VideoAttachment } from "#types/biosignal"
import { type ConfigStudyContext, type ConfigStudyLoader } from "#types/config"
import { type FileFormatLoader } from "#types/loader"
import { type StudyContext } from '#types/study'
import GenericStudyLoader from "#assets/study/loaders/GenericStudyLoader"

//const SCOPE = 'BiosignalStudyLoader'

export default class BiosignalStudyLoader extends GenericStudyLoader {

    constructor (name: string, contexts: string[], types: string[], loader: FileFormatLoader) {
        super(name, contexts, types, loader)
    }

    async loadFromUrl(fileUrl: string, config?: ConfigStudyLoader, preStudy?: StudyContext):
    Promise<StudyContext | null> {
        const study = await super.loadFromUrl(fileUrl, config, preStudy)
        if (!study) {
            return null
        }
        study.scope = 'sig'
        return study
    }

    async useStudy (study: StudyContext, config?: ConfigStudyContext) {
        const nextIdx = await super.useStudy(study)
        for (let i=0; i<study.files.length; i++) {
            const studyFile = study.files[i]
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
                    type: 'video',
                    // Video files require a URL to play in the browser.
                    url: studyFile.url,
                })
                // Video files can be attachments, so only update study format and type if they are empty.
                if (!study.format) {
                    study.format = format
                }
                if (!study.type) {
                    study.type = 'video'
                }
                const startDif = 0
                const group = 0
                // Figuring out video duration requires creating a video element and preloading the metadata.
                const loadVideoMeta = (study: StudyContext) => new Promise<number[]>((resolve, reject) => {
                    try {
                        const video = document.createElement('video')
                        video.preload = 'metadata'
                        video.onloadedmetadata = () => {
                            // Save metadata before removing the element
                            const meta = [ video.duration ]
                            resolve(meta)
                        }
                        video.onerror = () => {
                            reject()
                        }
                        video.src = study.files[i].url
                    } catch (e) {
                        reject()
                    }
                })
                const [ duration ] = await loadVideoMeta(study) || [ 0 ]
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
                    url: study.files[i].url
                } as VideoAttachment)
                study.files.splice(i, 1)
                // Prevent skipping over the next file.
                i--
            }
        }
        return nextIdx
    }
}
