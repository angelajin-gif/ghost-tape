import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gfDiv, gfMul, rsDecode, rsEncode } from '../../src/modem/reedSolomon';
import { fcParams } from '../support/runs';

// The two codes the modem uses (design "Header" and "Payload pipeline").
const HEADER = { k: 12, nParity: 8 } as const;
const PAYLOAD_PARITY = 32;
const MAX_PAYLOAD_K = 223;

/** A code: header RS(20,12), or payload k + 32 with k = 1..223. */
const codeArb = fc.oneof(
  fc.constant(HEADER),
  fc.integer({ min: 1, max: MAX_PAYLOAD_K }).map((k) => ({ k, nParity: PAYLOAD_PARITY })),
);

/** Distinct positions in 0..n-1 with non-zero XOR error values. */
const errorsArb = (n: number, minCount: number, maxCount: number) =>
  fc.uniqueArray(fc.nat({ max: n - 1 }), { minLength: minCount, maxLength: maxCount }).chain((positions) =>
    fc.tuple(fc.constant(positions), fc.array(fc.integer({ min: 1, max: 255 }), { minLength: positions.length, maxLength: positions.length })),
  );

const corrupt = (codeword: Uint8Array, positions: readonly number[], values: readonly number[]): Uint8Array => {
  const r = codeword.slice();
  positions.forEach((p, i) => (r[p]! ^= values[i]!));
  return r;
};

const hamming = (a: Uint8Array, b: Uint8Array): number => a.reduce((d, x, i) => d + (x !== b[i] ? 1 : 0), 0);

const encodeOrThrow = (data: Uint8Array, nParity: number): Uint8Array => {
  const r = rsEncode(data, nParity);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('GF(256) arithmetic', () => {
  it('multiplication has inverses and distributes over XOR (exhaustive inverses)', () => {
    for (let a = 1; a < 256; a++) expect(gfMul(gfDiv(1, a), a)).toBe(1);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), (a, b, c) => {
        expect(gfMul(a, b ^ c)).toBe(gfMul(a, b) ^ gfMul(a, c));
        expect(gfMul(a, b)).toBe(gfMul(b, a));
      }),
      fcParams(50, 5000),
    );
  });
});

describe('rsEncode', () => {
  it('matches the QR code known answer (version 1-M "HELLO WORLD": 0x11D, first root alpha^0)', () => {
    const data = Uint8Array.of(32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17);
    const codeword = encodeOrThrow(data, 10);
    expect([...codeword.slice(16)]).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('is systematic and every codeword decodes to its data with no corrections', () => {
    fc.assert(
      fc.property(codeArb.chain((c) => fc.tuple(fc.constant(c), fc.uint8Array({ minLength: c.k, maxLength: c.k }))), ([c, data]) => {
        const codeword = encodeOrThrow(data, c.nParity);
        expect(codeword.length).toBe(c.k + c.nParity);
        expect(codeword.slice(0, c.k)).toEqual(data);
        expect(rsDecode(codeword, c.nParity)).toEqual({ ok: true, value: { data, errorsCorrected: 0 } });
      }),
      fcParams(50, 1000),
    );
  });

  it('rejects bad parameters without throwing', () => {
    expect(rsEncode(new Uint8Array(0), 32).ok).toBe(false);
    expect(rsEncode(new Uint8Array(224), 32).ok).toBe(false);
    expect(rsEncode(new Uint8Array(10), 0).ok).toBe(false);
    expect(rsDecode(new Uint8Array(32), 32).ok).toBe(false);
    expect(rsDecode(new Uint8Array(256), 32).ok).toBe(false);
  });
});

describe('P4: corrects up to t = nParity/2 byte errors', () => {
  it('returns the original data for any <= t corrupted bytes (header t = 4, payload t = 16)', () => {
    fc.assert(
      fc.property(
        codeArb.chain((c) => {
          const n = c.k + c.nParity;
          return fc.tuple(fc.constant(c), fc.uint8Array({ minLength: c.k, maxLength: c.k }), errorsArb(n, 0, Math.min(n, c.nParity / 2)));
        }),
        ([c, data, [positions, values]]) => {
          const received = corrupt(encodeOrThrow(data, c.nParity), positions, values);
          expect(rsDecode(received, c.nParity)).toEqual({ ok: true, value: { data, errorsCorrected: positions.length } });
        },
      ),
      fcParams(50, 2000),
    );
  });

  it('corrects exactly t errors at the very first and very last positions (boundary)', () => {
    for (const c of [HEADER, { k: 1, nParity: 32 }, { k: 223, nParity: 32 }]) {
      const n = c.k + c.nParity;
      const t = c.nParity / 2;
      const data = Uint8Array.from({ length: c.k }, (_, i) => (i * 37 + 11) & 0xff);
      const half = Math.floor(t / 2);
      const positions = [...Array.from({ length: half }, (_, i) => i), ...Array.from({ length: t - half }, (_, i) => n - 1 - i)];
      const received = corrupt(encodeOrThrow(data, c.nParity), positions, positions.map(() => 0xff));
      expect(rsDecode(received, c.nParity)).toEqual({ ok: true, value: { data, errorsCorrected: t } });
    }
  });
});

describe('P5: beyond capacity the decoder fails or returns a genuine nearby codeword, and never throws', () => {
  // A decoder that corrects up to t errors cannot always detect more than t: the
  // received word can fall within t of a *different* codeword. What it must
  // guarantee is that any success is a real decoding (output re-encodes to a
  // codeword within t of what was received). Wrong payloads are then stopped by
  // the CRC-32 and tapeId checks (R7.2, R7.3), tested end to end as P18.
  it('for t+1 .. n corrupted bytes: failure, or a codeword within distance t of the received word', () => {
    fc.assert(
      fc.property(
        codeArb.chain((c) => {
          const n = c.k + c.nParity;
          return fc.tuple(fc.constant(c), fc.uint8Array({ minLength: c.k, maxLength: c.k }), errorsArb(n, c.nParity / 2 + 1, n));
        }),
        ([c, data, [positions, values]]) => {
          const received = corrupt(encodeOrThrow(data, c.nParity), positions, values);
          const result = rsDecode(received, c.nParity);
          if (result.ok) {
            const reencoded = encodeOrThrow(result.value.data, c.nParity);
            expect(hamming(reencoded, received)).toBeLessThanOrEqual(c.nParity / 2);
            expect(result.value.errorsCorrected).toBe(hamming(reencoded, received));
          }
        },
      ),
      fcParams(50, 2000),
    );
  });

  it('never throws on arbitrary bytes and any parity count', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), fc.integer({ min: -2, max: 40 }), (bytes, nParity) => {
        const result = rsDecode(bytes, nParity);
        if (result.ok) {
          const reencoded = encodeOrThrow(result.value.data, nParity);
          expect(hamming(reencoded, bytes)).toBeLessThanOrEqual(Math.floor(nParity / 2));
        }
      }),
      fcParams(50, 2000),
    );
  });
});
