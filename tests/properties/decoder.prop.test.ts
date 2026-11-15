import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resample } from '../../src/modem/channel';
import { PROFILES } from '../../src/modem/profiles';
import { serializePayload } from '../../src/modem/tape';
import type { Payload, Tape } from '../../src/modem/types';
import { smallGhostArb, smallPayloadArb } from '../support/arbitraries';
import { decodeCounted, encodeOrThrow } from '../support/decode';
import { PENTATONIC } from '../support/profiles';
import { fcParams } from '../support/runs';

const profileArb = fc.constantFrom('standard', 'robust');
const rateArb = fc.constantFrom(44100, 48000);

/** A valid tape whose serialized size is exactly `size` bytes (title/from/to fixed, tracks and letter fill the rest). */
function tapeOfSize(size: number): Tape {
  for (let trackCount = 0; trackCount <= 10; trackCount++) {
    const tracks = Array.from({ length: trackCount }, (_, i) => `Track ${i + 1}: ` + 'la '.repeat(20).slice(0, 49));
    const fixed = serializePayload({ kind: 'tape', title: 'Title', from: 'From', to: 'To', tracks, letter: '' });
    if (!fixed.ok) throw new Error(fixed.reason);
    const letterLength = size - fixed.value.length;
    if (letterLength >= 0 && letterLength <= 800) {
      return { kind: 'tape', title: 'Title', from: 'From', to: 'To', tracks, letter: 'abcdefghij '.repeat(100).slice(0, letterLength) };
    }
  }
  throw new Error(`cannot build a tape of ${size} bytes`);
}

describe('P13: perfect channel, decodeFile(encodePayload(p)) = p (R1.1, R3.1)', () => {
  it('for every profile and both encoder rates', () => {
    fc.assert(
      fc.property(smallPayloadArb, profileArb, rateArb, (payload, profile, fs) => {
        const samples = encodeOrThrow(payload, profile, fs);
        const r = decodeCounted('P13 perfect channel', samples, fs);
        expect(r).toEqual({ ok: true, payload, passesUsed: 1 });
      }),
      fcParams(8, 14),
    );
  });

  it('decodes the smallest and largest payloads: 1-character ghost, 140-character ghost, and tapes of exactly 256 B (Robust cap) and 1024 B (Standard cap)', () => {
    const cases: Array<[Payload, string, number | undefined]> = [
      [{ kind: 'ghost', message: 'x' }, 'robust', undefined],
      [{ kind: 'ghost', message: 'y'.repeat(140) }, 'standard', undefined],
      [tapeOfSize(256), 'robust', 256],
      [tapeOfSize(1024), 'standard', 1024],
    ];
    for (const [payload, profile, size] of cases) {
      if (size !== undefined) {
        const bytes = serializePayload(payload);
        expect(bytes.ok && bytes.value.length).toBe(size);
      }
      const samples = encodeOrThrow(payload, profile, 48000);
      expect(decodeCounted('P13 size classes', samples, 48000)).toEqual({ ok: true, payload, passesUsed: 1 });
    }
  });
});

describe('P13 (R3.3): any sample rate from 16000 to 48000 Hz, perfect channel at that rate', () => {
  it.each([16000, 22050, 24000, 32000, 44100, 48000])('decodes at %i Hz', (rate) => {
    for (const profile of ['standard', 'robust']) {
      const payload: Payload = { kind: 'ghost', message: 'Rate test: 16 to 48 kHz.' };
      const source = encodeOrThrow(payload, profile, 48000);
      const samples = resample(source, 48000, rate);
      expect(decodeCounted('P13 rate sweep', samples, rate), `${profile} at ${rate} Hz`).toEqual({ ok: true, payload, passesUsed: 1 });
    }
  });

  it('decodes a 44.1 kHz encoding resampled to 16 kHz and a 48 kHz encoding resampled to 44.1 kHz', () => {
    const payload: Payload = { kind: 'tape', title: 'Resampled', from: 'A', to: 'B', tracks: ['One', 'Two'], letter: 'Hello.' };
    for (const [from, to] of [[44100, 16000], [48000, 44100]] as const) {
      const samples = resample(encodeOrThrow(payload, 'standard', from), from, to);
      expect(decodeCounted('P13 rate sweep', samples, to)).toEqual({ ok: true, payload, passesUsed: 1 });
    }
  });
});

describe('P14: any single pass cut from a looped ghost track decodes alone (R1.10)', () => {
  it('cuts each pass at its boundaries; the whole loop decodes too', () => {
    fc.assert(
      fc.property(smallGhostArb.filter((g) => g.message.length <= 12), profileArb, rateArb, fc.integer({ min: 2, max: 3 }), (payload, profile, fs, passes) => {
        const single = encodeOrThrow(payload, profile, fs).length;
        const loop = encodeOrThrow(payload, profile, fs, passes);
        expect(loop.length).toBe(passes * single + (passes - 1) * fs);
        for (let i = 0; i < passes; i++) {
          const from = i * (single + fs);
          expect(decodeCounted('P14 cut from loop', loop.slice(from, from + single), fs)).toEqual({ ok: true, payload, passesUsed: 1 });
        }
        expect(decodeCounted('P14 whole loop', loop, fs).ok).toBe(true);
      }),
      fcParams(2, 3),
    );
  });
});

describe('P24: a profile added to the table works with no other source change (R9.7)', () => {
  it('a made-up 3-bit profile round-trips through the full encoder and decoder', () => {
    const table = [...PROFILES, PENTATONIC];
    fc.assert(
      fc.property(smallGhostArb.filter((g) => g.message.length <= 10), rateArb, (payload, fs) => {
        const samples = encodeOrThrow(payload, 'pentatonic', fs, undefined, table);
        expect(decodeCounted('P24 injected profile', samples, fs, table)).toEqual({ ok: true, payload, passesUsed: 1 });
      }),
      fcParams(2, 3),
    );
  });

  it('the built-in table cannot decode that profile: header names a profile the table lacks', () => {
    const table = [...PROFILES, PENTATONIC];
    const samples = encodeOrThrow({ kind: 'ghost', message: 'only in the extended table' }, 'pentatonic', 48000, undefined, table);
    const r = decodeCounted('P24 injected profile', samples, 48000);
    expect(r.ok).toBe(false);
  });
});
