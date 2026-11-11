import { defineConfig } from 'vitest/config';

// Deep suite (`npm run test:deep`): same test files, more cases, full channel cells.
// GT_DEEP switches case counts (tests/support/runs.ts) and turns on the simulated-audio
// ledger whose total is checked against the R11.13 cap in tests/support/budgetSetup.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: { GT_DEEP: '1' },
    globalSetup: ['tests/support/budgetSetup.ts'],
    testTimeout: 600_000,
  },
});
