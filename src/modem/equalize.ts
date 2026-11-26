// Per-tone equalization (task 16, decoder only; off by default until real-room data decide).
//
// Why: in a room, the direct sound and its echoes add up differently at each frequency. At some
// frequencies they nearly cancel, so one tone of the alphabet can arrive 10–20 dB weaker than the
// others for the whole pass (frequency-selective fading). The decision "strongest tone wins" then
// fails on that tone: the echo of the previous symbol, or noise, outshouts it. In the simulator,
// 74–88% of the errors in failed headers were on one sent tone (design "Task 14 measurements").
//
// The fix is to learn each tone's gain in this room and divide it out before deciding. The gain is
// steady over a pass (the speaker, the mic and the room do not move much in 30 s), so it can be
// estimated from symbols whose tone is known: the sync notes (each Robust tone twice), and symbols
// decided clearly (decision-directed). Divide every tone's energy by its gain, then decide again.
//
// Rows are symbols, columns tones, symbol-major, as everywhere in the decoder. Energies are raw
// (not normalized): only ratios between tones matter, so any common scale is fine.

import { decide } from './demodulate';

/** A decision this clear is trusted to say which tone was sent (confidence 1 − second/best). */
export const EQ_MIN_CONFIDENCE = 0.5;
/** Fewer trusted samples than this for a tone: its gain is not estimated, the median of the others is used. */
export const EQ_MIN_SAMPLES = 3;
/** Gains are clamped to this range around their mean: a tone 30 dB down is dead, not worth boosting into noise. */
export const EQ_MAX_RATIO = 1000;

/** Mean energy of tone t over the rows known (or decided) to carry tone t. NaN where there are none. */
export function gainsFromKnown(energies: Float64Array, tones: number, sent: ArrayLike<number>): Float64Array {
  const sum = new Float64Array(tones);
  const count = new Float64Array(tones);
  for (let i = 0; i < sent.length; i++) {
    const t = sent[i]!;
    if (t < 0 || t >= tones) continue;
    const e = energies[i * tones + t]!;
    if (!(e > 0) || !Number.isFinite(e)) continue;
    sum[t]! += e;
    count[t]!++;
  }
  return sum.map((s, t) => (count[t]! > 0 ? s / count[t]! : Number.NaN));
}

/**
 * Decision-directed gains: for each row decided with confidence ≥ EQ_MIN_CONFIDENCE (after the
 * gains in `prior`, if given), its energy on the decided tone. Tones with fewer than EQ_MIN_SAMPLES
 * such rows fall back to `prior`, or to the median of the estimated ones.
 */
export function decisionGains(energies: Float64Array, symbols: number, tones: number, prior?: Float64Array): Float64Array {
  const decided: number[] = [];
  const counts = new Array<number>(tones).fill(0);
  const row = new Float64Array(tones);
  for (let i = 0; i < symbols; i++) {
    for (let t = 0; t < tones; t++) row[t] = energies[i * tones + t]! / (prior && prior[t]! > 0 ? prior[t]! : 1);
    const d = decide(normalized(row));
    if (d.confidence >= EQ_MIN_CONFIDENCE && row[d.tone]! > 0) {
      decided.push(d.tone);
      counts[d.tone]!++;
    } else decided.push(-1);
  }
  const raw = gainsFromKnown(energies, tones, decided);
  for (let t = 0; t < tones; t++) if (counts[t]! < EQ_MIN_SAMPLES) raw[t] = prior && prior[t]! > 0 ? prior[t]! : Number.NaN;
  return finish(raw);
}

/** Fill unknown gains with the median of the known ones, scale to mean 1, clamp. All unknown: all 1. */
export function finish(gains: Float64Array): Float64Array {
  const known = [...gains].filter((g) => g > 0 && Number.isFinite(g)).sort((a, b) => a - b);
  if (known.length === 0) return new Float64Array(gains.length).fill(1);
  const median = known[Math.floor(known.length / 2)]!;
  const filled = gains.map((g) => (g > 0 && Number.isFinite(g) ? g : median));
  const mean = filled.reduce((a, b) => a + b, 0) / filled.length;
  return filled.map((g) => Math.min(EQ_MAX_RATIO, Math.max(1 / EQ_MAX_RATIO, g / mean)));
}

/** Divide each tone's energy by its gain, in place. */
export function applyGains(energies: Float64Array, tones: number, gains: Float64Array): void {
  for (let i = 0; i < energies.length; i++) energies[i]! /= gains[i % tones]!;
}

/** Shares summing to 1 (all zeros stays all zeros). */
function normalized(row: Float64Array): Float64Array {
  let sum = 0;
  for (const v of row) sum += v;
  return sum > 0 ? row.map((v) => v / sum) : row.slice();
}
