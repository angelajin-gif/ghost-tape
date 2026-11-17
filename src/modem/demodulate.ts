// Samples -> symbols: Goertzel tone energies, normalisation, the decision, and the timing
// tracker that keeps the analysis windows on the symbols when the receiver's clock is a little
// fast or slow (design.md "Symbol energies", "Timing tracking").

import { sampleAtMs } from './frame';
import { GLIDE_MS, renderSymbolRun } from './modulate';
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

// ---------- timing tracking ----------
//
// If the receiver's clock runs a little fast or slow, symbols arrive early or late by an amount
// that grows steadily: 0.2% of a 66 s pass is 132 ms, several whole symbols. The analysis windows
// have to follow. Two parts:
//
//  1. An early/late GATE per profile. For a symbol whose tone has been decided, measure that
//     tone's energy in one window shifted earlier and one shifted later than the current window.
//     If the window sits late, the late probe has slid off the end of the symbol and loses
//     energy; if early, the early probe loses it. The log of the energy ratio therefore tells how
//     late the window is. How the ratio maps to a lateness depends on the profile (Standard has a
//     flat top about 5 ms wide, Robust a broad bell), so the mapping is learned, not assumed: the
//     gate renders a few reference symbols with the real modulator and measures the curve.
//
//  2. A CLOCK TRACKER, an alpha-beta filter. Each gate reading nudges the estimated offset
//     (alpha) and the estimated drift per sample (beta). Once the drift is known the windows move
//     along the ramp by themselves, so a steady clock error costs nothing.

/** Goertzel energy of one tone (the single-tone case of goertzelEnergies). */
export function goertzelEnergy(segment: Float32Array, freqHz: number, sampleRate: number): number {
  const coeff = 2 * Math.cos((2 * Math.PI * freqHz) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let n = 0; n < segment.length; n++) {
    const s0 = segment[n]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

const GATE_GRID_MS = 0.5;
/** Probes sit where the decided tone's energy has fallen to this share of its value at the target position. */
const GATE_PROBE_LEVEL = 0.85;
const GATE_MAX_PROBE_MS = 18;
/** The gate reads lateness within ± this many ms of the target position. */
const GATE_RANGE_MS = 12;
/** Windows are kept this far before the nominal alignment (but never into the glide): clear of the late edge, where spill from the next symbol begins. */
const TARGET_BEFORE_NOMINAL_MS = 1.5;
const CALIBRATION_SYMBOLS = 40;

export interface Gate {
  /** Samples added to every nominal window start: where windows are kept (negative = earlier than nominal). */
  readonly targetShift: number;
  /** Samples before / after the window start at which the two probe windows begin. */
  readonly earlyProbe: number;
  readonly lateProbe: number;
  /** False when the profile's symbols show no measurable timing edge, so the gate would only add noise. */
  readonly usable: boolean;
  /** Lateness in samples (positive = windows too late) that best explains a measured ln(E_late / E_early). */
  latenessOf(logRatio: number): number;
}

const gateCache = new Map<string, Gate>();

/**
 * Learn a profile's gate (cached). Reference symbols with deterministic tones, consecutive ones
 * always different, are rendered by the real modulator; the decided tone's energy is measured at
 * many window shifts and averaged over the symbols. From that curve: where the probes go, and
 * the table that turns a measured ratio back into a lateness.
 */
export function calibrateGate(profile: Profile, sampleRate: number): Gate {
  const key = `${profile.name}|${profile.id}|${profile.tonesHz.join(',')}|${profile.symbolMs}|${profile.guardMs}|${profile.analysisMs}|${profile.envelope}|${sampleRate}`;
  const cached = gateCache.get(key);
  if (cached) return cached;

  const toneCount = profile.tonesHz.length;
  const tones = new Uint8Array(CALIBRATION_SYMBOLS);
  for (let k = 1; k < CALIBRATION_SYMBOLS; k++) tones[k] = (tones[k - 1]! + 1 + ((k * 5) % Math.max(1, toneCount - 1))) % toneCount; // never repeats the previous tone
  const signal = renderSymbolRun(tones, profile, sampleRate);
  const length = analysisSamples(profile, sampleRate);
  const samplesOf = (ms: number): number => Math.round((ms * sampleRate) / 1000);
  const first = 6;
  const last = CALIBRATION_SYMBOLS - 7;

  /** Mean energy of the decided tone with windows shifted by `shiftMs` from the nominal alignment. */
  const energyCache = new Map<number, number>();
  const energyAt = (shiftMs: number): number => {
    const hit = energyCache.get(shiftMs);
    if (hit !== undefined) return hit;
    let sum = 0;
    for (let k = first; k <= last; k++) {
      const start = sampleAtMs(k * profile.symbolMs + profile.guardMs, sampleRate) + samplesOf(shiftMs);
      sum += goertzelEnergy(signal.subarray(start, start + length), profile.tonesHz[tones[k]!]!, sampleRate);
    }
    energyCache.set(shiftMs, sum / (last - first + 1));
    return sum / (last - first + 1);
  };

  const glideMs = Math.min(GLIDE_MS, profile.guardMs);
  const targetMs = -Math.min(TARGET_BEFORE_NOMINAL_MS, Math.max(0, (profile.guardMs - glideMs) / 2));
  const reference = energyAt(targetMs);
  const probeAt = (direction: 1 | -1): number => {
    for (let d = GATE_GRID_MS; d <= GATE_MAX_PROBE_MS; d += GATE_GRID_MS) {
      if (energyAt(targetMs + direction * d) <= GATE_PROBE_LEVEL * reference) return d;
    }
    return GATE_MAX_PROBE_MS;
  };
  const lateMs = probeAt(1);
  const earlyMs = probeAt(-1);

  const xs: number[] = [];
  const logs: number[] = [];
  for (let x = -GATE_RANGE_MS; x <= GATE_RANGE_MS; x += GATE_GRID_MS) {
    const late = energyAt(targetMs + x + lateMs);
    const early = energyAt(targetMs + x - earlyMs);
    xs.push(x);
    logs.push(late > 0 && early > 0 ? Math.log(late / early) : 0);
  }
  // Usable when the ratio changes clearly across a few ms of lateness.
  const at = (ms: number): number => logs[Math.round((ms + GATE_RANGE_MS) / GATE_GRID_MS)]!;
  const usable = reference > 0 && Math.abs(at(-3) - at(3)) > 0.15;

  const gate: Gate = {
    targetShift: samplesOf(targetMs),
    earlyProbe: samplesOf(earlyMs),
    lateProbe: samplesOf(lateMs),
    usable,
    latenessOf(logRatio: number): number {
      let best = 0;
      let bestError = Infinity;
      for (let i = 0; i < xs.length; i++) {
        const error = Math.abs(logs[i]! - logRatio);
        // On a tie prefer the smaller lateness, so a flat stretch does not push the windows around.
        if (error < bestError - 1e-12 || (Math.abs(error - bestError) <= 1e-12 && Math.abs(xs[i]!) < Math.abs(xs[best]!))) {
          bestError = error;
          best = i;
        }
      }
      return samplesOf(xs[best]!);
    },
  };
  gateCache.set(key, gate);
  return gate;
}

/** Gain on each reading's position error. Small, because one reading is noisy and the clock error is steady. */
export const CLOCK_ALPHA = 0.15;
/** Gain on the drift estimate; about alpha²/(2 − alpha), the usual smooth choice for an alpha-beta filter. */
export const CLOCK_BETA = 0.012;
/** The drift the tracker may believe: 0.3% (design), a little beyond the ±0.2% requirement. */
export const CLOCK_RATE_LIMIT = 0.003;

/**
 * Alpha-beta tracker of the receiver clock's error: a position offset plus a steady drift.
 * Times are in samples since the pass's first sample, as nominal positions; corrections are in
 * samples to add to a nominal window start. Pure arithmetic on its own state, so the same
 * readings in the same order always give the same corrections.
 */
export class ClockTracker {
  private offset = 0;
  private rate = 0;
  private reference: number;

  constructor(startTime: number) {
    this.reference = startTime;
  }

  /** Correction (samples, fractional) for a window whose nominal start is at time `t`. */
  predict(t: number): number {
    return this.offset + this.rate * (t - this.reference);
  }

  /** The drift estimate: samples of error per sample of time. */
  get drift(): number {
    return this.rate;
  }

  /** A reading at time `t`: the windows were `lateness` samples late (negative = early). */
  update(t: number, lateness: number): void {
    const elapsed = t - this.reference;
    this.offset = this.offset + this.rate * elapsed - CLOCK_ALPHA * lateness;
    if (elapsed > 0) this.rate = Math.max(-CLOCK_RATE_LIMIT, Math.min(CLOCK_RATE_LIMIT, this.rate - (CLOCK_BETA * lateness) / elapsed));
    this.reference = t;
  }
}
