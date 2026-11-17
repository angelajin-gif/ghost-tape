import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyChannel, resample } from '../../src/modem/channel';
import { crc32 } from '../../src/modem/crc32';
import { createDecoder, decodeFile } from '../../src/modem/decoder';
import { frameLayout, sampleAtMs } from '../../src/modem/frame';
import { geometry, payloadSymbolCount } from '../../src/modem/interleave';
import { PROFILES, ROBUST, STANDARD } from '../../src/modem/profiles';
import { serializePayload } from '../../src/modem/tape';
import type { DecoderEvent, Ghost, Payload } from '../../src/modem/types';
import { decodeCounted, encodeOrThrow, runInChunks } from '../support/decode';
import { concat, mulberry32, rmsOf, whiteNoise } from '../support/random';
import { fcParams } from '../support/runs';

const FS = 48000;
const ghost = (message: string): Ghost => ({ kind: 'ghost', message });
const types = (events: DecoderEvent[]): string[] => events.map((e) => e.type);
const CELL = 'decoder unit tests';

const events = (samples: Float32Array, fs = FS, chunk = 4096): DecoderEvent[] => runInChunks(createDecoder({ sampleRate: fs }), samples, [chunk], CELL, fs);

describe('a clean pass produces the documented events (R8.1, R8.2, R8.4)', () => {
  const payload = ghost('Hello from the other side.');
  const bytes = serializePayload(payload);
  if (!bytes.ok) throw new Error(bytes.reason);

  it.each(['standard', 'robust'] as const)('%s: signal-detected, header, pass-complete, complete', (profileName) => {
    const profile = profileName === 'standard' ? STANDARD : ROBUST;
    const e = events(encodeOrThrow(payload, profileName, FS));
    expect(types(e)).toEqual(['signal-detected', 'header', 'pass-complete', 'complete']);
    const symbols = payloadSymbolCount(geometry(bytes.value.length), profile);
    expect(e[0]).toEqual({ type: 'signal-detected', atSample: 0 });
    expect(e[1]).toEqual({
      type: 'header',
      tapeId: crc32(bytes.value),
      profile: profileName,
      payloadLength: bytes.value.length,
      pass: 1,
      estimatedSecondsRemaining: (symbols * profile.symbolMs + 200) / 1000,
    });
    const complete = e[3] as Extract<DecoderEvent, { type: 'complete' }>;
    expect(complete.payload).toEqual(payload);
    expect(complete.tapeId).toBe(crc32(bytes.value));
    expect(complete.passesUsed).toBe(1);
    const done = e[2] as Extract<DecoderEvent, { type: 'pass-complete' }>;
    expect([done.blocksRecovered, done.blocksTotal, done.pass]).toEqual([1, 1, 1]);
    expect(done.clarity).toBeGreaterThan(0.9);
    expect(done.clarity).toBeLessThanOrEqual(1);
  });

  it('reports where the pass starts in the stream', () => {
    const lead = 123457;
    const e = events(concat(new Float32Array(lead), encodeOrThrow(payload, 'standard', FS)));
    const found = e.find((x) => x.type === 'signal-detected') as Extract<DecoderEvent, { type: 'signal-detected' }>;
    expect(Math.abs(found.atSample - lead)).toBeLessThanOrEqual(1);
  });

  it('counts passes of the same tape: pass 1, 2, 3 in a loop', () => {
    const e = events(encodeOrThrow(payload, 'standard', FS, 3));
    const headers = e.filter((x): x is Extract<DecoderEvent, { type: 'header' }> => x.type === 'header');
    expect(headers.map((h) => h.pass)).toEqual([1, 2, 3]);
    expect(e.filter((x) => x.type === 'complete')).toHaveLength(3);
  });

  it('decodes two different tapes one after another in one stream', () => {
    const other = ghost('A different message entirely.');
    const stream = concat(encodeOrThrow(payload, 'standard', FS), new Float32Array(FS), encodeOrThrow(other, 'robust', FS));
    const done = events(stream).filter((x): x is Extract<DecoderEvent, { type: 'complete' }> => x.type === 'complete');
    expect(done.map((d) => d.payload)).toEqual([payload, other]);
  });
});

describe('"no signal found" (R3.5)', () => {
  const noSignal = { ok: false, reason: 'no signal found', clarity: 0 };

  it('for empty input, a single sample and a few samples', () => {
    for (const n of [0, 1, 2, 100]) expect(decodeCounted(CELL, new Float32Array(n), FS)).toEqual(noSignal);
  });

  it('for silence, white noise at several levels, a pure tone and a lone click', () => {
    const seconds = 6;
    const n = seconds * FS;
    const tone = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1500 * i) / FS));
    const click = new Float32Array(n);
    click[40000] = 1;
    const inputs = [new Float32Array(n), whiteNoise(n, 0.01, 1), whiteNoise(n, 0.3, 2), whiteNoise(n, 1, 3), tone, click];
    for (const x of inputs) expect(decodeCounted(CELL, x, FS)).toEqual(noSignal);
  });

  it('for a ghost track with its preamble chirp cut off, and for the chirp alone', () => {
    const track = encodeOrThrow(ghost('Cut me.'), 'standard', FS);
    expect(decodeCounted(CELL, track.slice(sampleAtMs(450, FS)), FS)).toEqual(noSignal);
    expect(decodeCounted(CELL, concat(track.slice(0, sampleAtMs(400, FS)), new Float32Array(2 * FS)), FS)).toEqual(noSignal);
  });

  it('for the postamble chirp (down-sweep) alone', () => {
    const track = encodeOrThrow(ghost('Down chirp.'), 'standard', FS);
    expect(decodeCounted(CELL, concat(new Float32Array(FS), track.slice(track.length - sampleAtMs(200, FS))), FS)).toEqual(noSignal);
  });
});

describe('a track that is cut short', () => {
  const payload = ghost('Cut short somewhere.');
  const track = encodeOrThrow(payload, 'standard', FS);
  const layout = frameLayout(payloadSymbolCount(geometry(payload.message.length + 2), STANDARD), STANDARD, ROBUST);

  it('cut in the sync notes: nothing is reported', () => {
    expect(types(events(track.slice(0, sampleAtMs(layout.syncStartMs + 200, FS))))).toEqual([]);
  });

  it('cut in the header: signal-detected then pass-discarded(signal-lost)', () => {
    const e = events(track.slice(0, sampleAtMs(layout.headerStartMs + 2000, FS)));
    expect(e).toEqual([{ type: 'signal-detected', atSample: 0 }, { type: 'pass-discarded', reason: 'signal-lost' }]);
  });

  it('cut in the payload: header, then pass-discarded(signal-lost), and decodeFile says not yet developed', () => {
    const cut = track.slice(0, sampleAtMs(layout.payloadStartMs + 1500, FS));
    expect(types(events(cut))).toEqual(['signal-detected', 'header', 'pass-discarded']);
    const r = decodeCounted(CELL, cut, FS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not yet developed/);
  });
});

describe('damage inside the payload', () => {
  const payload: Payload = { kind: 'tape', title: 'Damaged', from: 'A', to: 'B', tracks: ['One', 'Two', 'Three'], letter: 'x'.repeat(200) };
  const bytes = serializePayload(payload);
  if (!bytes.ok) throw new Error(bytes.reason);
  const symbols = payloadSymbolCount(geometry(bytes.value.length), STANDARD);
  const layout = frameLayout(symbols, STANDARD, ROBUST);
  const track = encodeOrThrow(payload, 'standard', FS);

  it('a 120 ms dropout in the payload is repaired by Reed–Solomon and the tape still arrives', () => {
    const damaged = track.slice();
    damaged.fill(0, sampleAtMs(layout.payloadStartMs + 3000, FS), sampleAtMs(layout.payloadStartMs + 3120, FS));
    expect(decodeCounted(CELL, damaged, FS)).toEqual({ ok: true, payload, passesUsed: 1 });
  });

  it('a payload replaced by noise never completes, reports blocks lost and low clarity (R7.1, R7.9)', () => {
    const damaged = track.slice();
    const from = sampleAtMs(layout.payloadStartMs, FS);
    damaged.set(whiteNoise(sampleAtMs(layout.postambleStartMs, FS) - from, 0.3, 9), from);
    const e = events(damaged);
    expect(types(e)).toEqual(['signal-detected', 'header', 'pass-complete']);
    const done = e[2] as Extract<DecoderEvent, { type: 'pass-complete' }>;
    expect(done.blocksRecovered).toBeLessThan(done.blocksTotal);
    expect(done.clarity).toBeLessThan(0.5);
    expect(decodeCounted(CELL, damaged, FS).ok).toBe(false);
  });
});

describe('a bad header does not stop the decoder (R7.5, R7.6)', () => {
  it('discards the pass with header-invalid and decodes the next pass', () => {
    const first = ghost('This header will be destroyed.');
    const second = ghost('This pass arrives intact.');
    const damaged = encodeOrThrow(first, 'standard', FS).slice();
    const layout = frameLayout(10, STANDARD, ROBUST);
    damaged.set(whiteNoise(sampleAtMs(layout.payloadStartMs, FS) - sampleAtMs(layout.headerStartMs, FS), 0.4, 5), sampleAtMs(layout.headerStartMs, FS));
    const e = events(concat(damaged, new Float32Array(FS), encodeOrThrow(second, 'standard', FS)));
    expect(types(e)).toEqual(['signal-detected', 'pass-discarded', 'signal-detected', 'header', 'pass-complete', 'complete']);
    expect(e[1]).toEqual({ type: 'pass-discarded', reason: 'header-invalid' });
    expect((e[5] as Extract<DecoderEvent, { type: 'complete' }>).payload).toEqual(second);
  });
});

describe('chunking does not change what is decoded (R4.2, R4.3; full property P16 is task 13)', () => {
  it('zero-length, one-sample and odd-sized chunks give identical events', () => {
    const stream = concat(whiteNoise(30001, 0.02, 4), encodeOrThrow(ghost('Chunk me up.'), 'standard', FS), new Float32Array(777));
    const reference = events(stream, FS, stream.length);
    expect(types(reference)).toEqual(['signal-detected', 'header', 'pass-complete', 'complete']);
    for (const sizes of [[1, 2, 3, 0, 127, 128, 129, 1000, 4096, 7], [48000], [999], [1, 0, 1, 0, 5000]]) {
      expect(runInChunks(createDecoder({ sampleRate: FS }), stream, sizes, CELL, FS)).toEqual(reference);
    }
  });

  it('chunks of 1 sample around the start of the pass still find it', () => {
    const lead = whiteNoise(2000, 0.01, 6);
    const track = encodeOrThrow(ghost('One by one.'), 'standard', FS);
    const decoder = createDecoder({ sampleRate: FS });
    const out: DecoderEvent[] = [];
    for (const x of lead) out.push(...decoder.push(Float32Array.of(x)));
    out.push(...decoder.push(track.slice(0, 30000)));
    for (let i = 30000; i < 31000; i++) out.push(...decoder.push(Float32Array.of(track[i]!)));
    out.push(...decoder.push(track.slice(31000)), ...decoder.flush());
    expect(types(out)).toEqual(['signal-detected', 'header', 'pass-complete', 'complete']);
  });
});

describe('never throws, whatever the input (R3.6, R11.6)', () => {
  const sampleArb = fc.oneof(
    { weight: 6, arbitrary: fc.float({ min: -1, max: 1, noNaN: true }) },
    { weight: 1, arbitrary: fc.constantFrom(NaN, Infinity, -Infinity, 1, -1, 1e30, -1e30, 0) },
  );

  it('decodeFile on arbitrary samples and sample rates returns a failure result', () => {
    fc.assert(
      fc.property(fc.array(sampleArb, { maxLength: 3000 }), fc.constantFrom(16000, 44100, 48000, 8000, 96000, 0, -5, NaN, Infinity, 44100.5), (xs, rate) => {
        const r = decodeFile(Float32Array.from(xs), rate);
        expect(r.ok).toBe(false);
        expect(typeof (r as { reason: string }).reason).toBe('string');
      }),
      fcParams(50, 2000),
    );
  });

  it('push and flush on every length from 0 to 10, and on clipped or non-finite audio', () => {
    for (let n = 0; n <= 10; n++) {
      for (const fill of [0, 1, -1, NaN, Infinity, -Infinity]) {
        const d = createDecoder({ sampleRate: FS });
        expect(() => {
          d.push(new Float32Array(n).fill(fill));
          d.flush();
        }).not.toThrow();
      }
    }
    const noise = whiteNoise(60000, 1, 11).map((x) => Math.max(-1, Math.min(1, x * 10))); // heavily clipped
    expect(decodeCounted(CELL, noise, FS).ok).toBe(false);
  });

  it('survives garbage between and around real passes and still finds them', () => {
    const next = mulberry32(21);
    const a = ghost('First.');
    const b = ghost('Second.');
    const garbage = (n: number) => Float32Array.from({ length: n }, () => (next() < 0.001 ? (next() < 0.5 ? NaN : Infinity) : next() * 2 - 1));
    const stream = concat(garbage(20000), encodeOrThrow(a, 'standard', FS), garbage(30000), encodeOrThrow(b, 'robust', FS), garbage(5000));
    const done = events(stream).filter((x): x is Extract<DecoderEvent, { type: 'complete' }> => x.type === 'complete');
    expect(done.map((d) => d.payload)).toEqual([a, b]);
  });
});

describe('timing tracking at the decoder level (R5.2)', () => {
  const around = { before: { kind: 'silence', seconds: 1 }, after: { kind: 'silence', seconds: 1 } } as const;
  type Complete = Extract<DecoderEvent, { type: 'complete' }>;
  const completes = (e: DecoderEvent[]): Complete[] => e.filter((x): x is Complete => x.type === 'complete');

  it.each([['standard', 2000], ['standard', -2000], ['robust', 2000], ['robust', -2000]] as const)(
    'a looped %s track under a %i ppm clock error decodes every pass: the search resumes where the drifted pass really ends',
    (profile, ppm) => {
      const payload = ghost('Looped under drift.');
      const damaged = applyChannel(encodeOrThrow(payload, profile, FS, 3), FS, { rateMismatch: 1 + ppm / 1e6, ...around }, 3);
      const e = events(damaged);
      expect(completes(e).map((d) => d.payload)).toEqual([payload, payload, payload]);
      expect(e.filter((x) => x.type === 'pass-discarded')).toEqual([]);
    },
  );

  it.each([44100, 48000])('tracks well beyond the required ±0.2%: both profiles decode at ±0.5% (%i Hz)', (rate) => {
    const payload = ghost('Margin check.');
    for (const profile of ['standard', 'robust']) {
      for (const ppm of [5000, -5000]) {
        const damaged = applyChannel(encodeOrThrow(payload, profile, rate), rate, { rateMismatch: 1 + ppm / 1e6, ...around }, 4);
        expect(decodeCounted(CELL, damaged, rate), `${profile} ${ppm / 1e4}%`).toEqual({ ok: true, payload, passesUsed: 1 });
      }
    }
  });

  it('a rate conversion and a clock error together: 48 kHz -> 44.1 kHz then +0.2%, and 44.1 kHz -> 16 kHz then -0.2%', () => {
    const payload: Payload = { kind: 'tape', title: 'Both at once', from: 'A', to: 'B', tracks: ['One', 'Two'], letter: 'Resampled and drifting.' };
    for (const [from, to, ppm] of [[48000, 44100, 2000], [44100, 16000, -2000]] as const) {
      const converted = resample(encodeOrThrow(payload, 'standard', from), from, to);
      const damaged = applyChannel(converted, to, { rateMismatch: 1 + ppm / 1e6, ...around }, 5);
      expect(decodeCounted(CELL, damaged, to), `${from}->${to} then ${ppm / 1e4}%`).toEqual({ ok: true, payload, passesUsed: 1 });
    }
  });

  it('a clean channel is unaffected: tracking on a perfect clock finds nothing to correct and decodes exactly', () => {
    const payload = ghost('Perfect clock.');
    for (const profile of ['standard', 'robust']) expect(decodeCounted(CELL, encodeOrThrow(payload, profile, FS), FS)).toEqual({ ok: true, payload, passesUsed: 1 });
  });
});

describe('configuration and lifecycle', () => {
  it('an unsupported sample rate or profile table gives a decoder that ignores input; decodeFile explains', () => {
    for (const rate of [8000, 15999, 48001, 0, NaN]) {
      const d = createDecoder({ sampleRate: rate });
      expect(d.push(new Float32Array(1000))).toEqual([]);
      expect(d.flush()).toEqual([]);
      const r = decodeFile(new Float32Array(10), rate);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/sample rate/);
    }
    expect(createDecoder({ sampleRate: FS, profiles: [STANDARD] }).push(new Float32Array(100))).toEqual([]);
  });

  it('accepts the whole 16000–48000 Hz range, including both ends', () => {
    for (const rate of [16000, 16001, 30000, 47999, 48000]) expect(decodeCounted(CELL, new Float32Array(2000), rate).ok).toBe(false);
    const r = decodeFile(resample(encodeOrThrow(ghost('Edge of the range.'), 'standard', FS), FS, 16000), 16000);
    expect(r.ok).toBe(true);
  });

  it('reset() forgets pass counts; the decoder can be used again after flush()', () => {
    const track = encodeOrThrow(ghost('Again.'), 'standard', FS);
    const d = createDecoder({ sampleRate: FS });
    const first = runInChunks(d, track, [8192], CELL, FS);
    const second = runInChunks(d, track, [8192], CELL, FS); // flush() ended the stream; a new one starts
    expect(types(second)).toEqual(types(first));
    expect((second[1] as Extract<DecoderEvent, { type: 'header' }>).pass).toBe(2);
    d.reset();
    const third = runInChunks(d, track, [8192], CELL, FS);
    expect((third[1] as Extract<DecoderEvent, { type: 'header' }>).pass).toBe(1);
  });

  it('a gained track (x0.001, x4) decodes the same: decisions compare energies, not levels', () => {
    const payload = ghost('Level independent.');
    const track = encodeOrThrow(payload, 'standard', FS);
    for (const gain of [0.001, 0.05, 4]) {
      expect(decodeCounted(CELL, track.map((x) => x * gain), FS)).toEqual({ ok: true, payload, passesUsed: 1 });
    }
  });

  it('survives a loud lead-in at the ghost level (R3.2 smoke; the full matrix is task 10)', () => {
    const payload = ghost('After the noise.');
    const track = encodeOrThrow(payload, 'standard', FS);
    const lead = whiteNoise(5 * FS, rmsOf(track), 31);
    expect(decodeCounted(CELL, concat(lead, track, lead), FS)).toEqual({ ok: true, payload, passesUsed: 1 });
  });

  it('the built-in table is what createDecoder defaults to', () => {
    const track = encodeOrThrow(ghost('Defaults.'), 'standard', FS);
    expect(types(runInChunks(createDecoder({ sampleRate: FS, profiles: PROFILES }), track, [8192]))).toEqual(types(events(track)));
  });
});
