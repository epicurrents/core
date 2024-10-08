/////////////////////////////////////////////////
//                   ASSETS                    //
/////////////////////////////////////////////////

import {
    type BaseAsset,
    type DataResource,
    type EpicurrentsApp,
    type InterfaceModule,
    type InterfaceModuleConstructor,
    type InterfaceResourceModule,
    type InterfaceResourceModuleContext,
    type NullProtoObject,
    type PropertyUpdateHandler,
    type ResourceModule,
    type RuntimeAppModule,
    type RuntimeResourceModule,
    type RuntimeState,
    type SafeObject,
    type StateManager,
} from './application'
export {
    BaseAsset,
    DataResource,
    EpicurrentsApp,
    InterfaceModule,
    InterfaceModuleConstructor,
    InterfaceResourceModule,
    InterfaceResourceModuleContext,
    NullProtoObject,
    PropertyUpdateHandler,
    ResourceModule,
    RuntimeAppModule,
    RuntimeResourceModule,
    RuntimeState,
    SafeObject,
    StateManager,
}

/////////////////////////////////////////////////
//                 BIOSIGNAL                   //
/////////////////////////////////////////////////

import {
    type AnnotationTemplate,
    type BiosignalAnnotation,
    type BiosignalChannel,
    type BiosignalChannelMarker,
    type BiosignalChannelProperties,
    type BiosignalChannelTemplate,
    type BiosignalConfig,
    type BiosignalCursor,
    type BiosignalDataField,
    type BiosignalDataReject,
    type BiosignalDataResolve,
    type BiosignalDataService,
    type BiosignalFilters,
    type BiosignalHeaderRecord,
    type BiosignalHeaderSignal,
    type BiosignalLaterality,
    type BiosignalMetaField,
    type BiosignalMontage,
    type BiosignalMontageReferenceSignal,
    type BiosignalMontageService,
    type BiosignalMontageTemplate,
    type BiosignalResource,
    type BiosignalScope,
    type BiosignalSetup,
    type BiosignalSetupReject,
    type BiosignalSetupResolve,
    type BiosignalSetupResponse,
    type BiosignalStudyProperties,
    type ChannelPositionProperties,
    type FftAnalysisResult,
    type GetSignalsResponse,
    type MontageChannel,
    type ReleaseCacheResponse,
    type SetFiltersResponse,
    type SetupCacheResponse,
    type SetupChannel,
    type SetupMutexResponse,
    type SetupSharedWorkerResponse,
    type SignalDataCache,
    type SignalDataGap,
    type SignalDataGapMap,
    type SignalPart,
    type SignalPolarity,
    type SignalRange,
    type VideoAttachment,
    type WorkerMontage,
} from './biosignal'
export {
    AnnotationTemplate,
    BiosignalAnnotation,
    BiosignalChannel,
    BiosignalChannelMarker,
    BiosignalChannelProperties,
    BiosignalChannelTemplate,
    BiosignalConfig,
    BiosignalCursor,
    BiosignalDataField,
    BiosignalDataReject,
    BiosignalDataResolve,
    BiosignalDataService,
    BiosignalFilters,
    BiosignalHeaderRecord,
    BiosignalHeaderSignal,
    BiosignalLaterality,
    BiosignalMetaField,
    BiosignalMontage,
    BiosignalMontageReferenceSignal,
    BiosignalMontageService,
    BiosignalMontageTemplate,
    BiosignalResource,
    BiosignalScope,
    BiosignalSetup,
    BiosignalSetupReject,
    BiosignalSetupResolve,
    BiosignalSetupResponse,
    BiosignalStudyProperties,
    ChannelPositionProperties,
    FftAnalysisResult,
    GetSignalsResponse,
    MontageChannel,
    ReleaseCacheResponse,
    SetFiltersResponse,
    SetupCacheResponse,
    SetupChannel,
    SetupMutexResponse,
    SetupSharedWorkerResponse,
    SignalDataCache,
    SignalDataGap,
    SignalDataGapMap,
    SignalPart,
    SignalPolarity,
    SignalRange,
    VideoAttachment,
    WorkerMontage,
}

/////////////////////////////////////////////////
//                   CONFIG                    //
/////////////////////////////////////////////////

import {
    type AppSettings,
    type BaseModuleSettings,
    type ClonableAppSettings,
    type ClonableModuleSettings,
    type CommonBiosignalSettings,
    type ConfigBiosignalMontage,
    type ConfigBiosignalSetup,
    type ConfigChannelFilter,
    type ConfigDatasetLoader,
    type ConfigMapChannels,
    type ConfigStudyContext,
    type ConfigStudyLoader,
    type SettingsColor,
    type SettingsValue,
    type SettingsValueConstructor,
} from './config'
export {
    AppSettings,
    BaseModuleSettings,
    ClonableAppSettings,
    ClonableModuleSettings,
    CommonBiosignalSettings,
    ConfigBiosignalMontage,
    ConfigBiosignalSetup,
    ConfigChannelFilter,
    ConfigDatasetLoader,
    ConfigMapChannels,
    ConfigStudyContext,
    ConfigStudyLoader,
    SettingsColor,
    SettingsValue,
    SettingsValueConstructor,
}

/////////////////////////////////////////////////
//                  DATASET                    //
/////////////////////////////////////////////////

import {
    type BaseDataset,
    type DatasetCredentials,
    type DatasetLoader,
    type MediaDataset,
    type ResourceSortingInstructions,
    type ResourceSortingScheme,
} from './dataset'
export {
    BaseDataset,
    DatasetCredentials,
    DatasetLoader,
    MediaDataset,
    ResourceSortingInstructions,
    ResourceSortingScheme,
}

/////////////////////////////////////////////////
//                  DOCUMENT                   //
/////////////////////////////////////////////////

import {
    type DocumentResource,
    type DocumentServiceReject,
    type DocumentServiceResolve,
    type DocumentServiceResponse,
} from './document'
export {
    DocumentResource,
    DocumentServiceReject,
    DocumentServiceResolve,
    DocumentServiceResponse,
}

/////////////////////////////////////////////////
//                   MEDIA                     //
/////////////////////////////////////////////////

import {
    type AudioRecording,
    type WavHeader,
    type WavSignalChannel,
} from './media'
export {
    AudioRecording,
    WavHeader,
    WavSignalChannel,
}

/////////////////////////////////////////////////
//                   PLOT                      //
/////////////////////////////////////////////////

import {
    type BiosignalPlot,
    type BiosignalPlotConfig,
    type BiosignalTrace,
    type HighlightContext,
    type PlotCircleStyles,
    type PlotLineStyles,
    type PlotTraceSelection,
    type SignalHighlight,
    type SignalPoI,
    type WebGlCompatibleColor,
    type WebGlPlotConfig,
    type WebGlTrace,
} from './plot'
export {
    BiosignalPlot,
    BiosignalPlotConfig,
    BiosignalTrace,
    HighlightContext,
    PlotCircleStyles,
    PlotLineStyles,
    PlotTraceSelection,
    SignalHighlight,
    SignalPoI,
    WebGlCompatibleColor,
    WebGlPlotConfig,
    WebGlTrace,
}

/////////////////////////////////////////////////
//                   READER                    //
/////////////////////////////////////////////////

import {
    type AssociatedFileType,
    type ConfigReadHeader,
    type ConfigReadSignals,
    type ConfigReadUrl,
    type FileDecoder,
    type FileFormatReader,
    type FileFormatReaderSpecs,
    type FileReader,
    type FileSystemItem,
    type FileSystemItemType,
    type ReadDirection,
    type ReaderMode,
    type SignalDataReader,
    type SignalFileReader,
    type SignalFilePart,
    type SuccessReject,
    type SuccessResolve,
    type SuccessResponse,
} from './reader'
export {
    AssociatedFileType,
    ConfigReadHeader,
    ConfigReadSignals,
    ConfigReadUrl,
    FileDecoder,
    FileFormatReader,
    FileFormatReaderSpecs,
    FileReader,
    FileSystemItem,
    FileSystemItemType,
    ReadDirection,
    ReaderMode,
    SignalDataReader,
    SignalFileReader,
    SignalFilePart,
    SuccessReject,
    SuccessResolve,
    SuccessResponse,
}

/////////////////////////////////////////////////
//                  SERVICE                    //
/////////////////////////////////////////////////

import {
    type ActionWatcher,
    type AssetService,
    type CommissionMap,
    type CommissionPromise,
    type ManagedService,
    type MemoryManager,
    type PythonResponse,
    type SetupStudyResponse,
    type SignalCacheMutex,
    type SignalCachePart,
    type SignalCacheProcess,
    type SignalCacheResponse,
    type WorkerCommission,
    type WorkerMessage,
    type WorkerResponse,
} from './service'
export {
    ActionWatcher,
    AssetService,
    CommissionMap,
    CommissionPromise,
    ManagedService,
    MemoryManager,
    PythonResponse,
    SetupStudyResponse,
    SignalCacheMutex,
    SignalCachePart,
    SignalCacheProcess,
    SignalCacheResponse,
    WorkerCommission,
    WorkerMessage,
    WorkerResponse,
}

/////////////////////////////////////////////////
//                   STUDY                     //
/////////////////////////////////////////////////

import {
    type OrderedLoadingProtocol,
    type StudyContext,
    type StudyContextCollection,
    type StudyContextFile,
    type StudyContextFileRole,
    type StudyFileContext,
    type StudyLoader,
    type StudyLoaderContext,
    type StudyLoaderProtocolContext,
} from './study'
export {
    OrderedLoadingProtocol,
    StudyContext,
    StudyContextCollection,
    StudyContextFile,
    StudyContextFileRole,
    StudyFileContext,
    StudyLoader,
    StudyLoaderContext,
    StudyLoaderProtocolContext,
}

/////////////////////////////////////////////////
//                   UTIL                      //
/////////////////////////////////////////////////

import {
    type Modify,
    type TypedNumberArray,
    type TypedNumberArrayConstructor,
} from './util'
export {
    Modify,
    TypedNumberArray,
    TypedNumberArrayConstructor,
}