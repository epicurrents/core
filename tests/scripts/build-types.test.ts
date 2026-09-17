// @vitest-environment node
/**
 * Declaration alias rewriting in `scripts/build-types.mjs`, run as a sibling package would run it: from the root of
 * a fixture package with its own tsconfig, against declarations laid out as `tsc` emits them.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = join(coreRoot, 'scripts', 'build-types.mjs')
const typescriptDir = dirname(createRequire(join(coreRoot, 'package.json')).resolve('typescript/package.json'))

let base: string
let pkg: string

function write (path: string, content: string | object) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}

function run (...args: string[]) {
    return spawnSync(process.execPath, [script, ...args], { cwd: pkg, encoding: 'utf-8' })
}

function emitted (path: string) {
    return readFileSync(join(pkg, 'dist', path), 'utf-8')
}

beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'epi-build-types-')))
    pkg = join(base, 'pkg')
    write(join(pkg, 'package.json'), { name: 'fixture', version: '0.0.0' })
    mkdirSync(join(pkg, 'node_modules'), { recursive: true })
    symlinkSync(typescriptDir, join(pkg, 'node_modules', 'typescript'), 'dir')
    write(join(pkg, 'tsconfig.json'), {
        compilerOptions: {
            declaration: true,
            module: 'esnext',
            moduleResolution: 'node',
            outDir: 'dist',
            rootDir: 'src',
            skipLibCheck: true,
            strict: true,
            target: 'esnext',
            baseUrl: './',
            paths: {
                '#root/*': ['./*'],
                '#workspace/*': ['../*'],
                '#vendor': ['./node_modules/vendor/index'],
                '#*': ['src/*'],
            },
        },
        include: ['src/**/*'],
    })
    write(join(pkg, 'dist', 'types', 'index.d.ts'), 'export type A = { a: number };\n')
    write(join(pkg, 'dist', 'util', 'strings.d.ts'), 'export declare const s: string;\n')
    write(join(base, 'sibling', 'package.json'), {
        name: '@scope/sibling',
        exports: {
            '.': { types: './dist/index.d.ts', import: './dist/index.js' },
            './dist/types': './dist/types/index.d.ts',
            './types': './dist/types/index.d.ts',
        },
    })
    write(join(base, 'sibling', 'dist', 'index.d.ts'), 'export type Root = 1;\n')
    write(join(base, 'sibling', 'dist', 'types', 'index.d.ts'), 'export type S = 1;\n')
    write(join(base, 'sibling', 'dist', 'hidden.d.ts'), 'export type H = 1;\n')
    write(join(base, 'plain', 'package.json'), { name: 'plain' })
    write(join(base, 'plain', 'lib', 'thing.d.ts'), 'export type T = 1;\n')
})

afterEach(() => {
    rmSync(base, { force: true, recursive: true })
})

describe('epicurrents-build-types', () => {
    it('rewrites aliases into the emitted tree relative to each declaration', () => {
        write(join(pkg, 'dist', 'index.d.ts'), [
            `import type { A } from '#types';`,
            `export { s } from "#util/strings";`,
            `export type B = import("#root/src/types").A;`,
        ].join('\n'))
        write(join(pkg, 'dist', 'nested', 'deep.d.ts'), `export * from '#util/strings';\n`)
        const result = run('--no-emit')
        expect(result.status, result.stderr).toBe(0)
        expect(emitted('index.d.ts')).toBe([
            `import type { A } from './types/index';`,
            `export { s } from "./util/strings";`,
            `export type B = import("./types/index").A;`,
        ].join('\n'))
        expect(emitted('nested/deep.d.ts')).toBe(`export * from '../util/strings';\n`)
    })
    it('names a sibling package through the shortest subpath its exports publish', () => {
        write(join(pkg, 'dist', 'index.d.ts'), [
            `import type { S } from '#workspace/sibling/dist/types';`,
            `import type { Root } from '#workspace/sibling/dist/index';`,
            `import type { T } from '#workspace/plain/lib/thing';`,
        ].join('\n'))
        const result = run('--no-emit')
        expect(result.status, result.stderr).toBe(0)
        expect(emitted('index.d.ts')).toBe([
            `import type { S } from '@scope/sibling/types';`,
            `import type { Root } from '@scope/sibling';`,
            `import type { T } from 'plain/lib/thing';`,
        ].join('\n'))
    })
    it('leaves non-aliases and aliases of installed packages untouched', () => {
        const source = [
            `import type { V } from '#vendor';`,
            `import type { E } from 'scoped-event-bus/types';`,
            `import type { L } from './local';`,
        ].join('\n')
        write(join(pkg, 'dist', 'index.d.ts'), source)
        const result = run('--no-emit')
        expect(result.status, result.stderr).toBe(0)
        expect(emitted('index.d.ts')).toBe(source)
    })
    it.each([
        ['an alias with no emitted target', '#types/missing'],
        ['a package file outside rootDir', '#root/package.json'],
        ['a sibling file its exports do not publish', '#workspace/sibling/dist/hidden'],
    ])('fails on %s and leaves the specifier as written', (_label, specifier) => {
        const source = `import type { X } from '${specifier}';\n`
        write(join(pkg, 'dist', 'index.d.ts'), source)
        const result = run('--no-emit')
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(`dist/index.d.ts: ${specifier}`)
        expect(emitted('index.d.ts')).toBe(source)
    })
    it('emits declarations with tsc before rewriting them', () => {
        write(join(pkg, 'src', 'types', 'index.ts'), 'export type A = { a: number }\n')
        write(join(pkg, 'src', 'index.ts'), `import type { A } from '#types'\nexport const make = (): A => ({ a: 1 })\n`)
        write(join(pkg, 'tsconfig.types.json'), { extends: './tsconfig.json' })
        rmSync(join(pkg, 'dist'), { force: true, recursive: true })
        const result = run('--project', 'tsconfig.types.json')
        expect(result.status, result.stderr).toBe(0)
        expect(emitted('index.d.ts')).toContain(`from './types/index'`)
    })
    it('rejects a tsconfig without outDir and rootDir', () => {
        write(join(pkg, 'tsconfig.bare.json'), { compilerOptions: { declaration: true } })
        const result = run('--no-emit', '--project=tsconfig.bare.json')
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('must set both outDir and rootDir')
    })
})
