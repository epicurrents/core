/**
 * Runtime app module.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { RuntimeAppModule, SafeObject } from '#root/src/types/application'
import type { BiosignalPlot } from '#types/plot'
import type {
    StudyExporterContext,
    StudyImporterContext,
    StudyLoaderProtocolContext
} from '#types/study'

//const SCOPE = 'runtime-app-module'

const APP: SafeObject & RuntimeAppModule = {
    __proto__: null,
    activeDataset: null,
    datasets: [],
    id: '',
    moduleName: {
        code: 'app',
        full: 'Application',
        short: 'App',
    },
    plots: new Map<string, BiosignalPlot>(),
    runningId: 0,
    studyExporters: new Map<string, StudyExporterContext>(),
    studyImporters: new Map<string, StudyImporterContext>(),
    studyLoadProtocols: new Map<string, StudyLoaderProtocolContext>(),
}
export default APP
