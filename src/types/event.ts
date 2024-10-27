import { type ScopedEventPhase } from 'scoped-event-bus/dist/types'

export type BroadcastStateEvent = void

export type EpicurrentsEventDetail = {
    phase: ScopedEventPhase
    scope: string
}

export type EventWithPayload<T> = {
    payload: T
}

export type PropertyChangeEvent<T> = {
    property: string
    newValue: T
    oldValue: T
}