// Per-tone equalization (src/modem/equalize.ts, decoder option `equalize`): the gain estimates,
// and that dividing them out repairs a faded tone without changing anything on a flat channel.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDecoder } from '../../src/modem/decoder';
import { decide } from '../../src/modem/demodulate';
import { applyGains, decisionGains, EQ_MAX_RATIO, finish, gainsFromKnown } from '../../src/modem/equalize';
import type { DecoderEvent, Payload } from '../../src/modem/types';
import { encodeOrThrow, runInChunks } from '../support/decode';
import { fcParams } from '../support/runs';

const T = 4;
/**
 * Rows for the given sent tones: the sent tone at its channel gain, plus a small floor on every tone,
 * plus the previous symbol's tone lingering at `echo` times its own gain. The echo scaling with the
 * tone's gain is an assumption (a tone that fades also has a faded echo); a real room may differ,
 * and then equalization also boosts the echo of the faded tone (design note, task 16).
 */
function rows(sent: readonly number[], gains: readonly number[], floor = 0.001, echo = 0): Float64Array {
  const out = new Float64Array(sent.length * T).fill(floor);
  sent.forEach((t, i) => {
    out[i * T + t]! += gains[t]!;
    if (echo > 0 && i > 0) out[i * T + sent[i - 1]!]! += echo * gains[sent[i - 1]!]!;
  });
  return out;
}
const decisions = (energies: Float64Array): number[] =>
  Array.from({ length: energies.length / T }, (_, i) => {
    const r = energies.subarray(i * T, (i + 1) * T);
    let sum = 0;
    for (const v of r) sum += v;
    return decide(r.map((v) => v / sum)).tone;
  });
const gainsArb = fc.array(fc.double({ min: 0.05, max: 5, noNaN: true }), { minLength: T, maxLength: T });
const sentArb = fc.array(fc.integer({ min: 0, max: T - 1 }), { minLength: 40, maxLength: 120 });

describe('gain estimates', () => {
  it('gainsFromKnown recovers each tone gain from rows whose tone is known (up to the common floor)', () => {
    fc.assert(
      fc.property(gainsArb, sentArb, (gains, sent) => {
        const g = gainsFromKnown(rows(sent, gains, 0), T, sent);
        for (let t = 0; t < T; t++) {
          if (sent.includes(t)) expect(g[t]).toBeCloseTo(gains[t]!, 9);
          else expect(Number.isNaN(g[t])).toBe(true);
        }
      }),
      fcParams(50, 500),
    );
  });

  it('finish scales to mean 1, fills unknown tones with the median of the known ones, and clamps', () => {
    expect([...finish(Float64Array.of(1, 2, 3, Number.NaN))]).toEqual([0.5, 1, 1.5, 1]);
    expect([...finish(Float64Array.of(Number.NaN, Number.NaN))]).toEqual([1, 1]);
    const clamped = finish(Float64Array.of(1e-9, 1, 1, 1));
    expect(clamped[0]).toBe(1 / EQ_MAX_RATIO);
  });

  it('decisionGains on a clean channel tracks the true gains (ratios), with or without a prior', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0.3, max: 3, noNaN: true }), { minLength: T, maxLength: T }), sentArb, (gains, sent) => {
        fc.pre([0, 1, 2, 3].every((t) => sent.filter((s) => s === t).length >= 3));
        const g = decisionGains(rows(sent, gains), sent.length, T);
        const mean = gains.reduce((a, b) => a + b, 0) / T;
        for (let t = 0; t < T; t++) expect(g[t]! / (gains[t]! / mean)).toBeCloseTo(1, 1);
      }),
      fcParams(50, 300),
    );
  });
});

describe('dividing the gains out', () => {
  it('repairs a faded tone that the echo of the previous symbol outshouts (the simulator failure mode)', () => {
    // Tone 2 arrives at 5% of the others; the previous symbol lingers at 10% of its own level. Without
    // equalization a symbol on tone 2 that follows another tone is decided as that other tone.
    const sent = Array.from({ length: 80 }, (_, i) => (i * 7 + (i >> 2)) % T);
    const gains = [1, 1, 0.05, 1];
    const raw = rows(sent, gains, 0.001, 0.1);
    const before = decisions(raw);
    const wrongBefore = before.filter((t, i) => t !== sent[i]).length;
    expect(wrongBefore).toBeGreaterThan(10);
    // The sync notes (each tone twice, no echo between identical neighbours in this toy) give the prior.
    const syncSent = [0, 3, 0, 3, 1, 2, 1, 2];
    const prior = finish(gainsFromKnown(rows(syncSent, gains), T, syncSent));
    const eq = raw.slice();
    applyGains(eq, T, decisionGains(raw, sent.length, T, prior));
    const wrongAfter = decisions(eq).filter((t, i) => t !== sent[i]).length;
    expect(wrongAfter).toBeLessThan(wrongBefore / 4);
  });

  it('is scale-free: multiplying every energy by any positive factor changes no decision after equalizing', () => {
    fc.assert(
      fc.property(gainsArb, sentArb, fc.double({ min: 1e-6, max: 1e6, noNaN: true }), (gains, sent, scale) => {
        const raw = rows(sent, gains, 0.01, 0.05);
        const scaled = raw.map((v) => v * scale);
        const a = raw.slice();
        const b = scaled.slice();
        applyGains(a, T, decisionGains(raw, sent.length, T));
        applyGains(b, T, decisionGains(scaled, sent.length, T));
        expect(decisions(b)).toEqual(decisions(a));
      }),
      fcParams(50, 300),
    );
  });
});

describe('decoder option `equalize` on a perfect channel', () => {
  const FS = 48000;
  const cases: Array<[Payload, string]> = [
    [{ kind: 'ghost', message: 'Equalized and still the same.' }, 'standard'],
    [{ kind: 'ghost', message: 'Robust, equalized.' }, 'robust'],
  ];
  it.each(cases)('gives the same tape and the same events as without it (%#)', (payload, profile) => {
    const track = encodeOrThrow(payload, profile, FS);
    const run = (equalize: boolean): DecoderEvent[] => runInChunks(createDecoder({ sampleRate: FS, equalize }), track, [8192], 'equalize tests', FS);
    const on = run(true);
    expect(on.find((e) => e.type === 'complete')).toMatchObject({ payload });
    const types = (events: DecoderEvent[]): string[] => events.filter((e) => e.type !== 'progress').map((e) => e.type);
    expect(types(on)).toEqual(types(run(false)));
  });
});
