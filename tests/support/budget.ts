// Simulated-audio budget for the deep suite (R11.13, design "Deep-suite plan").
//
// Vitest runs test files in separate workers, so an in-memory counter cannot see
// the whole suite. Each worker appends one JSON line per record to a shared ledger
// file; the global teardown (budgetSetup.ts) sums it, prints the report and fails
// the run if the total exceeds the cap.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BUDGET_CAP_SEC = 15_000;

export const LEDGER_DIR = fileURLToPath(new URL('../../.vitest-budget/', import.meta.url));
export const LEDGER_FILE = `${LEDGER_DIR}ledger.jsonl`;

export interface LedgerRecord {
  readonly cell: string;
  readonly audioSec: number;
  readonly trials: number;
}

export interface CellSummary {
  readonly cell: string;
  readonly audioSec: number;
  readonly trials: number;
}

export interface BudgetSummary {
  readonly totalSec: number;
  readonly capSec: number;
  readonly overCap: boolean;
  readonly cells: readonly CellSummary[];
}

const ledgerEnabled = (): boolean => process.env.GT_DEEP === '1';

function append(record: LedgerRecord): void {
  if (!ledgerEnabled()) return;
  appendFileSync(LEDGER_FILE, `${JSON.stringify(record)}\n`);
}

/** Count samples pushed into a decoder for a cell, e.g. 'R5.1 standard'. */
export function recordAudio(cell: string, sampleCount: number, sampleRate: number): void {
  append({ cell, audioSec: sampleCount / sampleRate, trials: 0 });
}

/** Count one trial in a cell. */
export function recordTrial(cell: string): void {
  append({ cell, audioSec: 0, trials: 1 });
}

export function parseLedger(text: string): LedgerRecord[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LedgerRecord);
}

export function readLedger(file: string = LEDGER_FILE): LedgerRecord[] {
  return existsSync(file) ? parseLedger(readFileSync(file, 'utf8')) : [];
}

/** Pure: total and per-cell sums, sorted by cell name for a stable report. */
export function summarize(records: readonly LedgerRecord[], capSec: number = BUDGET_CAP_SEC): BudgetSummary {
  const byCell = new Map<string, { audioSec: number; trials: number }>();
  let totalSec = 0;
  for (const r of records) {
    const c = byCell.get(r.cell) ?? { audioSec: 0, trials: 0 };
    c.audioSec += r.audioSec;
    c.trials += r.trials;
    byCell.set(r.cell, c);
    totalSec += r.audioSec;
  }
  const cells = [...byCell.entries()]
    .map(([cell, c]) => ({ cell, audioSec: c.audioSec, trials: c.trials }))
    .sort((x, y) => (x.cell < y.cell ? -1 : x.cell > y.cell ? 1 : 0));
  return { totalSec, capSec, overCap: totalSec > capSec, cells };
}

export function formatSummary(s: BudgetSummary): string {
  const lines = ['Deep-suite simulated audio (R11.13):'];
  for (const c of s.cells) {
    lines.push(`  ${c.cell.padEnd(40)} trials ${String(c.trials).padStart(4)}  audio ${c.audioSec.toFixed(1).padStart(9)} s`);
  }
  lines.push(`  TOTAL ${s.totalSec.toFixed(1)} s of ${s.capSec} s cap${s.overCap ? '  -> OVER CAP' : ''}`);
  return lines.join('\n');
}
