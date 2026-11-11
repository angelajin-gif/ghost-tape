import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../../src/audio/wav';
import { encodePayload } from '../../src/modem/modulate';
import { fcParams } from '../support/runs';

const ok = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

const sampleArb = fc.float({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true });
const samplesArb = fc.array(sampleArb, { maxLength: 2000 }).map((a) => Float32Array.from(a));
const rateArb = fc.constantFrom(8000, 16000, 44100, 48000);

const u32 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const u16 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset).getUint16(o, true);
const text = (b: Uint8Array, o: number): string => String.fromCharCode(...b.subarray(o, o + 4));

describe('WAV round trip (R1.6)', () => {
  it('decodeWav(encodeWav(x)) keeps the length and sample rate, and each sample within one 16-bit step', () => {
    fc.assert(
      fc.property(samplesArb, rateArb, (x, fs) => {
        const back = ok(decodeWav(ok(encodeWav(x, fs))));
        expect(back.sampleRate).toBe(fs);
        expect(back.samples.length).toBe(x.length);
        for (let i = 0; i < x.length; i++) expect(Math.abs(back.samples[i]! - x[i]!)).toBeLessThanOrEqual(1 / 32768 + 1e-9);
      }),
      fcParams(50, 2000),
    );
  });

  it('is stable: re-encoding decoded samples gives identical bytes', () => {
    fc.assert(
      fc.property(samplesArb, rateArb, (x, fs) => {
        const bytes = ok(encodeWav(x, fs));
        const again = ok(encodeWav(ok(decodeWav(bytes)).samples, fs));
        expect(again).toEqual(bytes);
      }),
      fcParams(50, 2000),
    );
  });

  it('writes a canonical 44-byte header: mono, 16-bit PCM, at the given rate', () => {
    fc.assert(
      fc.property(samplesArb, rateArb, (x, fs) => {
        const b = ok(encodeWav(x, fs));
        expect(b.length).toBe(44 + 2 * x.length);
        expect([text(b, 0), text(b, 8), text(b, 12), text(b, 36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
        expect(u32(b, 4)).toBe(b.length - 8);
        expect([u32(b, 16), u16(b, 20), u16(b, 22), u32(b, 24), u32(b, 28), u16(b, 32), u16(b, 34), u32(b, 40)]).toEqual([16, 1, 1, fs, fs * 2, 2, 16, 2 * x.length]);
      }),
      fcParams(50, 1000),
    );
  });

  it('clamps out-of-range samples and turns non-finite samples into silence', () => {
    const b = ok(encodeWav(Float32Array.of(2, -2, 1, -1, NaN, Infinity, -Infinity, 0), 48000));
    const view = new DataView(b.buffer);
    const read = (i: number): number => view.getInt16(44 + 2 * i, true);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(read)).toEqual([32767, -32768, 32767, -32768, 0, 0, 0, 0]);
  });

  it('exports a real ghost track and reads it back at the track sample rate', () => {
    const track = ok(encodePayload({ kind: 'ghost', message: 'Meet at the old pier at nine.' }, { profile: 'standard', sampleRate: 44100 }));
    const back = ok(decodeWav(ok(encodeWav(track.samples, 44100))));
    expect(back.sampleRate).toBe(44100);
    expect(back.samples.length).toBe(track.samples.length);
    for (let i = 0; i < track.samples.length; i += 97) expect(Math.abs(back.samples[i]! - track.samples[i]!)).toBeLessThanOrEqual(1 / 32768 + 1e-9);
  });
});

describe('WAV failures are reported, never thrown', () => {
  const good = ok(encodeWav(Float32Array.of(0.1, -0.2, 0.3), 48000));
  const reason = (bytes: Uint8Array): string => {
    const r = decodeWav(bytes);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.reason;
  };
  const patched = (edit: (b: Uint8Array) => void): Uint8Array => {
    const c = good.slice();
    edit(c);
    return c;
  };

  it('rejects bad sample rates when encoding', () => {
    for (const fs of [0, -1, 1.5, NaN, 2 ** 33]) expect(encodeWav(new Float32Array(1), fs).ok).toBe(false);
  });

  it('rejects short, non-RIFF and wrong-format input', () => {
    expect(reason(new Uint8Array(5))).toMatch(/too short/);
    expect(reason(patched((b) => (b[0] = 0x58)))).toMatch(/RIFF/);
    expect(reason(patched((b) => (b[20] = 3)))).toMatch(/PCM/);
    expect(reason(patched((b) => (b[22] = 2)))).toMatch(/mono/);
    expect(reason(patched((b) => (b[34] = 8)))).toMatch(/16-bit/);
  });

  it('rejects files with no fmt or no data chunk', () => {
    expect(reason(good.slice(0, 12))).toMatch(/no fmt/);
    expect(reason(good.slice(0, 36))).toMatch(/no data/);
  });

  it('skips unknown chunks (with even padding) before the data chunk', () => {
    const extra = Uint8Array.of(0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0); // 'LIST', size 3, padded
    const withList = new Uint8Array(good.length + extra.length);
    withList.set(good.subarray(0, 36));
    withList.set(extra, 36);
    withList.set(good.subarray(36), 36 + extra.length);
    expect(ok(decodeWav(withList)).samples.length).toBe(3);
  });

  it('clamps a data size that runs past the end of the file', () => {
    const cut = good.slice(0, good.length - 3); // 6 data bytes -> 3: one whole sample and a stray byte
    expect(ok(decodeWav(cut)).samples.length).toBe(1);
  });

  it('never throws on arbitrary bytes', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => void decodeWav(bytes)), fcParams(50, 5000));
  });
});
