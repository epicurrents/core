#!/usr/bin/env node
/**
 * Emit a package's TypeScript declarations, then make their path aliases portable.
 *
 * `tsc` writes `paths` aliases (`#types`, `#root/src/…`) into emitted declarations verbatim. The aliases belong to
 * the package's own tsconfig, so a consumer resolving them gets "cannot find module" on every type the package
 * exposes, which from the consumer's side is indistinguishable from the package shipping no types at all. Every
 * specifier that matches a `paths` pattern is therefore rewritten, resolved against what was actually emitted rather
 * than assumed:
 *
 * - A target inside `rootDir` becomes a relative path into `outDir`. A directory becomes an explicit `/index`, so the
 *   result holds under any module-resolution mode.
 * - A target inside another package (a workspace sibling reached through an alias such as `#workspace/*`) becomes a
 *   bare specifier naming that package, through the shortest subpath its `exports` map publishes for the file.
 * - A target under `node_modules` is already a published package and is left alone.
 *
 * Anything else fails the build: an alias with no emitted target means a declaration references a file this package
 * does not ship, and a consumer would find out only as a missing type.
 *
 * Only declarations are processed. JavaScript is expected to come from a bundler that resolves the aliases itself.
 *
 * Usage, from the package root:
 *   epicurrents-build-types [--project <tsconfig>] [--no-emit]
 *
 * `--project` defaults to tsconfig.json. `--no-emit` skips running `tsc`, for a package that emits (or adds
 * hand-written declarations to the emitted tree) in its own build step first.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const root = process.cwd()

/**
 * TypeScript is resolved from the package being built, not from core, so declarations are emitted by the compiler
 * version that package type-checks with.
 */
const requireFromPackage = createRequire(join(root, 'package.json'))

/** Parse the command line into `{ project, emit }`. */
function parseArguments (argv) {
    const options = { emit: true, project: 'tsconfig.json' }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--no-emit') {
            options.emit = false
        } else if (arg === '--project' || arg === '-p') {
            if (!argv[i + 1]) {
                fail(`${arg} needs a value.`)
            }
            options.project = argv[++i]
        } else if (arg.startsWith('--project=')) {
            options.project = arg.slice('--project='.length)
        } else {
            fail(`Unknown argument: ${arg}`)
        }
    }
    return options
}

function fail (message) {
    console.error(`epicurrents-build-types: ${message}`)
    process.exit(1)
}

/** Every declaration file under `dir`, depth first. */
function declarations (dir) {
    const found = []
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) {
            found.push(...declarations(path))
        } else if (path.endsWith('.d.ts')) {
            found.push(path)
        }
    }
    return found
}

function isFile (path) {
    try {
        return statSync(path).isFile()
    } catch {
        return false
    }
}

/** Whether `path` lies inside `dir` (or is `dir`). */
function isInside (path, dir) {
    const rel = relative(dir, path)
    return !rel.startsWith('..') && !isAbsolute(rel)
}

/** Forward slashes, for specifiers and messages. */
function posix (path) {
    return path.split(sep).join('/')
}

/**
 * The declaration file `path` names, as an absolute path without the `.d.ts` suffix, or null when nothing exists
 * there. A specifier may name the file itself or a directory holding an `index`.
 */
function declarationTarget (path) {
    const bare = path.replace(/\.(d\.ts|ts|js|mjs|cjs)$/, '')
    if (isFile(`${bare}.d.ts`)) {
        return bare
    }
    if (isFile(join(bare, 'index.d.ts'))) {
        return join(bare, 'index')
    }
    return null
}

/**
 * Candidate paths for a specifier, in the order TypeScript would try them: the pattern with the longest prefix wins,
 * and within it each target in turn. Empty when no pattern matches, which means the specifier is not an alias.
 */
function aliasCandidates (specifier, paths, pathsBase) {
    let best = null
    for (const [pattern, targets] of Object.entries(paths)) {
        const star = pattern.indexOf('*')
        let captured
        if (star === -1) {
            if (specifier !== pattern) {
                continue
            }
            captured = ''
        } else {
            const prefix = pattern.slice(0, star)
            const suffix = pattern.slice(star + 1)
            if (
                !specifier.startsWith(prefix) || !specifier.endsWith(suffix) ||
                specifier.length < prefix.length + suffix.length
            ) {
                continue
            }
            captured = specifier.slice(prefix.length, specifier.length - suffix.length)
        }
        const weight = star === -1 ? Infinity : star
        if (!best || weight > best.weight) {
            best = { captured, targets, weight }
        }
    }
    if (!best) {
        return []
    }
    return best.targets.map(target => resolve(pathsBase, target.replace('*', best.captured)))
}

/** The nearest directory at or above `path` that holds a package.json, or null. */
function packageRootOf (path) {
    let dir = path
    while (true) {
        if (isFile(join(dir, 'package.json'))) {
            return dir
        }
        const parent = dirname(dir)
        if (parent === dir) {
            return null
        }
        dir = parent
    }
}

/** Every declaration path an `exports` value can stand for, package-relative and without `.d.ts`. */
function exportedDeclarations (value) {
    if (typeof value === 'string') {
        return [value.replace(/^\.\//, '').replace(/\.(d\.ts|ts|js|mjs|cjs)$/, '')]
    }
    if (value && typeof value === 'object') {
        return Object.values(value).flatMap(exportedDeclarations)
    }
    return []
}

/**
 * The bare specifier that reaches `target` (absolute, without `.d.ts`) in another package, or null when that package
 * does not publish it. Without an `exports` map every file is reachable by its path.
 */
function packageSpecifier (target, packageRoot) {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'))
    const file = posix(relative(packageRoot, target))
    if (!manifest.exports) {
        return `${manifest.name}/${file}`
    }
    const exportsMap = typeof manifest.exports === 'string' || Object.keys(manifest.exports)[0]?.[0] !== '.'
        ? { '.': manifest.exports }
        : manifest.exports
    const subpaths = []
    for (const [key, value] of Object.entries(exportsMap)) {
        for (const published of exportedDeclarations(value)) {
            const keyStar = key.indexOf('*')
            const valueStar = published.indexOf('*')
            if (keyStar === -1 && valueStar === -1) {
                if (published === file) {
                    subpaths.push(key)
                }
            } else if (keyStar !== -1 && valueStar !== -1) {
                const prefix = published.slice(0, valueStar)
                const suffix = published.slice(valueStar + 1)
                if (file.startsWith(prefix) && file.endsWith(suffix) && file.length >= prefix.length + suffix.length) {
                    subpaths.push(key.replace('*', file.slice(prefix.length, file.length - suffix.length)))
                }
            }
        }
    }
    if (!subpaths.length) {
        return null
    }
    const shortest = subpaths.sort((a, b) => a.length - b.length)[0]
    return shortest === '.' ? manifest.name : `${manifest.name}/${shortest.slice(2)}`
}

/**
 * The portable replacement for `specifier` as written in `file`: a string, `undefined` when the specifier is not an
 * alias (or aliases a published package) and stays as it is, or null when it cannot be resolved.
 */
function rewriteSpecifier (specifier, file, config) {
    const candidates = aliasCandidates(specifier, config.paths, config.pathsBase)
    if (!candidates.length) {
        return undefined
    }
    for (const candidate of candidates) {
        if (candidate.split(sep).includes('node_modules')) {
            return undefined
        }
        if (isInside(candidate, config.rootDir)) {
            const target = declarationTarget(join(config.outDir, relative(config.rootDir, candidate)))
            if (!target) {
                continue
            }
            const path = posix(relative(dirname(file), target))
            return path.startsWith('.') ? path : `./${path}`
        }
        const packageRoot = packageRootOf(candidate)
        if (packageRoot && packageRoot !== root) {
            const target = declarationTarget(candidate)
            const bare = target && packageSpecifier(target, packageRoot)
            if (bare) {
                return bare
            }
        }
    }
    return null
}

/** Resolved compiler options for the project, with every path absolute. */
function readConfig (ts, project) {
    const configPath = resolve(root, project)
    if (!existsSync(configPath)) {
        fail(`No such tsconfig: ${project}`)
    }
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        },
    })
    const { baseUrl, outDir, paths, pathsBasePath, rootDir } = parsed.options
    if (!outDir || !rootDir) {
        fail(`${project} must set both outDir and rootDir, so emitted paths mirror the source tree.`)
    }
    return {
        outDir,
        paths: paths ?? {},
        pathsBase: baseUrl ?? pathsBasePath ?? dirname(configPath),
        rootDir,
    }
}

const options = parseArguments(process.argv.slice(2))
const ts = requireFromPackage('typescript')
const config = readConfig(ts, options.project)

if (options.emit) {
    const tsc = requireFromPackage.resolve('typescript/bin/tsc')
    try {
        execFileSync(
            process.execPath,
            [tsc, '-p', options.project, '--declaration', '--emitDeclarationOnly'],
            { cwd: root, stdio: 'inherit' }
        )
    } catch {
        fail('tsc failed; declarations were not rewritten.')
    }
}
if (!existsSync(config.outDir)) {
    fail(`Nothing emitted: ${posix(relative(root, config.outDir))} does not exist.`)
}

const IMPORT_SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bdeclare\s+module\s+)(["'])([^"'\n]+)\2/g
const unresolved = []
let rewritten = 0
let files = 0
for (const file of declarations(config.outDir)) {
    const source = readFileSync(file, 'utf-8')
    const updated = source.replace(IMPORT_SPECIFIER, (whole, lead, quote, specifier) => {
        const replacement = rewriteSpecifier(specifier, file, config)
        if (replacement === undefined) {
            return whole
        }
        if (replacement === null) {
            unresolved.push(`${posix(relative(root, file))}: ${specifier}`)
            return whole
        }
        rewritten++
        return `${lead}${quote}${replacement}${quote}`
    })
    if (updated !== source) {
        writeFileSync(file, updated)
        files++
    }
}

if (unresolved.length) {
    fail(`declarations reference aliases with no published target:\n  ${unresolved.join('\n  ')}`)
}
console.info(`Rewrote ${rewritten} alias specifier(s) in ${files} declaration file(s).`)
