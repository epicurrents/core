import { defineConfig } from 'vitest/config'
import { ALIASES } from './vite.shared.mjs'

export default defineConfig({
    resolve: {
        alias: ALIASES,
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'tests/coverage',
        },
    },
})
