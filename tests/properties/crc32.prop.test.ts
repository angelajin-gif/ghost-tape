import { crc32 as zlibCrc32 } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { appendCrc32, crc32, stripCrc32 } from '../../src/modem/crc32';
import { fcParams } from '../support/runs';

// Payloads up to the largest CRC input: 1024 payload bytes (Standard cap).
const payloadArb = fc.uint8Array({ minLength: 1, maxLength: 1024 });

const flipBit = (bytes: Uint8Array, bit: number): Uint8Array => {
  const copy = bytes.slice();
  copy[bit >> 3]! ^= 0x80 >> (bit & 7);
  return copy;
};

describe('P3: CRC-32', () => {
  it('matches the known answer for "123456789" and for empty input', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('agrees with Node zlib.crc32 (independent implementation) and is an unsigned 32-bit value', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1024 }), (bytes) => {
        const c = crc32(bytes);
        expect(Number.isInteger(c) && c >= 0 && c <= 0xffffffff).toBe(true);
        expect(c).toBe(zlibCrc32(bytes));
      }),
      fcParams(50, 2000),
    );
  });

  it('every single-bit flip changes the CRC', () => {
    fc.assert(
      fc.property(
        payloadArb.chain((bytes) => fc.tuple(fc.constant(bytes), fc.nat({ max: bytes.length * 8 - 1 }))),
        ([bytes, bit]) => {
          expect(crc32(flipBit(bytes, bit))).not.toBe(crc32(bytes));
        },
      ),
      fcParams(50, 5000),
    );
  });

  it('every single-bit flip in a short payload changes the CRC (exhaustive over bit positions)', () => {
    const bytes = new TextEncoder().encode('GT ghost');
    const base = crc32(bytes);
    for (let bit = 0; bit < bytes.length * 8; bit++) expect(crc32(flipBit(bytes, bit))).not.toBe(base);
  });

  it('stripCrc32(appendCrc32(p)) returns p and its CRC', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1024 }), (payload) => {
        const framed = appendCrc32(payload);
        expect(framed.length).toBe(payload.length + 4);
        expect(stripCrc32(framed)).toEqual({ ok: true, value: { payload, crc: crc32(payload) } });
      }),
      fcParams(50, 2000),
    );
  });

  it('any single-bit flip in payload or trailer makes stripCrc32 fail', () => {
    fc.assert(
      fc.property(
        payloadArb.chain((p) => fc.tuple(fc.constant(p), fc.nat({ max: (p.length + 4) * 8 - 1 }))),
        ([payload, bit]) => {
          expect(stripCrc32(flipBit(appendCrc32(payload), bit)).ok).toBe(false);
        },
      ),
      fcParams(50, 5000),
    );
  });

  it('rejects inputs shorter than the 4-byte trailer without throwing', () => {
    for (let n = 0; n < 4; n++) expect(stripCrc32(new Uint8Array(n)).ok).toBe(false);
  });
});
