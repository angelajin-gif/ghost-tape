// fast-check parameters for UI property tests (R37.2): fixed seed, never fewer than 100 runs.
// Unlike fcParams in runs.ts there is no cap at 50, because UI properties are pure and cheap.

import { seed } from './runs';

/** Minimum number of cases every UI property runs (R37.2). */
export const UI_MIN_RUNS = 100;

/** `fc.assert(prop, fcUi())`. Asking for fewer than 100 runs still gives 100. */
export function fcUi(numRuns = UI_MIN_RUNS): { numRuns: number; seed: number } {
  return { numRuns: Math.max(UI_MIN_RUNS, Math.floor(numRuns)), seed };
}
