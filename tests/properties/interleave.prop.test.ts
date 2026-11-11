import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bytesInFirstSymbols,
  chooseMultiplier,
  deinterleave,
  geometry,
  interleave,
  joinAndTrim,
  padAndSplit,
  PAYLOAD_PARITY,
  payloadSymbolCount,
  permute,
  unpermute,
  type Geometry,
  type SpreadParams,
} from '../../src/modem/interleave';
import { fcParams } from '../support/runs';

// Profile facts from design.md "Profiles". Replace with the PROFILES table once
// profiles.ts exists (task 7); the values must stay identical.
const PROFILES: ReadonlyArray<{ name: string; spread: SpreadParams; maxPayload: number }> = [
  { name: 'standard', spread: { bitsPerSymbol: 4, pilotEvery: 32 }, maxPayload: 1024 },
  { name: 'robust', spread: { bitsPerSymbol: 2, pilotEvery: 32 }, maxPayload: 256 },
];

const allCases = PROFILES.flatMap((p) => Array.from({ length: p.maxPayload }, (_, i) => ({ profile: p, P: i + 1 })));

const multiplier = (P: number, spread: SpreadParams): number => {
  const r = chooseMultiplier(P, spread);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

/**
 * Run labelled bytes through the real pipeline (padAndSplit -> placeholder parity
 * -> interleave -> permute). `label(position)` marks data bytes; padding, CRC
 * and parity carry `fill`. Uses the functions under test, not their internals.
 */
function transmitLabelled(g: Geometry, a: number, dataLabel: (position: number) => number, fill: number, parityLabel?: (block: number) => number): Uint8Array {
  const withCrc = new Uint8Array(g.crcLength).fill(fill);
  for (let p = 0; p < g.payloadLength; p++) withCrc[p] = dataLabel(p);
  const blocks = padAndSplit(withCrc).map((data, b) => {
    const codeword = new Uint8Array(data.length + PAYLOAD_PARITY).fill(parityLabel ? parityLabel(b) : fill);
    codeword.set(data);
    // padAndSplit pads with zeros; relabel padding as `fill` so it is not mistaken for data.
    for (let pos = 0; pos < data.length; pos++) if (b * g.blockData + pos >= g.payloadLength) codeword[pos] = parityLabel ? parityLabel(b) : fill;
    return codeword;
  });
  const stream = interleave(blocks);
  if (!stream.ok) throw new Error(stream.reason);
  return permute(stream.value, a);
}

describe('geometry (R8.10)', () => {
  it('equal blocks: B divides L, k >= ceil(M/B), n <= 255, for every valid P (exhaustive)', () => {
    for (let P = 1; P <= 1024; P++) {
      const g = geometry(P);
      expect(g.blocks).toBe(Math.ceil((P + 4) / 223));
      expect(g.blocks * g.blockData).toBeGreaterThanOrEqual(P + 4);
      expect(g.blockData).toBeLessThanOrEqual(223);
      expect(g.blockLength).toBeLessThanOrEqual(255);
      expect(g.streamLength % g.blocks).toBe(0);
    }
  });
});

describe('P6: pad/split and interleave round trip', () => {
  it('joinAndTrim(deinterleave(interleave(padAndSplit(x)))) = x', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 5, maxLength: 1028 }), (withCrc) => {
        const blocks = padAndSplit(withCrc);
        const g = geometry(withCrc.length - 4);
        expect(blocks.length).toBe(g.blocks);
        for (const b of blocks) expect(b.length).toBe(g.blockData);
        const stream = interleave(blocks);
        expect(stream.ok).toBe(true);
        if (!stream.ok) return;
        const back = deinterleave(stream.value, blocks.length);
        expect(back).toEqual({ ok: true, value: blocks });
        if (back.ok) expect(joinAndTrim(back.value, withCrc.length)).toEqual({ ok: true, value: withCrc });
      }),
      fcParams(50, 2000),
    );
  });

  it('places byte 0 of every block first, then byte 1 of every block', () => {
    const stream = interleave([Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6)]);
    expect(stream).toEqual({ ok: true, value: Uint8Array.of(1, 4, 2, 5, 3, 6) });
  });

  it('rejects malformed input without throwing', () => {
    expect(interleave([]).ok).toBe(false);
    expect(interleave([Uint8Array.of(1), Uint8Array.of(1, 2)]).ok).toBe(false);
    expect(deinterleave(new Uint8Array(5), 2).ok).toBe(false);
    expect(deinterleave(new Uint8Array(4), 0).ok).toBe(false);
    expect(joinAndTrim([Uint8Array.of(1)], 2).ok).toBe(false);
  });
});

describe('P7: permutation is a bijection and unpermute inverts it (R8.12, R8.14)', () => {
  it('i -> a·i mod L hits every index exactly once, for every valid P and profile (exhaustive)', () => {
    for (const { profile, P } of allCases) {
      const L = geometry(P).streamLength;
      const a = multiplier(P, profile.spread);
      const seen = new Uint8Array(L);
      for (let i = 0; i < L; i++) seen[(a * i) % L]! += 1;
      expect(seen.every((c) => c === 1), `${profile.name} P=${P}`).toBe(true);
    }
  });

  it('unpermute(permute(x, a), a) = x', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1024 }), fc.constantFrom(...PROFILES), (P, profile) => {
        const L = geometry(P).streamLength;
        const x = Uint8Array.from({ length: L }, (_, i) => (i * 131 + P) & 0xff);
        const a = multiplier(P, profile.spread);
        expect(unpermute(permute(x, a), a)).toEqual(x);
      }),
      fcParams(50, 2000),
    );
  });

  it('also reorders single-block streams (R8.15)', () => {
    const g = geometry(100);
    expect(g.blocks).toBe(1);
    const x = Uint8Array.from({ length: g.streamLength }, (_, i) => i & 0xff);
    expect(permute(x, multiplier(100, PROFILES[0]!.spread))).not.toEqual(x);
  });
});

describe('P8: every 16 consecutive transmitted bytes touch every block (R8.13)', () => {
  it('holds for every valid P and profile with B <= 16 (exhaustive)', () => {
    for (const { profile, P } of allCases) {
      const g = geometry(P);
      if (g.blocks > 16) continue;
      // Label every byte of block b (data, padding and parity) with b + 1.
      const tx = transmitLabelled(g, multiplier(P, profile.spread), (p) => Math.floor(p / g.blockData) + 1, 0, (b) => b + 1);
      for (let start = 0; start + 16 <= tx.length; start++) {
        const blocks = new Set(tx.subarray(start, start + 16));
        if (blocks.size < g.blocks) expect.fail(`${profile.name} P=${P}: window at ${start} covers ${blocks.size}/${g.blocks} blocks`);
      }
    }
  });
});

describe('P9: darkroom spread (R8.11, R8.16)', () => {
  it('a multiplier exists, and the first 10% of symbols reach every tenth, for every valid P and profile (exhaustive)', () => {
    let checked = 0;
    for (const { profile, P } of allCases) {
      const g = geometry(P);
      const a = multiplier(P, profile.spread);
      const bytes = bytesInFirstSymbols(Math.ceil(0.1 * payloadSymbolCount(g, profile.spread)), profile.spread);
      // Mark each payload byte with its tenth + 1; everything else is 0.
      const tenthOf = (p: number): number => {
        for (let t = 0; t < 10; t++) if (p >= Math.floor((t * P) / 10) && p < Math.floor(((t + 1) * P) / 10)) return t;
        return -1;
      };
      const tx = transmitLabelled(g, a, (p) => tenthOf(p) + 1, 0);
      const prefix = tx.subarray(0, bytes);
      // Bytes from P's tenths; tenthOf is never -1 for 0 <= p < P, so any non-zero byte is payload.
      const payloadBytes = prefix.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
      if (payloadBytes < 20) continue;
      checked++;
      for (let t = 1; t <= 10; t++) if (!prefix.includes(t)) expect.fail(`${profile.name} P=${P} a=${a}: tenth ${t - 1} empty`);
    }
    // Precondition met in 893 of 1,280 cases (scripts/check-scramble.mjs).
    expect(checked).toBe(893);
  });

  it('matches scripts/check-scramble.mjs for the 16 lengths where the approved rule changed a', () => {
    const expected: Record<number, number> = { 202: 145, 220: 175, 231: 181, 232: 181, 237: 193, 238: 193, 268: 205, 281: 213, 282: 213, 305: 229 };
    for (const [P, a] of Object.entries(expected)) expect(multiplier(Number(P), PROFILES[0]!.spread)).toBe(a);
    for (const P of [202, 220, 231, 232, 237, 238]) expect(multiplier(P, PROFILES[1]!.spread)).toBe(expected[P]);
  });

  it('rejects invalid arguments without throwing', () => {
    expect(chooseMultiplier(0, PROFILES[0]!.spread).ok).toBe(false);
    expect(chooseMultiplier(1.5, PROFILES[0]!.spread).ok).toBe(false);
    expect(chooseMultiplier(10, { bitsPerSymbol: 0, pilotEvery: 32 }).ok).toBe(false);
  });
});
