/**
 * Library build — emits the ESM `dist/` that every consumer imports.
 *
 * Module structure is preserved one-to-one with `src/`, so the subpath entries in the package
 * `exports` map keep resolving to the same files and a consumer's bundler can still tree-shake at
 * module granularity. Type declarations are emitted separately by `build:types`; this build emits
 * JavaScript only.
 *
 * Workers are inlined here rather than left for the consumer to resolve. Publishing an unresolved
 * `new Worker(new URL(…, import.meta.url))` hands the decision to whichever bundler runs last, and
 * they do not agree: Rollup rewrites it to an emitted chunk, Rolldown substitutes an empty object
 * for `import.meta` and the construct throws at runtime.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */
import { defineConfig } from 'vite'
import { ALIASES, WORKER, abs, externalDependencies } from './vite.shared.mjs'

export default defineConfig({
    build: {
        lib: {
            entry: {
                'index': abs('./src/index.ts'),
                'assets/index': abs('./src/assets/index.ts'),
                'config/index': abs('./src/config/index.ts'),
                'events/index': abs('./src/events/index.ts'),
                'runtime/index': abs('./src/runtime/index.ts'),
                'util/index': abs('./src/util/index.ts'),
                'workers/index': abs('./src/workers/index.ts'),
            },
            formats: ['es'],
        },
        // The library ships readable; only the inlined workers are minified (see WORKER).
        minify: false,
        outDir: abs('./dist'),
        emptyOutDir: true,
        target: 'esnext',
        rollupOptions: {
            external: externalDependencies,
            output: {
                preserveModules: true,
                preserveModulesRoot: abs('./src'),
                entryFileNames: '[name].js',
            },
        },
    },
    resolve: {
        alias: ALIASES,
    },
    worker: WORKER,
})
