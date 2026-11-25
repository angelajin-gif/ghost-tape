// Multi-pass combining: the store that remembers, per tape, the evidence from every pass so far
// (design.md "Pass handling and accumulation", requirements 6).
//
// Why combining works: a pass gives, for every payload symbol, how much of its energy sat on each
// tone (normalised so the shares sum to 1; loudness drops out). The tone that was really sent gets
// a high share in every pass, while noise lands on different tones each time. Adding the shares
// across passes makes the right tone's total grow steadily and the others' average out, so the
// margin between the best and second-best tone widens with each pass: every séance makes the
// ghost clearer. Adding is equal-gain combining; there is nothing to estimate and nothing to tune.

import { decide } from './demodulate';
import type { Payload } from './types';

/** Tapes held at once (R6.9). */
export const MAX_TAPES = 4;
/** A tape's evidence is kept this long after its last activity, in audio time (R6.8). */
export const RETENTION_SECONDS = 600;

/**
 * A pass is aligned when its pilot reads are a count that chance alone reaches less often than
 * this (R6.6, design decision S9).
 */
export const ALIGNMENT_FALSE_ACCEPT = 1e-3;

/** P(X ≥ k) for X ~ Binomial(n, p): the chance of at least k hits in n tries with hit chance p. */
export function binomialTail(n: number, p: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  // Walk P(X = x) upwards with the ratio P(x+1)/P(x) = (n−x)/(x+1) · p/(1−p), summing from x = k.
  let term = (1 - p) ** n;
  let sum = 0;
  for (let x = 0; x <= n; x++) {
    if (x >= k) sum += term;
    term = (term * (n - x) * p) / ((x + 1) * (1 - p));
  }
  return Math.min(1, sum);
}

/**
 * Pilot reads needed out of `pilots` when each read happens by chance with probability `chance`:
 * the smallest count that chance reaches with probability below ALIGNMENT_FALSE_ACCEPT. With few
 * pilots no count is that unlikely (2 pilots at 1/16 each: both by chance 1 time in 256), and the
 * rule falls back to all of them, the strongest evidence the pass can give.
 */
export function pilotReadsNeeded(pilots: number, chance: number): number {
  for (let k = 0; k <= pilots; k++) if (binomialTail(pilots, chance, k) < ALIGNMENT_FALSE_ACCEPT) return k;
  return pilots;
}

export interface TapeShape {
  readonly tapeId: number;
  readonly profileName: string;
  readonly payloadLength: number;
  /** Payload symbols per pass, pilots included. */
  readonly symbols: number;
  /** Tones in the profile's alphabet. */
  readonly tones: number;
}

export interface AccumulatedTape extends TapeShape {
  /** Σ over committed passes of the normalised energies; symbols × tones, symbol-major. */
  readonly sums: Float64Array;
  /** Passes added to the sums. */
  passes: number;
  /** Passes counted for the `pass` number of header events: committed passes, plus repeats once the tape is complete. */
  received: number;
  /** Audio time (stream sample index) of the last pass added or repeated. */
  lastActivity: number;
  /** The verified payload, once the tape has completed. */
  completed: Payload | undefined;
}

/** Data decisions below this confidence (1 − second/best) are treated as noise when estimating chance. */
export const CHANCE_MAX_CONFIDENCE = 0.5;
/** Fewer noise-like data decisions than this: too few to estimate from, so chance is taken as 1/T. */
export const CHANCE_MIN_SAMPLES = 32;

export interface AlignmentReading {
  /** Pilot symbols in the pass, and how many were read as the pilot tone. */
  readonly pilots: number;
  readonly pilotReads: number;
  /** How often the pilot tone won at noise-like (unclear) data decisions, floored at 1/T. */
  readonly chance: number;
  readonly needed: number;
  readonly aligned: boolean;
}

/**
 * Was this pass read at the right time, and is it a ghost at all? The pilots are known: the pilot
 * tone after every `pilotEvery` data symbols. A pass read at the wrong place, or noise behind a
 * real header, reads the pilot tone at pilot positions no more often than anywhere else.
 *
 * How often is "anywhere else"? Not simply 1/T: speech or music favour some tones, and with
 * speech-like noise the old fixed rule (2/T of the pilots) accepted 56–67% of noise payloads
 * (design "Task 14 measurements"). So the chance is measured in the same pass, at its data
 * positions whose decision was unclear (noise-like), and floored at 1/T. Aligned = the pilot reads
 * are a count that this chance reaches with probability below 1/1000 (R6.6, S9).
 */
export function alignmentReading(pending: Float64Array, symbols: number, tones: number, pilotEvery: number, pilotIndex: number): AlignmentReading {
  let pilots = 0;
  let pilotReads = 0;
  let data = 0;
  let dataAsPilot = 0;
  for (let i = 0; i < symbols; i++) {
    const row = pending.subarray(i * tones, (i + 1) * tones);
    const d = decide(row);
    // A vector with no energy "decides" tone 0 with confidence 0: that is no read at all.
    const read = row[d.tone]! > 0;
    if ((i + 1) % (pilotEvery + 1) === 0) {
      pilots++;
      if (read && d.tone === pilotIndex) pilotReads++;
    } else if (read && d.confidence < CHANCE_MAX_CONFIDENCE) {
      // Only unclear decisions estimate chance: a clearly heard data symbol is on the pilot tone
      // because the message put it there (a letter of repeated characters can put a third of its
      // symbols on it), which says nothing about how often noise lands there.
      data++;
      if (d.tone === pilotIndex) dataAsPilot++;
    }
  }
  const chance = Math.max(1 / tones, data >= CHANCE_MIN_SAMPLES ? dataAsPilot / data : 1 / tones);
  const needed = pilotReadsNeeded(pilots, chance);
  return { pilots, pilotReads, chance, needed, aligned: pilots === 0 || pilotReads >= needed };
}

export function isAligned(pending: Float64Array, symbols: number, tones: number, pilotEvery: number, pilotIndex: number): boolean {
  return alignmentReading(pending, symbols, tones, pilotEvery, pilotIndex).aligned;
}

/**
 * Which symbols of an accepted pass to commit (design decision S9, option B). A pass can be partly
 * drowned: a door slams, someone talks over the speaker. Its clean stretches still read their
 * pilots; its noisy stretches mostly do not. So the payload is judged run by run: the data symbols
 * between two pilots are kept if either pilot bounding them was read as the pilot tone (the first
 * run has only the pilot after it, the run after the last pilot only the one before it). Either,
 * not both, so that one misread pilot in clean audio does not throw away good evidence: at −10 dB
 * a pilot is read about 90% of the time and both bounding pilots fail about 1% of the time, while
 * a noise run gets in only with about twice the pilot tone's chance rate.
 *
 * Returns 1 per kept symbol (pilots kept with their run). A pass with no pilots keeps everything.
 */
export function keptSymbols(pending: Float64Array, symbols: number, tones: number, pilotEvery: number, pilotIndex: number): Uint8Array {
  const group = pilotEvery + 1;
  const pilots = Math.floor(symbols / group);
  const keep = new Uint8Array(symbols);
  if (pilots === 0) return keep.fill(1);
  const read = new Uint8Array(pilots);
  for (let j = 0; j < pilots; j++) {
    const row = pending.subarray((j * group + pilotEvery) * tones, (j * group + pilotEvery + 1) * tones);
    const d = decide(row);
    read[j] = d.tone === pilotIndex && row[d.tone]! > 0 ? 1 : 0;
  }
  for (let i = 0; i < symbols; i++) {
    // Run r holds the data symbols after pilot r−1 and up to pilot r (pilot r itself goes with it).
    const r = Math.floor(i / group);
    const before = r - 1 >= 0 ? read[r - 1]! : 0;
    const after = r < pilots ? read[r]! : 0;
    keep[i] = before === 1 || after === 1 ? 1 : 0;
  }
  return keep;
}

/** Zero the rows of symbols that are not kept, so they add no evidence when committed. */
export function dropUnkept(pending: Float64Array, keep: Uint8Array, tones: number): void {
  for (let i = 0; i < keep.length; i++) if (keep[i] !== 1) pending.fill(0, i * tones, (i + 1) * tones);
}

export interface SumDecisions {
  readonly tones: Uint8Array;
  readonly confidence: Float64Array;
  /** Mean confidence over all payload symbols (R6.7). */
  readonly clarity: number;
}

/**
 * Hard decision per symbol from the summed shares: the strongest tone, and confidence
 * 1 − second/best (0 when there is no energy). Clarity is the mean confidence.
 */
export function decideFromSums(sums: Float64Array, symbols: number, tones: number): SumDecisions {
  const out = new Uint8Array(symbols);
  const confidence = new Float64Array(symbols);
  let total = 0;
  for (let i = 0; i < symbols; i++) {
    const d = decide(sums.subarray(i * tones, (i + 1) * tones));
    out[i] = d.tone;
    confidence[i] = d.confidence;
    total += d.confidence;
  }
  return { tones: out, confidence, clarity: symbols > 0 ? total / symbols : 0 };
}

/**
 * The accumulators for up to four tapes, keyed by tapeId. Every time-dependent rule uses audio
 * time, a position in the stream, never the clock on the wall (R6.8), and the caller supplies it,
 * so the same stream always gives the same behaviour however it was chunked.
 */
export class AccumulatorStore {
  private readonly tapes = new Map<number, AccumulatedTape>();
  private readonly retentionSamples: number;

  constructor(
    sampleRate: number,
    retentionSeconds: number = RETENTION_SECONDS,
    private readonly maxTapes: number = MAX_TAPES,
  ) {
    this.retentionSamples = retentionSeconds * sampleRate;
  }

  get size(): number {
    return this.tapes.size;
  }

  /** The tape's accumulator if one is held, exactly the definition of "known" (R6.1). */
  peek(tapeId: number): AccumulatedTape | undefined {
    return this.tapes.get(tapeId);
  }

  /** Tape ids held, oldest activity first (insertion order breaks ties). */
  held(): number[] {
    return [...this.tapes.values()].sort((a, b) => a.lastActivity - b.lastActivity).map((t) => t.tapeId);
  }

  /**
   * Drop every accumulator whose last activity is a full retention period or more behind `now`
   * (R6.8: kept WHILE less than 10 minutes have passed). Returns the ids dropped.
   */
  expire(now: number): number[] {
    const dropped: number[] = [];
    for (const tape of this.tapes.values()) {
      if (now - tape.lastActivity >= this.retentionSamples) dropped.push(tape.tapeId);
    }
    for (const id of dropped) this.tapes.delete(id);
    return dropped;
  }

  /**
   * Add a pass's normalised energies to the tape's accumulator, creating it if none is held
   * (R6.2). Creating one while the store is full first evicts exactly one tape, the one with the
   * oldest last activity (R6.9, R6.10). If a held accumulator has a different shape (a tapeId
   * collision, essentially impossible with a 32-bit CRC) it is replaced, not mixed.
   */
  commit(shape: TapeShape, pending: Float64Array, passNumber: number, now: number): { tape: AccumulatedTape; evicted: number | undefined } {
    let tape = this.tapes.get(shape.tapeId);
    if (tape && (tape.profileName !== shape.profileName || tape.payloadLength !== shape.payloadLength || tape.symbols !== shape.symbols || tape.tones !== shape.tones)) {
      this.tapes.delete(shape.tapeId);
      tape = undefined;
    }
    let evicted: number | undefined;
    if (!tape) {
      if (this.tapes.size >= this.maxTapes) {
        evicted = this.held()[0];
        if (evicted !== undefined) this.tapes.delete(evicted);
      }
      tape = { ...shape, sums: new Float64Array(shape.symbols * shape.tones), passes: 0, received: 0, lastActivity: now, completed: undefined };
      this.tapes.set(shape.tapeId, tape);
    }
    for (let i = 0; i < tape.sums.length; i++) tape.sums[i]! += pending[i]!;
    tape.passes++;
    tape.received = passNumber;
    tape.lastActivity = now;
    return { tape, evicted };
  }

  /** A pass of a tape that is already complete arrived: the tape is untouched, but this counts as activity (R8.17). */
  noteRepeat(tapeId: number, passNumber: number, now: number): void {
    const tape = this.tapes.get(tapeId);
    if (!tape) return;
    tape.received = passNumber;
    tape.lastActivity = now;
  }

  /** Forget everything: accumulators and completed tapes (R6.11). */
  clear(): void {
    this.tapes.clear();
  }
}
