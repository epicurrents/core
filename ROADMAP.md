# @epicurrents/core — roadmap

General design directions and work deferred from previous implementations. Nothing here describes shipped behaviour — [README.md](README.md) is the current-state description of the package, and [AGENTS.md](AGENTS.md) the in-depth technical reference; each item below links to the section there whose current state it builds on.

**This is not an issue tracker.** Bugs, feature requests and other discrete work items belong in the GitHub issue tracker. This file holds only broad design intent that is not yet actionable as an issue, and it will likely be retired in favour of the external tracker once that practice is established.

## Shared action map between worker and substitute

Every off-thread processor's commissions are dispatched in two hand-maintained places — the real worker's `_actionMap` and the substitute's `switch` (see [Worker commission design](AGENTS.md#worker-commission-design--three-places-to-keep-in-sync)). Adding an action to one and forgetting the other is a standing source of `Action 'X' is not implemented` runtime failures the compiler does not catch.

A cleaner design shares the map:

- Move `_actionMap` into a base class shared by the worker and its substitute.
- Each handler reads from `data` and writes back through an injected `reply` callback (`postMessage` in the worker, `returnMessage` in the substitute).
- Removes the second switch entirely; a substitute becomes a thin wrapper routing incoming `postMessage` to `handleMessage` and forwarding `_postMessage` to `returnMessage`.

Deferred: a bigger refactor than v1 trends warranted; revisit once trends are stable.

## Cheap mutex rebind on reactivation

Level 1 release is wired and used, but the *rebind* direction is not: reusing a released mutex shell over a fresh buffer via `BiosignalMutex.initSignalBuffers(..., overwrite=true)` + `rebuildDataArrayViews()` instead of a full setup. Both real `initSignalBuffers` call sites pass `overwrite=false`, so reactivation always does the full `requestMemory` + `setupMutex` + `setDataArrays` walk — the `overwrite=true` branch is reachable but never taken (see [Rolling signal cache → Eviction and reactivation coherence](AGENTS.md#eviction-and-reactivation-coherence)).

Wiring it would let `unloadOnClose=true` reactivation skip the full walk, but it needs an "intent to reactivate" signal on close — today's `releaseBuffers` discards the mutex, and no caller currently wants Level 1 over Level 2.

## Produce `partial` request results

`SignalRequest` carries a `partial` status, but the reader never produces it — a mid-slide read returns `pending` until the full target lands (see [Rolling signal cache → The request protocol](AGENTS.md#the-request-protocol)). Producing `partial` (return the resident, view-anchored overlap immediately plus a `ready` promise for the rest) lets the plot draw the still-valid portion of an overlapping jump instead of showing a loading state for the whole slide. The type and the consumer contract are already in place, so this needs no consumer-side change.

## Retire per-package `globals.d.ts` after the Vite migration

With the `window.__EPICURRENTS__` global now declared canonically in `application.ts` and inherited by every consumer, each package's `globals.d.ts` carries a single line — `declare let __webpack_public_path__`, a webpack build global. Once the toolchain moves from webpack to Vite family-wide, that last reason to keep the file disappears (Vite exposes the equivalent through `import.meta`), so `globals.d.ts` can be deleted from core and every sibling. Gated on the webpack → Vite migration, which is a builder-level toolchain change tracked outside this package.
