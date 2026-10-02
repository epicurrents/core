# @epicurrents/core — roadmap

General design directions and work deferred from previous implementations. Nothing here describes shipped behaviour — [README.md](README.md) is the current-state description of the package, and [AGENTS.md](AGENTS.md) the in-depth technical reference; each item below links to the section there whose current state it builds on.

**This is not an issue tracker.** Bugs, feature requests and other discrete work items belong in the GitHub issue tracker. This file holds only broad design intent that is not yet actionable as an issue, and it will likely be retired in favour of the external tracker once that practice is established.

## Unreleased work awaiting a version bump — the next release is 2.1.0

Core sits at 2.0.0 with fixes committed on top of it. The audit of the sibling packages keeps turning up small core-side defects, so the bump is deliberately deferred until that sweep finishes and they can ship as one release rather than a string of versions. Anything landed since 2.0.0 belongs in that release's notes.

**The release is a minor rather than a patch.** Most of what has landed is a fix, but repairing the settings relay added `AppSettings.applySnapshot` and closing the substitute vocabulary gap added `SignalReaderWorkerSubstitute`, both published surface. An addition to it is a minor under semver whatever the change around it was for, so the number is 2.1.0 and a package that reaches for either must ask for `^2.1.0` — `^2.0.0` admits a core that has neither. `api-reader` calls the method and `csv-reader` extends the class, and both currently declare `^2.0.0` because naming an unpublished version would be worse. Correcting the two is part of cutting the release, not of the sweep.

`@epicurrents/core/workers` also changes character in the same release. It exported `MontageWorker` from a module that assigned `onmessage` and constructed a worker instance when it was imported, so reaching for the class from the main thread took over the application's own message handler; the class now lives in a module with no side effects and the thread entry in [src/workers/montage.worker.entry.ts](src/workers/montage.worker.entry.ts). The memory manager and the trend worker are split the same way, in [src/workers/memory-manager.worker.entry.ts](src/workers/memory-manager.worker.entry.ts) and [src/workers/trend.worker.entry.ts](src/workers/trend.worker.entry.ts); the barrel exports `MemoryManagerWorker`, so there the handler was reachable by any consumer of `@epicurrents/core/workers` rather than only by a main-thread caller inside the package. Every export name and shape is unchanged.

Splitting montage had left `build:workers` building its standalone bundle from the class module, which by then bound nothing: the `umd/` montage worker loaded, ignored every commission and reported no error, so a deployment that cannot grant `worker-src blob:` and serves those files got a montage that silently never computed. The three standalone bundles are now built from the entry files, which is also what makes the claim in [AGENTS.md](AGENTS.md) — that the inlined and standalone bundles are the same code — true again.

The package now declares `"sideEffects": false`, which the split is what permits. It is published surface in the sense that matters to a consumer's bundler: a worker that reaches for one class out of the barrel stops carrying the rest of core with it. Measured on the four packages that resolve core through the workspace symlink alone, so that the declaration is the only variable: `api-reader` 492 kB to 38, `csv-reader` 587 to 167, `edf-reader` 602 to 182, `dicom-reader` 1646 to 1225. The remaining readers show a similar drop but had a stale core of their own in `node_modules` at the time, so their figures carry two causes and are not quoted here.

The release also adds the shared coded-event vocabulary. `GenericBiosignalEvent.CODED_EVENTS` carries the technical, intervention, observation and environment terms from [src/assets/annotation/vocabulary/biosignal-events.json](src/assets/annotation/vocabulary/biosignal-events.json), `CodedEventProperties` gains `class` and `meta`, and the coded-event statics on `GenericAnnotation` became class-aware methods a subclass inherits over its own table, which is what let the EEG module drop its copies. Additions to published surface, so they ride the minor; the one observable change is that the statics are no longer arrow properties and lose `this` when detached, which nothing in the family did.

The memory manager gained a teardown in the same release. `MemoryManager.shutdown` unloads every service registered against the shared buffer, awaits them, and then has the worker drop the buffer and close — the manager's half of the defect the montage worker had. `EpicurrentsApp` gained `unloadNeedsConfirmation` and `allowUnload` alongside it, which is how a host asks whether leaving the document would cost the user an open review session or an annotation edit, and how an application-initiated reload waives the question. Three additions to published surface, so they ride the same minor.

A sibling that needs a fix from this list before the release can rely on the workspace symlink, which resolves core from the checkout rather than the registry — but its declared range still has to name a version that exists, so nothing published may depend on an unreleased fix.

The version in `package.json` stays at 2.0.0 until the sweep finishes. Bumping it early would make every sibling's range look satisfiable against a release that does not exist yet.

## `safeObjectFrom` returns `any`, and it is load-bearing

`safeObjectFrom` is `Object.assign(Object.create(null), template)`, which TypeScript infers as `any`. That propagates: every module's runtime export is built through it, so each one lands in its package as an unsafe assignment, and the type of what went in is lost on the way out.

Giving it the obvious signature — `<T extends object>(template: T): T` — type-checks core cleanly and then fails `edf-reader`, which is the interesting part. `EdfEncoder.createHeader` and `setHeader` return `this.#edfHeader || safeObjectFrom({})` while declaring `BiosignalHeaderRecord`; `EdfHeader` is a different shape, and the empty object has none of the record's fields. A caller on the locked path reads `undefined` off a header it was promised. There is a third site in `EdfImporter`.

So the `any` is not merely untidy, it is what hides those returns from the compiler. Fixing the signature means first deciding what those two methods should return when locked — `null`, a throw, or a properly shaped empty record — which is a change to `edf-reader`'s API and belongs with that package's audit rather than a core patch.

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

## Montage precaching is a protocol with nobody at either end

`MontageService.cacheMontageSignals` is declared on `BiosignalMontageService`, so it is public API. It posts `cache-montage-signals` with a bare `postMessage`, and no worker or substitute has ever answered that action. `MontageService.handleMessage` does have a branch for the reply — it maps the returned signals onto their sampling rates and calls `saveSignalsToCache` — but that branch runs only after `_getCommissionForMessage` finds an entry, and a message posted without a request number creates none. So the protocol is broken at both ends, and nothing in the family calls the method.

That makes it the one part of the montage vocabulary still worth a decision rather than a repair. Precaching a montage means deciding what is cached and when it is invalidated, which is a feature; what exists today is the outline of one. Either implement it — handler in `MontageWorker`, commission through `_commissionWorker` so the reply correlates — or drop the method and its response branch. Dropping it is a breaking change to a published interface, so it waits for 3.0 unless the feature lands first.

## The unload guard confirms rather than preserves

`EpicurrentsApp.unloadNeedsConfirmation` is true while any resource is open and from the first user-sourced change to a resource's `events` or `labels`, and nothing but `allowUnload` makes it false again. It prevents an accident; it recovers nothing once the user accepts the prompt or the tab goes away another way.

Two refinements, in the order they are worth doing.

**Restoring the session.** The position the user had navigated to, the active montage and the filter state could be written to session storage and offered back on the next load, which would make an interrupted review resumable rather than merely guarded. The limit is what a browser will not give back: a recording opened from a URL can be reloaded, but one opened from the user's own disk cannot be reopened without them picking the file again, and nothing the viewer stores changes that. So the restore is worth having for a host that loads by URL and only partial for a standalone viewer — which is also why the guard is the one protection that works in both cases and should stay whatever else lands.

**Clearing the annotation condition.** It is deliberately sticky, because the viewer has no notion of a saved state and a flag that cleared itself would have to guess. The consequence is that a user who annotates, submits through an export target, and then leaves is still asked. An export target's `submit` hands back a receipt, the first thing in the family that knows an annotation set reached somewhere durable, so the condition could be cleared per resource on a successful submit and re-armed by the next edit. That needs a per-resource flag rather than the single application-level one, and a decision about what a partial submit means — one resource of several, or a signal export that carries no annotations at all. Over-warning is the safe direction until then.

## Reader packages still on a hand-written substitute

`SignalReaderWorkerSubstitute` closes the vocabulary gap for any reader substitute that extends it; `csv-reader` does, as does the montage pair through `MontageWorker`. The rest still implement a subset by hand — `wav-reader` and `nic-reader` answer five of the thirteen commissions, `natus-reader` eight, `edf-reader` and `dicom-reader` ten — so on an origin without cross-origin isolation a study in those formats cannot be released or shut down.

Each conversion is small: extend the new base, delete the switch, keep `setup-worker`. Fold it into each package as the audit sweep opens it, and note that it needs a core that has the base, so a package published before core 2.1.0 cannot declare it.

## Retire `syncSettings` at the next major

[src/util/worker.ts](src/util/worker.ts) exports `syncSettings`, which builds the per-field `{ field, value }` settings message. No worker accepts that shape — settings reach a worker as a whole snapshot (see [Settings reach a worker as a snapshot](AGENTS.md#settings-reach-a-worker-as-a-snapshot)) — and nothing in the family calls it.

It stays exported because it is part of `@epicurrents/core/util`, and dropping a published export is a major-version change rather than something to fold into a patch. Remove it, and the `fields` handshake it implies, when 3.0 opens.


## Cheap mutex rebind on reactivation

Level 1 release is wired and used, but the *rebind* direction is not: reusing a released mutex shell over a fresh buffer via `BiosignalMutex.initSignalBuffers(..., overwrite=true)` + `rebuildDataArrayViews()` instead of a full setup. Both real `initSignalBuffers` call sites pass `overwrite=false`, so reactivation always does the full `requestMemory` + `setupMutex` + `setDataArrays` walk — the `overwrite=true` branch is reachable but never taken (see [Rolling signal cache → Eviction and reactivation coherence](AGENTS.md#eviction-and-reactivation-coherence)).

Wiring it would let `unloadOnClose=true` reactivation skip the full walk, but it needs an "intent to reactivate" signal on close — today's `releaseBuffers` discards the mutex, and no caller currently wants Level 1 over Level 2.

## Produce `partial` request results

`SignalRequest` carries a `partial` status, but the reader never produces it — a mid-slide read returns `pending` until the full target lands (see [Rolling signal cache → The request protocol](AGENTS.md#the-request-protocol)). Producing `partial` (return the resident, view-anchored overlap immediately plus a `ready` promise for the rest) lets the plot draw the still-valid portion of an overlapping jump instead of showing a loading state for the whole slide. The type and the consumer contract are already in place, so this needs no consumer-side change.
