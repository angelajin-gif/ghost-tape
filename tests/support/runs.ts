// Shared fast-check parameters. Property tests are seeded so every run is
// reproducible (tech.md: no randomness without a seed). Set FC_SEED to explore
// other seeds locally; a failure report always prints the seed and path to replay.

/** True under `npm run test:deep` (set in vitest.deep.config.ts). */
export const isDeep = process.env.GT_DEEP === '1';

/** Fixed default seed: "GT" + version 1. */
export const DEFAULT_SEED = 0x47540001;

const envSeed = process.env.FC_SEED;
export const seed = envSeed !== undefined && envSeed !== '' ? Number(envSeed) : DEFAULT_SEED;

/** fast-check parameters: `fast` cases in `npm test` (design: ≤ 50), `deep` in test:deep. */
export function fcParams(fast: number, deep: number): { numRuns: number; seed: number } {
  return { numRuns: isDeep ? deep : Math.min(fast, 50), seed };
}
