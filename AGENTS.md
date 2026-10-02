# @epicurrents/core — architecture notes for AI coding assistants

`@epicurrents/core` is the dependency root of the Epicurrents package family. It defines the application entry point (`Epicurrents`), the runtime state manager, the asset/resource/module/service abstractions, the biosignal montage and trend machinery, the worker commission protocol, and the shared TypeScript types every sibling package imports. Every other `@epicurrents/*` package — readers, modality modules, services, and the viewer interface — builds on the contracts defined here, so a change in this package can break all of them at once.

This file is the in-depth technical reference for AI coding assistants: internal architecture, the contracts the package guarantees to consumers, and the gotchas that bite when editing it. It should let an agent answer most questions about the package directly, or at least point at the right place to look. [README.md](README.md) is the denser user-facing description (structure, usage, build workflow) and the right link to hand a human; [ROADMAP.md](ROADMAP.md) carries design intent, not current state. Sibling packages (readers, modules, services, interface) keep their own `AGENTS.md`; module-side and rendering-side detail lives there, not here.

> **Keep this file current — update it in the same change set as the code.** This document only works if it describes the code as it is; a stale section is worse than a missing one, because an agent will act on it. After any change that alters something documented here — a contract, a protocol shape, a lifecycle, a public symbol, a limitation being lifted — update the affected section (or add one for a new subsystem) before reporting the work done. The same rule applies to the siblings: README.md when the user-facing surface (usage, structure, build workflow) changes, ROADMAP.md when documented deferred work lands or new work is deliberately deferred. Pure refactors, test-only changes and bug fixes that restore documented behaviour need no update.

---

## Version compliance

`tsconfig.base.json` in this package is the **shared toolchain base** for the whole family: this package extends it locally, and sibling packages extend `@epicurrents/core/tsconfig.base.json` so it resolves standalone. It is exported from `package.json` (`"./tsconfig.base.json"`) for exactly that reason.

**Never pin a TypeScript version here that diverges from the family's canonical `^5.7.0`**, and never override `tsconfig.base.json` compiler options in a sibling package without a comment explaining why. A divergent TypeScript version produces structurally incompatible `.d.ts` files that **type-check cleanly but corrupt data at runtime** — the worker bundle and the main-thread code end up disagreeing about data layouts or API shapes with no compile-time signal.

**`moduleResolution` is `bundler`**, so the compiler reads a dependency's `exports` map the way a consumer's bundler does. Import core through the subpaths it publishes — `@epicurrents/core/types`, `@epicurrents/core/util` — and never a file inside them such as `@epicurrents/core/dist/types/event`: `exports` names only the barrels, so a consumer cannot resolve the deeper path, and the older `node` resolution accepted it because it ignores `exports`. A type a sibling needs is re-exported from [src/types/index.ts](src/types/index.ts). The `./dist/*` subpaths stay in `exports` only so that code written against them keeps resolving.

Both build outputs must be regenerated together after any change to shared code:

```bash
npm run build:workers  # updates umd/ (standalone worker bundles)
npm run build:tsc      # updates dist/ (ESM, consumed by the main thread)
# or simply:
npm run build          # build:workers + build:tsc
```

Rebuilding only one leaves a stale mismatch between the worker bundle and the main-thread code — the same failure mode as a version drift.

`build:tsc` is two steps: `build:lib` (Vite emits the ESM tree, preserving one output module per source module) and `build:types` (declarations, through [scripts/build-types.mjs](scripts/build-types.mjs)). The name is kept because the builder's cross-package `build:tsc-all` sweep calls it by name in every package; a package that drops the script is skipped silently, which is exactly the stale-output failure above.

### Path aliases and the declaration build

Source imports go through the `#`-prefixed `paths` in [tsconfig.json](tsconfig.json). Each tool resolves them from its own configuration, and there is deliberately no `imports` field in `package.json`: it is published, so it would advertise source paths a consumer does not receive, and a tool that consulted it would mask a missing alias instead of failing on it.

- **`#*` is declared before `#root/*`.** Resolution takes the longest matching prefix whatever the order, but TypeScript's auto-import takes the first key that matches, and `#root/*` matches every file in the package — declared first, every suggested import reads `#root/src/types` instead of `#types`. `#root/*` stays for files outside `src/`, which `#*` cannot reach.
- **Vite and Vitest** resolve through `ALIASES` in [vite.shared.mjs](vite.shared.mjs). They must be regular expressions — a string alias matches only the exact id or the id followed by `/`, so `'#'` never matches `#events/dispatch`. With no `imports` field to fall back on, such an alias fails loudly at resolution.
- **The two tables are not the same shape, and the mismatch has a sharp edge.** [tsconfig.json](tsconfig.json) maps `#*` to `src/*` for *any* name; `ALIASES` matches a fixed alternation of directory names (`assets|config|errors|events|onnx|pyodide|runtime|types|util|workers`), two of which (`onnx`, `pyodide`) name no directory under `src/`. So a new top-level directory under `src/` type-checks and auto-imports cleanly, then fails to resolve in both the build and the test run until its name is added to the alternation. Add the directory and the alternation entry together.
- **Declarations** are emitted by `tsc` and rewritten by [scripts/build-types.mjs](scripts/build-types.mjs), published as the `epicurrents-build-types` bin so the whole family shares one implementation. It reads the project's tsconfig through the TypeScript API and rewrites each specifier matching a `paths` pattern: into `outDir` as a relative path with an explicit `/index` for directories, into a sibling package as a bare specifier through that package's `exports`, or not at all when the target is under `node_modules`. Anything else fails the build, because it names a file the package does not ship.

A sibling package runs `epicurrents-build-types` from its own root with its own TypeScript. `--project <tsconfig>` selects the config and `--no-emit` skips `tsc`, for a package that has to add hand-written declarations to the emitted tree before the rewrite. The tool handles declarations only; JavaScript is expected from a bundler that has already resolved the aliases.

---

## Core concepts

**The single most important package.** Everything else depends on it.

### Key concepts

| Concept | Class / Interface | Role |
|---|---|---|
| Application | `Epicurrents` (class), `EpicurrentsApp` (interface) | Entry point. Holds runtime, event bus, interface, memory manager. |
| Runtime state | `RuntimeStateManager` / `StateManager` interface | Central reactive store: `APP`, `MODULES`, `SERVICES`, `SETTINGS`, `WORKERS`, `INTERFACE`. `INTERFACE` belongs to the interface, which assigns it; core does not. |
| Asset | `BaseAsset` interface | Root type of everything — has `id`, `name`, `modality`, `state`, event API. |
| Resource | `DataResource` interface | Loadable asset with lifecycle (`added → loading → loaded → ready → destroyed`). The full `AssetState` union also has `error`, which carries an `errorReason` the setter clears on the way out. |
| Module | `ResourceModule` / `RuntimeResourceModule` | Pluggable modality support registered with `registerModule(name, module)`. |
| Service | `GenericService` / `AssetService` | Web-worker interface. Manages commission/promise pairs for off-thread work. |
| Study loader | `GenericStudyLoader` / `StudyLoader` | Knows how to read a file format and produce `StudyContext` + `DataResource`. |
| Interface | `InterfaceModule` / `InterfaceModuleConstructor` | UI shell — passed `EpicurrentsApp` + `StateManager` at `launch()`. |
| Dataset | `MixedMediaDataset` / `MediaDataset` | Container for a set of resources opened together. |
| Event bus | `EventBus` (wraps `scoped-event-bus`) | Application-wide event dispatch; exposed as `window.__EPICURRENTS__.EVENT_BUS`. |

### Globals

The `Epicurrents` constructor sets:
```ts
window.__EPICURRENTS__ = { APP, EVENT_BUS, RUNTIME, SETUP }
```

`APP`, `EVENT_BUS` and `RUNTIME` are `null` until the constructor assigns them. `SETUP` is the host→viewer bootstrap handoff — a `Readonly<ApplicationConfig>` written once before launch by whoever bootstraps the viewer, and an empty object until then, so a consumer can read `SETUP.<field>` without guarding. It is static setup, not runtime state; the live, mutable configuration is the runtime state manager's.

### Source layout

```
src/
  assets/
    biosignal/           # GenericBiosignalResource, GenericBiosignalService,
                         # BiosignalCache, BiosignalMutex, SharedWorkerCache,
                         # MontageService, TrendService, components/ (montages, trends), etc.
    connector/           # DatabaseAPIConnector, WebDAVConnector
    dataset/             # GenericDataset, MixedMediaDataset
    document/            # GenericDocumentResource
    error/               # ErrorResource
    media/               # BiosignalAudio + synthesizers/ (audio rendering)
    reader/              # GenericSignalReader/Writer/Processor, LocalFileReader,
                         # SignalReaderOpQueue, filesystem/ (FileSystemDirectory,
                         # FileSystemFile, MixedFileSystemItem)
    service/             # GenericService, ServiceMemoryManager, ServiceWorkerSubstitute
    study/               # GenericStudyLoader, GenericStudyImporter, GenericStudyExporter,
                         # StudyCollection, StudyLoadProtocol
    annotation/          # GenericAnnotation, ResourceLabel
  config/                # Settings singleton
  errors/                # worker error-message constants; nothing imports them
  events/                # EventBus, ApplicationEvents enum
  runtime/               # RuntimeStateManager, module stubs
  types/                 # All TypeScript interfaces (application.ts is the main one)
  util/                  # constants, conversions, signal maths, dsp (filters + FFT),
                         # text, worker helpers,
                         # network/ (resilientFetch + per-origin circuit breaker)
  workers/               # base.worker, montage.worker, trend.worker,
                         # signal-reader.worker, memory-manager.worker,
                         # *.worker.entry (thread entries; see Worker resolution)
```

### App lifecycle

1. Instantiate `new Epicurrents()` — sets globals, creates `RuntimeStateManager`.
2. Call `registerModule(name, module)` for each modality (EEG, EMG…).
3. Call `registerService(name, service)` for optional services (Pyodide, ONNX…).
4. Call `registerStudyImporter(name, label, mode, loader)`.
5. Call `registerInterface(InterfaceConstructor)`.
6. Call `launch()` — sets up the memory manager when `SETTINGS.app.useMemoryManager` is true, then constructs the interface and awaits its readiness. The manager is created first, so the interface sees the final answer: a setup that finds no cross-origin isolation, no `SharedArrayBuffer`, or no allocatable buffer clears `app.useMemoryManager` through the runtime (so registered property-update handlers run) and continues on the main-thread path. The allocation case additionally shuts the manager down before dropping it: the manager's constructor starts its worker before it attempts the allocation, so releasing only the reference would leave a thread running for the life of the document.
7. Call `loadStudy(loaderName, source, options)` to open a recording.

---

## Core runtime internals

### RuntimeStateManager

Extends `GenericAsset`. Wraps a module-level `state` singleton object — not a reactive UI store. All mutations go through named methods (`addDataset`, `setActiveResource`, `setModule`, …) that dispatch `before`/`after` scoped events via the `EventBus`. `WORKERS` is a `Map<string, (() => Worker) | null>` — the value is a factory or `null`, not a factory returning `null` — used to inject test doubles or deployment-specific workers.

The `SETTINGS` singleton takes programmatic changes through `setSettingsValue`, and `init()` additionally reads a `settings` entry from `localStorage` and applies the fields a module declares in `_userDefinable` (with `source: 'user'`), warning on a module name or field that is not user-settable. **Nothing in the package writes to `localStorage`** — persisting a user's overrides is the host application's job.

### ServiceMemoryManager teardown

`shutdown` is an ordering problem before it is anything else. The manager's `SharedArrayBuffer` is the one every registered service's mutex views are cut from, so the services are unloaded — and awaited — before the worker is told to drop it; a service outliving the buffer holds views into memory with no owner. The unload is `unload(false)`, because `unload(true)` calls back into `release`, which would commission a rearrange of a buffer that is about to go. A service that fails to unload is logged and skipped rather than allowed to abort the teardown, since the alternative is one stuck service keeping the worker thread alive.

`MemoryManagerWorker.shutdown` then drops `_buffer` and `_view`, answers, and only then closes. The order matters: `close()` stops the thread, so a reply posted after it never leaves, and `GenericService.shutdown` resolves its commission with the reply's success flag rather than rejecting — an unanswered or failed shutdown therefore skips the whole teardown block, `terminate()` among it, in silence. That is the shape the montage worker leaked through before it had a handler of its own.

Nothing in the package calls `shutdown` on the manager except the failed-allocation path in `launch`. A host that tears an application down calls it; closing the document does the same job for free.

### Leaving the document

`EpicurrentsApp.unloadNeedsConfirmation` answers whether leaving the document would cost the user anything. Two conditions make it true, and either is enough.

**A resource is open.** The review session is the work, not just the data: finding a recording again, loading it and navigating back to the same position is expensive on a long one and sometimes impractical. The check reads the datasets live rather than counting, so closing a resource is reflected with no second piece of bookkeeping to keep in step, and a resource whose `state` is `'error'` does not count — a failed load is nothing to return to.

**An annotation was edited.** True from the first change to a resource's `events` or `labels` that did not come from a `'system'` source, tracked through one subscription on the runtime's `add-resource` event — the single funnel every resource enters through, whether a host, a study loader or a session restore added it. This condition outlives the resource it was made on, because the edit is gone either way and closing the recording must not make leaving look safe.

The source flag is the whole distinction for the second one. A reader applies the annotations a recording arrives with through `addEventsFromTemplates({ source: 'system' })`, and the interface applies a user's edits with `{ source: 'user' }`; an omitted source means `'user'`, which is what a viewer component passes when the user draws an event. So anything but an explicit `'system'` counts, and a call site that forgets its context over-warns rather than quietly letting an edit go.

`allowUnload` is the only thing that makes the answer false again. That waiver exists for a navigation the application or its host is itself performing: an update that reloads the page, or a host remounting the viewer. It stays in effect once taken, so it is called immediately before the navigation rather than kept set in advance, and it asserts that the caller has taken responsibility for the session, not that anything saved it.

Core only reports the fact. The prompting belongs to whoever owns the exit: the framework entry in the `interface` package installs the `beforeunload` handler that covers closing the tab, reloading and navigating the document away, and an embedding host intercepts its own in-app navigation, which never unloads the document at all.

### Signal data flow — three paths

Signal data travels along three distinct paths depending on whether `SharedArrayBuffer` is available and where the cache lives:

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
  ↓  ('setup-cache' hands the cache object to MontageWorkerSubstitute by reference)
MontageProcessor (main thread) reads from the plain cache
  ↓
MontageProcessor.getSignals() → derived signals → returned on the main thread
```

**Path C — Shared-worker cache**
```
cache-holding worker → MessagePort transferred with the 'setup-input-cache' commission
  ↓
MontageWorker.setInputCache → MontageProcessor wraps the port in a SharedWorkerCache
  ↓
MontageProcessor.getSignals() → derived signals → sent back to main thread
```

`SharedWorkerCache` ([src/assets/biosignal/service/SharedWorkerCache.ts](src/assets/biosignal/service/SharedWorkerCache.ts)) is a `SignalDataCache` implemented as a `GenericService` over the port: every read (`inputSignals`, `inputRangeStart`, `inputRangeEnd`) is itself a worker commission, so this path is asynchronous where the SAB path reads in place. `MontageService.setupMontageWithSharedWorker(port)` is the main-thread entry.

`GenericBiosignalResource` holds both handles: `_mutexProps` (SAB path, `MutexExportProperties`) and `_cacheProps` (`SignalDataCache | null`). The `dataCache` getter returns `_mutexProps || _cacheProps`.

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

`MontageService` (main thread) owns the `MontageWorker` (or `MontageWorkerSubstitute`). Commission pattern:
1. `_commissionWorker(action, props?, callbacks?, options?)` → takes the next `rn` from `_requestNumber` → posts the message → returns `{ promise, rn, reject, resolve }`
2. Worker processes, replies with the same `rn`
3. `handleMessage` matches `rn` → resolves/rejects the promise

Which worker the service constructs is decided by the constructor's `manager` argument and the `overrideWorker` name: with a memory manager and an `overrideWorker` other than the reserved `'substitute'`, it takes the factory registered in `RUNTIME.WORKERS` under `overrideWorker || 'montage'` and falls back to the inlined `MontageWorker`. With no manager, or with `overrideWorker === 'substitute'`, it constructs a `MontageWorkerSubstitute`.

Worker action map ([src/workers/montage.worker.ts](src/workers/montage.worker.ts)): `get-signals`, `invalidate-cache`, `map-channels`, `release-cache`, `release-signal-arrays`, `reset-network`, `set-buffer-range`, `set-interruptions`, `set-filters`, `setup-cache`, `setup-input-cache`, `setup-input-mutex`, `setup-worker`, `shutdown`, `update-settings`. The substitute answers the same fifteen, four of them differently — see [Worker commission design](#worker-commission-design).

`setupWorker` initialises a `MontageProcessor` in the worker with the channel config and module settings. `get-signals` → `MontageProcessor.getSignals(range, config)` → derived `Float32Array[]` → transferred back.

### MontageProcessor

Holds the actual signal math — channel derivation (active channels minus reference channels), filter application (highpass/lowpass/notch), downsampling. Reads raw signals from the cache/mutex. Key method: `getSignals(range, config)`.

It normally runs inside the montage worker, but it is a public export ([src/assets/biosignal/service/MontageProcessor.ts](src/assets/biosignal/service/MontageProcessor.ts), re-exported from the package root) and `MontageWorkerSubstitute` runs one on the main thread. Anything written into the processor therefore has to work in both settings. Its outbound channel is the worker's own `_postMessage`, which the substitute redirects, so a notification the processor pushes reaches the service on either side.

### Property change events

Every setter on `GenericBiosignalResource` (and all assets) calls `_setPropertyValue(name, value)` which dispatches a `property-change:<name>` scoped event. Consumers subscribe to these events to trigger reactivity/redraws without direct coupling to the resource implementation.

The inverse is the trap: **an assignment to the backing field sets the value and announces nothing.** A consumer that registered its listeners on mount and otherwise does not poll — which is every one of them — never learns of the change, so the asset holds the right value while the interface shows the state it had when it mounted. Anything a subclass sets after construction, and in particular anything set from a promise the constructor started, goes through the public setter or `_setPropertyValue`. Writing `this._state` where `this.state` was meant is the shape this takes, and it fails silently in the one direction nothing tests: later than the interface.

---

## Other public subsystems

### Audio — [src/assets/media/](src/assets/media/)

`BiosignalAudio` turns signal data into playable audio: it extends `GenericAsset`, implements `AudioRecording`, and owns the `AudioContext`, buffer, compressor and playback state (position, gain, loop, playback rate, start/end callbacks).

The rendering itself is pluggable. An `AudioSynthesizer` is one method — `synthesize(signals, sampleRate, opts)` returning an `AudioBuffer` — and three ship: `direct` (normalised playback of the samples with an optional EQ chain), `spectral-tone` (resynthesise the dominant spectral peaks of a window as a steady audible tone) and `stethoscope` (map a sub-audible signal onto an audible carrier). The registry in [src/assets/media/synthesizers/registry.ts](src/assets/media/synthesizers/registry.ts) is the extension point: `registerSynthesizer(method, synthesizer)` adds or replaces one, `getSynthesizer` / `listSynthesizers` read it back, and a project registers its own method without touching core. `renderGraph` / `renderOffline` wrap `OfflineAudioContext` for rendering faster than real time and off the UI thread; sound-generating methods render at `AUDIBLE_SAMPLE_RATE` (44 100 Hz) because biosignal rates fall below the `OfflineAudioContext` minimum.

All nine symbols are exported from the package root and from `@epicurrents/core/assets`. Tests: [tests/assets/BiosignalAudio.test.ts](tests/assets/BiosignalAudio.test.ts) and [tests/assets/audioSynthesis.test.ts](tests/assets/audioSynthesis.test.ts).

### DSP — [src/util/dsp.ts](src/util/dsp.ts)

The package's own digital-signal-processing layer, with no third-party dependency: a radix-2 `FFT` with pre-computed twiddle factors and caller-provided buffers, an `SOSFilter` (including a zero-phase `filtfilt`), and four Butterworth designers — `butterBandpass`, `butterBandstop`, `butterHighpass`, `butterLowpass`. All six symbols are exported from `#util`, and so from `@epicurrents/core/util`, which is how the worker bundles reach them.

Two conventions to know before calling a designer. `order` is the number of prototype poles, matching `scipy.signal.butter`, so a filter specified as two biquad sections is `order: 4` here. And `butterBandpass(order, hp, lp, fs)` takes both thresholds and produces one 2×order-pole filter rather than a sequential high-pass and low-pass pair. The designs match scipy exactly; `SOSFilter.filtfilt` approximates `scipy.signal.sosfiltfilt` closely, with edge samples not bit-exact because the steady-state initial conditions are a closed-form per-section approximation rather than scipy's companion-matrix solve.

`downsampleSignal(signal, fromRate, toRate, length?, offset?)` is the rate conversion for data: a zero-phase Butterworth low-pass at 0.4 × the output rate, then the output instants taken directly at an integer ratio or by linear interpolation otherwise. It only downsamples and throws when asked to go up. The cutoff fraction is exported as `DOWNSAMPLE_CUTOFF_FRACTION`, so an exporter can state the new low-pass in a channel's prefiltering. `resampleSignal` in [src/util/signal.ts](src/util/signal.ts) is a different tool: it uses Largest-Triangle-Three-Buckets to keep the visual peaks of a trace, aliases, and must not be used for anything that leaves the screen.

### ErrorResource

A `GenericResource` that constructs straight into `state = 'error'` and carries a `reason` string, for the case where loading failed before a real resource could exist. `loadStudy` uses it on every failure branch — unknown importer, no study returned, no resource from the study — adding it to the target dataset in place of what could not be loaded before returning `null`. The failure therefore stays visible in the resource list, with `getMainProperties` surfacing the reason, rather than existing only as the caller's discarded return value.

### Study importers and exporters

`GenericStudyImporter` (`FileFormatImporter`) reads a format into a `StudyContext`; its `_fetchArrayBuffer` helper is the shared importer read path (see [Network resilience](#network-resilience)). `GenericStudyExporter` (`FileFormatExporter`) is the transcoding counterpart, holding a `format`, a `description` and a source study.

Both are abstract and are subclassed in the reader packages. An exporter reaches a loader in two ways: as the optional constructor argument to `GenericStudyLoader`, or through `StudyLoader.registerStudyExporter(exporter)` afterwards. The application-level `Epicurrents.registerStudyExporter(name, label, mode, loader)` is the separate registration that makes a whole loader available for export, mirroring `registerStudyImporter`.

**Export selection** — [src/util/export.ts](src/util/export.ts), with its types, all named `SignalExport*`, in [src/types/reader.ts](src/types/reader.ts). The operations an export may apply, kept out of every exporter so each offers the same ones: a `SignalExportSelection` names a recording-time range, an ordered channel list (source index plus optional output label), an output rate and an amplitude range, and `applyExportSelection` applies it to signals, events and interruptions. An end of the range inside an interruption moves to the data edge. Events and interruptions are clipped and re-based to the range; an event's channel references follow the output (a number is an index in the channel list passed in, a string a channel name matched case-insensitively), an event left with none of its channels is dropped, and an event with no channel list is kept. Events name their channels against the record montage, so a caller whose record montage does not map one-to-one onto the recording's channels converts the numeric references first. `checkExportSelection` reports what stops a selection applying and, given `SignalExportConstraints`, what stops the result meeting a destination's limits. The result carries the resolved range, which an exporter needs to move the start time. Signals may be passed from any data offset, so an exporter can read the range from `resolveExportRange` plus a second each side for the anti-aliasing filter rather than the whole recording.

**Export targets** — `SignalExportTarget` in [src/types/reader.ts](src/types/reader.ts), registered with `registerSignalExportTarget(name, target)` and removed with `unregisterSignalExportTarget`, both announcing the change as the application event `signal-export-targets-changed`. A target is a destination the host application offers: a label, the file format it takes (matched against a registered exporter's `format`), optional `SignalExportConstraints`, exporter options that take precedence over an export dialog's own, whether it also wants the sidecar, and a `submit` function receiving the bytes. Core names no destination, so whatever a target posts to is the host's knowledge. `getSignalExportTargets(resource)` is the only way to read the registry and hands out a copy: every target for a resource `isLocalResource` accepts, none otherwise. A resource is local when every data file of its source study carries a `File` object, which a study loader sets only for a file the person picked or dropped; a recording loaded from a URL or a connector already exists elsewhere, and offering it to a target would copy it. The rule trusts the host: one that wraps downloaded bytes in a `File` and loads them as a local file defeats it. `suggestExportSource` suggests which source channel an output label is taken from, exact first and then ignoring a leading modality word and a trailing reference, and suggests nothing for an ambiguous match.

### Smaller public exports

- `GenericBiosignalCascadeMontage` — a montage that stacks N time-shifted slices of *one* source channel as N rows, each covering a fixed `pageLength`, so a long stretch of a single signal can be scanned at a glance. Modality wrappers override `_createChannel` to wrap each row in their own `MontageChannel` class; the slice math and page-step logic stay in the base.
- `ResourceCollection` — an abstract `GenericResource` that *is* a collection of other resources (`_resources`, a default index, a date), for a resource whose content is several resources opened as one.
- `MixedFileSystemItem` — the concrete `FileSystemItem` for a local or remote file or directory, and the type `loadFromDirectory` takes. Its static `UrlsToFsItem(...urls)` is how `loadStudy` turns an array of URLs into one.

---

### Coded event vocabularies — [src/assets/annotation/vocabulary/](src/assets/annotation/vocabulary/)

`GenericAnnotation.CODED_EVENTS` is a table of coded terms by category, and the four statics beside it (`getEventForCode`, `getEventForLabel`, `extendEvents`, `addStandardEventCodes`) read `this.CODED_EVENTS`, so a subclass that overrides the getter inherits them over its own view instead of copying them. A class that declares terms keeps them in a JSON file beside its class, loads it with `codedEventsFromVocabulary` and stacks it on the parent's table with `mergeCodedEvents`, both in [src/assets/annotation/vocabulary/index.ts](src/assets/annotation/vocabulary/index.ts) beside the shared file and exported through the annotation and assets barrels to the package root. [GenericBiosignalEvent](src/assets/biosignal/components/GenericBiosignalEvent.ts) declares the shared set, `epicurrents.biosignal`, in the categories TECHNICAL, INTERVENTION, OBSERVATION and ENVIRONMENT. Every category in a vocabulary file carries a scope, `acquisition` (what was done, given and observed during a recording) or `finding` (what a reader concluded from the signal); the shared set is all acquisition-scoped so far, and the scope, not the file, is what a consuming platform registers by. A modality's event class, such as the EEG module's `EegEvent`, declares its own categories on top.

Category names are unique up the chain, and `mergeCodedEvents` throws on a shadowed one. The category objects in a merged view are the originals, so `extendEvents` through a subclass writes into the table that owns the category: extending OBSERVATION through `EegEvent` adds the term for every biosignal event class, which is the intended way to add a shared term from outside. `extendEvents` refuses a category no class declares, since a merged view has nowhere to keep it. Terms and categories are defined read-only but extensible, which is what lets a crosswalk be added to a term after the fact while the term itself cannot be replaced.

The Epicurrents code is the term's identity; `standardCodes` is a crosswalk (`dicom`, `ieee`, `snomed`) filled only from a checked lookup against the standard's own browser. The JSON is also the file a consuming platform pins a copy of and registers as an annotation `Code` vocabulary, so a term added on one side and not the other fails that platform's digest test. Bump the file's `version` whenever a term is added, deprecated or its crosswalk changes, and never change a code once shipped: a term that turns out wrong is deprecated in place with a `description` naming its replacement. The state-like terms (body position, level of consciousness, montage, video) follow one convention, stated in the file: an event with duration 0 marks entry into the state until the next event of the same family, and an event with a duration bounds it. The design and the term tables live in the consuming platform repository as `docs/engineering-notes/annotation-event-vocabulary.md`.

The statics are methods, so `this` is the class they are called on; a detached reference such as `const find = EegEvent.getEventForCode` loses it.

## Event bus dispatch semantics

The event bus is exposed as `window.__EPICURRENTS__.EVENT_BUS`. It starts as `null` and is assigned by the `Epicurrents` constructor during initialisation, so any consumer registering listeners at load time must wait until it is non-null before subscribing.

### How `dispatchScopedEvent` reaches plain `addEventListener`

`GenericAsset.dispatchEvent(event, phase, detail)` calls `_eventBus.dispatchScopedEvent(event, this.id, phase, detail)`. That method:
1. Calls all matching scoped subscribers registered via `addScopedEventListener` directly.
2. Creates a `CustomEvent` and calls `this.dispatchEvent(e)` — the standard `EventTarget` method — which reaches any listener registered with plain `addEventListener`.

Step 2 happens for **both** phases when the `CustomEvent` is not cancelable (the default). This means plain `addEventListener` receives 'before' and 'after' events alike. The 'before' event carries the *anticipated* value (a listener may still prevent the change); the 'after' event carries the committed one. Filter by `(e as CustomEvent).detail?.phase === 'after'` if you only want the final value.

### `detail` shape by dispatch type

| Dispatch method | `detail` fields |
|---|---|
| `dispatchPropertyChangeEvent(prop, newValue, oldValue, phase?, context?)` | `{ property, newValue, oldValue, source, phase, scope, origin }` |
| `dispatchPayloadEvent(event, payload)` | `{ payload, phase, scope, origin }` |

`detail.source` is `'system'` or `'user'`, taken from the dispatching call's `PropertyChangeContext`; an absent value means user-initiated. A consumer that must not echo its own edits back — or that wants to react only to changes a person made — branches on it rather than inferring intent from the value.

### Useful events for biosignal consumers

| Event | Fired by | `detail.newValue` / `detail.payload` | When |
|---|---|---|---|
| `property-change:activeResources` | `GenericDataset` | `DataResource[]` — the new active set | Recording opened/switched |
| `property-change:displayViewStart` | `GenericBiosignalResource` | `number` — seconds from recording start | View scrolled |
| `property-change:viewStart` | `GenericBiosignalResource` | `number` | View position committed (after scroll inertia) |
| `property-change:events` | `GenericBiosignalResource` | `BiosignalAnnotationEvent[]` | Annotation created/moved/deleted |
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

A **trend** is a derived per-epoch signal computed from one or more montage channels. Four types are dispatched today: `'amplitude'` (aEEG — amplitude-integrated EEG), `'spectrogram'` (per-Hz band power), `'ratio'` (normalised band-power ratio on `[−1, +1]`) and `'pdbsi'` (pairwise-derived brain symmetry index). The infrastructure around them is generic, so a fifth type needs a union member, a branch in the processor and — where its output is not a scalar — a documented layout.

Trend work is its own layer, separate from the montage one: [TrendProcessor](src/assets/biosignal/service/TrendProcessor.ts), [TrendService](src/assets/biosignal/service/TrendService.ts), [TrendWorkerSubstitute](src/assets/biosignal/service/TrendWorkerSubstitute.ts) and [src/workers/trend.worker.ts](src/workers/trend.worker.ts). The montage processor and service hold no trend code: the trend worker couples to the reader's output SAB as an input-only reader, so computation is independent of which display montage is active.

| Layer | Class / Symbol | Role |
|---|---|---|
| Type union | `BiosignalTrendType` (`'amplitude' \| 'pdbsi' \| 'ratio' \| 'spectrogram'`) in [src/types/biosignal.ts](src/types/biosignal.ts) | Extend this union per new trend type |
| Base asset | `GenericBiosignalTrend` (concrete, not abstract) in [src/assets/biosignal/components/GenericBiosignalTrend.ts](src/assets/biosignal/components/GenericBiosignalTrend.ts) | Owns `signal[]`, `derivation`, `epochLength`, `samplingRate`; registers itself through `_registerWithService()` (see below); `computeTrend(range?)` writes each epoch into `_signal` at its absolute index and emits `'trend-epoch'` / `'trend-complete'` / `'trend-error'` |
| Concrete trend | per-modality wrapper class, owned by the modality module package | Fixes the trend `type` and supplies modality-specific defaults (e.g. a 2 / 15 Hz band-pass for aEEG). Epoch length is not one of them — it is resolved per recording, see below |
| Math | `computeAmplitudeIntegratedEpoch` / `compressAmplitudeValue` in [src/util/signal.ts](src/util/signal.ts) | Amplitude only, as pure functions: band-pass → rectify → envelope (min/max or 5/95 percentile) → semi-log compress. The frequency-domain types are implemented inside the processor, against the cached FFT and filter resources it keeps per trend |
| Per-epoch compute | `computeTrendEpoch(name, epochIndex)` on [TrendProcessor](src/assets/biosignal/service/TrendProcessor.ts), returning a `BiosignalTrendEpoch \| null` | Reads the input signals, builds the derived `(source − reference)` array in µV, dispatches by `derivation.type` — amplitude through the shared math function, spectrogram / ratio / pdbsi through the processor's own `_compute*` methods |
| Loop + cancellation | `computeTrend(name, range?)` + the processor's `_cancelledTrends` set | Loops epochs, `postMessage` per epoch (`'trend-epoch'`), supports cooperative cancel |
| Worker actions | `'setup-trend'`, `'compute-trend'`, `'cancel-trend-computation'`, `'set-interruptions'`, `'setup-worker'`, `'set-buffer-range'`, `'update-settings'`, `'shutdown'` in `TrendWorkerCommission` ([src/types/biosignal.ts](src/types/biosignal.ts)) | The trend-specific ones are keyed by trend `name`, so multiple trends can coexist on one processor |
| Service | `BiosignalTrendService` — `computeTrend(name, range?)` / `setupTrend(...)` / `setupWorker(...)` / `setupWithCache(...)`, implemented by [TrendService](src/assets/biosignal/service/TrendService.ts) (worker) and [TrendWorkerSubstitute](src/assets/biosignal/service/TrendWorkerSubstitute.ts) (in-process) | Tracks per-trend computation in `_trendComputations: Map<string, ...>`; routes `'trend-epoch'` / `'trend-complete'` / `'trend-cancelled'` messages back to the right trend |
| Registry | `GenericBiosignalMontage._trends` + `addTrend` / `getTrend` / `removeTrend` / `removeAllTrends` | Dispatches `property-change:trends` |
| Settings | `CommonBiosignalSettings.trends.<type>` (math knobs) | Per-modality derivation and display defaults live in the modality module's own settings |
| Epoch length | `resolveTrendEpochLength(recordingDuration, config)` in [src/util/signal.ts](src/util/signal.ts) | A `trends.<type>.epochLength` above zero is used as given; zero derives one from the recording length through that type's `epochScaling` ladder (`TrendEpochScaling`). Zero is the sentinel because settings are merged, so an absent key and a deliberate default are indistinguishable — a derivation keyed on absence would silently beat a deployment's explicit value |

**Important design choices**:
- Trend math is generic in core; the per-modality wrapper class only fixes the trend `type` and supplies defaults.
- **Registration is conditional, and a subclass that resolves its derivation late owns it.** The `GenericBiosignalTrend` constructor calls `_registerWithService()` only when it was given a service *and* `derivation.sourceChannels` is non-empty. A trend with no service is externally loaded and takes its data through `loadSignal()`; a subclass that resolves its channels after construction must call `_registerWithService()` itself once the derivation is complete, or `setupTrend` never reaches the worker and every later `computeTrend` fails on an unregistered name.
- The signal layout is implicit and differs per type: amplitude produces interleaved `[min0, max0, min1, max1, …]`, so a renderer reads `signal.length / 2` epochs; spectrogram produces one power value per output bin per epoch (bin count = `maxFreqHz`); ratio and pdbsi produce a single scalar per epoch. A new type documents its layout in the wrapper class.
- Each epoch arrives as one `BiosignalTrendEpoch` — `{ epochIndex, signal, totalEpochs, quality }` — passed whole to the `onEpochReady` callback and forwarded verbatim as the `'trend-epoch'` payload, so a consumer sees every qualification the processor recorded. `quality.coverage` is the fraction of the epoch's nominal span that was actually cached: below 1 at the caching frontier or at the end of the recording, where the values were computed from less data than the epoch spans.
- The `BiosignalTrendService` abstraction is what enables a future "compute on the backend" mode — swap the implementation, keep the same interface. Today's computation runs in JS on the in-house DSP layer in [src/util/dsp.ts](src/util/dsp.ts); nothing else needs to change to offload to a backend service.
- Trend setup and compute are driven by the consuming modality module, not by core. A module typically registers the trend once signal caching is complete (and again when the active montage changes) and gates the expensive compute behind an explicit opt-in, so that a montage switch does not silently re-run a full-recording computation.

### Adding a new trend type

1. **Type union**: add the new literal to `BiosignalTrendType` in [src/types/biosignal.ts](src/types/biosignal.ts).
2. **Math**: a pure time-domain function belongs in [src/util/signal.ts](src/util/signal.ts), the way `computeAmplitudeIntegratedEpoch` does. One that needs per-trend state — an FFT plan, a window, a pre-filter, a scratch buffer — belongs in [TrendProcessor](src/assets/biosignal/service/TrendProcessor.ts) beside the existing spectrogram, ratio and pdbsi implementations, which allocate those resources once in `setupTrend` and reuse them across epochs. Either way, return a `number[]` of one epoch's output samples, interleaving coordinates for multi-dimensional output (mirroring the amplitude trend's `[min, max]`).
3. **Dispatch**: extend the processor's `_computeTrendEpochValues` with a branch for the new `derivation.type`.
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

**A worker's class and its thread entry are separate modules, and both halves must point at the entry.** `<name>.worker.ts` declares the class and nothing else; `<name>.worker.entry.ts` constructs it and binds `onmessage`. The split is what the class modules' other callers need — the barrel exports `MemoryManagerWorker`, the substitutes run `MontageWorker` and `SignalReaderWorker` on the main thread, and importing a module that bound `onmessage` would take over the host's own handler. Both the `?worker&inline` import and the `WORKERS` list in [scripts/build-workers.mjs](scripts/build-workers.mjs) therefore name the entry, and the sentence above — that the standalone and inlined bundles are the same code — is only true while they do. A standalone bundle built from the class module loads, answers nothing, and reports no error, so nothing in the suite or the build says it happened; the check is that each `umd/` bundle still assigns `onmessage`.

The package declares `"sideEffects": false`, which rests on that split: a consumer's bundler is being told it may drop any core module whose exports go unused. Re-adding import-time work to a class module makes the declaration false in the direction that loses code silently, so an entry's construction and binding stay in the entry file.

When adding a new worker-bearing package, add the same two keys. The builder's worker-discovery step auto-discovers any `@epicurrents/*` package with a `umd/` directory, so no list needs updating there.

---

## Worker commission design

Each off-thread processor (montage, trend, format readers) reaches the worker through a **commission** — a typed message with a string `action` plus action-specific payload fields. A commission is declared in a type union and answered by one class, which runs on a worker thread or on the main thread depending on what the environment supports. The trend worker is the exception and is described at the end of this section.

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

### 2. The worker — action map ([src/workers/montage.worker.ts](src/workers/montage.worker.ts))

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

`BaseWorker` supplies two handlers every worker registers under its own map entry rather than inheriting a registration: `setBufferRange`, which delegates to whatever `_getBufferRangeTarget` returns, and `resetNetwork`, which clears nothing unless the worker fetches. `reset-network` is posted to every service's worker on session restore, so leaving it unregistered turns a routine message into a warning about an unsupported action. A subclass assigns its own `_actionMap` as a field, which shadows the base's, so an action registered on `BaseWorker` alone would never be reached.

[src/workers/base.worker.ts](src/workers/base.worker.ts) `handleMessage` looks up the action in `_actionMap` and calls the handler. Each handler calls `this._validate(...)` to type-narrow the payload, does work, and returns via `this._success(...)` / `this._failure(...)`. All three deliver through `this._postMessage`, which carries the original `rn` correlation ID and is the single point a substitute redirects to run these handlers on the main thread.

**The class module holds no worker-thread code.** Instantiating the worker and binding `onmessage` lives in [src/workers/montage.worker.entry.ts](src/workers/montage.worker.entry.ts), which is the module `MontageService` imports with Vite's `?worker&inline` suffix. The split is what lets the substitute import the same class: a module body that runs on import would assign the application's own `window.onmessage` the moment main-thread code reached for it. A worker whose handlers are shared needs the same two files; `signal-reader.worker.ts` already has no entry of its own, because each reader package supplies one.

### 3. The substitute runs the worker's own handlers

`MontageService` uses [MontageWorkerSubstitute](src/assets/biosignal/service/MontageWorkerSubstitute.ts) in place of a real Worker when it is constructed without a memory manager, or with the reserved override name `'substitute'`. The substitute holds a `MontageWorker` and hands it every commission, so there is no second implementation of the vocabulary to keep aligned:

```ts
class MainThreadCommissions extends MontageWorker {
    protected override _close () {}
    protected override _postMessage (reply: WorkerMessage['data']) {
        this._substitute.returnMessage(reply)
    }
}
```

What makes that possible is that `BaseWorker` routes every reply through `_postMessage` and closes its thread through `_close`, so redirecting those two runs the same handlers here. **A handler must not reach for the global `postMessage` or `close`**, and must validate through `this._validate` rather than calling `validateCommissionProps` directly: the utility's default reply target is that same global, which on the main thread is `window.postMessage`, so a validation failure would go to the window and the commission it refused would never settle. Nothing about that is visible — the reply is sent, to the wrong place.

Four montage commissions cannot mean the same thing on both sides, and each is overridden where it differs rather than left out. `setup-cache` hands over a live cache object, whose methods no structured clone carries, so the worker refuses it and the substitute serves it. `set-buffer-range`, `setup-input-cache` and `setup-input-mutex` need shared memory or a shared worker, which is what an environment running a substitute does not have, so the substitute refuses those three. A fifth, `setup-worker`, is shared, with `_resolveModuleSettings` overridden: the processor keeps the settings reference it is given, and on the main thread that must be the application's live module settings rather than the snapshot the commission carries.

Both halves answer in the same shape: `{ rn, action, success, error }` for a failure and `{ rn, action, success, ...results }` for a success, with the cause always under `error`. A reply must not spread the inbound commission into it — that returns the request's own payload alongside the response, so a consumer reading a field off the reply can be handed the request's value for it.

The stakes are worth stating, because a partial substitute looks like a working fallback and is not one. An unregistered action is answered with a failure, and `GenericService.shutdown` reads a failed `shutdown` as a refusal and skips the teardown it guards — so the worker is never terminated, its processor and cache stay resident, and nothing reports it. On the substitute side the same commission has to answer *before* tearing itself down: `ServiceWorkerSubstitute.shutdown` clears the listeners the service subscribed with, so a reply posted after it reaches nobody and the awaiting promise never settles at all.

[ServiceWorkerSubstitute](src/assets/service/ServiceWorkerSubstitute.ts) is the base every substitute extends. Reader substitutes extend [SignalReaderWorkerSubstitute](src/assets/service/SignalReaderWorkerSubstitute.ts) (see 3c). [TrendWorkerSubstitute](src/assets/biosignal/service/TrendWorkerSubstitute.ts) is outside the scheme entirely — it implements `BiosignalTrendService` directly and drives a main-thread `TrendProcessor` through ordinary method calls, with no commissions at all. `TrendService` has no substitute branch of its own: its `setupWithCache` logs that `TrendWorkerSubstitute` is the no-SAB path and returns `{ success: false }`, so the *caller* chooses between the two implementations.

Out-of-band notifications (e.g. per-epoch `'trend-epoch'` messages from inside the processor) go through the processor's `_postMessage` callback, wired to the worker's own `this._postMessage` — see the processor constructor's second parameter — so they reach the service on either side of the boundary.

### 3b. Reader workers — the shared vocabulary

A format's reader worker does not write its own dispatch. [src/workers/signal-reader.worker.ts](src/workers/signal-reader.worker.ts) `SignalReaderWorker<T extends GenericSignalReader>` registers every commission a reader answers alike — `cache-signals`, `get-signals`, `request-signals`, `set-interruptions`, `set-buffer-range`, `set-signal-polarity`, `setup-cache`, `release-signal-arrays`, `release-cache`, `reset-network`, `shutdown`, `update-settings` — against one reader instance, and each package adds `setup-worker`, where the formats genuinely differ:

```ts
class EdfWorker extends SignalReaderWorker<EdfReader> {
    constructor () {
        super(new EdfReader(SETTINGS))
        this.extendActionMap([['setup-worker', this.setupWorker]])
    }
}
```

Two hooks cover the rest of the variation: `_signalResponseExtras(range)` adds fields to a `get-signals` reply (an EDF reports the annotations and interruptions it discovered while decoding), and any shared handler can be overridden — a reader whose timeline admits no gaps refuses `set-interruptions` rather than applying one.

The reason this is a base class rather than a convention is that the failure it prevents is silent. A hand-written dispatch that omits a commission replies with nothing, and the service waits on a promise that can no longer settle; nothing logs, and the feature that needed it simply does nothing. `handleMessage` answering an unregistered action with a failure is what converts that into a visible error.

### 3c. Reader substitutes run the worker's own handlers

A reader's main-thread substitute extends [SignalReaderWorkerSubstitute](src/assets/service/SignalReaderWorkerSubstitute.ts), which holds a `SignalReaderWorker` over the same reader and hands it every commission. There is no second implementation of the vocabulary to keep aligned, and the package's substitute reads like its worker:

```ts
class EdfWorkerSubstitute extends SignalReaderWorkerSubstitute<EdfReader> {
    constructor () {
        super(new EdfReader(window.__EPICURRENTS__.RUNTIME!.SETTINGS))
        this.extendActionMap([['setup-worker', this.setupWorker]])
    }
}
```

The redirect and the rules it imposes on a handler are the same as for the montage pair in 3 above.

Three commissions mean something different on the main thread and are overridden there. `setup-cache` answers with the cache object itself, which a worker cannot do because it would cross the thread boundary as a clone with no link to the memory it stands for, and refuses a `useMemoryManager` request outright, a substitute existing precisely because there is no `SharedArrayBuffer` to manage. `update-settings` acknowledges a snapshot without applying it, the substitute reading the very settings module the snapshot was taken from. `shutdown` tears the reader down but closes nothing, the service terminating the substitute after the reply.

A reader's stakes differ from the montage's in where the damage lands. `GenericService.unload` awaits a commission too, and a reader's cache is the study's signal data, so a missing handler does not degrade a study — it makes the study impossible to close, on exactly the origins that cannot use a worker.

### 4. Subclass workers

Subclasses (e.g. a Pyodide-backed montage worker in the `pyodide-service` package) inherit `_actionMap` and any new actions added via `extendActionMap([...])`. Actions added to a base worker are picked up automatically there — no per-subclass change required, provided the subclass doesn't shadow the action map or override `handleMessage`.

### Settings reach a worker as a snapshot

A worker keeps its own copy of the settings tree; `setup-worker` seeds it with `SETTINGS._CLONABLE` and the `update-settings` commission replaces it whenever a field changes. The payload is always the whole snapshot, plus `changed`, the dotted paths behind it, for a worker that wants to react selectively.

`GenericService` opens the relay for every dedicated worker it is constructed with, by subscribing to `ApplicationEvents.SETTING_CHANGED` on `EventScopes.APPLICATION` — the event every successful `setFieldValue` dispatches. Changes arriving in one tick are coalesced into a single message. **A worker declares no interest in particular fields.** An earlier design had it ask the service to watch a list of them, which put the same field names in two places and let a field added to one go silently unrelayed; there is nothing to register now.

Apply the snapshot with `SETTINGS.applySnapshot(data.settings)` rather than assigning its properties over the worker's own. It writes field by field, so accessors survive — `app.isSabUsed` has to keep testing the worker's cross-origin isolation rather than adopt what the main thread evaluated — and it registers a module the worker has not seen, which is the normal case since modules register through the main thread's runtime. A worker that only needs one namespace can read `data.settings.modules[namespace]` out of the message instead, as the montage and trend workers do.

A substitute applies no snapshot: it runs on the main thread and reads the very settings module the application writes to. `ServiceWorkerSubstitute` answers the action for every substitute that does not override it, `SignalReaderWorkerSubstitute` overrides it to the same effect, and `MontageWorkerSubstitute` reaches it from the other direction — it overrides `_resolveModuleSettings` to read the live module, which leaves the shared handler assigning the processor the reference it already holds.

The snapshot is what makes the relay safe to miss. A worker attached after a change, or one still setting up, is corrected by the next message; a stream of individual field writes would leave it stale with nothing able to detect the drift. `syncSettings` in [src/util/worker.ts](src/util/worker.ts) builds the per-field message and is deprecated — no worker accepts that shape.

### Adding a new commission — checklist

1. Add the entry to the relevant commission type in [src/types/biosignal.ts](src/types/biosignal.ts).
2. Add a handler method to the worker and register it in `_actionMap`.
3. Decide whether the commission means the same thing on both sides. It usually does, and then there is nothing to add — the substitute runs the same handler. Where it does not, override the handler in the substitute and say why; refusing it there with a reason is better than leaving it out, since an absent handler and a refusal reach the service as the same failure and only one of them explains itself. A trend commission has nothing to add either way: `TrendWorkerSubstitute` implements the service interface rather than the worker protocol, so give it the matching method instead.
4. If the processor needs to push out-of-band notifications, route them through `this._postMessage(...)` rather than calling `postMessage` directly so the substitute can intercept them.
5. Add the dispatching method on the service and wire the response actions in `handleMessage`.

`_validate` answers the commission itself when validation fails, so a handler returns `false` after it rather than calling `this._failure` again — a second reply arrives under a request number the service has already released.

---

## SAB cache lifecycle — cross-activation state leaks

**Public docs:** [memory-management — Recording activation lifecycle](https://epicurrents.github.io/docs/memory-management#recording-activation-lifecycle)

### The problem

Switching between recordings and switching back produces permanently empty signals. Three root causes, all **cross-activation state leaks** — state owned by the recording *object* that doesn't reset atomically when the SAB is freed and reallocated:

1. **`_cacheProcesses` not cleared on `releaseCache()`** — `GenericSignalReader._cacheProcesses` retains stale "fully cached" targets across the release; `partsNotCached()` returns empty; `cacheSignals()` skips loading into the freshly-zeroed SAB.

2. **ACTIVATE event fires for both 'before' and 'after' phases** — the `GenericAsset.isActive` setter dispatches ACTIVATE 'before' (when `_isActive = false`), then sets `_isActive = true`, then dispatches ACTIVATE 'after'. If the full setup body (including `requestMemory`, `setupMutex`) runs in 'before', it leaves `isReady = true`; the 'after' handler then sees `isReady = true` and skips everything — including `cacheSignals()`. **Any ACTIVATE listener in a subclass must guard `if (!this._isActive) return` at the top.**

3. **Stale `cache-signals` progress response** — a progress message buffered as a macro task can arrive after `releaseBuffers()` resets `signalCacheStatus = [0,0]`, restoring a non-zero `signalCacheStatus[1]`. `cacheSignals()` guards on `!_signalCacheStatus[1]`, so the stale value silently skips caching.

Root cause 1 is fixed in this package: `releaseSignalArrays()` on [src/assets/reader/GenericSignalReader.ts](src/assets/reader/GenericSignalReader.ts) sets `proc.continue = false` on all processes and clears `_cacheProcesses`, and `releaseCache()` — defined once on the base [GenericDataProcessor](src/assets/reader/GenericDataProcessor.ts) and not overridden down the reader hierarchy — calls it first. Root causes 2 and 3 are obligations on the consuming module — see below.

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
- `GenericDataProcessor.releaseSignalArrays()` / `GenericSignalReader.releaseSignalArrays()` — Level 1 on the reader. The `cacheProcesses.continue = false` + `cacheProcesses.length = 0` cancellation lives in the reader's override, not inside `releaseCache`; `releaseCache` is the base processor's Level 2 and calls Level 1 first.
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

All remote I/O in the family — HTTP range reads, header/size probes, remote config and runtime loads, connector queries — goes through one layer in [src/util/network/](src/util/network/), exported from `#util` (and `@epicurrents/core/util` for worker bundles). Before it, a `fetch()` that resolved on a 4xx/5xx let an error body be decoded as signal bytes, and a worker fetch that threw without replying left its main-thread commission pending forever. The layer's contract is: a remote failure surfaces as a typed [`NetworkError`](src/util/network/errors.ts), never as corrupt data or a silent hang.

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
- Worker side — a worker calls `setNetworkStatusHandler((origin, state) => this._postMessage({ action: 'network-status', origin, state }))` at setup and overrides `resetNetwork` to call `networkBreakers.reset(origin)`. The base handler accepts the action and clears nothing, so a worker that fetches nothing needs no override. `GenericService` re-emits an incoming `network-status` as a `network-status` `'after'` event carrying `{ endpoint, state }` — the field is `endpoint`, **not** `origin`, because `GenericAsset.dispatchEvent` already fills `detail.origin` with `this`.

**Service commission backstop.** `GenericService` wires `worker.onerror` / `onmessageerror` to `_rejectAllCommissions`, so a synchronous worker crash or an undeserialisable message rejects every in-flight commission instead of stranding it. These events carry no `rn` correlation ID, so reject-all is the only safe response; it does not replace each worker handler's own duty to post a `success:false` reply for a caught failure (an async `onmessage` reject raises `unhandledrejection`, not `onerror`).

**Adding a new worker-bearing reader:** register `setNetworkStatusHandler` and override `resetNetwork` in the worker so it participates in the session-restore reset; route its byte reads through `resilientFetch` (breaker-only if the op-queue or a one-shot read owns cancellation).

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

with no obvious source-level cause is almost always a duplicate `scoped-event-log` getting bundled into the worker. The duplicate is `util/asymmetric-io-mutex/node_modules/scoped-event-log/` in the workspace — a v2 copy npm installs whenever the mutex package's declared range admits one while the workspace ships v3. With v2 nested under the mutex package, a bundler that walks `node_modules` from the importing file finds the v2 copy first, while the rest of the page uses v3 from the workspace root. Two `Log` shapes coexist, and the v2 one doesn't have `static debug` (it's an instance-style API).

Two things keep the nested copy away, and the second is what an `npm install` can undo:

1. `util/asymmetric-io-mutex/package.json` declares `scoped-event-log: ^3.2.0`, which is what stops npm's resolver from creating the nested v2. Check this first — a range that admits v2 is the root cause, and deleting the directory only postpones it.
2. Delete an existing nested copy and rebuild:
   ```bash
   rm -rf util/asymmetric-io-mutex/node_modules/scoped-event-log
   find . -name .vite -type d -exec rm -rf {} +
   cd util/asymmetric-io-mutex && npm run build
   ```

Verify there is exactly one copy (run from the workspace root). The workspace root's entry is a symlink, so a bare `-type d` silently hides it and the check looks like it found a missing copy rather than a healthy tree:

```bash
find . -name scoped-event-log \( -type d -o -type l \)
# Should print only:
#   ./util/scoped-event-log
#   ./node_modules/scoped-event-log   (symlink to the above)
```

If a third path under `util/asymmetric-io-mutex/node_modules/scoped-event-log` appears, the declared range was widened or `npm install` was run against a lockfile that still references v2.

---

## Planned work

Deferred and planned changes are tracked in [ROADMAP.md](ROADMAP.md) — the shared worker/substitute action map, the cheap mutex rebind on reactivation, and producing `partial` request results. The current-state limitation behind each is noted in place in the relevant section above; ROADMAP.md carries the intent and design sketch.
