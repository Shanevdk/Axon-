import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Tests run against the CAD library directly, so this config deliberately
 * skips the Laravel, Inertia and Wayfinder plugins in `vite.config.ts` —
 * they expect a running app and are irrelevant to pure geometry code.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, 'resources/js'),
        },
    },
    test: {
        environment: 'node',
        include: ['resources/js/**/*.test.ts'],
    },
});
