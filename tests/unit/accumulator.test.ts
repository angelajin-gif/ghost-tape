import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AccumulatorStore,
  ALIGNMENT_FALSE_ACCEPT,
  alignmentReading,
  binomialTail,
  decideFromSums,
  dropUnkept,
  isAligned,
  keptSymbols,
  pilotReadsNeeded,
  MAX_TAPES,
  RETENTION_SECONDS,
  type TapeShape,
} from '../../src/modem/accumulator';
import { fcParams } from '../support/runs';

const FS = 48000;
const shape = (tapeId: number, overrides: Partial<TapeShape> = {}): TapeShape => ({ tapeId, profileName: 'standard', payloadLength: 10, symbols: 4, tones: 3, ...overrides });
const ones = (n: number, value = 1): Float64Array => new Float64Array(n).fill(value);

/** A pass of `symbols` symbols over `tones` tones where each symbol is a one-hot vector on the given tone. */
function oneHot(tones: number, picks: readonly number[]): Float64Array {
  const out = new Float64Array(picks.length * tones);
  picks.forEach((tone, i) => (out[i * tones + tone] = 1));
  return out;
}

describe('constants (R6.8, R6.9)', () => {
  it('holds four tapes, keeps evidence for ten minutes, and lets noise through less than once in 1000', () => {
    expect(MAX_TAPES).toBe(4);
    expect(RETENTION_SECONDS).toBe(600);
    expect(ALIGNMENT_FALSE_ACCEPT).toBe(1e-3);
  });
});

describe('binomialTail and pilotReadsNeeded', () => {
  it('match hand-computed binomial values', () => {
    expect(binomialTail(2, 1 / 16, 2)).toBeCloseTo(1 / 256, 12);
    expect(binomialTail(4, 0.25, 4)).toBeCloseTo(1 / 256, 12);
    expect(binomialTail(10, 0.5, 0)).toBe(1);
    expect(binomialTail(10, 0.5, 11)).toBe(0);
    expect(binomialTail(3, 0.5, 2)).toBeCloseTo(0.5, 12); // P(2) + P(3) = 3/8 + 1/8
    expect(binomialTail(5, 0, 1)).toBe(0);
    expect(binomialTail(5, 1, 5)).toBe(1);
  });

  it('needs the reads that chance reaches with probability below 1/1000 (design S9 table)', () => {
    const cases: Array<[number, number, number]> = [
      [3, 1 / 16, 3], [11, 1 / 16, 5], [16, 1 / 16, 6], [20, 1 / 16, 7], [40, 1 / 16, 9],
      [5, 1 / 4, 5], [8, 1 / 4, 7], [16, 1 / 4, 11], [40, 1 / 4, 20],
      [16, 0.3, 12], // colored noise that favours the pilot tone raises the bar
    ];
    for (const [n, p, k] of cases) {
      expect(pilotReadsNeeded(n, p), `${n} pilots at ${p}`).toBe(k);
      expect(binomialTail(n, p, k)).toBeLessThan(1e-3);
      expect(binomialTail(n, p, k - 1)).toBeGreaterThanOrEqual(1e-3);
    }
  });

  it('falls back to every pilot when no count is that unlikely (few pilots)', () => {
    expect(pilotReadsNeeded(2, 1 / 16)).toBe(2); // both by chance: 1 in 256
    expect(pilotReadsNeeded(4, 1 / 4)).toBe(4); // all four by chance: 1 in 256
    expect(pilotReadsNeeded(1, 1 / 16)).toBe(1);
  });

  it('never asks for more reads than there are pilots, and asks for more when chance is higher', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 80 }), fc.double({ min: 0.01, max: 0.9, noNaN: true }), fc.double({ min: 0.01, max: 0.9, noNaN: true }), (n, p, q) => {
        const [lo, hi] = p <= q ? [p, q] : [q, p];
        expect(pilotReadsNeeded(n, lo)).toBeLessThanOrEqual(n);
        expect(pilotReadsNeeded(n, lo)).toBeLessThanOrEqual(pilotReadsNeeded(n, hi));
      }),
      fcParams(50, 500),
    );
  });
});

describe('isAligned: the pilot test (R6.6, adaptive rule S9)', () => {
  // 528 symbols with pilotEvery 32: pilots at 32, 65, 98, ... 527, sixteen of them.
  const symbols = 528;
  const pilots = Array.from({ length: 16 }, (_, j) => 32 + 33 * j);
  /** Data symbols read as tone `dataTone`, except that every `pilotToneEvery`-th data symbol reads as the pilot tone; `pilotsRead` pilots read right. */
  const pass = (tones: number, pilotIndex: number, pilotsRead: number, dataTone = 0, pilotToneEvery = 0): Float64Array => {
    const picks = new Array<number>(symbols).fill(dataTone);
    let d = 0;
    for (let i = 0; i < symbols; i++) {
      if ((i + 1) % 33 === 0) continue;
      if (pilotToneEvery > 0 && d++ % pilotToneEvery === 0) picks[i] = pilotIndex;
    }
    pilots.forEach((i, j) => (picks[i] = j < pilotsRead ? pilotIndex : dataTone));
    return oneHot(tones, picks);
  };

  it('Standard (16 tones), 16 pilots, data at chance: aligned from 6 pilot reads, not 5', () => {
    expect(isAligned(pass(16, 15, 6), symbols, 16, 32, 15)).toBe(true);
    expect(isAligned(pass(16, 15, 5), symbols, 16, 32, 15)).toBe(false);
    expect(isAligned(pass(16, 15, 0), symbols, 16, 32, 15)).toBe(false);
    expect(isAligned(pass(16, 15, 16), symbols, 16, 32, 15)).toBe(true);
  });

  it('Robust (4 tones), 16 pilots: aligned from 11 reads, not 10', () => {
    expect(isAligned(pass(4, 3, 11), symbols, 4, 32, 3)).toBe(true);
    expect(isAligned(pass(4, 3, 10), symbols, 4, 32, 3)).toBe(false);
  });

  /** The same picks as unclear, noise-like decisions: the picked tone 0.3, the next tone 0.2 (confidence 1/3). */
  const soft = (tones: number, hot: Float64Array): Float64Array => {
    const out = new Float64Array(hot.length);
    for (let i = 0; i < hot.length / tones; i++) {
      const t = hot.subarray(i * tones, (i + 1) * tones).indexOf(1);
      for (let k = 0; k < tones; k++) out[i * tones + k] = 0.5 / (tones - 2);
      out[i * tones + t] = 0.3;
      out[i * tones + ((t + 1) % tones)] = 0.2;
    }
    return out;
  };

  it('a clearly heard message that often uses the pilot tone does not raise the bar (content is not chance)', () => {
    // Every 3rd data symbol is the pilot tone, but decided with full confidence: chance stays 1/16.
    const r = alignmentReading(pass(16, 15, 6, 0, 3), symbols, 16, 32, 15);
    expect(r.chance).toBe(1 / 16);
    expect(r.aligned).toBe(true);
  });

  it('when noise-like decisions favour the pilot tone (colored noise), more pilot reads are needed', () => {
    // Pilot tone at every 3rd unclear data decision: chance ≈ 1/3, so 16 pilots need far more than 6 reads.
    const r = alignmentReading(soft(16, pass(16, 15, 10, 0, 3)), symbols, 16, 32, 15);
    expect(r.chance).toBeCloseTo(1 / 3, 2);
    expect(r.needed).toBe(pilotReadsNeeded(16, r.chance));
    expect(r.needed).toBeGreaterThan(10); // 10 reads would be plenty at 1/16 chance (6 needed), not here
    expect(r.pilotReads).toBe(10);
    expect(r.aligned).toBe(false);
    expect(isAligned(soft(16, pass(16, 15, 16, 0, 3)), symbols, 16, 32, 15)).toBe(true);
  });

  it('chance is floored at 1/T: data that never reads the pilot tone does not lower the bar', () => {
    const r = alignmentReading(pass(16, 15, 6, 0), symbols, 16, 32, 15);
    expect(r.chance).toBe(1 / 16);
    expect(r).toMatchObject({ pilots: 16, pilotReads: 6, needed: 6, aligned: true });
  });

  it('keptSymbols: a run is kept when either pilot bounding it was read, dropped when neither was (S9 gating)', () => {
    // Pilots 0..15 at 32 + 33j. Read: all except 4, 5 and 9.
    const picks = new Array<number>(symbols).fill(0);
    pilots.forEach((i, j) => (picks[i] = [4, 5, 9].includes(j) ? 0 : 15));
    const keep = keptSymbols(oneHot(16, picks), symbols, 16, 32, 15);
    const runKept = (r: number): boolean => keep[r * 33 + 5] === 1; // a data symbol inside run r
    expect(runKept(0)).toBe(true); // first run: only pilot 0 after it, read
    expect(runKept(4)).toBe(true); // pilot 3 before it read, pilot 4 after it not: either is enough
    expect(runKept(5)).toBe(false); // pilots 4 and 5 both missed: dropped
    expect(runKept(6)).toBe(true); // pilot 5 missed, pilot 6 read
    expect(runKept(9)).toBe(true);
    expect(runKept(10)).toBe(true);
    // Pilot symbols go with their run.
    expect(keep[pilots[5]!]).toBe(0);
    expect(keep[pilots[6]!]).toBe(1);
    expect(keep.reduce((a, b) => a + b, 0)).toBe(symbols - 33);
  });

  it('keptSymbols: the run after the last pilot follows that pilot; a pass without pilots keeps everything', () => {
    const n = 33 * 2 + 10; // two pilots, then 10 trailing data symbols
    const picks = new Array<number>(n).fill(0);
    picks[32] = 15; // pilot 0 read, pilot 1 (at 65) not
    const keep = keptSymbols(oneHot(16, picks), n, 16, 32, 15);
    expect([...keep.subarray(66)]).toEqual(new Array(10).fill(0)); // trailing run: only pilot 1 before it, missed
    expect(keep[40]).toBe(1); // run 1: pilot 0 before it read
    expect([...keptSymbols(oneHot(16, [1, 2, 3]), 3, 16, 32, 15)]).toEqual([1, 1, 1]);
  });

  it('dropUnkept zeroes exactly the rows that are not kept', () => {
    const pending = Float64Array.of(1, 2, 3, 4, 5, 6);
    dropUnkept(pending, Uint8Array.of(1, 0, 1), 2);
    expect([...pending]).toEqual([1, 2, 0, 0, 5, 6]);
  });

  it('a pass with no energy at all is not aligned, even for a profile whose pilot is tone 0', () => {
    expect(isAligned(new Float64Array(symbols * 16), symbols, 16, 32, 0)).toBe(false);
    expect(isAligned(new Float64Array(symbols * 4), symbols, 4, 32, 0)).toBe(false);
  });

  it('a pass too short to hold a pilot is treated as aligned (nothing to test)', () => {
    expect(isAligned(oneHot(16, [1, 2, 3]), 3, 16, 32, 15)).toBe(true);
  });
});

describe('decideFromSums (R6.7)', () => {
  it('picks the strongest tone with confidence 1 - second/best, and clarity is the mean confidence', () => {
    const sums = Float64Array.of(
      6, 3, 1, // best 6, second 3 -> tone 0, confidence 0.5
      0, 0, 5, // tone 2, confidence 1
      0, 0, 0, // no energy -> tone 0, confidence 0
      2, 2, 0, // tie -> first, confidence 0
    );
    const d = decideFromSums(sums, 4, 3);
    expect([...d.tones]).toEqual([0, 2, 0, 0]);
    expect([...d.confidence]).toEqual([0.5, 1, 0, 0]);
    expect(d.clarity).toBeCloseTo(0.375, 12);
  });

  it('only the shares matter: scaling every sum by any positive factor changes nothing', () => {
    fc.assert(
      // Sums are shares of at most a few passes, never denormal numbers: either exactly 0 or at least 1e-6.
      fc.property(fc.array(fc.oneof(fc.constant(0), fc.double({ min: 1e-6, max: 5, noNaN: true })), { minLength: 12, maxLength: 12 }), fc.double({ min: 0.001, max: 1000, noNaN: true }), (xs, k) => {
        const a = decideFromSums(Float64Array.from(xs), 4, 3);
        const b = decideFromSums(Float64Array.from(xs, (v) => v * k), 4, 3);
        expect([...b.tones]).toEqual([...a.tones]);
        expect(b.clarity).toBeCloseTo(a.clarity, 9);
      }),
      fcParams(50, 1000),
    );
  });
});

describe('AccumulatorStore: adding passes (R6.2)', () => {
  it('creates an accumulator on the first committed pass and adds each later pass to it', () => {
    const store = new AccumulatorStore(FS);
    expect(store.peek(7)).toBeUndefined();
    const first = store.commit(shape(7), Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0), 1, 100);
    expect(first.evicted).toBeUndefined();
    expect([...store.peek(7)!.sums]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0]);
    store.commit(shape(7), Float64Array.of(0, 0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 1, 0, 0), 2, 200);
    const tape = store.peek(7)!;
    expect([...tape.sums]).toEqual([1, 0.5, 0, 0, 1.5, 0, 0, 0, 1.5, 2, 0, 0]);
    expect([tape.passes, tape.received, tape.lastActivity]).toEqual([2, 2, 200]);
  });

  it('the total does not depend on the order passes arrive in', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 12, maxLength: 12 }), { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 1e6 }), (passes, seed) => {
        const forward = new AccumulatorStore(FS);
        passes.forEach((p, i) => forward.commit(shape(1), Float64Array.from(p), i + 1, i));
        const order = passes.map((_, i) => i).sort((a, b) => ((a * 7919 + seed) % 101) - ((b * 7919 + seed) % 101));
        const shuffled = new AccumulatorStore(FS);
        order.forEach((idx, i) => shuffled.commit(shape(1), Float64Array.from(passes[idx]!), i + 1, i));
        const a = forward.peek(1)!.sums;
        const b = shuffled.peek(1)!.sums;
        for (let k = 0; k < a.length; k++) expect(b[k]).toBeCloseTo(a[k]!, 12);
      }),
      fcParams(50, 1000),
    );
  });

  it('adding passes widens the margin of the right tone: the property combining rests on', () => {
    // Each observation: the true tone (index 2) holds a share around 0.4, the rest is noise spread over all tones.
    let seed = 12345;
    const rand = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const observe = (): Float64Array => {
      const v = Float64Array.from({ length: 8 }, () => rand());
      v[2]! += 0.8;
      const total = v.reduce((a, b) => a + b, 0);
      return v.map((x) => x / total);
    };
    const meanMargin = (passes: number): number => {
      let sum = 0;
      for (let trial = 0; trial < 200; trial++) {
        const sums = new Float64Array(8);
        for (let p = 0; p < passes; p++) observe().forEach((x, i) => (sums[i]! += x));
        const sorted = [...sums].sort((a, b) => b - a);
        sum += 1 - sorted[1]! / sorted[0]!; // confidence
      }
      return sum / 200;
    };
    const margins = [1, 2, 4, 8].map(meanMargin);
    for (let i = 1; i < margins.length; i++) expect(margins[i]!).toBeGreaterThan(margins[i - 1]!);
  });

  it('replaces, rather than mixes, an accumulator whose shape differs (a tapeId collision)', () => {
    const store = new AccumulatorStore(FS);
    store.commit(shape(9), ones(12), 1, 10);
    store.commit(shape(9, { payloadLength: 99 }), ones(12, 2), 1, 20);
    const tape = store.peek(9)!;
    expect([tape.payloadLength, tape.passes, tape.sums[0]]).toEqual([99, 1, 2]);
    expect(store.size).toBe(1);
  });
});

describe('AccumulatorStore: four tapes, oldest activity evicted (R6.9, R6.10)', () => {
  it('a fifth tape evicts exactly the one whose last activity is oldest', () => {
    const store = new AccumulatorStore(FS);
    [10, 20, 30, 40].forEach((t, i) => store.commit(shape(i + 1), ones(12), 1, t));
    const result = store.commit(shape(5), ones(12), 1, 50);
    expect(result.evicted).toBe(1);
    expect(store.held()).toEqual([2, 3, 4, 5]);
    expect(store.size).toBe(4);
  });

  it('activity, not arrival order, decides: a tape that was added to again is not the oldest', () => {
    const store = new AccumulatorStore(FS);
    [10, 20, 30, 40].forEach((t, i) => store.commit(shape(i + 1), ones(12), 1, t));
    store.commit(shape(1), ones(12), 2, 45); // tape 1 is active again
    expect(store.commit(shape(5), ones(12), 1, 50).evicted).toBe(2);
    expect(store.peek(1)).toBeDefined();
  });

  it('a repeat of a complete tape counts as activity (R8.17)', () => {
    const store = new AccumulatorStore(FS);
    [10, 20, 30, 40].forEach((t, i) => store.commit(shape(i + 1), ones(12), 1, t));
    store.noteRepeat(1, 2, 45);
    expect(store.peek(1)!.received).toBe(2);
    expect(store.commit(shape(5), ones(12), 1, 50).evicted).toBe(2);
  });

  it('with equal activity the earlier-held tape goes first (a fixed, repeatable tie-break)', () => {
    const store = new AccumulatorStore(FS);
    [1, 2, 3, 4].forEach((id) => store.commit(shape(id), ones(12), 1, 10));
    expect(store.commit(shape(5), ones(12), 1, 10).evicted).toBe(1);
  });

  it('adding to a tape that is already held never evicts anything, even when full', () => {
    const store = new AccumulatorStore(FS);
    [1, 2, 3, 4].forEach((id) => store.commit(shape(id), ones(12), 1, id));
    expect(store.commit(shape(3), ones(12), 2, 99).evicted).toBeUndefined();
    expect(store.size).toBe(4);
  });
});

describe('AccumulatorStore: retention in audio time (R6.8)', () => {
  it('keeps a tape while less than ten minutes have passed since its last activity, drops it at ten', () => {
    const store = new AccumulatorStore(FS);
    store.commit(shape(1), ones(12), 1, 1000);
    expect(store.expire(1000 + 600 * FS - 1)).toEqual([]);
    expect(store.peek(1)).toBeDefined();
    expect(store.expire(1000 + 600 * FS)).toEqual([1]);
    expect(store.peek(1)).toBeUndefined();
  });

  it('retention is counted from the latest activity, so a repeat extends it', () => {
    const store = new AccumulatorStore(FS);
    store.commit(shape(1), ones(12), 1, 0);
    store.noteRepeat(1, 2, 500 * FS);
    expect(store.expire(1000 * FS)).toEqual([]); // 500 s since the repeat
    expect(store.expire(1100 * FS)).toEqual([1]); // 600 s since the repeat
  });

  it('the length of retention follows the sample rate and can be shortened for tests', () => {
    const store = new AccumulatorStore(16000, 30);
    store.commit(shape(1), ones(12), 1, 0);
    expect(store.expire(30 * 16000 - 1)).toEqual([]);
    expect(store.expire(30 * 16000)).toEqual([1]);
  });

  it('only the stale tapes go', () => {
    const store = new AccumulatorStore(FS);
    store.commit(shape(1), ones(12), 1, 0);
    store.commit(shape(2), ones(12), 1, 400 * FS);
    expect(store.expire(700 * FS)).toEqual([1]);
    expect(store.held()).toEqual([2]);
  });
});

describe('AccumulatorStore: reset and repeats (R6.11, R8.17)', () => {
  it('clear forgets accumulators and completed tapes alike', () => {
    const store = new AccumulatorStore(FS);
    store.commit(shape(1), ones(12), 1, 0);
    store.peek(1)!.completed = { kind: 'ghost', message: 'hi' };
    store.commit(shape(2), ones(12), 1, 0);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.peek(1)).toBeUndefined();
  });

  it('noteRepeat on an unknown tape does nothing', () => {
    const store = new AccumulatorStore(FS);
    store.noteRepeat(42, 3, 100);
    expect(store.size).toBe(0);
  });
});
