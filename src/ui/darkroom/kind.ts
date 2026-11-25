// Payload kind detection (ghost-tape-ui R5, design "Kind detection").
//
// Position 0 of the serialized payload is the Kind byte and it is the first byte on the air,
// so it is one of the first provisional bytes to carry evidence.

import { KIND_CONFIDENCE_MIN } from '../tokens';
import type { KindReading } from './state';

const KIND_TAPE = 0;
const KIND_GHOST = 1;

/**
 * 'unknown' until position 0 has a byte at or above KIND_CONFIDENCE_MIN; then 'tape' for 0,
 * 'ghost' for 1 and 'invalid' for anything else (Generic sheet, no hint, R5.7). Never throws.
 */
export function detectKind(bytes: Uint8Array, conf: Float32Array, has: Uint8Array): KindReading {
  if (bytes.length < 1 || conf.length < 1 || has.length < 1) return 'unknown';
  if (has[0] !== 1 || !(conf[0]! >= KIND_CONFIDENCE_MIN)) return 'unknown';
  if (bytes[0] === KIND_TAPE) return 'tape';
  if (bytes[0] === KIND_GHOST) return 'ghost';
  return 'invalid';
}
