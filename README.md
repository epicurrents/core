# @epicurrents/core

The core library of the Epicurrents neurophysiological signal viewer. It defines the application entry point (`Epicurrents`), the runtime state manager, the asset / resource / module / service abstractions, the biosignal montage and trend machinery, the worker commission protocol, and the shared TypeScript types that every other `@epicurrents/*` package builds on. It contains no UI — the viewer interface, file-format readers, modality modules and computation services are separate packages that register themselves onto the application at setup time.

## Documentation map

| Document | Audience | Contents |
|---|---|---|
| README.md (this file) | Developers consuming or embedding the package | Structure, usage, build and test workflow |
| [AGENTS.md](AGENTS.md) | AI coding assistants (useful to humans too) | In-depth internals: signal data flow, SAB cache lifecycle, rolling-cache protocol, worker commissions, network resilience, gotchas |
| [ROADMAP.md](ROADMAP.md) | Contributors | General design directions and deferred work — explicitly not an issue tracker |

The README / AGENTS split is deliberate: much of the intended audience is clinicians rather than career developers, and the deep technical material lives in AGENTS.md so that an AI coding agent can carry those concepts for them. A reader should get a working mental model of the package from this file alone, and point an agent at AGENTS.md for anything beyond it.


## Role in the package family

`@epicurrents/core` is the dependency root. Sibling packages fall into three patterns, each documented in its own repository:

- **Readers** (`edf-reader`, `csv-reader`, `wav-reader`, `nic-reader`, `dicom-reader`, …) — parse a file format into studies and signals, usually with their own web worker.
- **Modality modules** (`eeg-module`, `emg-module`, `ncs-module`, …) — the domain logic and settings for one recording modality.
- **Services** (`pyodide-service`, `onnx-service`) — optional off-thread computation backends.

Editions of the full viewer are assembled from these packages by the separate builder repository.

## Install and build

```bash
npm install
npm run build        # build:umd (worker bundles) + build:tsc (dist/)
npm test             # vitest unit suite
npm run lint         # eslint on src/
```

The two build outputs serve different consumers and must be regenerated together after any source change: `dist/` is the TSC ESM output imported by the main thread, and `umd/` holds the self-contained worker bundles. Rebuilding only one leaves the worker and main thread disagreeing about shared code — a mismatch the type system cannot see.

`tsconfig.base.json` is exported and extended by every sibling package; the TypeScript version is pinned family-wide (see AGENTS.md → Version compliance).

## Package structure

```
src/
  index.ts             # Epicurrents application class + public exports
  assets/
    biosignal/         # biosignal resource, montage, trend, mutex + montage/trend services
    connector/         # REST API and WebDAV data-source connectors
    dataset/           # dataset containers for resources opened together
    document/          # document (non-signal) resource base
    reader/            # signal reader/writer/processor bases, rolling-cache op queue
    service/           # web-worker service base, memory manager, worker substitutes
    study/             # study loaders, importers and exporters
    annotation/        # annotations and resource labels
  config/              # Settings singleton
  events/              # EventBus and application events
  runtime/             # RuntimeStateManager
  types/               # all shared TypeScript interfaces
  util/                # constants, conversions, signal maths, network/ (resilientFetch)
  workers/             # base, montage, trend and memory-manager workers
```

Subpath exports mirror this layout: `@epicurrents/core/dist/types`, `.../dist/util`, `.../runtime`, etc. Worker bundles are exposed as `@epicurrents/core/workers/<name>.worker.js` (from `umd/`) for `?raw` inlining.

## Usage

```ts
import { Epicurrents } from '@epicurrents/core'

const app = new Epicurrents()
// Sets window.__EPICURRENTS__ = { APP, EVENT_BUS, RUNTIME }.

// Optionally override default settings before launching.
app.configure({ 'app.useMemoryManager': false })

// Register the modality modules, services, study importers and the UI.
app.registerModule('eeg', eegModule)
app.registerService('pyodide', pyodideService)
app.registerStudyImporter('edf', 'EDF', 'file', edfLoader)
app.registerInterface(MyInterfaceModule)

// Launch: instantiates the interface, sets up the memory manager when SharedArrayBuffer is available.
await app.launch()

// Open a recording through a registered importer.
const dataset = app.createDataset('Session 1', true)
const resource = await app.loadStudy('edf', 'https://example.com/recording.edf', { dataset })
if (resource) {
    app.selectActiveResource(resource)
}
```

Key `Epicurrents` methods beyond the flow above:

- `addResource(resource, modality?)` — add an already-constructed resource to the active dataset.
- `setWorkerOverride(name, getWorker)` — inject a deployment-specific or test-double worker factory.
- `notifySessionRestored()` — host applications call this after a re-login; it resets the network circuit breakers on the main thread and in every registered service's worker so latched fetch paths resume.
- `setSettingsValue(field, value)` / `SETTINGS` — runtime settings access; user-overridable fields persist to `localStorage`.

The event bus (`app.eventBus`, also `window.__EPICURRENTS__.EVENT_BUS`) carries scoped `property-change:*` and payload events for reactive consumers; see AGENTS.md → Event bus dispatch semantics for the contract.

## Testing

Vitest suites live in `tests/`, mirroring `src/`. The SAB-dependent suites (mutex, memory rearrange, montage locked read) run against real `SharedArrayBuffer` instances. Run a single file with `npx vitest run tests/<path>`.

## Contributing

Work on a feature branch, keep `npm test` and `npm run lint` green, and regenerate both build outputs before verifying in a consuming application. Planned and deferred design work is listed in [ROADMAP.md](ROADMAP.md); bug reports and feature requests belong in the GitHub issue tracker.

## License

Copyright 2017-2022, 2023-2026 Sampsa Lohi. Licensed under the [Apache-2.0](LICENSE) license.
