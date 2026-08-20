# @epicurrents/core — architecture notes for AI coding assistants

`@epicurrents/core` is the dependency root of the Epicurrents package family. It defines the application entry point (`Epicurrents`), the runtime state manager, the asset/resource/module/service abstractions, the biosignal montage and trend machinery, the worker commission protocol, and the shared TypeScript types every sibling package imports. Every other `@epicurrents/*` package — readers, modality modules, services, and the viewer interface — builds on the contracts defined here, so a change in this package can break all of them at once.

This file is the in-depth technical reference for AI coding assistants: internal architecture, the contracts the package guarantees to consumers, and the gotchas that bite when editing it. It should let an agent answer most questions about the package directly, or at least point at the right place to look. [README.md](README.md) is the denser user-facing description (structure, usage, build workflow) and the right link to hand a human; [ROADMAP.md](ROADMAP.md) carries design intent, not current state. Sibling packages (readers, modules, services, interface) keep their own `AGENTS.md`; module-side and rendering-side detail lives there, not here.

> **Keep this file current — update it in the same change set as the code.** This document only works if it describes the code as it is; a stale section is worse than a missing one, because an agent will act on it. After any change that alters something documented here — a contract, a protocol shape, a lifecycle, a public symbol, a limitation being lifted — update the affected section (or add one for a new subsystem) before reporting the work done. The same rule applies to the siblings: README.md when the user-facing surface (usage, structure, build workflow) changes, ROADMAP.md when documented deferred work lands or new work is deliberately deferred. Pure refactors, test-only changes and bug fixes that restore documented behaviour need no update.

---

## Version compliance

`tsconfig.base.json` in this package is the **shared toolchain base** for the whole family: this package extends it locally, and sibling packages extend `@epicurrents/core/tsconfig.base.json` so it resolves standalone. It is exported from `package.json` (`"./tsconfig.base.json"`) for exactly that reason.

**Never pin a TypeScript version here that diverges from the family's canonical `^5.7.0`**, and never override `tsconfig.base.json` compiler options in a sibling package without a comment explaining why. A divergent TypeScript version produces structurally incompatible `.d.ts` files that **type-check cleanly but corrupt data at runtime** — the worker bundle and the main-thread code end up disagreeing about data layouts or API shapes with no compile-time signal.

Both build outputs must be regenerated together after any change to shared code:

```bash
npm run build:workers  # updates umd/ (standalone worker bundles)
npm run build:tsc      # updates dist/ (ESM, consumed by the main thread)
# or simply:
npm run build          # build:workers + build:tsc
```

Rebuilding only one leaves a stale mismatch between the worker bundle and the main-thread code — the same failure mode as a version drift.

`build:tsc` is two steps: `build:lib` (Vite emits the ESM tree, preserving one output module per source module) and `build:types` (`tsc --emitDeclarationOnly`). The name is kept because the builder's cross-package `build:tsc-all` sweep calls it by name in every package; a package that drops the script is skipped silently, which is exactly the stale-output failure above.

---

## Core concepts

**The single most important package.** Everything else depends on it.

### Key concepts

| Concept | Class / Interface | Role |
|---|---|---|
| Application | `Epicurrents` (class), `EpicurrentsApp` (interface) | Entry point. Holds runtime, event bus, interface, memory manager. |
| Runtime state | `RuntimeStateManager` / `StateManager` interface | Central reactive store: `APP`, `MODULES`, `SERVICES`, `SETTINGS`, `WORKERS`, `INTERFACE` maps. |
| Asset | `BaseAsset` interface | Root type of everything — has `id`, `name`, `modality`, `state`, event API. |
| Resource | `DataResource` interface | Loadable asset with lifecycle (`added → loading → loaded → ready → destroyed`). |
| Module | `ResourceModule` / `RuntimeResourceModule` | Pluggable modality support registered with `registerModule(name, module)`. |
| Service | `GenericService` / `AssetService` | Web-worker interface. Manages commission/promise pairs for off-thread work. |
| Study loader | `GenericStudyLoader` / `StudyLoader` | Knows how to read a file format and produce `StudyContext` + `DataResource`. |
| Interface | `InterfaceModule` / `InterfaceModuleConstructor` | UI shell — passed `EpicurrentsApp` + `StateManager` at `launch()`. |
| Dataset | `MixedMediaDataset` / `MediaDataset` | Container for a set of resources opened together. |
| Event bus | `EventBus` (wraps `scoped-event-bus`) | Application-wide event dispatch; exposed as `window.__EPICURRENTS__.EVENT_BUS`. |

### Globals

The `Epicurrents` constructor sets:
```ts
window.__EPICURRENTS__ = { APP, EVENT_BUS, RUNTIME }
```

### Source layout

```
src/
  assets/
    biosignal/           # GenericBiosignalResource, GenericBiosignalService,
                         # BiosignalCache, BiosignalMutex, MontageService, etc.
    connector/           # DatabaseAPIConnector, WebDAVConnector
    dataset/             # GenericDataset, MixedMediaDataset
    document/            # GenericDocumentResource
    reader/              # GenericSignalReader/Writer/Processor, LocalFileReader,
                         # filesystem/ (FileSystemDirectory, FileSystemFile)
    service/             # GenericService, ServiceMemoryManager, ServiceWorkerSubstitute
    study/               # GenericStudyLoader, StudyCollection, StudyLoadProtocol
    annotation/          # GenericAnnotation, ResourceLabel
  config/                # Settings singleton
  events/                # EventBus, ApplicationEvents enum
  runtime/               # RuntimeStateManager, module stubs
  types/                 # All TypeScript interfaces (application.ts is the main one)
  util/                  # constants, conversions, signal maths, worker helpers,
                         # network/ (resilientFetch + per-origin circuit breaker)
  workers/               # base.worker, montage.worker, trend.worker, memory-manager.worker
```

### App lifecycle

1. Instantiate `new Epicurrents()` — sets globals, creates `RuntimeStateManager`.
2. Call `registerModule(name, module)` for each modality (EEG, EMG…).
3. Call `registerService(name, service)` for optional services (Pyodide, ONNX…).
4. Call `registerStudyImporter(name, label, mode, loader)`.
5. Call `registerInterface(InterfaceConstructor)`.
6. Call `launch()` — creates interface, sets up memory manager if `useSAB` is true.
7. Call `loadStudy(loaderName, source, options)` to open a recording.

---

## Core runtime internals

### RuntimeStateManager

Extends `GenericAsset`. Wraps a module-level `state` singleton object — not a reactive UI store. All mutations go through named methods (`addDataset`, `setActiveResource`, `setModule`, …) that dispatch `before`/`after` scoped events via the `EventBus`. The `SETTINGS` singleton supports both programmatic and `localStorage`-persisted user-overridable fields. `WORKERS` is a `Map<name, () => Worker | null>` used to inject test doubles or deployment-specific workers.

### Signal data flow — two paths

Signal data travels along two distinct paths depending on whether `SharedArrayBuffer` is available:

**Path A — Memory manager (SAB / cross-origin isolated)**
```
format worker → BiosignalMutex (SAB, raw signals)
  ↓  (MutexExportProperties transferred to montage worker)
MontageWorker.setupInputMutex → MontageProcessor reads directly from SAB
  ↓
MontageProcessor.getSignals() → derived signals → sent back to main thread
```

**Path B — No memory manager (JS heap)**
```
format worker → BiosignalCache (SignalCachePart, main thread JS heap)
  ↓  (cache reference passed to montage worker)
MontageWorker.setInputCache → MontageProcessor reads from shared worker / simple cache
  ↓
MontageProcessor.getSignals() → derived signals → sent back to main thread
```

`GenericBiosignalResource` holds both: `_mutexProps` (SAB path, `MutexExportProperties`) and `_cacheProps` (`BiosignalCache`). The `dataCache` getter returns `_mutexProps || _cacheProps`.

### BiosignalCache

Simple non-SAB cache. Holds a single `SignalCachePart` (`{ start, end, signals: { data: Float32Array, samplingRate }[] }`). `insertSignals(part)` merges adjacent parts via `combineSignalParts`. No locking — safe for single-threaded (main-thread) access only.

### GenericBiosignalResource

Key properties:
- `_service` — the format-specific `BiosignalDataService` that reads raw bytes
- `_montages[]` — list of available montages (one active at a time)
- `_activeMontage` — signals routed through this if set; `null` = raw signals displayed
- `visibleChannels` → `activeMontage.channels` (filtered) if montage active, else `_channels` (source)
- `signalCacheStatus: [start, end]` — tracks what portion of recording is loaded

Setting `activeMontage` stops prior montage signal caching, updates filters, and relays channel change events to resource listeners. All filter mutations (`setHighpassFilter` etc.) are async — they await `activeMontage.updateFilters()` which sends a commission to the montage worker.

### MontageService + MontageWorker

`MontageService` (main thread) owns the `MontageWorker` (or `MontageWorkerSubstitute` for non-SAB mode). Commission pattern:
1. `_commissionWorker(action, params)` → generates UUID → posts message → returns `{ promise }`
2. Worker processes, replies with same UUID
3. `handleMessage` matches UUID → resolves/rejects promise

Worker actions map: `get-signals`, `map-channels`, `set-filters`, `set-interruptions`, `setup-worker`, `setup-input-mutex`, `setup-input-cache`, `release-cache`, `release-signal-arrays`.

`setupWorker` initialises a `MontageProcessor` in the worker with the channel config and module settings. `get-signals` → `MontageProcessor.getSignals(range, config)` → derived `Float32Array[]` → transferred back.

### MontageProcessor

Lives entirely inside the montage worker (not transferred). Holds the actual signal math — channel derivation (active channels minus reference channels), filter application (highpass/lowpass/notch), downsampling. Reads raw signals from the cache/mutex. Key method: `getSignals(range, config)`.

### Property change events

Every setter on `GenericBiosignalResource` (and all assets) calls `_setPropertyValue(name, value)` which dispatches a `property-change:<name>` scoped event. Consumers subscribe to these events to trigger reactivity/redraws without direct coupling to the resource implementation.

---

## Event bus dispatch semantics

The event bus is exposed as `window.__EPICURRENTS__.EVENT_BUS`. It starts as `null` and is assigned by the `Epicurrents` constructor during initialisation, so any consumer registering listeners at load time must wait until it is non-null before subscribing.

### How `dispatchScopedEvent` reaches plain `addEventListener`

`GenericAsset.dispatchEvent(event, phase, detail)` calls `_eventBus.dispatchScopedEvent(event, this.id, phase, detail)`. That method:
1. Calls all matching scoped subscribers registered via `addScopedEventListener` directly.
2. Creates a `CustomEvent` and calls `this.dispatchEvent(e)` — the standard `EventTarget` method — which reaches any listener registered with plain `addEventListener`.

Step 2 happens for **both** phases when the `CustomEvent` is not cancelable (the default). This means plain `addEventListener` receives 'before' and 'after' events alike. Filter by `(e as CustomEvent).detail?.phase === 'before'` if you only want the final value.

### `detail` shape by dispatch type

| Dispatch method | `detail` fields |
|---|---|
| `dispatchPropertyChangeEvent(prop, newValue, oldValue)` | `{ property, newValue, oldValue, phase, scope, origin }` |
| `dispatchPayloadEvent(event, payload)` | `{ payload, phase, scope, origin }` |

### Useful events for biosignal consumers

| Event | Fired by | `detail.newValue` / `detail.payload` | When |
|---|---|---|---|
| `property-change:activeResources` | `GenericDataset` | `DataResource[]` — the new active set | Recording opened/switched |
| `property-change:displayViewStart` | `GenericBiosignalResource` | `number` — seconds from recording start | View scrolled |
| `property-change:viewStart` | `GenericBiosignalResource` | `number` | View position committed (after scroll inertia) |
| `property-change:events` | `GenericBiosignalResource` | `BiosignalEvent[]` | Annotation created/moved/deleted |
| `add-dataset` | `RuntimeStateManager` | dataset object (payload) | New dataset loaded |
| `set-active-resource` | `RuntimeStateManager` | `DataResource \| null` (payload) | Active resource changed |

### Reading the current resource without waiting for an event

After the bus is live, the currently active resource can be read directly:

```ts
const runtime = (window.__EPICURRENTS__ as unknown as {
    RUNTIME?: { APP?: { activeDataset?: { activeResources?: DataResource[] } } }
})?.RUNTIME
const resource = runtime?.APP?.activeDataset?.activeResources?.[0] ?? null
```

---

## Biosignal trends

### Architecture

A **trend** is a derived per-epoch signal computed from one or more montage channels. The first concrete trend type is **`'amplitude'`** (aEEG — amplitude-integrated EEG), but the infrastructure is generic; further types cover frequency spectrogram, band ratios and brain symmetry.

| Layer | Class / Symbol | Role |
|---|---|---|
| Type union | `BiosignalTrendType` (`'amplitude' \| 'pdbsi' \| 'ratio' \| 'spectrogram'`) in [src/types/biosignal.ts](src/types/biosignal.ts) | Extend this union per new trend type |
| Base asset | `GenericBiosignalTrend` (concrete, not abstract) in [src/assets/biosignal/components/GenericBiosignalTrend.ts](src/assets/biosignal/components/GenericBiosignalTrend.ts) | Owns `signal[]`, `derivation`, `epochLength`, `samplingRate`; calls `service.setupTrend()` in constructor; `computeTrend(range?)` streams epoch results into `_signal` and emits `'trend-epoch'` / `'trend-complete'` / `'trend-error'` |
| Concrete trend | per-modality wrapper class, owned by the modality module package | Fixes the trend `type` and supplies modality-specific defaults (e.g. NICU-standard 15 s epochs and a 2 / 15 Hz band-pass for aEEG) |
| Math | `computeAmplitudeIntegratedEpoch` / `compressAmplitudeValue` in [src/util/signal.ts](src/util/signal.ts) | Pure functions: band-pass → rectify → envelope (min/max or 5/95 percentile) → semi-log compress |
| Per-epoch compute | `computeTrendEpoch(name, epochIndex)` on the processor ([src/assets/biosignal/service/TrendProcessor.ts](src/assets/biosignal/service/TrendProcessor.ts), [src/assets/biosignal/service/MontageProcessor.ts](src/assets/biosignal/service/MontageProcessor.ts)) | Reads montage signals, builds derived `(source − reference)` array, dispatches by `derivation.type` |
| Loop + cancellation | `computeTrend(name, range?)` + the processor's `_cancelledTrends` set | Loops epochs, `postMessage` per epoch (`'trend-epoch'`), supports cooperative cancel |
| Worker actions | `'setup-trend'`, `'compute-trend'`, `'cancel-trend-computation'` in `TrendWorkerCommission` ([src/types/biosignal.ts](src/types/biosignal.ts)) | All keyed by trend `name` — multiple trends can coexist on one montage |
| Service | `computeTrend(name, range?)` / `setupTrend(...)` on [src/assets/biosignal/service/TrendService.ts](src/assets/biosignal/service/TrendService.ts) and [src/assets/biosignal/service/MontageService.ts](src/assets/biosignal/service/MontageService.ts) | Tracks per-trend computation in `_trendComputations: Map<string, ...>`; routes `'trend-epoch'` / `'trend-complete'` / `'trend-cancelled'` messages back to the right trend |
| Registry | `GenericBiosignalMontage._trends` + `addTrend` / `getTrend` / `removeTrend` / `removeAllTrends` | Dispatches `property-change:trends` |
| Settings | `CommonBiosignalSettings.trends.<type>` (math knobs) | Per-modality derivation and display defaults live in the modality module's own settings |

**Important design choices**:
- Trend math is generic in core; the per-modality wrapper class only fixes the trend `type` and supplies defaults. To add a new trend type (e.g. brain symmetry index), extend the `BiosignalTrendType` union, add a `compute*` math function in [src/util/signal.ts](src/util/signal.ts), dispatch on the new type inside the processor's `computeTrendEpoch`, and (optionally) create a per-modality wrapper class.
- The signal layout is implicit: amplitude trends produce interleaved `[min0, max0, min1, max1, …]` per epoch, so a renderer reads `signal.length / 2` epochs. Future trend types should document their layout in the wrapper class.
- The service abstraction (`BiosignalMontageService.computeTrend`) is what enables a future "compute on the backend" mode — swap the worker implementation, keep the same interface. Today's worker computes everything in JS via Fili.js; nothing else needs to change to offload to a backend service.
- Trend setup and compute are driven by the consuming modality module, not by core. A module typically registers the trend once signal caching is complete (and again when the active montage changes) and gates the expensive compute behind an explicit opt-in, so that a montage switch does not silently re-run a full-recording computation.

### Adding a new trend type

1. **Type union**: add the new literal to `BiosignalTrendType` in [src/types/biosignal.ts](src/types/biosignal.ts).
2. **Math**: add `compute<Whatever>Epoch(signal, samplingRate, options)` to [src/util/signal.ts](src/util/signal.ts). Return a `number[]` representing one epoch's output samples — interleave coordinates if your trend has multi-dimensional output (mirroring the amplitude trend's `[min, max]`).
3. **Dispatch**: extend the processor's `computeTrendEpoch` with a branch for the new `derivation.type`.
4. **Wrapper class** (optional but recommended): per-modality, in that modality's own package, fixing the type and supplying module-specific defaults (epoch length, output sample rate, derivation).
5. **Settings**: extend `CommonBiosignalSettings.trends` if the new type needs math knobs, or leave modality-specific defaults to the module's own settings.
6. **Renderer**: the consuming interface package adds a draw method and dispatches on `trend.derivation.type`.
7. **Lifecycle**: if the new trend should auto-instantiate, the consuming module registers it in its own resource lifecycle.

---

## Worker resolution

A service takes its worker from the factory registered under its name in `RUNTIME.WORKERS`, and constructs the package's own worker when no factory is registered. The default is resolved **in this package's build**, not the consumer's: `MontageService`, `ServiceMemoryManager` and `TrendService` import their worker through Vite's `?worker&inline`, so `dist/` carries the bundled worker as a source string and constructs it from a Blob.

Nothing about that reaches the consumer's bundler, which is the point. Publishing an unresolved `new Worker(new URL('../../workers/x.worker', import.meta.url))` hands the decision to whichever bundler runs last, and they disagree: Rollup rewrites it to an emitted chunk, Rolldown substitutes an empty object for `import.meta` and the construct throws `Invalid URL` at runtime. **Do not add a worker construction that defers resolution to the consumer** — import it with `?worker&inline` like the existing three.

The cost of inlining is that a worker is created from a `blob:` URL, which the consumer's content security policy must allow. Consumers that cannot grant `worker-src blob:` serve the standalone bundles instead and register a URL-based factory, which takes precedence. Those bundles are what the `umd/` output and its two `exports` keys are for:

```json
"./workers/*": "./umd/*",
"./umd/*": "./umd/*"
```

`build:workers` and the inlined copy run the same bundler settings, so the two are the same code. The `dist/workers/*.worker.js` files are neither of these — they are the worker sources compiled as ordinary modules, with bare imports, and are **not** runnable as a standalone worker.

When adding a new worker-bearing package, add the same two keys. The builder's worker-discovery step auto-discovers any `@epicurrents/*` package with a `umd/` directory, so no list needs updating there.

---

## Worker commission design — three places to keep in sync

Each off-thread processor (montage, trend, format readers) reaches the worker through a **commission** — a typed message with a string `action` plus action-specific payload fields. The shape is one piece of code and the dispatch lives in three places that must stay aligned.

### 1. The type union (single source of truth)

[src/types/biosignal.ts](src/types/biosignal.ts) defines:

```ts
export type MontageWorkerCommission = {
    'get-signals':              WorkerMessage['data'] & { range: number[], config?: …, montage?: string }
    'map-channels':             WorkerMessage['data'] & { config: ConfigMapChannels }
    'release-cache':            WorkerMessage['data']
    'release-signal-arrays':    WorkerMessage['data']
    // …
}
export type MontageWorkerCommissionAction = keyof MontageWorkerCommission
```

A commission added here gets type-checked everywhere it's posted from. **Always add here first.**

### 2. The real worker — action map ([src/workers/montage.worker.ts](src/workers/montage.worker.ts))

```ts
protected _actionMap = new Map<
    MontageWorkerCommissionAction,
    (message: WorkerMessage['data']) => Promise<boolean>
>([
    ['get-signals',           this.getSignals],
    ['release-signal-arrays', this.releaseSignalArrays],
    // …
])
```

[src/workers/base.worker.ts](src/workers/base.worker.ts) `handleMessage` looks up the action in `_actionMap` and calls the handler. Each handler calls `validateCommissionProps(...)` to type-narrow the payload, does work, and returns via `this._success(...)` / `this._failure(...)` — both wrap `postMessage` with the original `rn` correlation ID.

### 3. The substitute — switch statement ([src/assets/biosignal/service/MontageWorkerSubstitute.ts](src/assets/biosignal/service/MontageWorkerSubstitute.ts))

When `useMemoryManager === false` (no SAB), the service uses `MontageWorkerSubstitute` instead of a real Worker. The substitute is a plain class that the service `.postMessage(...)`s commissions to, and it sends replies back via `.returnMessage(...)`. The dispatch is a hand-written `switch (action) { case 'foo': ... }` over the same action names.

Because the action map and the switch are two separate places, **adding a new action to the union and the worker is not enough — you must also add a case to the substitute switch**. The compiler does not catch the omission; the failure mode is `Action 'X' is not implemented` at runtime, as happened with the initial aEEG landing.

Inside a substitute case, replies use `this.returnSuccess(message)` / `this.returnFailure(message)`; out-of-band notifications (e.g. per-epoch `'trend-epoch'` messages from inside the processor) need the processor's `_postMessage` callback to be wired to `this.returnMessage.bind(this)` — see the processor constructor's second parameter.

### 4. Subclass workers

Subclasses (e.g. a Pyodide-backed montage worker in the `pyodide-service` package) inherit `_actionMap` and any new actions added via `extendActionMap([...])`. Actions added to a base worker are picked up automatically there — no per-subclass change required, provided the subclass doesn't shadow the action map or override `handleMessage`.

### Adding a new commission — checklist

1. Add the entry to the relevant commission type in [src/types/biosignal.ts](src/types/biosignal.ts).
2. Add a handler method to the worker and register it in `_actionMap`.
3. Add a matching `case` to the corresponding worker substitute's `postMessage`.
4. If the processor needs to push out-of-band notifications, route them through `this._postMessage(...)` rather than calling `postMessage` directly so the substitute can intercept them.
5. Add the dispatching method on the service and wire the response actions in `handleMessage`.

The two hand-maintained dispatch sites (worker `_actionMap`, substitute `switch`) are a known ergonomic hazard; a shared-map refactor is tracked in [ROADMAP.md](ROADMAP.md).

---

## SAB cache lifecycle — cross-activation state leaks

**Public docs:** [memory-management — Recording activation lifecycle](https://epicurrents.github.io/docs/memory-management#recording-activation-lifecycle)

### The problem

Switching between recordings and switching back produces permanently empty signals. Three root causes, all **cross-activation state leaks** — state owned by the recording *object* that doesn't reset atomically when the SAB is freed and reallocated:

1. **`_cacheProcesses` not cleared on `releaseCache()`** — `GenericSignalReader._cacheProcesses` retains stale "fully cached" targets across the release; `partsNotCached()` returns empty; `cacheSignals()` skips loading into the freshly-zeroed SAB.

2. **ACTIVATE event fires for both 'before' and 'after' phases** — the `GenericAsset.isActive` setter dispatches ACTIVATE 'before' (when `_isActive = false`), then sets `_isActive = true`, then dispatches ACTIVATE 'after'. If the full setup body (including `requestMemory`, `setupMutex`) runs in 'before', it leaves `isReady = true`; the 'after' handler then sees `isReady = true` and skips everything — including `cacheSignals()`. **Any ACTIVATE listener in a subclass must guard `if (!this._isActive) return` at the top.**

3. **Stale `cache-signals` progress response** — a progress message buffered as a macro task can arrive after `releaseBuffers()` resets `signalCacheStatus = [0,0]`, restoring a non-zero `signalCacheStatus[1]`. `cacheSignals()` guards on `!_signalCacheStatus[1]`, so the stale value silently skips caching.

Root cause 1 is fixed in this package: `releaseSignalArrays()` on [src/assets/reader/GenericSignalReader.ts](src/assets/reader/GenericSignalReader.ts) sets `proc.continue = false` on all processes and clears `_cacheProcesses`, and `releaseCache()` calls it first. Root causes 2 and 3 are obligations on the consuming module — see below.

### What a consuming module must do

A module that subclasses `GenericBiosignalResource` and drives activation itself is responsible for two things:

- **Guard the ACTIVATE listener** with `if (!this._isActive) return` at the top, so the setup body runs only in the 'after' phase.
- **Do not reset `signalCacheStatus` defensively.** An early band-aid was to set `signalCacheStatus = [0, 0]` before calling `cacheSignals()` to defuse the stale-progress race. That is no longer necessary (the in-flight drain below removes the race at its source), and it is actively harmful if placed outside the `if (!isReady && state === 'ready')` setup guard: on a reactivation where `unloadOnClose=false` leaves `isReady=true`, the whole setup block — including the `cacheSignals()` call — is skipped, so the status gets zeroed with nothing to repopulate it. A renderer that gates on `signalCacheStatus[1] > 0` then shows a loading placeholder indefinitely.

Two further module-side ordering requirements follow from the drain widening the release window:

- **Flip `_isActive` synchronously.** If a resource's `isActive` setter defers the `_isActive = false` assignment into `unload().then(...)`, the runtime's `getActiveResource()` iteration can still see the *old* recording as active when `'set-active-resource'` fires, so a newly-created view binds to the wrong resource. Once the old resource's release completes and nulls the worker-side processor cache, every `getAllSignals` from that view errors with "signal cache has not been set up yet". Flip `_isActive` **before** kicking off `unload()`, and let `unload()` (with all its draining and commission round-trip) run in the background. A listener that needs to know when teardown actually completes should subscribe to the service's `isReady` property change, not the resource's `DEACTIVATE` event.
- **Set up the montage cache before dispatching the `'montages'` property change.** `_setPropertyValue('montages', [...])` is synchronous and fans out to renderers, which can post `get-signals` to the worker before the cache-setup commission is even queued — the worker's processor cache is still `null` and the same "cache has not been set up yet" error follows. In `addMontage`, await `setupServiceWithInputMutex` / `setupServiceWithCache` (both branches) and apply interruptions *before* dispatching the property change, so synchronous listeners see a fully-ready montage.

### Three-level cache lifecycle

The cache lifecycle has three levels, with `releaseSignalArrays` as the Level 1 entry point across every layer that owns cache state. Existing Level 2 names are kept where they're already established (`releaseCache` on the reader, `releaseBuffers` on the resource/montage/IOMutex) — the consistency comes from Level 1 having a single name across all layers, not from renaming established APIs.

| Level | Reader hierarchy | Mutex (`BiosignalMutex` / `IOMutex`) | Montage / Resource | Worker commission |
|---|---|---|---|---|
| 1 — Soft release | `releaseSignalArrays()` | `releaseSignalArrays()` / `releaseOutputBufferViews()` | `releaseSignalArrays()` | `release-signal-arrays` |
| 2 — Full teardown | `releaseCache()` | `releaseBuffers()` (inherited from `IOMutex`) | `releaseBuffers()` | `release-cache` |
| 3 — Destroy | `destroy()` | `destroy()` | (resource destroy path) | `shutdown` / `decommission` |

**Level 1 contract:** cancel in-flight caching processes, drop the worker-side signal-array views, reset `signalCacheStatus` — but **preserve the mutex layout** (`_outputData.arrays` entries, `_outputData.fields`, `_outputMeta.fields`) and the SAB allocation. The same mutex shell can then be cheaply rebound to a fresh buffer via `initSignalBuffers(..., overwrite=true)` + `IOMutex.rebuildDataArrayViews()`.

**Level 2 contract:** Level 1 first, then drop the mutex reference entirely and free the SAB from the memory manager. A fresh `setupCache` / `setupMutex` round-trip is required afterwards.

**Pieces in place**

`IOMutex` lives in the `asymmetric-io-mutex` package; the rest is in this package.

- `IOMutex.initialize(buffer, start, overwrite=false)` — re-binds to a new buffer when `overwrite=true`.
- `IOMutex.rebuildDataArrayViews()` — rebuilds the output data array views over the currently bound buffer using the existing layout.
- `IOMutex.releaseOutputBufferViews()` — Level 1 op on the util side: null views + buffer ref, keep layout.
- `BiosignalMutex.initSignalBuffers(..., overwrite=false)` — when `overwrite=true`, skips the `setDataArrays` walk and calls `rebuildDataArrayViews` instead.
- `BiosignalMutex.releaseSignalArrays()` — Level 1 on the consumer mutex.
- `GenericDataProcessor.releaseSignalArrays()` / `GenericSignalReader.releaseSignalArrays()` — Level 1 on the reader. The `cacheProcesses.continue = false` + `cacheProcesses.length = 0` cancellation lives here (not inside `releaseCache`); `releaseCache` calls Level 1 first.
- `GenericService.releaseSignalArrays()` + matching `release-signal-arrays` worker commission (format workers, montage worker, montage worker substitute).
- `BiosignalMontage.releaseSignalArrays()` + `GenericBiosignalResource.releaseSignalArrays()` — Level 1 at the resource API surface.

**In-flight drain — why the stale-progress race is gone**

The stale-progress-message race was eliminated by a structural change rather than a generation counter:

- **`SignalCacheProcess.inFlightRead`** — each caching loop stores its currently-running `awaitThenSleep(_readAndCachePart, yieldMs)` promise on the process and clears it once the chunk resolves.
- **`GenericSignalReader.releaseSignalArrays` drains all in-flight chunks** (`await Promise.all(_cacheProcesses.map(p => p.inFlightRead ?? Promise.resolve()))`) before clearing the process list. By the time the release ack is posted, every `cache-signals` progress message from this cycle has already been posted; postMessage ordering on the receiver side guarantees the resource processes them all before the ack arrives. No stale message can land after the ack.
- **`releaseCache` (Level 2) inherits the drain via Level 1**, so every close/unload path (including `releaseBuffers` on the resource) is race-free without needing to call Level 1 explicitly.

A generation counter would also work but is strictly more code (per-message tag + receiver filter) for the same guarantee — the drain achieves race-freedom at the SOURCE rather than filtering at the SINK.

**Adding a new release-triggering code path** no longer requires any defensive `signalCacheStatus = [0, 0]` reset, provided it goes through `releaseSignalArrays` or `releaseCache` (Level 2 cascades to Level 1). The drain is intrinsic to the release contract now.

**Current asymmetry — release is wired, rebind is not.** Level 1 *release* is wired and exercised (the `release-signal-arrays` commission, its handlers across worker / substitute / resource / montage / service, and `IOMutex.releaseOutputBufferViews()`). The *rebind* direction — reusing the released mutex shell over a fresh buffer via `initSignalBuffers(..., overwrite=true)` + `rebuildDataArrayViews()` instead of a full setup — is reachable but never taken: both real `initSignalBuffers` call sites pass `overwrite=false`, so reactivation always does the full `requestMemory` + `setupMutex` + `setDataArrays` walk (see [Rolling signal cache → Eviction and reactivation coherence](#eviction-and-reactivation-coherence)). Wiring the cheap rebind is tracked in [ROADMAP.md](ROADMAP.md).

---

## Rolling signal cache — the request-coordinated protocol

For remote or large recordings the reader holds a **rolling window** of blocks in the SAB rather than the whole file. The window used to slide free-running beneath unsynchronised readers: a read landing mid-slide saw every channel's `updated_start/end` reset to `EMPTY_FIELD` → `cache has no initialized signals` → a null, flat view. The redesign replaces the free-running slide + polled `signalCacheStatus` with a **view-anchored request protocol** funnelled through **one operation queue per reader**, plus a **window epoch (seqlock)** that lets cross-worker consumers validate direct SAB reads without routing signal bytes across threads.

**The data plane is untouched.** Signal bytes live in the SAB and are read in place, zero-copy, by every consumer in every worker. The redesign coordinates only the *control plane* — whether the window is stable and covers a range — which is a few words of metadata. Every one of the failures it fixes was a metadata race, not a data race.

Full design and failure catalogue in the consuming platform repo: `docs/engineering-notes/rolling-cache-redesign.md` (design), `rolling-cache.md` (the failure modes it defends against), and `rolling-cache-implementation-plan.md` (the ledger, and the two user-directed deviations from the design that the code — and this section — reflect).

### The request protocol

`requestSignals(range, config?, stream = 'view'): Promise<SignalRequest>` on [GenericSignalReader](src/assets/reader/GenericSignalReader.ts), surfaced through `GenericBiosignalService.requestSignals` and `GenericBiosignalResource.requestSignals` / `getAllSignals`. It replaces the old direct `getSignals` + `cacheSignals` race: it ensures the window covers `range` (sliding if needed), then returns the data — never observing a half-slid window, coalescing concurrent same-target calls.

`SignalRequest` ([src/types/service.ts](src/types/service.ts)) is a discriminated union on `status`:

| `status` | Payload | Meaning |
|---|---|---|
| `ready` | `part` | The part fully covers the requested range. |
| `partial` | `part`, `ready` | Some resident data now, more coming (`ready` resolves to the rest). |
| `pending` | `ready` | Nothing resident yet; `ready` resolves when it is. |
| `superseded` | — | A newer request in the same stream replaced this one — do nothing, the newer one carries the work. |
| `error` | `reason` | Unrecoverable (bad range, torn-down cache). |

The `ready` promise always **resolves** (never rejects) to a terminal `ready`/`error`/`superseded` for the same range, so a consumer `await`s it without re-requesting or unhandled-rejection noise.

- **`partial` is defined but not produced** — a mid-slide read returns `pending` until the full target lands. The type and consumer contract are in place; producing `partial` (draw the resident overlap immediately) is tracked in [ROADMAP.md](ROADMAP.md).
- **Streams.** `stream` names the consumer (`'view'` is the plot). Supersession is **per stream** — a newer request supersedes older pending ones within its own stream only; a cross-stream request cancels nothing. **Only the `'view'` stream moves the window;** a non-view consumer whose range is not resident gets a view-anchored empty answer, never dragging the window off the user's view.

### The operation queue

One FIFO queue per reader worker ([SignalReaderOpQueue](src/assets/reader/SignalReaderOpQueue.ts)). The slide is **decomposed** into separate ops so reads interleave and a hung fetch cannot wedge:

- **invalidate** — synchronous SAB work under the write lock: epoch → odd, write the new window range and reset evicted channels' ranges, epoch → even, release. Microseconds.
- **load(block)** — the block fetch runs **outside any lock** (abortable, breaker-only `resilientFetch` — see [Network resilience](#network-resilience)), then a short locked, epoch-bracketed `insertSignals`. One op per block.
- **read(range)** — re-validates coverage (a later-enqueued invalidate may have retargeted the window), enqueues the needed slide ops and re-enqueues itself on a miss, else returns the part.

A read never sees a half-invalidated window (every metadata mutation is one locked, epoch-bracketed op). Supersession cancels queued-but-unstarted ops for stale targets **and aborts in-flight `load` fetches** via their `AbortController`, settling them `superseded`. Every `load` carries `LOAD_BLOCK_TIMEOUT` (30 s), so a hung fetch settles its dependants `error` and the queue proceeds — one block delayed, not the reader. `_opQueue.supersedeAll()` runs at the top of `releaseSignalArrays` so no window op outlives the buffer (this is distinct from, and complementary to, the full-load `inFlightRead` drain in [SAB cache lifecycle](#sab-cache-lifecycle--cross-activation-state-leaks)).

### Window epoch (seqlock) — cross-worker reads

Window metadata in `BiosignalMutex` carries a monotonic epoch. Every window-metadata mutation runs inside `_withWindowEpochBracket` ([BiosignalMutex](src/assets/biosignal/service/BiosignalMutex.ts)): odd before the first write, the next even after the last, inside one write-lock hold. Comparison is equality-only, so Int32 wraparound is harmless.

The montage and trend workers read the reader's window from another thread. Routing their data through the reader would defeat the SAB, and none of the confirmed failures is a data race — so they keep their **direct SAB signal views** and validate each coupled read against the epoch. The implemented pattern (a user-directed revision of the design's option A′) is an **optimistic lock-free seqlock read**, not a lock hold:

1. read the epoch (must be even),
2. read window ranges + signal views via the **sync accessors** (`inputRangeStartSync` / `inputRangeEndSync` / `inputSignalsSync` — documented seqlock-only, valid only across a synchronous read),
3. run the synchronous derivation (`_derivePartFromInput` for the montage),
4. re-read the epoch — unchanged → consistent; changed or odd → discard and answer the view-anchored empty part (`_emptyPartFor`).

No lock, no copy, no writer starvation; a collision costs one wasted derivation. The clamp-inversion class (`cacheStart > cacheEnd`) dies structurally — inverted arithmetic can only arise from mixing pre- and post-mutation metadata, which the epoch check discards. Trend follows the same pattern in its processor's SAB branch.

Why lock-free and not the single-hold read the design first specified: holding the input read lock across a whole derivation starved `insertSignals`' write-lock acquisition (the RW lock is reader-preference) → `Maximum retries of locking operation reached` mid-slide, seen live. The seqlock read has no such coupling.

### Eviction and reactivation coherence

Resource cache state must never claim data the SAB no longer holds. Rather than the design's `buffer-invalidated` commission, the implemented resolution is simpler: **`unload()` is the eviction notification.** `ServiceMemoryManager.freeBy` evicts only via the victim `service.unload()`, which commissions `release-cache` and dispatches `isReady → false`. Three guarantees ride the release path: `releaseSignalArrays` calls `_opQueue.supersedeAll()` and resets every `_dataBlocks[].loaded` (a later rebind cannot trust a prior tenancy's residency), and `EegRecording` zeroes `signalCacheStatus` when the service's `isReady` goes false. Reactivation is symmetric — the ACTIVATE guard re-runs full setup when the service is not ready (fresh mutex, rebuilt block table, trusted interruptions redelivered) and re-requests the view through the queue — so reopen is always correct without a `signalCacheStatus` guard.

### Interrupted-file navigation frontier

On EDF+D, recording-time → record mapping is exact only within the contiguously decoded span, so random access past that frontier is unsound until the gap table is complete. `GenericSignalProcessor` tracks `_exploredUnitEnd` (advanced only by contiguous decodes — a detached duration probe does not count) and exposes `exploredEnd` on the resource (`-1` = unrestricted: continuous, or the interruption table is trusted-complete). The `viewStart` setter — the single navigation chokepoint — clamps to it, and the EEG navigator masks the off-limits span. A platform caller lifts the restriction by injecting the recording's interruptions via `resource.setTrustedInterruptions(map)` → `setInterruptions(map, complete = true)`; the standalone viewer self-discovers TALs from the bytes and stays clamped. Only `EegRecording` wires the delivery and navigator overlay today — EMG/NCS/ACC would need the same if they gain discontinuous rolling support.

### Plot draw loop

Raw mode awaits `requestSignals(viewRange)` and draws the result — no `signalCacheStatus` polling, no `pendingViewRedraw`/coverage gate. The montage branch drives the window via `cacheSignals()` (slide-only) then reads `getAllSignals`; a thin coverage-keyed `signalCacheStatus` redraw trigger **remains** so progressive full-load caching re-draws as coverage advances — do not delete it in a later refactor without replacing that function. Full-load (non-rolling) caching was already correct; the protocol only unifies its read path.

---

## Network resilience

All remote I/O in the family — HTTP range reads, header/size probes, remote config and runtime loads, connector queries — goes through one layer in [src/util/network/](src/util/network/), exported from `#util` (and `@epicurrents/core/dist/util` for worker bundles). Before it, a `fetch()` that resolved on a 4xx/5xx let an error body be decoded as signal bytes, and a worker fetch that threw without replying left its main-thread commission pending forever. The layer's contract is: a remote failure surfaces as a typed [`NetworkError`](src/util/network/errors.ts), never as corrupt data or a silent hang.

| Symbol | Role |
|---|---|
| `resilientFetch(url, init, opts)` | The wrapper. Guarantees an **ok `Response` on resolve**; throws `NetworkError` on any terminal failure. Retries transient failures (network/CORS, timeout, 429/5xx) with jittered backoff up to the budget; throws persistent ones (auth, gone, other 4xx) at once. An open breaker short-circuits before any request. |
| `CircuitBreaker` / `BreakerRegistry` / `networkBreakers` | Per-origin latch — `closed` / `open-auth` / `open-unavailable` / `half-open`. `networkBreakers` is the module singleton keyed by origin; call sites pass `{ registry: networkBreakers }` and it draws the right breaker. |
| `classifyFetchOutcome(Response \| Error)` | Maps a status or thrown error to `{ ok, kind, retryable, breakerTrip }` — the single classification table. |
| `NetworkError` | `{ kind, status?, origin? }`; `kind` is one of `transient \| server \| timeout \| auth \| gone \| client \| aborted`. |
| `setNetworkStatusHandler(fn)` | Worker-side hook: registers the callback the worker uses to post `network-status` up to the main thread. |

**Policy.** Transient is retried, persistent is latched, and a **non-idempotent POST is never retried** (connectors and the API processors both rely on this). Per-category timeouts (`range` / `file` / `setup` / `config` / `default`) live in `CATEGORY_TIMEOUT_MS`; they are orders of magnitude apart, so there is no single global ceiling.

**Breaker-only mode.** A caller that already owns cancellation passes `{ timeoutMs: Infinity, retries: 0, registry: networkBreakers }`. `resilientFetch` treats a non-finite or zero `timeoutMs` as "no internal deadline", so a slow block over a throttled link is not killed by a duplicate timer — the caller's own signal is the sole cancellation authority, while the origin breaker still coordinates auth across callers. Two consumers use this: the signal reader's block loads (the op-queue owns cancellation — see [Rolling signal cache](#rolling-signal-cache--the-request-coordinated-protocol)) and `GenericStudyImporter._fetchArrayBuffer` (a one-shot setup read owns no cancellation and must not be cut off mid-parse).

**The importer read helper.** [`GenericStudyImporter._fetchArrayBuffer(url, { authHeader?, range? })`](src/assets/study/GenericStudyImporter.ts) is the shared importer fetch: it sets the auth header and optional `Range`, routes through `resilientFetch` in breaker-only mode, and returns the `ArrayBuffer` — throwing on non-ok so an error body is never decoded as file content. Every reader's importer delegates to it; a new importer should too rather than hand-rolling `new Headers()` + `fetch` + `.ok`.

**The session-restore reset (one-way, host → viewer).** A persistent auth failure latches the origin breaker open; clearing it after a re-auth is an explicit signal from the host, never a coupling back into the platform's auth flow:

- `EpicurrentsApp.notifySessionRestored()` ([src/index.ts](src/index.ts)) — the host calls this after re-login. It resets `networkBreakers` on the main thread (connectors, main-thread readers), then calls `resetNetwork()` on every registered service.
- `AssetService.resetNetwork(origin?)` ([GenericService](src/assets/service/GenericService.ts)) — resets the main registry and posts `{ action: 'reset-network', origin }` to its worker (fire-and-forget).
- Worker side — a worker calls `setNetworkStatusHandler((origin, state) => postMessage({ action: 'network-status', origin, state }))` at setup and handles `reset-network` by calling `networkBreakers.reset(origin)`. `GenericService` re-emits an incoming `network-status` as a `network-status` `'after'` event carrying `{ endpoint, state }` — the field is `endpoint`, **not** `origin`, because `GenericAsset.dispatchEvent` already fills `detail.origin` with `this`.

**Service commission backstop.** `GenericService` wires `worker.onerror` / `onmessageerror` to `_rejectAllCommissions`, so a synchronous worker crash or an undeserialisable message rejects every in-flight commission instead of stranding it. These events carry no `rn` correlation ID, so reject-all is the only safe response; it does not replace each worker handler's own duty to post a `success:false` reply for a caught failure (an async `onmessage` reject raises `unhandledrejection`, not `onerror`).

**Adding a new worker-bearing reader:** register `setNetworkStatusHandler` and a `reset-network` handler in the worker so it participates in the session-restore reset; route its byte reads through `resilientFetch` (breaker-only if the op-queue or a one-shot read owns cancellation).

The full fetch-path audit (findings F1–F19) and the per-repository rollout live in the consuming platform repo's `docs/engineering-notes/viewer-network-resilience.md` and `viewer-network-recovery-plan.md`.

---

## `Log.announce` — boolean or custom string

`LogEventContext.announce` in the `scoped-event-log` package accepts `boolean | string`. A consuming interface typically registers `Log.addEventListener(['ERROR', 'WARN'], …)` and pipes any truthy `announce` into its own toast/callout surface:

- `announce: true` — toast uses `event.message` verbatim. Right when the log line is already user-friendly.
- `announce: "Custom message"` — toast uses the string; the log line keeps its own (typically technical) message. Right when the log should stay grep-friendly for SIEM / debugging but the user needs plain prose.
- `announce: false` / omitted — log line only, no toast.

---

## Gotchas

### `Log.debug is not a function` in workers — nested `scoped-event-log` copy

Stack trace signature (dev viewer, signal reader worker):

```
TypeError: z.debug is not a function
  at executeWithLock
  at setData
  at insertSignals
```

with no obvious source-level cause is almost always a duplicate `scoped-event-log` getting bundled into the worker. The duplicate is `util/asymmetric-io-mutex/node_modules/scoped-event-log/` in the workspace — an older v2 copy that npm installs when `asymmetric-io-mutex` declares `scoped-event-log: ^2.0.1` while the workspace ships v3. With v2 nested under the mutex package, a bundler that walks `node_modules` from the importing file finds the v2 copy first, while the rest of the page uses v3 from the workspace root. Two `Log` shapes coexist, and the v2 one doesn't have `static debug` (it's an instance-style API).

The fix is two-part — both halves are needed, because either alone lets the nested copy come back on the next `npm install`:

1. Make `util/asymmetric-io-mutex/package.json` declare `scoped-event-log: ^3.0.0` so npm's resolver stops creating the nested v2.
2. Delete the existing nested copy if present and rebuild:
   ```bash
   rm -rf util/asymmetric-io-mutex/node_modules/scoped-event-log
   find . -name .vite -type d -exec rm -rf {} +
   cd util/asymmetric-io-mutex && npm run build
   ```

Verify there is exactly one copy (run from the workspace root):

```bash
find . -name scoped-event-log -type d
# Should print only:
#   ./util/scoped-event-log
#   ./node_modules/scoped-event-log   (symlink to the above)
```

If a third path under `util/asymmetric-io-mutex/node_modules/scoped-event-log` reappears, the version bump in step 1 was reverted or `npm install` was run against a lockfile that still references v2.

---

## Planned work

Deferred and planned changes are tracked in [ROADMAP.md](ROADMAP.md) — the shared worker/substitute action map, the cheap mutex rebind on reactivation, and producing `partial` request results. The current-state limitation behind each is noted in place in the relevant section above; ROADMAP.md carries the intent and design sketch.
