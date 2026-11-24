// Synthesized decoder events: a unit-test fixture only (R37.4). It is never used for an
// end-to-end Darkroom test; those use feeds recorded through src/modem/channel.ts.
// Positions index the final serialized payload (not including the CRC), confidence is 0..1.

import { crc32 } from '../../src/modem/crc32';
import { serializePayload } from '../../src/modem/tape';
import type { DecoderEvent, Payload, ProfileId, ProvisionalByte } from '../../src/modem/types';

/** Small seeded generator (mulberry32) so the fixture needs no global randomness. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthTape {
  readonly payload: Payload;
  readonly bytes: Uint8Array;
  /** Same rule as the encoder: CRC-32 of the serialized payload. */
  readonly tapeId: number;
  readonly profile: ProfileId;
}

export function synthTape(payload: Payload, profile: ProfileId = 'standard'): SynthTape {
  const serialized = serializePayload(payload);
  if (!serialized.ok) throw new Error(`synthTape: ${serialized.reason}`);
  return { payload, bytes: serialized.value, tapeId: crc32(serialized.value), profile };
}

export function header(tape: SynthTape, pass = 1, estimatedSecondsRemaining = 20): DecoderEvent {
  return {
    type: 'header',
    tapeId: tape.tapeId,
    profile: tape.profile,
    payloadLength: tape.bytes.length,
    pass,
    estimatedSecondsRemaining,
  };
}

/**
 * A progress snapshot with every position present. Confidence ramps with `fractionReceived`
 * (position-dependent jitter keeps it in 0..1). Below full confidence a seeded share of bytes
 * is wrong, and that share shrinks to zero as the fraction reaches 1.
 */
export function progress(tape: SynthTape, fractionReceived: number, seed = 1): DecoderEvent {
  const fraction = Math.min(1, Math.max(0, fractionReceived));
  const rand = seededRandom(seed);
  const provisional: ProvisionalByte[] = [];
  for (let position = 0; position < tape.bytes.length; position++) {
    const confidence = Math.min(1, Math.max(0, fraction * (0.75 + 0.25 * rand())));
    const wrong = fraction < 1 && rand() > confidence;
    const truth = tape.bytes[position]!;
    const byte = wrong ? (truth ^ (1 + Math.floor(rand() * 255))) & 0xff : truth;
    provisional.push({ kind: 'provisional', position, byte, confidence });
  }
  return { type: 'progress', tapeId: tape.tapeId, provisional, fractionReceived: fraction };
}

export function passComplete(
  tape: SynthTape,
  pass: number,
  options: { blocksRecovered?: number; blocksTotal?: number; clarity?: number } = {},
): DecoderEvent {
  const blocksTotal = options.blocksTotal ?? 4;
  return {
    type: 'pass-complete',
    tapeId: tape.tapeId,
    pass,
    blocksRecovered: options.blocksRecovered ?? blocksTotal,
    blocksTotal,
    clarity: options.clarity ?? 1,
  };
}

export function complete(tape: SynthTape, passesUsed = 1): DecoderEvent {
  return { type: 'complete', tapeId: tape.tapeId, payload: tape.payload, passesUsed };
}

/**
 * The batch the real decoder emits when a pass completes the tape: `pass-complete`
 * immediately followed by `complete`, in one batch.
 */
export function finalBatch(tape: SynthTape, pass = 1): DecoderEvent[] {
  return [passComplete(tape, pass), complete(tape, pass)];
}
