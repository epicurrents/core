/**
 * Runtime app module.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type RuntimeAppModule, type SafeObject } from '#root/src/types/application'
import { type BiosignalPlot } from '#types/plot'
import { type StudyLoaderContext, type StudyLoaderProtocolContext } from '#types/study'

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
    studyLoaders: new Map<string, StudyLoaderContext>(),
    studyLoadProtocols: new Map<string, StudyLoaderProtocolContext>(),
}
export default APP
