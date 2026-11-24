import { defineConfig } from 'vitest/config';

// Fast suite (`npm test`): small fast-check case counts, smoke-level channel cells.
// UI tests live under tests/**/ui/**. They run in node unless the file starts with
// `// @vitest-environment jsdom` (vitest reads that docblock per file).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/ui/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
