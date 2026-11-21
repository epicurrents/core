# @epicurrents/core — roadmap

General design directions and work deferred from previous implementations. Nothing here describes shipped behaviour — [README.md](README.md) is the current-state description of the package, and [AGENTS.md](AGENTS.md) the in-depth technical reference; each item below links to the section there whose current state it builds on.

**This is not an issue tracker.** Bugs, feature requests and other discrete work items belong in the GitHub issue tracker. This file holds only broad design intent that is not yet actionable as an issue, and it will likely be retired in favour of the external tracker once that practice is established.

## Unreleased work awaiting a version bump — the next release is 2.1.0

Core sits at 2.0.0 with fixes committed on top of it. The audit of the sibling packages keeps turning up small core-side defects, so the bump is deliberately deferred until that sweep finishes and they can ship as one release rather than a string of versions. Anything landed since 2.0.0 belongs in that release's notes.

**The release is a minor rather than a patch.** Most of what has landed is a fix, but repairing the settings relay added `AppSettings.applySnapshot` and closing the substitute vocabulary gap added `SignalReaderWorkerSubstitute`, both published surface. An addition to it is a minor under semver whatever the change around it was for, so the number is 2.1.0 and a package that reaches for either must ask for `^2.1.0` — `^2.0.0` admits a core that has neither. `api-reader` calls the method, `csv-reader` extends the class, and `edf-reader` reaches for `BaseWorker._validate`; every such package currently declares `^2.0.0` because naming an unpublished version would be worse. The builder's roadmap holds the set, and correcting it is part of cutting the release rather than of the sweep.

`@epicurrents/core/workers` also changes character in the same release. It exported `MontageWorker` from a module that assigned `onmessage` and constructed a worker instance when it was imported, so reaching for the class from the main thread took over the application's own message handler; the class now lives in a module with no side effects and the thread entry in [src/workers/montage.worker.entry.ts](src/workers/montage.worker.entry.ts). The memory manager and the trend worker are split the same way, in [src/workers/memory-manager.worker.entry.ts](src/workers/memory-manager.worker.entry.ts) and [src/workers/trend.worker.entry.ts](src/workers/trend.worker.entry.ts); the barrel exports `MemoryManagerWorker`, so there the handler was reachable by any consumer of `@epicurrents/core/workers` rather than only by a main-thread caller inside the package. Every export name and shape is unchanged.

Splitting montage had left `build:workers` building its standalone bundle from the class module, which by then bound nothing: the `umd/` montage worker loaded, ignored every commission and reported no error, so a deployment that cannot grant `worker-src blob:` and serves those files got a montage that silently never computed. The three standalone bundles are now built from the entry files, which is also what makes the claim in [AGENTS.md](AGENTS.md) — that the inlined and standalone bundles are the same code — true again.

The package now declares `"sideEffects": false`, which the split is what permits. It is published surface in the sense that matters to a consumer's bundler: a worker that reaches for one class out of the barrel stops carrying the rest of core with it. Measured on the four packages that resolve core through the workspace symlink alone, so that the declaration is the only variable: `api-reader` 492 kB to 38, `csv-reader` 587 to 167, `edf-reader` 602 to 182, `dicom-reader` 1646 to 1225. The remaining readers show a similar drop but had a stale core of their own in `node_modules` at the time, so their figures carry two causes and are not quoted here.

The release also adds the shared coded-event vocabulary. `GenericBiosignalEvent.CODED_EVENTS` carries the technical, intervention, observation and environment terms from [src/assets/annotation/vocabulary/biosignal-events.json](src/assets/annotation/vocabulary/biosignal-events.json), `CodedEventProperties` gains `class` and `meta`, every term with a HED equivalent names it in a `hed` crosswalk, and the coded-event statics on `GenericAnnotation` became class-aware methods a subclass inherits over its own table, which is what let the EEG module drop its copies. Additions to published surface, so they ride the minor; the one observable change is that the statics are no longer arrow properties and lose `this` when detached, which nothing in the family did.

The memory manager gained a teardown in the same release. `MemoryManager.shutdown` unloads every service registered against the shared buffer, awaits them, and then has the worker drop the buffer and close — the manager's half of the defect the montage worker had. `EpicurrentsApp` gained `unloadNeedsConfirmation` and `allowUnload` alongside it, which is how a host asks whether leaving the document would cost the user an open review session or an annotation edit, and how an application-initiated reload waives the question. Three additions to published surface, so they ride the same minor.

The substitute base class closed the rest of the teardown gap in the same release. `ServiceWorkerSubstitute` answers `shutdown` itself — replying before it drops its listeners, since the method clears them and `onmessage` together and a reply sent after it reaches nobody — so the substitutes that register no case of their own stop refusing the one commission `GenericService.shutdown` and `unload` both await. It also gained `_validate`, `_failure` and `_success`, lifted from `SignalReaderWorkerSubstitute`, which had them only because it was written first; `_validate` is what keeps a refusal on the substitute's own transport rather than on the global `postMessage`, which on the main thread posts it to the window. All four are protected members a subclass outside the package reaches, so they are surface and ride the minor.

`GenericService` no longer drops in-flight commissions on the way out. `shutdown` and `destroy` both cleared `_commissions`, which discards each entry's resolve and reject closures without calling either, so a caller awaiting a reply as the worker was terminated waited for the life of the page. Both now reject through `_rejectAllCommissions`, as the superseded-request and worker-error paths already did.

Two declarations stopped describing something no implementation answers. `WorkerResponse['data']` declares `error`, which `_failure`, `returnFailure` and `validateCommissionProps` have always posted and which the index signature typed `unknown`, so every service read it through an assertion; `_failure` narrowed to the string each of its call sites passes. The new `MainProperty` names the value union `DataResource.getMainProperties` actually returns, and typing the map in `GenericResource` to it is what found the fourth member — `ResourceCollection` puts a `Date` in it, which the declaration never admitted and the navigator has no branch for.

Montage workers start on demand and stop when their recording goes out of view, and destroying a recording terminates every worker it owns ([MontageService + MontageWorker](AGENTS.md#montageservice--montageworker), [three-level cache lifecycle](AGENTS.md#three-level-cache-lifecycle)). The interfaces gained what that needs — `BiosignalMontage.destroy` and `releaseWorker`, `BiosignalMontageService.releaseWorker`, `BiosignalTrendService.destroy` — and an implementation outside the package has to provide them, so they ride the minor. `MontageService` also releases each commission's entry when its reply arrives; the map had kept one per read for the life of the montage.

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

Linting has only just started running (the flat config carried an invalid rule option, so eslint exited before reading a file). With the stylistic rules reconciled against the house style it reports 296 errors and 312 warnings as of 2026-10-03, none of them yet triaged.

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


## Release deferred studies as a minor

`addDeferredStudy`, `openDeferredResource`, `replaceResource` on the dataset and the runtime, `DeferredResource`, `isDeferredResource`, the `DeferredStudy` type and the `app.eagerStudyLoadLimit` setting are additions to the published surface, so they ship as a minor (2.3.0). The platform SPA declares the part it calls locally until its `@epicurrents/core` dev dependency moves to that release.

## Load a study in place, not through a placeholder

A deferred study is listed as a `DeferredResource` and loaded into a second object, which `replaceResource` puts in its place ([Deferred studies](AGENTS.md#deferred-studies)). Everything around the identity change pays for it:

- The platform keeps a tracker re-pointing attached studies at whichever object currently holds their recording's place.
- The interface re-runs its Pyodide wiring on `replace-resource`, and core re-subscribes its annotation watch on the same event.
- The store's activation action awaits the load and re-dispatches with the new object.
- A listing cannot be a child resource, because `openDeferredResource` finds and swaps it only as a dataset member.

The intent is to construct the real resource from the start and finish it on itself, in two stages split by cost rather than by object.

**Listed.** The resource exists in its module's own class with what a listing needs: its name, its modality, its main properties and the source its importer reads. Two producers fill it:

- **A study opened from a file or a URL** runs the importer as now, and the module constructs the resource from the study context it returns. For EDF the importer reads the fixed header and the per-signal blocks on the main thread and starts no worker.
- **A host listing studies it already describes**, as the platform does from its recordings endpoint, supplies the metadata itself, and nothing is fetched.

Either way, a listed resource has no worker, service, reader, signal cache or memory reservation, so listing a thousand studies costs what listing ten does.

**Activated.** First activation finishes the setup on the same object:

1. For a host-listed study, the importer reads the header.
2. The module creates its worker and service.
3. It runs the memory-budget check.
4. It sets up the worker and builds the montages and the cache.

The state goes from `added` to `loading` to `ready`. A failure sets `error` and `errorReason` on the same object; nothing is swapped in, `ErrorResource` included.

The rules that hold the shape:

- **The file's header is the only header a worker gets.** A host's metadata lists the study and is never read for loading, as `properties` are display-only today. A worker computes byte offsets from the header it is handed, so a header rebuilt from host JSON would decode the signal at the wrong offsets once ingest metadata and the stored file disagree, with no error anywhere. The guarantee costs two small range reads per activation.
- **Modality is fixed at listing.** Some importers decide it while reading today: the biosignal loader turns a video file into a video study, and `RestApiImporter` takes it from the response. A host lists a study under the modality it knows, and a read that disagrees ends in `error`, never in a resource of another class.
- **Loads through one importer stay queued** (`#queueOnLoader`), since a study loader holds one study between `useStudy` and the resource setup. Concurrent activations of one resource share its load.
- **Anything wired to "a usable resource appeared" moves to activation.** Left on `add-resource`, the interface's Pyodide wiring would boot Pyodide for every listed recording, and the memory-budget check would fail recordings nobody opened.
- **A view may hold an active resource that is still loading.** The interface shows one loading state until the resource is ready, and mounts the modality viewer only then. That also retires the `prepare()` re-dispatch of ACTIVATE in `EegRecording` and `AccRecording`, which exists because a viewer can mount before its recording is prepared.

Unloading becomes the reverse step: release the worker, the service and the cache, and go back to listed with the metadata kept. That is the mechanism [Release the readers of opened recordings](#release-the-readers-of-opened-recordings) needs, without rebuilding a placeholder from a kept descriptor.

**Work per package.**

| Package | Work |
|---|---|
| core | The two-stage lifecycle on `GenericResource`: a `load` entry, a protected hook a module fills with what its constructor does today, and unload back to listed. A factory on `StudyLoader` that builds the module's class unloaded. `setActiveResource` loads a listed resource instead of refusing it. The listing entry replaces `addDeferredStudy`. Guards in `GenericBiosignalResource` for members read before a service exists. Remove the deferred and swap API. |
| interface | Media and radiology resources are ready at construction and need no load step. The activation action stops awaiting a swap. The Pyodide wiring moves to activation. The loading state comes before the viewer mounts, and the navigator's gating follows the new states. |
| emg-module, ncs-module, doc-module, tab-module | Move the source-dependent tail of the constructor (worker, service, `prepareWorker`) into the hook. Close the race where the resource reports `ready` before its worker has finished, since a loading state shown until `ready` makes it visible. |
| eeg-module, acc-module | Move the channels, the header, the service and the memory-budget check out of the constructor. Guard every listener the constructor wires to `_service`. Retire the `prepare()` re-dispatch. |
| readers | None expected: the importers read headers without a worker. Verify each one, since a worker started at import would undo the listed stage. |

**API.** A major, 3.0, released together with every module package, which then declares `^3.0.0`. It removes:

- `DeferredResource`, `isDeferredResource` and `openDeferredResource`;
- `replaceResource` on the dataset and the runtime, and the `replace-resource` event.

The `DeferredStudy` descriptor and `addDeferredStudy` survive in substance under names that drop "deferred"; the naming is open. `app.eagerStudyLoadLimit` either becomes "activate up to this many in the background" or goes, since listing no longer needs a limit. [Retire `syncSettings`](#retire-syncsettings-at-the-next-major) rides the same major.

**Tests that pin the shape.**

- No `Worker` is constructed while a resource is listed, for either producer.
- The object activated is the object listed.
- A failed load leaves `error` on that object.
- A worker's header comes from the file even when the listing carried one.
- A read whose modality disagrees with the listing ends in `error`.

**Progress.** The core half is in the tree, unreleased: `load`, `isListed`, `setListing` and the `_load` hook on `GenericResource`; `createListedResource` on the study loader, optional on the interface since the interface's media and radiology loaders implement it directly, and null by default in `GenericStudyLoader`; `listStudy` on the application; activation loading in `setActiveResource` and `selectActiveResource`; and `loadAndCacheSignals` loading before it looks for a service. [Listed studies and loading in place](AGENTS.md#listed-studies-and-loading-in-place) describes it, and [tests/listed-loading.test.ts](tests/listed-loading.test.ts) pins it against a fake module, the host producer only. All of it is additive, so the deferred API stays beside it while the module packages, the interface and the platform move. Removing that API, and making `createListedResource` required, is the change that makes the release 3.0, and it comes last.

A module adopts the lifecycle by overriding `createListedResource` and moving the tail of its constructor into `_load`. The file-opened producer needs one more step: `getResource` builds the resource unloaded too, with `loadStudy` loading it at once as it does now. Until a module has both, `listStudy` refuses its studies, and a host lists them with `addDeferredStudy`.

emg-module, ncs-module, doc-module and tab-module have both, unreleased. Each resource takes a worker getter in place of a worker and asks for it in `_load`, which creates the service and sets the worker up, so `ready` now follows the worker's answer; for tab-module the setup that loads the tables is the load. A listed resource stays out of its loader's `_resources`, the list `loadStudy` finds a read study's resource in by index; a listing entered between a read and its `getResource` would otherwise take the read study's place. emg-module's [tests/listed.test.ts](../emg-module/tests/listed.test.ts) drives the real loader through the real `listStudy` with an importer shaped like the EDF and WAV ones. Adopting them changed core in three places. `listStudy` sent the listed modality into the read, and every importer refused it, since they declare no modality or only `document`; it now checks the modality against the loader at listing and leaves it out of the read. It registers the application's memory manager on the loader before the factory runs. And `GenericDocumentResource` takes its source as optional. doc-module's loader now claims a read study under its document type (`pdf`, `htm`) rather than `document`, which the read's modality check would refuse.

eeg-module and acc-module have both too, unreleased, and needed nothing more from core. Each recording reads its channels and header from the study, at construction when given one and in `_load` for a listed recording, and `_load` creates the service with its listeners and sets the worker up before the default setups go on; EEG's memory-budget check moved there from the loader, so a recording nobody opens is never refused. Activation loads a recording and commissions its cache once the load has succeeded on a recording still active, which retires the `prepare()` re-dispatch; `prepare()` is now `load()`, and `preload()` loads before it sets up. eeg-module's `_createRecording` hook changed shape, which an outside subclass such as `PsgRecording` follows at the 3.0 release. acc-module's [tests/listed.test.ts](../acc-module/tests/listed.test.ts) covers the listing path end to end, as emg-module's does; eeg-module's tests run against a core mock, which now carries the load contract. The readers check is next.

**Built on it.** Child resources that are listed and loaded in place are what the interface's nested navigator uses for attachments; see "Dataset navigator with nested resources" in the interface ROADMAP. The platform drops its attachment-parent tracker and its swap-dependent loading code once it consumes 3.0.

## Release the readers of opened recordings

Deferred studies bound what a dataset costs when it opens, but not what opening recordings one after another costs: each opened recording keeps its reader, its montage and trend workers and, with shared memory, its file worker until the whole dataset is destroyed. `unload` releases the cache and stops no worker, and a study loader keeps every resource it created in `_resources`. A user stepping through a few hundred recordings in one tab still exhausts it. The deferred shape makes the fix cheap: keep the last few opened recordings, and replace an older one with a `DeferredResource` rebuilt from its kept descriptor, destroying the loaded resource so its service shuts its worker down. It needs a resource that has unsaved annotation work to be skipped, and the loader to drop the resource from `_resources`.

Destroying a resource terminates every worker it owns — the file worker, one per montage and, for EEG, the trend worker — so the replacement only has to call it ([three-level cache lifecycle](AGENTS.md#three-level-cache-lifecycle), Level 3). Montage workers start on demand and stop when their recording goes out of view, so an opened EEG recording keeps two threads, its reader's and its trends', and its signal cache. Measured on a 1,032-recording EEG dataset in November 2026: 24 live workers after thirteen switches, against 100 when every montage held a thread. Destroying older recordings would bound those as well, but a recording reopened at a position far into it waits for its signals to be read again, so it costs the user a blank plot that keeping it does not.

## Release settled commissions in every service

`SharedWorkerCache` and `ServiceMemoryManager` resolve the commissions they handle themselves without dropping the entry, which `GenericService._handleWorkerCommission` and `MontageService` do. The map grows by one entry per commission for the life of the service, and a shutdown reports every leftover as a rejected commission. Both answer few commissions, so nothing has been seen to suffer, but the fix is the same one line per branch and a test reading the map after a reply.

## Cheap mutex rebind on reactivation

Level 1 release is wired and used, but the *rebind* direction is not: reusing a released mutex shell over a fresh buffer via `BiosignalMutex.initSignalBuffers(..., overwrite=true)` + `rebuildDataArrayViews()` instead of a full setup. Both real `initSignalBuffers` call sites pass `overwrite=false`, so reactivation always does the full `requestMemory` + `setupMutex` + `setDataArrays` walk — the `overwrite=true` branch is reachable but never taken (see [Rolling signal cache → Eviction and reactivation coherence](AGENTS.md#eviction-and-reactivation-coherence)).

Wiring it would let `unloadOnClose=true` reactivation skip the full walk, but it needs an "intent to reactivate" signal on close — today's `releaseBuffers` discards the mutex, and no caller currently wants Level 1 over Level 2.

## Produce `partial` request results

`SignalRequest` carries a `partial` status, but the reader never produces it — a mid-slide read returns `pending` until the full target lands (see [Rolling signal cache → The request protocol](AGENTS.md#the-request-protocol)). Producing `partial` (return the resident, view-anchored overlap immediately plus a `ready` promise for the rest) lets the plot draw the still-valid portion of an overlapping jump instead of showing a loading state for the whole slide. The type and the consumer contract are already in place, so this needs no consumer-side change.
