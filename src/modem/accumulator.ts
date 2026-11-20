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

/** A pass is aligned when at least this many times chance of its pilots were read as pilots (design: twice chance). */
export const ALIGNMENT_FACTOR = 2;

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

/**
 * Was this pass read at the right time? The pilots are known: a symbol of the pilot tone after
 * every `pilotEvery` data symbols. If the pass was found at the wrong place, or is not a ghost
 * track at all, the decisions are close to random and only about 1/T of the pilots come out right.
 * Aligned = at least ALIGNMENT_FACTOR/T of them do (R6.6).
 */
export function isAligned(pending: Float64Array, symbols: number, tones: number, pilotEvery: number, pilotIndex: number): boolean {
  let pilots = 0;
  let right = 0;
  for (let i = pilotEvery; i < symbols; i += pilotEvery + 1) {
    pilots++;
    const d = decide(pending.subarray(i * tones, (i + 1) * tones));
    // A vector with no energy at all "decides" tone 0 with confidence 0; that is not a pilot read.
    if (d.tone === pilotIndex && pending[i * tones + d.tone]! > 0) right++;
  }
  return pilots === 0 || right / pilots >= ALIGNMENT_FACTOR / tones;
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
