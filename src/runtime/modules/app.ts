/**
 * Runtime app module.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { RuntimeAppModule, SafeObject, StudyLoaderProtocolContext, StudyLoaderContext } from "TYPES/core"
import { BiosignalPlot } from "TYPES/plot"

const SCOPE = 'runtime-app-module'

const APP: SafeObject & RuntimeAppModule = {
    __proto__: null,
    activeDataset: null,
    activeScope: '',
    activeType: '',
    containerId: '',
    datasets: [],
    fileWorkerSources: new Map<string, () => Worker>(),
    id: '',
    isFullscreen: false,
    moduleName: {
        code: 'app',
        full: 'Application',
        short: 'App',
    },
    plots: new Map<string, BiosignalPlot>(),
    runningId: 0,
    settingsOpen: false,
    showOverlay: false,
    studyLoaders: new Map<string, StudyLoaderContext>(),
    studyLoadProtocols: new Map<string, StudyLoaderProtocolContext>(),
    userSettings: {
        'screenPPI': 'ScreenPpiCalibrator',
    },
}
export default APP
