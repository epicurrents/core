# @epicurrents/core — roadmap

General design directions and work deferred from previous implementations. Nothing here describes shipped behaviour — [README.md](README.md) is the current-state description of the package, and [AGENTS.md](AGENTS.md) the in-depth technical reference; each item below links to the section there whose current state it builds on.

**This is not an issue tracker.** Bugs, feature requests and other discrete work items belong in the GitHub issue tracker. This file holds only broad design intent that is not yet actionable as an issue, and it will likely be retired in favour of the external tracker once that practice is established.

## Load a dataset from a folder

`StateManager.loadDatasetFolder` is declared but not implemented: it refuses with an error rather than returning a dataset. The step it is missing is the one that turns each loaded `StudyContext` into a `DataResource` — every module knows how to do that for its own modality, and nothing yet decides which module owns a given study at this level.

This has become actionable now that the platform can supply the metadata describing a dataset, which is what a folder on its own could never provide: the modality of each study, and therefore the module that should construct its resource. A design that takes that metadata alongside the folder, rather than inferring everything from the file tree, is the direction to explore.

## Triage the type-aware lint findings

Linting has only just started running (the flat config carried an invalid rule option, so eslint exited before reading a file). With the stylistic rules reconciled against the house style it reports 297 errors and 496 warnings, none of them yet triaged.

The `no-unsafe-*` family and `require-await` are the bulk of what is left and mostly describe `any` leakage and cosmetic async — a separate and lower-value pass.

The promise-related classes have been triaged, and two of them need no further work:

- **`unbound-method`, 28 of 30** are the worker action maps (`['get-signals', this.getSignals]`). `BaseWorker.handleMessage` binds at dispatch (`this._actionMap.get(action)?.bind(this)`), so no entry is ever called unbound. The rule cannot see that and reports each entry.
- **`no-floating-promises`, roughly 40 of 48** are the seeding writes in `BiosignalMutex.initSignalBuffers`. They look like a race against the comment in `setupMutex` promising a fully seeded mutex, but `executeWithLock` is re-entrant: when the scope is already locked it skips locking and runs the callback synchronously, so each write has completed before its unawaited promise exists. Correct, but it rests on an invariant nothing states — a write moved outside the surrounding lock would begin floating for real.

What was genuinely wrong has been fixed: the two detached `listContents()` chains in the `GenericDataset` constructor had no rejection handler, so an offline or unauthorised source produced an unhandled rejection out of a constructor.

The remainder is mostly `handleMessage` dispatch in worker `onmessage` handlers, which can no longer reject now that `BaseWorker` reports a throwing handler rather than letting it escape.

The same configuration still has to reach the sibling packages, which currently have no working lint at all.

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
