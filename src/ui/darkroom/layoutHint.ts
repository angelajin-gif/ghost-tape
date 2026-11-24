// Layout hint parser (ghost-tape-ui R6, design "Layout hint parser").
//
// Reads only the length-prefix bytes of a serialized tape (src/modem/tape.ts) from
// provisional bytes. A wrong prefix shifts every later offset, and the last byte must
// land exactly on payloadLength - 1, so a misread prefix is very unlikely to be accepted.
// The hint is layout only: field bytes, date bytes and text are never read.

import { LIMITS, serializePayload } from '../../modem/tape';
import type { Payload } from '../../modem/types';
import { LAYOUT_CONFIDENCE_MIN } from '../tokens';

export interface LayoutOffsets {
  readonly titleLenPos: 1;
  readonly title: number;
  readonly fromLenPos: number;
  readonly from: number;
  readonly toLenPos: number;
  readonly to: number;
  readonly date: number;
  readonly trackCountPos: number;
  readonly trackLenPos: readonly number[];
  readonly tracks: readonly number[];
  readonly letterLenPos: number;
  readonly letter: number;
  readonly doodleFlagPos: number;
}

export interface LayoutHint {
  readonly titleLen: number;
  readonly fromLen: number;
  readonly toLen: number;
  readonly trackLens: readonly number[];
  readonly letterLen: number;
  readonly offsets: LayoutOffsets;
}

const KIND_TAPE = 0;
/** kind + 3 prefixes + 3 date + track count + 2 letter prefix + doodle flag + at least one name byte. */
const MIN_TAPE_LENGTH = 12;

/**
 * Returns a hint only when every prefix byte needed is known and the lengths sum
 * exactly to payloadLength. Never throws; returns undefined on any doubt.
 */
export function parseLayoutHint(bytes: Uint8Array, conf: Float32Array, has: Uint8Array, payloadLength: number): LayoutHint | undefined {
  if (!Number.isInteger(payloadLength) || payloadLength < MIN_TAPE_LENGTH) return undefined;

  // A byte is usable only if it exists in all three arrays, lies inside the payload and is confident enough.
  const known = (i: number): boolean =>
    i >= 0 && i < payloadLength && i < bytes.length && i < conf.length && i < has.length && has[i] === 1 && conf[i]! >= LAYOUT_CONFIDENCE_MIN;

  if (!known(0) || bytes[0] !== KIND_TAPE) return undefined;

  let pos = 1;
  const nameLens: number[] = [];
  const nameOffsets: number[] = [];
  const nameLenPos: number[] = [];
  for (const max of [LIMITS.title, LIMITS.from, LIMITS.to]) {
    if (!known(pos)) return undefined;
    const len = bytes[pos]!;
    if (len > max) return undefined;
    nameLenPos.push(pos);
    nameOffsets.push(pos + 1);
    nameLens.push(len);
    pos += 1 + len;
  }
  if (nameLens[0]! + nameLens[1]! + nameLens[2]! === 0) return undefined;

  const date = pos;
  pos += 3;

  const trackCountPos = pos;
  if (!known(pos)) return undefined;
  const count = bytes[pos]!;
  if (count > LIMITS.trackCount) return undefined;
  pos += 1;

  const trackLens: number[] = [];
  const trackLenPos: number[] = [];
  const trackOffsets: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!known(pos)) return undefined;
    const len = bytes[pos]!;
    if (len > LIMITS.track) return undefined;
    trackLenPos.push(pos);
    trackOffsets.push(pos + 1);
    trackLens.push(len);
    pos += 1 + len;
  }

  const letterLenPos = pos;
  if (!known(pos) || !known(pos + 1)) return undefined;
  // Big-endian u16, high byte first, as Writer.u16 in tape.ts.
  const letterLen = (bytes[pos]! << 8) | bytes[pos + 1]!;
  if (letterLen > LIMITS.letter) return undefined;
  const letter = pos + 2;
  pos = letter + letterLen;

  // The doodle flag is the last byte; the exact-sum rule is the main guard against misread prefixes.
  if (pos + 1 !== payloadLength) return undefined;
  if (known(pos) && bytes[pos] !== 0) return undefined;

  return {
    titleLen: nameLens[0]!,
    fromLen: nameLens[1]!,
    toLen: nameLens[2]!,
    trackLens,
    letterLen,
    offsets: {
      titleLenPos: 1,
      title: nameOffsets[0]!,
      fromLenPos: nameLenPos[1]!,
      from: nameOffsets[1]!,
      toLenPos: nameLenPos[2]!,
      to: nameOffsets[2]!,
      date,
      trackCountPos,
      trackLenPos,
      tracks: trackOffsets,
      letterLenPos,
      letter,
      doodleFlagPos: pos,
    },
  };
}

/** Layout of a verified payload: serialize, then run the same parser with every byte at confidence 1. */
export function layoutFromPayload(payload: Payload): LayoutHint | undefined {
  const serialized = serializePayload(payload);
  if (!serialized.ok) return undefined;
  const bytes = serialized.value;
  return parseLayoutHint(bytes, new Float32Array(bytes.length).fill(1), new Uint8Array(bytes.length).fill(1), bytes.length);
}
