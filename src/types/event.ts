import { type ScopedEvent, type ScopedEventPhase } from 'scoped-event-bus/dist/types'

export type BroadcastStateEvent = void

export type EpicurrentsEventDetail = {
    phase: ScopedEventPhase
    scope: string
}

export type EventWithPayload<T> = ScopedEvent & {
    detail : {
        payload: T
    }
}

export type PropertyChangeEvent<T> = ScopedEvent & {
    detail: {
        property: string
        newValue: T
        oldValue: T
    }
}