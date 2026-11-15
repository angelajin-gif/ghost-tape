import { describe, expect, it } from 'vitest';
import { BUDGET_CAP_SEC, formatSummary, lowerBound95, parseLedger, summarize } from '../support/budget';

describe('deep-suite budget ledger (R11.13)', () => {
  it('caps at 15,000 s', () => {
    expect(BUDGET_CAP_SEC).toBe(15_000);
  });

  it('sums audio and trials per cell and in total', () => {
    const s = summarize([
      { cell: 'R5.1 standard', audioSec: 39.1, trials: 0 },
      { cell: 'R5.1 standard', audioSec: 0, trials: 1 },
      { cell: 'R5.1 robust', audioSec: 71.9, trials: 1 },
    ]);
    expect(s.totalSec).toBeCloseTo(111.0, 9);
    expect(s.overCap).toBe(false);
    expect(s.cells).toEqual([
      { cell: 'R5.1 robust', audioSec: 71.9, trials: 1 },
      { cell: 'R5.1 standard', audioSec: 39.1, trials: 1 },
    ]);
  });

  it('flags a total above the cap, and not one exactly at the cap', () => {
    expect(summarize([{ cell: 'x', audioSec: 15_000, trials: 0 }]).overCap).toBe(false);
    expect(summarize([{ cell: 'x', audioSec: 15_000.1, trials: 0 }]).overCap).toBe(true);
  });

  it('computes the 95% lower bound for a cell where all n trials passed: 0.05^(1/n)', () => {
    expect(lowerBound95(10)).toBeCloseTo(0.741, 3);
    expect(lowerBound95(6)).toBeCloseTo(0.607, 3);
    expect(lowerBound95(60)).toBeCloseTo(0.951, 3);
    expect(lowerBound95(0)).toBe(0);
    expect(formatSummary(summarize([{ cell: 'x', audioSec: 1, trials: 10 }]))).toContain('95% bound if all pass  74%');
  });

  it('parses JSON lines and ignores blank lines', () => {
    const text = '{"cell":"a","audioSec":1,"trials":0}\n\n{"cell":"a","audioSec":0,"trials":1}\n';
    expect(summarize(parseLedger(text)).cells).toEqual([{ cell: 'a', audioSec: 1, trials: 1 }]);
  });

  it('reports the total and marks an over-cap run', () => {
    const text = formatSummary(summarize([{ cell: 'x', audioSec: 20_000, trials: 2 }]));
    expect(text).toContain('TOTAL 20000.0 s of 15000 s cap');
    expect(text).toContain('OVER CAP');
  });
});
