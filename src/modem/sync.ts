// Finding a ghost track in a stream: chirp detection (matched filter) and fine timing
// on the sync notes (design.md "Preamble detection", "Fine timing").

import type { SampleBuffer } from './buffer';
import { goertzelEnergies, analysisSamples } from './demodulate';
import { fft, nextPowerOfTwo } from './fft';
import { CHIRP_HIGH_HZ, CHIRP_LOW_HZ, PREAMBLE_MS, SYNC_TONES, sampleAtMs } from './frame';
import { chirpSample } from './modulate';
import type { Profile } from './profiles';

/** The peak must beat the median |correlation| of the surrounding second by this factor (gain-independent). */
export const DETECT_RATIO = 8;
/** Cheap pre-check against the mean before paying for a median: the median is rarely above the mean. */
const PREFILTER_RATIO = 4;
/**
 * Normalised correlation floor: |c| / (‖template‖·‖audio‖). 1 means the audio *is* the chirp;
 * a lone click in silence scores about 0.01 and white noise about 0.02. A real chirp scores
 * 0.7 clean and still 0.2 with the chirp 14 dB below the surrounding wideband noise.
 */
export const MIN_NCC = 0.05;
const WINDOW_SEC = 0.5; // median window is ±0.5 s: "the 1 s centred on the peak"
const EXCLUSION_SEC = 0.1; // a peak must be the largest within ±0.1 s
const BLOCK_PAD_SEC = 0.25;
const TRIM_SEC = 4;

interface Template {
  readonly length: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** Σ taper², i.e. ‖template‖². */
  readonly energy: number;
}

/**
 * The up-chirp as a complex signal, taper·e^(jφ). Correlating real audio with a complex
 * template gives the *envelope* of the match, so it is found whatever phase the speaker,
 * room and microphone have rotated the chirp by (a real template would score zero for a
 * chirp that arrives 90° out of phase). Built from the same chirpSample numbers the encoder plays.
 */
export function chirpTemplate(sampleRate: number): Template {
  const length = sampleAtMs(PREAMBLE_MS, sampleRate);
  const re = new Float64Array(length);
  const im = new Float64Array(length);
  let energy = 0;
  for (let n = 0; n < length; n++) {
    const { taper, phase } = chirpSample(n, length, CHIRP_LOW_HZ, CHIRP_HIGH_HZ, PREAMBLE_MS, sampleRate);
    re[n] = taper * Math.cos(phase);
    im[n] = taper * Math.sin(phase);
    energy += taper * taper;
  }
  return { length, re, im, energy };
}

/**
 * Streaming matched filter for the preamble chirp.
 *
 * The audio is cut into fixed blocks on an absolute grid (block j covers outputs
 * [j·B, (j+1)·B)) and each block is correlated by FFT overlap-save. Because the grid does
 * not depend on how the audio arrived, the correlation values, and so every detection,
 * are identical for any chunking (R4.3).
 */
export class ChirpDetector {
  private readonly template: Template;
  private readonly fftSize: number;
  private readonly blockSize: number;
  private readonly templateRe: Float64Array; // conj(FFT(template)), zero padded
  private readonly templateIm: Float64Array;
  private readonly workRe: Float64Array;
  private readonly workIm: Float64Array;
  private readonly halfWindow: number;
  private readonly exclusion: number;
  private readonly trimSamples: number;
  private nextBlock = 0;
  /** Next stream index not yet judged as a chirp start. */
  private candidate = 0;
  /** Correlation magnitudes; mag[i] belongs to stream index magBase + i. */
  private mag = new Float64Array(1 << 16);
  /** prefix[i] = sum of mag[0..i), for O(1) window means. */
  private prefix = new Float64Array((1 << 16) + 1);
  private magBase = 0;
  private magLength = 0;

  constructor(sampleRate: number) {
    this.template = chirpTemplate(sampleRate);
    const M = this.template.length;
    this.fftSize = nextPowerOfTwo(M + Math.round(BLOCK_PAD_SEC * sampleRate));
    this.blockSize = this.fftSize - M + 1;
    this.workRe = new Float64Array(this.fftSize);
    this.workIm = new Float64Array(this.fftSize);
    this.templateRe = new Float64Array(this.fftSize);
    this.templateIm = new Float64Array(this.fftSize);
    this.templateRe.set(this.template.re);
    this.templateIm.set(this.template.im);
    fft(this.templateRe, this.templateIm);
    for (let k = 0; k < this.fftSize; k++) this.templateIm[k] = -this.templateIm[k]!; // conjugate
    this.halfWindow = Math.round(WINDOW_SEC * sampleRate);
    this.exclusion = Math.round(EXCLUSION_SEC * sampleRate);
    this.trimSamples = Math.round(TRIM_SEC * sampleRate);
  }

  get templateLength(): number {
    return this.template.length;
  }

  /** Forget everything and look for the next chirp starting at stream index `position`. */
  resume(position: number): void {
    const pos = Math.max(0, position);
    this.nextBlock = Math.floor(pos / this.blockSize);
    this.magBase = this.nextBlock * this.blockSize;
    this.magLength = 0;
    this.prefix[0] = 0;
    this.candidate = pos;
  }

  /** Samples before this index are no longer needed by the detector. */
  keepFrom(): number {
    return this.candidate;
  }

  /**
   * Examine whatever audio is available and return the stream index where a chirp starts,
   * or undefined if none is confirmed yet. A candidate is judged only once enough
   * correlation exists on both sides of it, except when `final` (end of stream), when
   * the windows are cut at the end of the data.
   */
  scan(buffer: SampleBuffer, final: boolean): number | undefined {
    const M = this.template.length;
    for (;;) {
      const start = this.nextBlock * this.blockSize;
      const haveAll = buffer.end >= start + this.blockSize + M - 1;
      if (haveAll || (final && buffer.end > start)) this.computeBlock(buffer, start);
      else break;
    }
    const corrEnd = this.magBase + this.magLength;
    const limit = final ? corrEnd : corrEnd - Math.max(this.halfWindow, this.exclusion);
    for (; this.candidate < limit; this.candidate++) {
      if (this.isChirpStart(buffer, this.candidate)) return this.candidate++;
    }
    this.trim();
    return undefined;
  }

  /** Correlate one block: c[n] = Σ_k x[n+k]·conj(z[k]) for n in the block, via FFT. */
  private computeBlock(buffer: SampleBuffer, start: number): void {
    const { workRe, workIm, templateRe, templateIm, fftSize } = this;
    buffer.copyRange(start, fftSize, workRe);
    workIm.fill(0);
    fft(workRe, workIm);
    // Multiplying by the conjugate spectrum turns convolution into correlation.
    for (let k = 0; k < fftSize; k++) {
      const a = workRe[k]!;
      const b = workIm[k]!;
      workRe[k] = a * templateRe[k]! - b * templateIm[k]!;
      workIm[k] = a * templateIm[k]! + b * templateRe[k]!;
    }
    fft(workRe, workIm, true);
    this.ensureCapacity(this.magLength + this.blockSize);
    for (let n = 0; n < this.blockSize; n++) {
      const m = Math.hypot(workRe[n]!, workIm[n]!);
      this.mag[this.magLength + n] = m;
      this.prefix[this.magLength + n + 1] = this.prefix[this.magLength + n]! + m;
    }
    this.magLength += this.blockSize;
    this.nextBlock++;
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.mag.length) return;
    let capacity = this.mag.length;
    while (capacity < needed) capacity *= 2;
    const mag = new Float64Array(capacity);
    mag.set(this.mag.subarray(0, this.magLength));
    const prefix = new Float64Array(capacity + 1);
    prefix.set(this.prefix.subarray(0, this.magLength + 1));
    this.mag = mag;
    this.prefix = prefix;
  }

  /** Drop history that no candidate can reach any more. */
  private trim(): void {
    const keep = this.candidate - this.halfWindow - this.exclusion;
    const drop = keep - this.magBase;
    if (drop < this.trimSamples) return;
    this.mag.copyWithin(0, drop, this.magLength);
    this.prefix.copyWithin(0, drop, this.magLength + 1); // sums stay absolute; only differences are used
    this.magLength -= drop;
    this.magBase += drop;
  }

  private isChirpStart(buffer: SampleBuffer, n: number): boolean {
    const i = n - this.magBase;
    const peak = this.mag[i]!;
    if (!(peak > 0)) return false;
    const lo = Math.max(0, i - this.halfWindow);
    const hi = Math.min(this.magLength, i + this.halfWindow + 1);
    if (peak < PREFILTER_RATIO * ((this.prefix[hi]! - this.prefix[lo]!) / (hi - lo))) return false;
    // Largest in its neighbourhood (the first of equals wins).
    for (let j = Math.max(0, i - this.exclusion); j < Math.min(this.magLength, i + this.exclusion + 1); j++) {
      const v = this.mag[j]!;
      if (v > peak || (v === peak && j < i)) return false;
    }
    const sorted = Float64Array.from(this.mag.subarray(lo, hi)).sort();
    if (peak < DETECT_RATIO * sorted[Math.floor(sorted.length / 2)]!) return false;
    // Normalised correlation against the energy of the audio under the template.
    const M = this.template.length;
    const view = buffer.view(n, M);
    let audioEnergy = 0;
    if (view) for (let k = 0; k < M; k++) audioEnergy += view[k]! * view[k]!;
    else {
      const scratch = new Float64Array(M);
      buffer.copyRange(n, M, scratch);
      for (let k = 0; k < M; k++) audioEnergy += scratch[k]! * scratch[k]!;
    }
    return peak / Math.sqrt(this.template.energy * audioEnergy) >= MIN_NCC;
  }
}

// ---------- fine timing ----------

export const FINE_TIMING_MAX_SHIFT_MS = 10;
const FINE_TIMING_STEP_MS = 0.5;
/** Share of the energy that must sit on the expected sync tone (random would be 0.25 with 4 tones). */
export const MIN_SYNC_FRACTION = 0.45;
/** Tie-break towards the chirp's own timing: only decides between equally good offsets. */
const CENTRE_PREFERENCE_PER_MS = 0.0005;

export interface FineTiming {
  /** Samples to add to every window position computed from the chirp start. */
  readonly shift: number;
  /** Average share of energy on the expected sync tone at that shift, 0..1. */
  readonly score: number;
}

/** Audio needed after the chirp start before fineTiming can run. */
export function fineTimingSpan(syncStartMs: number, robust: Profile, sampleRate: number): number {
  return (
    sampleAtMs(syncStartMs + SYNC_TONES.length * robust.symbolMs, sampleRate) +
    Math.ceil((FINE_TIMING_MAX_SHIFT_MS * sampleRate) / 1000) +
    1
  );
}

/**
 * Slide the expected sync pattern ±10 ms in 0.5 ms steps and keep the offset where the
 * windows hold the most of the right tone. The score is a *share* (expected / all four
 * tones), not raw energy: the bell envelope makes early windows louder, and raw energy
 * would drag the windows into the guard period.
 */
export function fineTiming(buffer: SampleBuffer, passStart: number, syncStartMs: number, robust: Profile, sampleRate: number): FineTiming | undefined {
  const length = analysisSamples(robust, sampleRate);
  const steps = Math.round(FINE_TIMING_MAX_SHIFT_MS / FINE_TIMING_STEP_MS);
  let best: { shift: number; score: number; adjusted: number } | undefined;
  for (let s = -steps; s <= steps; s++) {
    const offsetMs = s * FINE_TIMING_STEP_MS;
    const shift = Math.round((offsetMs * sampleRate) / 1000);
    let share = 0;
    for (let k = 0; k < SYNC_TONES.length; k++) {
      const start = passStart + shift + sampleAtMs(syncStartMs + k * robust.symbolMs + robust.guardMs, sampleRate);
      const segment = buffer.view(start, length);
      if (!segment) continue;
      const energy = goertzelEnergies(segment, robust.tonesHz, sampleRate);
      let total = 0;
      for (const e of energy) total += e;
      if (total > 0) share += energy[SYNC_TONES[k]!]! / total;
    }
    const score = share / SYNC_TONES.length;
    const adjusted = score - CENTRE_PREFERENCE_PER_MS * Math.abs(offsetMs);
    if (!best || adjusted > best.adjusted) best = { shift, score, adjusted };
  }
  return best && best.score >= MIN_SYNC_FRACTION ? { shift: best.shift, score: best.score } : undefined;
}
