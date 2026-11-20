import { describe, expect, it } from 'vitest';
import { damagePasses, surroundingAudio, rms } from '../../src/modem/channel';
import { createDecoder, decodeFile } from '../../src/modem/decoder';
import type { DecoderEvent, Ghost } from '../../src/modem/types';
import { recordReport } from '../support/budget';
import { decodeCounted, encodeOrThrow, losePayloadPart, payloadSpan, runInChunks } from '../support/decode';
import { concat } from '../support/random';
import { fcParams, isDeep } from '../support/runs';
import { tapeOfSize } from '../support/tapes';

const FS = 48000;
const CELL = 'accumulator decoder tests';
const ghost = (message: string): Ghost => ({ kind: 'ghost', message });
const run = (samples: Float32Array, options: { retentionSeconds?: number } = {}): DecoderEvent[] => runInChunks(createDecoder({ sampleRate: FS, ...options }), samples, [8192], CELL, FS);
/** Event types in order, without `progress` (tested in decoder.prop.test.ts, P23). */
const types = (events: DecoderEvent[]): string[] => events.filter((e) => e.type !== 'progress').map((e) => e.type);
const passNumbers = (events: DecoderEvent[]): number[] => events.filter((e): e is Extract<DecoderEvent, { type: 'header' }> => e.type === 'header').map((e) => e.pass);
/** Where in the stream each event happened is not part of the comparison, only what the decoder concluded. */
const withoutPositions = (events: DecoderEvent[]): unknown[] => events.map((e) => (e.type === 'signal-detected' ? { type: e.type } : e));
/** The events from the n-th (0-based) `signal-detected` on. */
const fromDetection = (events: DecoderEvent[], n: number): DecoderEvent[] => {
  let seen = -1;
  const at = events.findIndex((e) => e.type === 'signal-detected' && ++seen === n);
  return at < 0 ? [] : events.slice(at);
};
const gap = (seconds: number): Float32Array => new Float32Array(Math.round(seconds * FS));

describe('combining passes (R3.4, R6.2, R6.7)', () => {
  const payload = ghost('Two halves make a whole.');
  const clean = encodeOrThrow(payload, 'standard', FS);
  const span = payloadSpan(payload, 'standard', FS);
  // Pass A keeps only the last 48% of its payload, pass B only the first 52%: neither can be read alone.
  const passA = losePayloadPart(clean, span, 0, 0.52);
  const passB = losePayloadPart(clean, span, 0.48, 1, 2);
  const stream = concat(passA, gap(1), passB);

  it('neither pass decodes alone, but the two together give the tape (and the second reports passesUsed 2)', () => {
    expect(decodeCounted(CELL, passA, FS).ok).toBe(false);
    expect(decodeCounted(CELL, passB, FS).ok).toBe(false);
    const events = run(stream);
    expect(types(events)).toEqual(['signal-detected', 'header', 'pass-complete', 'signal-detected', 'header', 'pass-complete', 'complete']);
    const [first, second] = events.filter((e): e is Extract<DecoderEvent, { type: 'pass-complete' }> => e.type === 'pass-complete');
    expect(first!.blocksRecovered).toBe(0);
    expect(second!.blocksRecovered).toBe(second!.blocksTotal);
    expect(events.at(-1)).toMatchObject({ type: 'complete', passesUsed: 2, payload });
    expect(passNumbers(events)).toEqual([1, 2]);
  });

  it('a file with several passes is combined by decodeFile (R3.4)', () => {
    expect(decodeCounted(CELL, stream, FS)).toEqual({ ok: true, payload, passesUsed: 2 });
  });

  it('the clarity reported after the second pass is higher: the evidence has grown (R6.7)', () => {
    const [first, second] = run(stream).filter((e): e is Extract<DecoderEvent, { type: 'pass-complete' }> => e.type === 'pass-complete');
    expect(second!.clarity).toBeGreaterThan(first!.clarity);
  });
});

describe('P15b: a fresh decoder given passes 1..N matches the first N passes of a longer stream (R6.3)', () => {
  const payload = ghost('Prefix property check.');
  const single = encodeOrThrow(payload, 'standard', FS);
  const total = 5;
  const cases = isDeep ? [{ seed: 11, n: 2 }, { seed: 12, n: 4 }, { seed: 13, n: 3 }] : [{ seed: 11, n: 2 }];

  it.each(cases)('seed $seed, N = $n', ({ seed, n }) => {
    // Noisy enough (−9 dB) that single passes sometimes fail, so there is something to combine.
    const long = damagePasses(Array.from({ length: total }, () => single), FS, { noiseSnrDb: -9 }, seed);
    const cutoff = n * (single.length + FS) - FS / 2;
    const prefix = long.slice(0, n * single.length + (n - 1) * FS);
    const full = run(long);
    const firstN: DecoderEvent[] = [];
    for (const e of full) {
      if (e.type === 'signal-detected' && e.atSample >= cutoff) break;
      firstN.push(e);
    }
    expect(run(prefix)).toEqual(firstN);
    expect(firstN.length).toBeGreaterThan(0);
  });
});

describe('P20: separate plays combine like consecutive passes (R6.1, R6.8)', () => {
  const payload = ghost('Heard in two sittings.');
  const clean = encodeOrThrow(payload, 'standard', FS);
  const span = payloadSpan(payload, 'standard', FS);
  const passA = losePayloadPart(clean, span, 0, 0.52);
  const passB = losePayloadPart(clean, span, 0.48, 1, 2);

  it('25 s of unrelated audio between the passes changes nothing about what the decoder concludes', () => {
    const consecutive = run(concat(passA, gap(1), passB));
    for (const kind of ['chords', 'speech', 'noise'] as const) {
      const between = surroundingAudio(kind, 25 * FS, rms(clean), FS, 7);
      const separate = run(concat(passA, between, passB));
      expect(withoutPositions(separate), kind).toEqual(withoutPositions(consecutive));
    }
  });
});

describe('P22: what the store keeps, and what it does not (R6.5, R6.6, R6.8–R6.11)', () => {
  const incomplete = (message: string): Float32Array => {
    const payload = ghost(message);
    return losePayloadPart(encodeOrThrow(payload, 'standard', FS), payloadSpan(payload, 'standard', FS), 0, 0.6);
  };

  it('a pass that is discarded leaves everything exactly as if it never came', () => {
    const payload = ghost('Discard leaves no trace.');
    const clean = encodeOrThrow(payload, 'standard', FS);
    const span = payloadSpan(payload, 'standard', FS);
    const passA = losePayloadPart(clean, span, 0, 0.52, 1);
    const passB = losePayloadPart(clean, span, 0.48, 1, 2);
    const drowned = losePayloadPart(clean, span, 0, 1, 3); // header fine, payload all noise: its pilots are not read, so it is not aligned
    const withDiscard = run(concat(passA, gap(1), drowned, gap(1), passB));
    const without = run(concat(passA, gap(1), passB));
    expect(types(withDiscard)).toEqual(['signal-detected', 'header', 'pass-complete', 'signal-detected', 'header', 'pass-discarded', 'signal-detected', 'header', 'pass-complete', 'complete']);
    expect(withDiscard.find((e) => e.type === 'pass-discarded')).toEqual({ type: 'pass-discarded', reason: 'alignment-failed' });
    // What the second real pass reports is identical, down to the pass number, every provisional byte and the clarity.
    expect(withoutPositions(fromDetection(withDiscard, 2))).toEqual(withoutPositions(fromDetection(without, 1)));
    expect(passNumbers(withDiscard)).toEqual([1, 2, 2]);
  });

  it('a fifth tape evicts the one with the oldest activity; the others are kept (R6.9, R6.10)', () => {
    const tapes = [1, 2, 3, 4, 5].map((i) => incomplete(`Tape number ${i} here.`));
    // Each tape once (all incomplete, so all held), then tape 2 and tape 1 again.
    const stream = concat(...tapes.flatMap((t) => [t, gap(1)]), tapes[1]!, gap(1), tapes[0]!);
    const numbers = passNumbers(run(stream));
    expect(numbers.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(numbers[5]).toBe(2); // tape 2 is still held
    expect(numbers[6]).toBe(1); // tape 1 was the oldest when tape 5 arrived, so it was evicted
  });

  it('evidence is dropped once retention has passed in audio time, and kept before (30 s retention here)', () => {
    const tape = incomplete('Time passes quietly.');
    const stream = concat(tape, gap(20), tape, gap(31), tape);
    expect(passNumbers(run(stream, { retentionSeconds: 30 }))).toEqual([1, 2, 1]);
    expect(passNumbers(run(stream, { retentionSeconds: 600 }))).toEqual([1, 2, 3]); // the default keeps all three
  });

  it('reset() clears accumulators, so the next pass starts again at pass 1 (R6.11)', () => {
    const tape = incomplete('Reset forgets.');
    const d = createDecoder({ sampleRate: FS });
    runInChunks(d, tape, [8192], CELL, FS);
    const before = runInChunks(d, tape, [8192], CELL, FS);
    expect(passNumbers(before)).toEqual([2]);
    d.reset();
    expect(passNumbers(runInChunks(d, tape, [8192], CELL, FS))).toEqual([1]);
  });

  it('a repeat of a complete tape is "already received" and keeps the tape fresh for retention (R8.17)', () => {
    const payload = ghost('Repeat then retain.');
    const clean = encodeOrThrow(payload, 'standard', FS);
    // A pass lasts about 8 s, so with 15 s of quiet the passes start about 23 s apart: each is inside the 30 s of
    // retention counted from the previous one, but the third starts about 46 s after the first. It is still
    // recognised only because the repeat in the middle counted as activity.
    const stream = concat(clean, gap(15), clean, gap(15), clean);
    const events = run(stream, { retentionSeconds: 30 });
    expect(types(events).filter((t) => t === 'complete')).toHaveLength(1);
    expect(types(events).filter((t) => t === 'already-received')).toHaveLength(2);
    expect(passNumbers(events)).toEqual([1, 2, 3]);
  });
});

describe('R6.3 / R6.4 regression cell: more passes decode at least as many tapes (design S7)', () => {
  // The full experiment (30 + 10 + 10 seeds, 5 passes) is `npm run measure:passes`, outside the audio cap.
  // This cell keeps a few seeds in the suite so a regression in combining shows up here. At −9 dB one
  // pass decoded 0 of 30 tapes in that experiment and two passes decoded 30 of 30, so the cell can also
  // ask for the R6.4 gain (20 points more with 3 passes than with 1) and still essentially never flake.
  it('at −9 dB, 560 B tapes, 3 passes: more passes never decode fewer tapes, and 3 passes beat 1 by 20 points', () => {
    const seeds = isDeep ? 6 : 2;
    const successAfter = [0, 0, 0];
    for (let s = 0; s < seeds; s++) {
      const rate = s % 2 === 0 ? 44100 : 48000;
      const payload = tapeOfSize(560, 700 + s);
      const pass = encodeOrThrow(payload, 'standard', rate);
      const damaged = damagePasses([pass, pass, pass], rate, { noiseSnrDb: -9 }, 900 + s);
      const events = runInChunks(createDecoder({ sampleRate: rate }), damaged, [8192], 'R6.3 regression cell', rate);
      let passIndex = -1;
      for (const e of events) {
        if (e.type === 'signal-detected') passIndex = Math.round(e.atSample / (pass.length + rate));
        if (e.type === 'complete') {
          expect(e.payload, 'decoded a WRONG payload').toEqual(payload);
          for (let n = passIndex; n < 3; n++) successAfter[n]!++;
        }
      }
    }
    recordReport('R6.3 / R6.4 regression cell: Standard 560 B, −9 dB, 3 passes', [`${seeds} seeds; tapes complete after pass 1: ${successAfter[0]}, after pass 2: ${successAfter[1]}, after pass 3: ${successAfter[2]}`]);
    expect(successAfter[1]!).toBeGreaterThanOrEqual(successAfter[0]!);
    expect(successAfter[2]!).toBeGreaterThanOrEqual(successAfter[1]!);
    expect(successAfter[2]!).toBeGreaterThanOrEqual(successAfter[0]! + Math.ceil(0.2 * seeds));
  });
});

describe('decodeFile still reports a failure honestly when combining cannot help', () => {
  it('two passes that are both silent in the same place stay undeveloped', () => {
    const payload = ghost('Same hole twice.');
    const clean = encodeOrThrow(payload, 'standard', FS);
    const span = payloadSpan(payload, 'standard', FS);
    const lost = losePayloadPart(clean, span, 0.1, 0.9);
    const r = decodeCounted(CELL, concat(lost, gap(1), lost), FS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not yet developed/);
  });

  it('decodeFile of a single clean pass is unchanged by combining: passesUsed 1', () => {
    const payload = ghost('One pass is enough.');
    expect(decodeFile(encodeOrThrow(payload, 'standard', FS), FS)).toEqual({ ok: true, payload, passesUsed: 1 });
  });
});

void fcParams;
