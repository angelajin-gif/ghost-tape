import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bitsToBytes,
  bitsToSymbols,
  bytesToBits,
  grayDecode,
  grayEncode,
  symbolCount,
  symbolsToBits,
  tonesToValues,
  toneForValue,
  valueForTone,
  valuesToTones,
  type BitsPerSymbol,
} from '../../src/modem/bits';
import { fcParams } from '../support/runs';

const bitsPerSymbolArb = fc.constantFrom<BitsPerSymbol>(1, 2, 3, 4, 5, 6, 7, 8);
const bitsArb = fc.uint8Array({ min: 0, max: 1, maxLength: 2000 });
const popcount = (n: number): number => n.toString(2).replaceAll('0', '').length;

describe('P1: bits round trips', () => {
  it('bitsToBytes(bytesToBits(b)) = b', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1200 }), (bytes) => {
        const back = bitsToBytes(bytesToBits(bytes));
        expect(back).toEqual({ ok: true, value: bytes });
      }),
      fcParams(50, 2000),
    );
  });

  it('symbolsToBits(bitsToSymbols(x)) = x for every bits-per-symbol, including zero-padded groups', () => {
    fc.assert(
      fc.property(bitsArb, bitsPerSymbolArb, (bits, bps) => {
        const symbols = bitsToSymbols(bits, bps);
        expect(symbols.length).toBe(symbolCount(bits.length, bps));
        for (const v of symbols) expect(v).toBeLessThan(1 << bps);
        expect(symbolsToBits(symbols, bps, bits.length)).toEqual({ ok: true, value: bits });
      }),
      fcParams(50, 2000),
    );
  });

  it('bytes -> bits -> symbols -> bits -> bytes is the identity (the payload path)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1200 }), fc.constantFrom<BitsPerSymbol>(2, 3, 4), (bytes, bps) => {
        const bits = bytesToBits(bytes);
        const back = symbolsToBits(bitsToSymbols(bits, bps), bps, bits.length);
        expect(back.ok).toBe(true);
        if (back.ok) expect(bitsToBytes(back.value)).toEqual({ ok: true, value: bytes });
      }),
      fcParams(50, 1000),
    );
  });
});

describe('P2: Gray code', () => {
  it('is a bijection on 0..2^k-1 for k = 1..8 (exhaustive)', () => {
    for (let k = 1; k <= 8; k++) {
      const n = 1 << k;
      const codes = new Set<number>();
      for (let v = 0; v < n; v++) {
        const g = grayEncode(v);
        expect(g).toBeLessThan(n);
        codes.add(g);
        expect(grayDecode(g)).toBe(v);
      }
      expect(codes.size).toBe(n);
    }
  });

  it('adjacent tone indices decode to values that differ in exactly one bit (exhaustive, k = 1..8)', () => {
    for (let k = 1; k <= 8; k++) {
      for (let t = 0; t + 1 < 1 << k; t++) {
        expect(popcount(valueForTone(t) ^ valueForTone(t + 1))).toBe(1);
      }
    }
  });

  it('grayDecode inverts grayEncode and the tone maps invert each other', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffff }), (n) => {
        expect(grayDecode(grayEncode(n))).toBe(n);
        expect(grayEncode(grayDecode(n))).toBe(n);
        expect(valueForTone(toneForValue(n))).toBe(n);
      }),
      fcParams(50, 5000),
    );
  });

  it('valuesToTones and tonesToValues are inverse over symbol arrays', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 500 }), (values) => {
        expect(tonesToValues(valuesToTones(values))).toEqual(values);
      }),
      fcParams(50, 1000),
    );
  });
});
