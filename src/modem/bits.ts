// Bytes <-> bits <-> symbol values, and the Gray mapping between symbol values
// and tone indices (design.md, "Payload pipeline" step 6).
//
// Bits are stored one per Uint8Array element (0 or 1), most significant bit first.
// That is wasteful but makes every stage easy to inspect and property-test.

import type { Result } from './types';

/** Bits carried by one symbol: log2 of the number of tones in a profile. */
export type BitsPerSymbol = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Expand each byte into 8 bits, MSB first. */
export function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    for (let b = 0; b < 8; b++) bits[i * 8 + b] = (byte >> (7 - b)) & 1;
  }
  return bits;
}

/** Pack bits (MSB first) into bytes. Fails if the count is not a multiple of 8 or a bit is not 0/1. */
export function bitsToBytes(bits: Uint8Array): Result<Uint8Array> {
  if (bits.length % 8 !== 0) return fail(`bit count ${bits.length} is not a multiple of 8`);
  const bytes = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      const bit = bits[i * 8 + b]!;
      if (bit > 1) return fail(`bit ${i * 8 + b} has value ${bit}`);
      byte = (byte << 1) | bit;
    }
    bytes[i] = byte;
  }
  return { ok: true, value: bytes };
}

/** Number of symbols needed for `bitCount` bits: the last group is zero-padded. */
export function symbolCount(bitCount: number, bitsPerSymbol: BitsPerSymbol): number {
  return Math.ceil(bitCount / bitsPerSymbol);
}

/**
 * Group bits into symbol values of `bitsPerSymbol` bits each, MSB first.
 * When the bit count is not a multiple of bitsPerSymbol (3-bit profiles),
 * the final group is padded with zero bits on the right.
 */
export function bitsToSymbols(bits: Uint8Array, bitsPerSymbol: BitsPerSymbol): Uint8Array {
  const symbols = new Uint8Array(symbolCount(bits.length, bitsPerSymbol));
  for (let s = 0; s < symbols.length; s++) {
    let value = 0;
    for (let b = 0; b < bitsPerSymbol; b++) {
      const i = s * bitsPerSymbol + b;
      value = (value << 1) | (i < bits.length ? bits[i]! & 1 : 0);
    }
    symbols[s] = value;
  }
  return symbols;
}

/**
 * Inverse of bitsToSymbols: expand symbol values back into `bitCount` bits,
 * dropping the zero padding. Fails on a value outside 0..2^bitsPerSymbol-1 or a
 * symbol count that does not match bitCount.
 */
export function symbolsToBits(symbols: Uint8Array, bitsPerSymbol: BitsPerSymbol, bitCount: number): Result<Uint8Array> {
  if (!Number.isInteger(bitCount) || bitCount < 0) return fail(`invalid bit count ${bitCount}`);
  if (symbols.length !== symbolCount(bitCount, bitsPerSymbol)) {
    return fail(`expected ${symbolCount(bitCount, bitsPerSymbol)} symbols for ${bitCount} bits, got ${symbols.length}`);
  }
  const limit = 1 << bitsPerSymbol;
  const bits = new Uint8Array(bitCount);
  for (let s = 0; s < symbols.length; s++) {
    const value = symbols[s]!;
    if (value >= limit) return fail(`symbol ${s} has value ${value}, max ${limit - 1}`);
    for (let b = 0; b < bitsPerSymbol; b++) {
      const i = s * bitsPerSymbol + b;
      if (i < bitCount) bits[i] = (value >> (bitsPerSymbol - 1 - b)) & 1;
    }
  }
  return { ok: true, value: bits };
}

/** Binary-reflected Gray code: n XOR (n >> 1). Consecutive n give codes one bit apart. */
export function grayEncode(n: number): number {
  return n ^ (n >>> 1);
}

/** Inverse Gray code: XOR together every right shift of g (prefix XOR from the top bit down). */
export function grayDecode(g: number): number {
  let n = g;
  for (let shift = g >>> 1; shift !== 0; shift >>>= 1) n ^= shift;
  return n;
}

// Which direction does Gray coding go? The demodulator's most likely mistake is
// picking a neighbouring tone (t ± 1), because neighbouring tones are closest in
// frequency. We want that mistake to cost one bit. So the *decoder* must read
// value = grayEncode(tone): consecutive tones then decode to values one bit apart.
// The encoder uses the inverse: tone = grayDecode(value).

/** Tone index to transmit for a symbol value (encoder side). */
export function toneForValue(value: number): number {
  return grayDecode(value);
}

/** Symbol value carried by a detected tone index (decoder side). */
export function valueForTone(tone: number): number {
  return grayEncode(tone);
}

/** Map symbol values to tone indices for transmission. */
export function valuesToTones(values: Uint8Array): Uint8Array {
  return values.map(toneForValue);
}

/** Map detected tone indices back to symbol values. */
export function tonesToValues(tones: Uint8Array): Uint8Array {
  return tones.map(valueForTone);
}
