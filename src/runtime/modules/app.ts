/**
 * Runtime app module.
 * @package    epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { RuntimeAppModule, SafeObject } from '#types/application'
import type { DatasourceConnector } from '#types/connector'
import type {
    StudyExporterContext,
    StudyImporterContext,
    StudyLoaderProtocolContext
} from '#types/study'

//const SCOPE = 'runtime-app-module'

const APP: SafeObject & RuntimeAppModule = {
    __proto__: null,
    activeDataset: null,
    connectors: new Map<string, DatasourceConnector>(),
    datasets: [],
    id: '',
    moduleName: {
        code: 'app',
        full: 'Application',
        short: 'App',
    },
    runningId: 0,
    studyExporters: new Map<string, StudyExporterContext>(),
    studyImporters: new Map<string, StudyImporterContext>(),
    studyLoadProtocols: new Map<string, StudyLoaderProtocolContext>(),
}
export default APP
