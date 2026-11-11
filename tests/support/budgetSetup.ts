// Vitest global setup for the deep suite: start an empty ledger, and after all
// tests print the budget report and fail the run if the R11.13 cap is exceeded.

import { mkdirSync, rmSync } from 'node:fs';
import { formatSummary, LEDGER_DIR, LEDGER_FILE, readLedger, summarize } from './budget';

export function setup(): () => void {
  rmSync(LEDGER_FILE, { force: true });
  mkdirSync(LEDGER_DIR, { recursive: true });
  return teardown;
}

function teardown(): void {
  const summary = summarize(readLedger());
  console.log(formatSummary(summary));
  if (summary.overCap) {
    throw new Error(`Deep suite pushed ${summary.totalSec.toFixed(1)} s of simulated audio, over the ${summary.capSec} s cap (R11.13)`);
  }
}
