import { BaseModuleSettings, CommonBiosignalSettings } from '../../src/types'

export const BIOSIG_SETTINGS = {
    annotations: {
        color: [0,0,0,0],
        convertPatterns: [],
        idColors: {},
        ignorePatterns: [],
        typeColors: {},
        width: 0
    },
    antialiasing: false,
    border: {
    },
    channelSpacing: 1,
    defaultMontages: { },
    defaultSetups: [],
    displayPolarity: -1,
    downsampleLimit: 0,
    filterPaddingSeconds: 10,
    filters: {
        highpass: {
            availableValues: [0.1, 0.2, 0.3, 0.5, 1, 2],
            default: 0.5
        },
        lowpass: {
            availableValues: [5, 10, 20, 30, 40, 50, 70],
            default: 50
        },
        notch: {
            availableValues: [50, 60],
            default: 50
        }
    },
    groupSpacing: 1.5,
    majorGrid: {
        show: true,
        color: [0, 0, 0, 0.25],
        style: 'solid',
        width: 2,
    },
    minorGrid: {
        show: true,
        color: [0, 0, 0, 0.2],
        style: 'solid',
        width: 1,
    },
    montages: {
        cacheMax: 2,
        preCache: true,
    },
    pageLength: 10,
    sensitivity: {
    },
    sensitivityUnit: 'uV',
    showHiddenChannels: false,
    showMissingChannels: false,
    timebase: {
        cmPerS: {
            availableValues: [3],
            default: 3,
        },
    },
    timebaseUnit: 'cmPerS',
    timeline: {
        labelSpacing: 10
    },
    yPadding: 2,
} as BaseModuleSettings & CommonBiosignalSettings