import { describe, expect, it } from 'vitest';
import { bitsToBytes, bitsToSymbols, bytesToBits, grayEncode, symbolsToBits, toneForValue } from '../../src/modem/bits';

describe('bits known answers', () => {
  it('expands bytes MSB first', () => {
    expect([...bytesToBits(Uint8Array.of(0xa5, 0x01))]).toEqual([1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('groups 4-bit symbols MSB first', () => {
    expect([...bitsToSymbols(bytesToBits(Uint8Array.of(0xa5)), 4)]).toEqual([0xa, 0x5]);
  });

  it('zero-pads the last 3-bit group on the right', () => {
    // 0xFF = 11111111 -> 111 111 11(0)
    expect([...bitsToSymbols(bytesToBits(Uint8Array.of(0xff)), 3)]).toEqual([7, 7, 6]);
  });

  it('uses the standard reflected Gray sequence', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(grayEncode)).toEqual([0, 1, 3, 2, 6, 7, 5, 4]);
    // Encoder side: value 2 (binary 10) is sent on tone 3, whose neighbours 2 and 4 carry 3 and 6.
    expect(toneForValue(2)).toBe(3);
  });
});

describe('bits failures return results, never throw', () => {
  it('rejects a bit count that is not a multiple of 8', () => {
    expect(bitsToBytes(new Uint8Array(7)).ok).toBe(false);
  });

  it('rejects a bit value above 1', () => {
    expect(bitsToBytes(Uint8Array.of(0, 0, 2, 0, 0, 0, 0, 0)).ok).toBe(false);
  });

  it('rejects a symbol value outside the alphabet', () => {
    expect(symbolsToBits(Uint8Array.of(4), 2, 2).ok).toBe(false);
  });

  it('rejects a symbol count that does not match the bit count', () => {
    expect(symbolsToBits(Uint8Array.of(1, 2), 2, 6).ok).toBe(false);
    expect(symbolsToBits(Uint8Array.of(1), 2, -1).ok).toBe(false);
  });
});
