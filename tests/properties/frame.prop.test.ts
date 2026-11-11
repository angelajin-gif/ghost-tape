import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../src/modem/crc32';
import {
  buildFrameSymbols,
  buildHeader,
  buildPayloadSymbols,
  bytesToHeader,
  frameLayout,
  HEADER_BYTES,
  HEADER_DATA_BYTES,
  headerToBytes,
  headerToTones,
  parseFrameSymbols,
  parseHeader,
  parsePayloadSymbols,
  POSTAMBLE_MS,
  PREAMBLE_MS,
  sampleAtMs,
  SYNC_TONES,
  tonesToHeader,
  type Header,
} from '../../src/modem/frame';
import { geometry, payloadSymbolCount } from '../../src/modem/interleave';
import { PROFILES, ROBUST, STANDARD, type Profile } from '../../src/modem/profiles';
import { rsEncode } from '../../src/modem/reedSolomon';
import { PENTATONIC } from '../support/profiles';
import { fcParams } from '../support/runs';

const TABLE = [...PROFILES, PENTATONIC];
const profileArb = fc.constantFrom<Profile>(ROBUST, STANDARD, PENTATONIC);

const headerArb: fc.Arbitrary<Header> = profileArb.chain((p) =>
  fc.record({
    profileId: fc.constant(p.id),
    payloadKind: fc.constantFrom<0 | 1>(0, 1),
    payloadLength: fc.integer({ min: 1, max: p.capBytes }),
    tapeId: fc.integer({ min: 0, max: 0xffffffff }),
  }),
);

const payloadFor = (p: Profile) => fc.uint8Array({ minLength: 1, maxLength: p.capBytes });

const ok = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('P12: header round trip', () => {
  it('parseHeader(buildHeader(h)) = h and the symbol path inverts too', () => {
    fc.assert(
      fc.property(headerArb, (h) => {
        const bytes = ok(buildHeader(h, TABLE));
        expect(bytes.length).toBe(HEADER_BYTES);
        expect(parseHeader(bytes, TABLE)).toEqual({ ok: true, value: h });
        const tones = ok(headerToTones(h, TABLE));
        expect(tones.length).toBe(80);
        expect(Math.max(...tones)).toBeLessThan(4);
        expect(tonesToHeader(tones, TABLE)).toEqual({ ok: true, value: h });
      }),
      fcParams(50, 2000),
    );
  });

  it('lays the 12 data bytes out big-endian: "GT", version 1, profile, kind, length, flags 0, tapeId', () => {
    const bytes = ok(headerToBytes({ profileId: 1, payloadKind: 1, payloadLength: 0x0123, tapeId: 0xdeadbeef }, TABLE));
    expect([...bytes]).toEqual([0x47, 0x54, 0x01, 1, 1, 0x01, 0x23, 0, 0xde, 0xad, 0xbe, 0xef]);
  });

  it('corrects up to 4 corrupted bytes of the 20 (RS 12+8)', () => {
    fc.assert(
      fc.property(
        headerArb,
        fc.uniqueArray(fc.nat({ max: HEADER_BYTES - 1 }), { maxLength: 4 }),
        fc.array(fc.integer({ min: 1, max: 255 }), { minLength: 4, maxLength: 4 }),
        (h, positions, xors) => {
          const bytes = ok(buildHeader(h, TABLE)).slice();
          positions.forEach((p, i) => (bytes[p]! ^= xors[i]!));
          expect(parseHeader(bytes, TABLE)).toEqual({ ok: true, value: h });
        },
      ),
      fcParams(50, 2000),
    );
  });

  it('never throws on arbitrary bytes and only returns headers whose fields are valid', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 30 }), (bytes) => {
        const r = parseHeader(bytes, TABLE);
        if (r.ok) expect(headerToBytes(r.value, TABLE).ok).toBe(true);
      }),
      fcParams(50, 5000),
    );
  });
});

describe('header validation (R7.5): each bad field is rejected after a successful RS decode', () => {
  const good = ok(headerToBytes({ profileId: 1, payloadKind: 0, payloadLength: 100, tapeId: 7 }, TABLE)).slice();
  /** Re-protect a hand-edited 12-byte header with valid parity so only the field is wrong. */
  const reject = (edit: (b: Uint8Array) => void, pattern: RegExp): void => {
    const b = good.slice();
    edit(b);
    const r = parseHeader(ok(rsEncode(b, 8)), TABLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(pattern);
  };

  it.each([
    ['magic byte 0', (b: Uint8Array) => (b[0] = 0x48), /magic/],
    ['magic byte 1', (b: Uint8Array) => (b[1] = 0x00), /magic/],
    ['version 2', (b: Uint8Array) => (b[2] = 2), /version/],
    ['version 0', (b: Uint8Array) => (b[2] = 0), /version/],
    ['undefined profileId', (b: Uint8Array) => (b[3] = 9), /profileId/],
    ['payloadKind 2', (b: Uint8Array) => (b[4] = 2), /payloadKind/],
    ['payloadLength 0', (b: Uint8Array) => ((b[5] = 0), (b[6] = 0)), /payloadLength/],
    ['payloadLength 1025', (b: Uint8Array) => ((b[5] = 0x04), (b[6] = 0x01)), /payloadLength/],
    ['non-zero flags', (b: Uint8Array) => (b[7] = 1), /flags/],
  ])('%s', (_label, edit, pattern) => reject(edit, pattern));

  it('rejects payloadLength 257 for Robust but accepts 256, and 1024 for Standard', () => {
    reject((b) => ((b[3] = 0), (b[5] = 0x01), (b[6] = 0x01)), /exceeds the 256-byte cap/);
    expect(bytesToHeader(Uint8Array.of(0x47, 0x54, 1, 0, 0, 0x01, 0x00, 0, 0, 0, 0, 1), TABLE).ok).toBe(true);
    expect(bytesToHeader(Uint8Array.of(0x47, 0x54, 1, 1, 0, 0x04, 0x00, 0, 0, 0, 0, 1), TABLE).ok).toBe(true);
  });

  it('rejects more than 4 byte errors in the header', () => {
    const bytes = ok(buildHeader({ profileId: 1, payloadKind: 0, payloadLength: 100, tapeId: 7 }, TABLE)).slice();
    for (let i = 0; i < 5; i++) bytes[i * 3]! ^= 0xff;
    // RS may fail outright or land on a different codeword; either way the original header must not come back.
    const r = parseHeader(bytes, TABLE);
    if (r.ok) expect(r.value.tapeId === 7 && r.value.payloadLength === 100).toBe(false);
  });
});

describe('P12: payload symbols round trip', () => {
  it('parsePayloadSymbols(buildPayloadSymbols(x)) = x for every profile, including a 3-bit one', () => {
    fc.assert(
      fc.property(profileArb.chain((p) => fc.tuple(fc.constant(p), payloadFor(p))), ([p, payload]) => {
        const tones = ok(buildPayloadSymbols(payload, p));
        expect(tones.length).toBe(payloadSymbolCount(geometry(payload.length), p));
        for (const t of tones) expect(t).toBeLessThan(p.tonesHz.length);
        expect(parsePayloadSymbols(tones, payload.length, p)).toEqual({ ok: true, value: { payload, crc: crc32(payload) } });
      }),
      fcParams(50, 1000),
    );
  });

  it('puts a pilot after every 32 data symbols and nowhere else is forced', () => {
    for (const p of [ROBUST, STANDARD, PENTATONIC]) {
      const tones = ok(buildPayloadSymbols(new Uint8Array(200).map((_, i) => i * 7), p));
      for (let i = 0; i < tones.length; i++) {
        if ((i + 1) % 33 === 0) expect(tones[i], `${p.name} symbol ${i}`).toBe(p.pilotIndex);
      }
    }
  });

  it('matches the symbol counts in the design duration table', () => {
    expect(ok(buildPayloadSymbols(new Uint8Array(102).fill(1), STANDARD)).length).toBe(284);
    expect(ok(buildPayloadSymbols(new Uint8Array(560).fill(1), STANDARD)).length).toBe(1361);
    expect(ok(buildPayloadSymbols(new Uint8Array(1024).fill(1), STANDARD)).length).toBe(2454);
    expect(ok(buildPayloadSymbols(new Uint8Array(142).fill(1), ROBUST)).length).toBe(734);
    expect(ok(buildPayloadSymbols(new Uint8Array(256).fill(1), ROBUST)).length).toBe(1336);
  });

  it('survives up to 16 corrupted symbols (each damages at most one byte; blocks share the load)', () => {
    fc.assert(
      fc.property(
        profileArb.chain((p) =>
          fc.tuple(
            fc.constant(p),
            payloadFor(p),
            fc.uniqueArray(fc.nat({ max: 100000 }), { minLength: 0, maxLength: 16 }),
            fc.array(fc.nat({ max: 255 }), { minLength: 16, maxLength: 16 }),
          ),
        ),
        ([p, payload, where, replacement]) => {
          const tones = ok(buildPayloadSymbols(payload, p)).slice();
          where.forEach((w, i) => {
            const pos = w % tones.length;
            tones[pos] = replacement[i]! % p.tonesHz.length;
          });
          // Sixteen symbol errors can land on at most 16 bytes; if they all hit one RS block that is
          // exactly the limit, so the payload must still come back.
          expect(parsePayloadSymbols(tones, payload.length, p)).toEqual({ ok: true, value: { payload, crc: crc32(payload) } });
        },
      ),
      fcParams(50, 1000),
    );
  });

  it('rejects empty payloads, over-cap payloads and wrong symbol counts without throwing', () => {
    expect(buildPayloadSymbols(new Uint8Array(0), STANDARD).ok).toBe(false);
    expect(buildPayloadSymbols(new Uint8Array(257), ROBUST).ok).toBe(false);
    expect(buildPayloadSymbols(new Uint8Array(1025), STANDARD).ok).toBe(false);
    expect(parsePayloadSymbols(new Uint8Array(10), 100, STANDARD).ok).toBe(false);
    expect(parsePayloadSymbols(new Uint8Array(10), 0, STANDARD).ok).toBe(false);
  });

  it('never throws on arbitrary symbols; a returned payload always has a matching CRC', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.uint8Array({ maxLength: 3000 }), (len, noise) => {
        const n = payloadSymbolCount(geometry(len), STANDARD);
        const tones = new Uint8Array(n).map((_, i) => (noise[i % Math.max(1, noise.length)] ?? 0) & 15);
        const r = parsePayloadSymbols(tones, len, STANDARD);
        if (r.ok) expect(crc32(r.value.payload)).toBe(r.value.crc);
      }),
      fcParams(50, 1000),
    );
  });
});

describe('whole frame symbols', () => {
  const kindOf = (b: Uint8Array): Uint8Array => Uint8Array.of(b[0]! & 1, ...b.subarray(1));

  it('parseFrameSymbols(buildFrameSymbols(x)) = x, reading the profile from the header (R9.6)', () => {
    fc.assert(
      fc.property(profileArb.chain((p) => fc.tuple(fc.constant(p), payloadFor(p))), ([p, raw]) => {
        const payload = kindOf(raw);
        const frame = ok(buildFrameSymbols(payload, p, TABLE));
        expect(frame.header).toEqual({ profileId: p.id, payloadKind: payload[0], payloadLength: payload.length, tapeId: crc32(payload) });
        expect(frame.syncTones).toEqual(SYNC_TONES);
        expect(parseFrameSymbols(frame.headerTones, frame.payloadTones, TABLE)).toEqual({ ok: true, value: { header: frame.header, payload } });
      }),
      fcParams(50, 500),
    );
  });

  it('uses Robust tone indices for sync and header whatever the payload profile (R9.4)', () => {
    const frame = ok(buildFrameSymbols(Uint8Array.of(1, 3, 0x68, 0x69, 0x21), STANDARD, TABLE));
    expect(Math.max(...frame.syncTones, ...frame.headerTones)).toBeLessThan(4);
    expect(frame.headerTones.length).toBe(80);
    expect(frame.syncTones.length).toBe(8);
  });

  it('detects a payload whose CRC differs from the header tapeId', () => {
    const a = ok(buildFrameSymbols(Uint8Array.of(1, 2, 0x68, 0x69), STANDARD, TABLE));
    const b = ok(buildFrameSymbols(Uint8Array.of(1, 2, 0x68, 0x6a), STANDARD, TABLE));
    expect(parseFrameSymbols(a.headerTones, b.payloadTones, TABLE).ok).toBe(false);
  });

  it('rejects a payload whose kind byte is not 0 or 1', () => {
    expect(buildFrameSymbols(Uint8Array.of(2, 1, 0x41), STANDARD, TABLE).ok).toBe(false);
  });
});

describe('frame timeline (R1.13)', () => {
  it('matches the design: overture ends at 4,850 ms; typical Standard tape lasts 39.075 s', () => {
    const s = payloadSymbolCount(geometry(560), STANDARD);
    const l = frameLayout(s, STANDARD, ROBUST);
    expect([l.syncStartMs, l.headerStartMs, l.payloadStartMs]).toEqual([450, 850, 4850]);
    expect(l.postambleStartMs).toBe(4850 + 1361 * 25);
    expect(l.totalMs).toBe(4850 + 1361 * 25 + POSTAMBLE_MS);
    expect(PREAMBLE_MS).toBe(400);
    expect(HEADER_DATA_BYTES).toBe(12);
  });

  it('start sample = round(exact time · rate) with error at most half a sample and no build-up, at both rates', () => {
    for (const fs of [44100, 48000]) {
      for (const [startMs, symbolMs] of [[850, 50], [4850, 25]] as const) {
        let worst = 0;
        for (let k = 0; k < 2500; k++) {
          const exactSamples = ((startMs + k * symbolMs) * fs) / 1000;
          worst = Math.max(worst, Math.abs(sampleAtMs(startMs + k * symbolMs, fs) - exactSamples));
        }
        expect(worst, `${fs} Hz, ${symbolMs} ms symbols`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('a 25 ms symbol is 1102 or 1103 samples at 44,100 Hz, never drifting', () => {
    const lengths = new Set<number>();
    for (let k = 0; k < 400; k++) lengths.add(sampleAtMs(4850 + (k + 1) * 25, 44100) - sampleAtMs(4850 + k * 25, 44100));
    expect([...lengths].sort()).toEqual([1102, 1103]);
    expect(sampleAtMs(25000, 44100)).toBe(1102500);
  });
});
