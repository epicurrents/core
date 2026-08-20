/**
 * Shared pieces of the Vite build configs.
 *
 * The package resolves its own workers at build time, so nothing downstream has to. Consumers get
 * plain ESM with no `import.meta.url`, no asset-base assumption and no required worker registration.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */
import { fileURLToPath, URL } from 'url'
import { createRequire } from 'module'
import { transform } from 'esbuild'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

/** Resolve a path relative to the package root. */
export const abs = (p) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Internal `#*` subpath imports, mirroring the `paths` in tsconfig.json. Vite cannot take these
 * from the package `imports` field alone: those map to extension-less source paths, which the
 * Node-ESM resolver rejects.
 */
export const ALIASES = [
    { find: /^#root\//, replacement: abs('./') + '/' },
    {
        find: /^#(assets|config|errors|events|onnx|pyodide|runtime|types|util|workers)\b/,
        replacement: abs('./src') + '/$1',
    },
]

/**
 * Every declared dependency stays a bare import in `dist/`, so a consumer installs one copy of each
 * rather than inheriting a bundled one. Workers are the deliberate exception — see {@link WORKER}.
 */
export const externalDependencies = (id) => Object.keys(pkg.dependencies || {})
    .some(dep => id === dep || id.startsWith(`${dep}/`))

/**
 * Minify worker output regardless of the surrounding build's `minify` setting. A worker is inlined
 * into the bundle as a source string, so its size is paid by every consumer whether or not the
 * worker ever runs; the library around it stays unminified for debuggability.
 *
 * Both worker builds run this same plugin so the inlined and standalone bundles are byte-identical
 * — a consumer switching to the standalone files gets the code it was already running.
 *
 * `legalComments: 'eof'` collects the bundled dependencies' licence notices at the end of the file
 * instead of leaving them interleaved. esbuild's `transform` default keeps them inline, which
 * triples the size of an inlined worker; dropping them would ship Apache-2.0 and MIT code with its
 * attribution removed.
 */
export const minifyWorkerOutput = () => ({
    name: 'epi-minify-worker',
    async renderChunk (code) {
        const result = await transform(code, { minify: true, legalComments: 'eof', target: 'esnext' })
        return { code: result.code, map: null }
    },
})

/**
 * Worker sub-build settings. Workers are self-contained classic (IIFE) bundles: a worker cannot
 * resolve a bare specifier against a Blob URL, so its dependencies must be bundled in.
 */
export const WORKER = {
    format: 'iife',
    plugins: () => [minifyWorkerOutput()],
    rollupOptions: {
        // Restated rather than inherited: the library build disables tree-shaking, which is wrong
        // for a worker. A worker has exactly one entry point and no external consumers, so what it
        // does not reach is genuinely dead — and its bytes are paid for by every consumer of the
        // inlined bundle.
        treeshake: true,
        output: {
            inlineDynamicImports: true,
        },
    },
}
