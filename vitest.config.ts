import { defineConfig } from 'vitest/config';

// Fast suite (`npm test`): small fast-check case counts, smoke-level channel cells.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
