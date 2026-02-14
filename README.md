# Epicurrents

An open-source JavaScript application for analyzing and visualizing neurophysiological signal data.

## Overview

The core module provides the main application class and base classes for different modules.

## Contents

- Main application class
- Base classes for use in modules:
  * Biosignal study modules
  * Document modules
  * File readers
  * Services
  * Workers
# Epicurrents — core

Epicurrents core is the central library for the Epicurrents application. It provides the main `Epicurrents` application class, the runtime state manager, base asset/resource classes and utilities used by modules (study loaders, readers, services and workers).

This package is intended to be consumed by higher-level modules (UI, study modules, services) and by applications that embed Epicurrents.

**Main highlights**
- `Epicurrents` application class (entry point)
- Runtime state manager (`runtime`) and event bus
- Base assets and resource classes (`src/assets`)
- Study importers/exporters and loaders
- Utilities and typed interfaces under `src/types` and `src/util`

Quick pointers
- Library entry: `src/index.ts` (exports `Epicurrents`, `SETTINGS`, `RuntimeStateManager`, and all base assets)
- Types: exported under `./types`
- Build artifacts: `dist/` and UMD bundle under `umd/`

Getting started

Install dependencies and build locally:

```bash
npm install
npm run build        # builds UMD + TypeScript outputs
npm run dev          # start webpack dev server (for integrating UI)
npm test             # run unit tests
```

Quick usage example (TypeScript)

```ts
import { Epicurrents, SETTINGS } from '@epicurrents/core'

// Create app instance
const app = new Epicurrents()

// Optional: configure default settings before launching
app.configure({ app: { useMemoryManager: false } })

// Register a platform-specific interface module (UI)
// Example: app.registerInterface(MyInterfaceModule)

// Register any resource modules or services
// app.registerModule('eeg', eegResourceModule)
// app.registerService('pyodide', pyodideServiceModule)

// Launch the application (provides runtime and instantiates the interface)
await app.launch({ /* optional ApplicationConfig */ })

// Create or switch datasets
const dataset = app.createDataset('Demo dataset', true)

// Load a study using a registered study importer
// const resource = await app.loadStudy('edf-importer', '/url/to/study.edf', { dataset })

// Add and open resources programmatically
// app.addResource(resource)
// app.openResource(resource)
```

API highlights
- `new Epicurrents()` — instantiate the main application; sets up global `window.__EPICURRENTS__` entries (`APP`, `EVENT_BUS`, `RUNTIME`).
- `configure(map)` — set default configuration before launching.
- `registerInterface(constructor)` — register an `InterfaceModule` constructor to be used by `launch()`.
- `registerModule(name, module)` — register resource modality modules (e.g., biosignal loaders/processors).
- `registerService(name, service)` — register application services.
- `launch(config?) => Promise<boolean>` — initializes the interface and runtime; must be called after `registerInterface`.
- `createDataset(name?, setAsActive?)` — convenience to create a `MixedMediaDataset` and add it to runtime. If no dataset is active when a study is loaded, one is created automatically.
- `loadStudy(loaderName, source, options) => Promise<DataResource | null>` — load/import a study using a registered importer.

Where to look next
- `src/index.ts` — main entry and the `Epicurrents` class implementation.
- `src/assets/` — base asset/resource classes used across modules.
- `src/runtime/` — runtime state manager and module registration.
- `src/events/` — event types and `EventBus` used for application-wide events.

Development notes
- This package builds a UMD bundle and typed `dist/` outputs. See `package.json` scripts for `build`, `dev`, and `test`.
- Exports in `package.json` expose subpaths like `./assets`, `./runtime`, `./types` for direct imports from the compiled `dist` outputs.

Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/YourFeature`)
3. Run tests and linting locally (`npm test`, `npm run lint`)
4. Commit and push your changes and open a Pull Request

License

Licensed under the Apache-2.0 License — see `LICENSE` for details.
