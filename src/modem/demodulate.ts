// Samples -> symbols: Goertzel tone energies, normalisation, and the decision
// (design.md "Symbol energies"). Timing tracking (SymbolTracker) arrives in task 11.

import { sampleAtMs } from './frame';
import type { Profile } from './profiles';

/** Samples in one analysis window of this profile at this rate. */
export function analysisSamples(profile: Profile, sampleRate: number): number {
  return Math.round((profile.analysisMs * sampleRate) / 1000);
}

/**
 * Absolute sample index where symbol k's analysis window starts. `passStart` is the sample
 * where the pass's first sample landed in the stream; `startMs` is the run's start inside
 * the pass. The guard at the start of each symbol is skipped: room echo from the previous
 * symbol lingers there, and so does our own 2 ms frequency glide.
 */
export function windowStart(passStart: number, shift: number, startMs: number, k: number, profile: Profile, sampleRate: number): number {
  return passStart + shift + sampleAtMs(startMs + k * profile.symbolMs + profile.guardMs, sampleRate);
}

/**
 * Goertzel energy of each tone over the window: how much of the window's energy sits at
 * that one frequency. For a tone at f and a window of N samples it runs the cheap
 * recurrence s[n] = x[n] + 2cos(2πf/fs)·s[n−1] − s[n−2], then reads the energy out as
 * s[N−1]² + s[N−2]² − 2cos(2πf/fs)·s[N−1]·s[N−2]. That equals |DFT bin|² at f, without
 * computing a whole FFT when only a handful of frequencies matter.
 */
export function goertzelEnergies(segment: Float32Array, tonesHz: readonly number[], sampleRate: number): Float64Array {
  const tones = tonesHz.length;
  const coeff = new Float64Array(tones);
  const s1 = new Float64Array(tones);
  const s2 = new Float64Array(tones);
  for (let t = 0; t < tones; t++) coeff[t] = 2 * Math.cos((2 * Math.PI * tonesHz[t]!) / sampleRate);
  for (let n = 0; n < segment.length; n++) {
    const x = segment[n]!;
    for (let t = 0; t < tones; t++) {
      const s0 = x + coeff[t]! * s1[t]! - s2[t]!;
      s2[t] = s1[t]!;
      s1[t] = s0;
    }
  }
  const energy = new Float64Array(tones);
  for (let t = 0; t < tones; t++) energy[t] = s1[t]! * s1[t]! + s2[t]! * s2[t]! - coeff[t]! * s1[t]! * s2[t]!;
  return energy;
}

/**
 * Divide by the total so the vector sums to 1. Received loudness is arbitrary (speaker
 * volume, distance), so only the *shares* between tones mean anything. All zeros stays
 * all zeros.
 */
export function normalizeEnergies(energy: Float64Array): Float64Array {
  let sum = 0;
  for (const e of energy) sum += e;
  const out = new Float64Array(energy.length);
  if (!(sum > 0) || !Number.isFinite(sum)) return out;
  for (let i = 0; i < energy.length; i++) out[i] = energy[i]! / sum;
  return out;
}

export interface SymbolDecision {
  /** Index of the strongest tone (the first one on a tie). */
  readonly tone: number;
  /** 1 − second/best over the normalised energies: 1 for a clean tone, near 0 when two tones tie, 0 when there is no energy. */
  readonly confidence: number;
}

export function decide(normalized: Float64Array): SymbolDecision {
  let best = 0;
  let second = 0;
  let tone = 0;
  for (let i = 0; i < normalized.length; i++) {
    const v = normalized[i]!;
    if (v > best) {
      second = best;
      best = v;
      tone = i;
    } else if (v > second) second = v;
  }
  return { tone, confidence: best > 0 ? 1 - second / best : 0 };
}

/** Normalised tone energies of one analysis window. */
export function readSymbol(segment: Float32Array, profile: Profile, sampleRate: number): Float64Array {
  return normalizeEnergies(goertzelEnergies(segment, profile.tonesHz, sampleRate));
}
