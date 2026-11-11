// CRC-32 (IEEE 802.3, the zip/PNG/Ethernet CRC): reflected polynomial 0xEDB88320,
// initial value and final XOR 0xFFFFFFFF. Used twice (R7.2): as the tapeId in the
// header, and as the 4-byte trailer after the payload that must match it.
//
// A CRC treats the message as one long binary polynomial and keeps the remainder
// after dividing by a fixed 33-bit polynomial. Any single flipped bit changes the
// remainder, and any burst of up to 32 flipped bits does too, so a corrupted
// payload that Reed–Solomon "repaired" wrongly is almost always caught here.

import type { Result } from './types';

const POLY_REFLECTED = 0xedb88320;

// Remainder for every possible byte value, so the main loop does one table
// lookup per byte instead of eight shift-and-XOR steps.
const TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? POLY_REFLECTED ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of `bytes` as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Payload followed by its CRC-32, big-endian (design "Payload pipeline" step 1). */
export function appendCrc32(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 4);
  out.set(payload);
  const c = crc32(payload);
  out[payload.length] = c >>> 24;
  out[payload.length + 1] = (c >>> 16) & 0xff;
  out[payload.length + 2] = (c >>> 8) & 0xff;
  out[payload.length + 3] = c & 0xff;
  return out;
}

/** Inverse of appendCrc32: the payload and its CRC, only if the trailer matches. */
export function stripCrc32(withCrc: Uint8Array): Result<{ payload: Uint8Array; crc: number }> {
  if (withCrc.length < 4) return { ok: false, reason: `need at least 4 bytes, got ${withCrc.length}` };
  const n = withCrc.length - 4;
  const payload = withCrc.slice(0, n);
  const trailer = ((withCrc[n]! << 24) | (withCrc[n + 1]! << 16) | (withCrc[n + 2]! << 8) | withCrc[n + 3]!) >>> 0;
  const crc = crc32(payload);
  if (trailer !== crc) return { ok: false, reason: 'CRC-32 mismatch' };
  return { ok: true, value: { payload, crc } };
}
