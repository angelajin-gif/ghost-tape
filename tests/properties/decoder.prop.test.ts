import fc from 'fast-check';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { resample, whiteNoise } from '../../src/modem/channel';
import { crc32 } from '../../src/modem/crc32';
import { createDecoder, PROGRESS_INTERVAL_MS } from '../../src/modem/decoder';
import { frameLayout, sampleAtMs } from '../../src/modem/frame';
import { bytesInFirstSymbols, geometry, payloadSymbolCount } from '../../src/modem/interleave';
import { PROFILES, ROBUST, STANDARD } from '../../src/modem/profiles';
import { serializePayload } from '../../src/modem/tape';
import type { Decoder, DecoderEvent, Payload, Tape } from '../../src/modem/types';
import { recordAudio, recordReport } from '../support/budget';
import { smallGhostArb, smallPayloadArb } from '../support/arbitraries';
import { decodeCounted, encodeOrThrow, losePayloadPart, payloadSpan, runInChunks } from '../support/decode';
import { PENTATONIC } from '../support/profiles';
import { concat } from '../support/random';
import { fcParams, isDeep } from '../support/runs';
import { tapeOfSize as seededTapeOfSize } from '../support/tapes';

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

// ---------- streaming events (task 13) ----------

const FS = 48000;
const ghostOf = (message: string): Payload => ({ kind: 'ghost', message });
const bytesOf = (p: Payload): Uint8Array => {
  const b = serializePayload(p);
  if (!b.ok) throw new Error(b.reason);
  return b.value;
};

/** Push the stream in fixed chunks and note, for every event, how many samples had been pushed when it came out (its audio time). */
function runTimed(decoder: Decoder, samples: Float32Array, chunk: number, cell: string): Array<{ event: DecoderEvent; at: number }> {
  recordAudio(cell, samples.length, FS);
  const out: Array<{ event: DecoderEvent; at: number }> = [];
  for (let at = 0; at < samples.length; at += chunk) {
    const end = Math.min(samples.length, at + chunk);
    for (const event of decoder.push(samples.subarray(at, end))) out.push({ event, at: end });
  }
  for (const event of decoder.flush()) out.push({ event, at: samples.length });
  return out;
}

/**
 * The event grammar of design "Events" as a checker. Returns every violation found (empty = fine).
 * Per pass: signal-detected, then either pass-discarded(header-invalid | signal-lost), or a header
 * followed by progress* and one of pass-complete [complete], pass-discarded(alignment-failed |
 * signal-lost); for a tape already complete: header then already-received (or signal-lost), with no
 * progress. complete comes straight after pass-complete, once per tape.
 */
function grammarViolations(events: readonly DecoderEvent[]): string[] {
  const out: string[] = [];
  type State = 'idle' | 'detected' | 'payload' | 'repeat' | 'passDone';
  let state: State = 'idle';
  let tape: number | undefined;
  let payloadLength = 0;
  const completed = new Set<number>();
  events.forEach((e, i) => {
    const bad = (why: string): void => void out.push(`event ${i} (${e.type}): ${why}`);
    switch (e.type) {
      case 'signal-detected':
        if (state !== 'idle' && state !== 'passDone') bad(`inside a pass (state ${state})`);
        state = 'detected';
        break;
      case 'header':
        if (state !== 'detected') bad(`not after signal-detected (state ${state})`);
        tape = e.tapeId;
        payloadLength = e.payloadLength;
        state = completed.has(e.tapeId) ? 'repeat' : 'payload';
        break;
      case 'progress':
        if (state !== 'payload' || e.tapeId !== tape) bad(`outside a payload of tape ${tape} (state ${state})`);
        if (!(e.fractionReceived > 0 && e.fractionReceived < 1)) bad(`fractionReceived ${e.fractionReceived}`);
        e.provisional.forEach((b, k) => {
          if (b.kind !== 'provisional') bad('entry not typed provisional');
          if (!(Number.isInteger(b.position) && b.position >= 0 && b.position < payloadLength)) bad(`position ${b.position} outside 0..${payloadLength - 1}`);
          if (!(b.confidence >= 0 && b.confidence <= 1)) bad(`confidence ${b.confidence}`);
          if (!(Number.isInteger(b.byte) && b.byte >= 0 && b.byte <= 255)) bad(`byte ${b.byte}`);
          if (k > 0 && b.position <= e.provisional[k - 1]!.position) bad('positions not strictly increasing');
        });
        break;
      case 'pass-complete':
        if (state !== 'payload' || e.tapeId !== tape) bad(`not ending a payload of tape ${tape} (state ${state})`);
        if (!(e.clarity >= 0 && e.clarity <= 1) || e.blocksRecovered < 0 || e.blocksRecovered > e.blocksTotal) bad('values out of range');
        state = 'passDone';
        break;
      case 'complete':
        if (state !== 'passDone' || e.tapeId !== tape || events[i - 1]?.type !== 'pass-complete') bad('not straight after its pass-complete');
        if (completed.has(e.tapeId)) bad('second complete for the same tape');
        if ('provisional' in e) bad('complete carries provisional bytes');
        completed.add(e.tapeId);
        state = 'idle';
        break;
      case 'already-received':
        if (state !== 'repeat' || e.tapeId !== tape) bad(`not ending a repeat pass (state ${state})`);
        state = 'idle';
        break;
      case 'pass-discarded': {
        const allowed: Record<typeof e.reason, readonly State[]> = {
          'header-invalid': ['detected'],
          'alignment-failed': ['payload'],
          'signal-lost': ['detected', 'payload', 'repeat'],
        };
        if (!allowed[e.reason].includes(state)) bad(`${e.reason} in state ${state}`);
        state = 'idle';
        break;
      }
    }
  });
  if (state !== 'idle' && state !== 'passDone') out.push(`stream ended inside a pass (state ${state})`);
  return out;
}

describe('the grammar checker itself (so P23 cannot pass vacuously)', () => {
  it('accepts the documented sequences and rejects broken ones', () => {
    const d: DecoderEvent = { type: 'signal-detected', atSample: 0 };
    const h: DecoderEvent = { type: 'header', tapeId: 7, profile: 'standard', payloadLength: 4, pass: 1, estimatedSecondsRemaining: 1 };
    const pr: DecoderEvent = { type: 'progress', tapeId: 7, provisional: [{ kind: 'provisional', position: 1, byte: 9, confidence: 0.5 }], fractionReceived: 0.5 };
    const pc: DecoderEvent = { type: 'pass-complete', tapeId: 7, pass: 1, blocksRecovered: 1, blocksTotal: 1, clarity: 0.9 };
    const c: DecoderEvent = { type: 'complete', tapeId: 7, payload: ghostOf('x'), passesUsed: 1 };
    const ar: DecoderEvent = { type: 'already-received', tapeId: 7 };
    expect(grammarViolations([d, h, pr, pc, c, d, h, ar, d, { type: 'pass-discarded', reason: 'header-invalid' }])).toEqual([]);
    expect(grammarViolations([d, h, pr, { type: 'pass-discarded', reason: 'alignment-failed' }])).toEqual([]);
    expect(grammarViolations([d, h, pr, pc, c, d, h, pc])).not.toEqual([]); // a repeat must not be combined again
    expect(grammarViolations([d, h, pc, c, d, h, pc, c])).not.toEqual([]); // second complete
    expect(grammarViolations([d, h, pc, c, d, h, pr, ar])).not.toEqual([]); // progress in a repeat
    expect(grammarViolations([d, pr])).not.toEqual([]); // progress before a header
    expect(grammarViolations([d, h, { ...pr, provisional: [{ kind: 'provisional', position: 4, byte: 0, confidence: 1 }] } as DecoderEvent, pc])).not.toEqual([]); // position ≥ P
    expect(grammarViolations([d, h])).not.toEqual([]); // stream ended mid-pass
  });
});

describe('P23: event grammar, progress cadence and provisional bytes (R7.5–7.7, R8.1–8.9, R8.17)', () => {
  // A small pool: each payload always uses the same profile (its tapeId is the CRC of the bytes, so the same text in two profiles would share an id).
  const pool = [
    { payload: ghostOf('First ghost on the air.'), profile: 'standard' },
    { payload: ghostOf('Second, a little longer, ghost message.'), profile: 'standard' },
    { payload: ghostOf('Robust one.'), profile: 'robust' },
  ] as const;
  const clean = pool.map((p) => encodeOrThrow(p.payload, p.profile, FS));
  const byTapeId = new Map(pool.map((p) => [crc32(bytesOf(p.payload)), p.payload] as const));
  type Damage = 'clean' | 'first-half' | 'second-half' | 'all-payload' | 'cut' | 'header';
  const segmentArb = fc.oneof(
    { weight: 4, arbitrary: fc.record({ kind: fc.constant('pass' as const), tape: fc.integer({ min: 0, max: 2 }), damage: fc.constantFrom<Damage>('clean', 'first-half', 'second-half', 'all-payload', 'cut', 'header') }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('gap' as const), noise: fc.boolean(), seconds: fc.double({ min: 0.1, max: 2, noNaN: true }) }) },
  );

  type Segment = { kind: 'pass'; tape: number; damage: Damage } | { kind: 'gap'; noise: boolean; seconds: number };
  function render(segments: readonly Segment[], seed: number): Float32Array {
    const parts: Float32Array[] = [];
    segments.forEach((s, i) => {
      if (s.kind === 'gap') {
        const n = Math.round(s.seconds * FS);
        parts.push(s.noise ? whiteNoise(n, 0.05, seed + i) : new Float32Array(n));
        return;
      }
      const { payload, profile } = pool[s.tape]!;
      const track = clean[s.tape]!;
      const span = payloadSpan(payload, profile, FS);
      const layout = frameLayout(payloadSymbolCount(geometry(bytesOf(payload).length), profile === 'robust' ? ROBUST : STANDARD), profile === 'robust' ? ROBUST : STANDARD, ROBUST);
      let pass: Float32Array;
      switch (s.damage) {
        case 'clean':
          pass = track;
          break;
        case 'first-half':
          pass = losePayloadPart(track, span, 0, 0.5, seed + i);
          break;
        case 'second-half':
          pass = losePayloadPart(track, span, 0.5, 1, seed + i);
          break;
        case 'all-payload':
          pass = losePayloadPart(track, span, 0, 1, seed + i);
          break;
        case 'cut':
          pass = track.slice(0, span.start + Math.round(0.6 * (span.end - span.start)));
          break;
        case 'header': {
          pass = track.slice();
          const from = sampleAtMs(layout.headerStartMs, FS);
          pass.set(whiteNoise(sampleAtMs(layout.payloadStartMs, FS) - from, 0.4, seed + i), from);
          break;
        }
      }
      parts.push(pass, new Float32Array(FS)); // 1 s of silence after every pass, as in a loop
    });
    return concat(...parts);
  }

  it('random sequences of clean, damaged, cut and repeated passes always follow the grammar, and every complete is the true tape', () => {
    fc.assert(
      fc.property(fc.array(segmentArb, { minLength: 1, maxLength: isDeep ? 6 : 4 }), fc.integer({ min: 1, max: 1_000_000 }), (segments, seed) => {
        const stream = render(segments, seed);
        const timed = runTimed(createDecoder({ sampleRate: FS }), stream, 128, 'P23 grammar');
        const events = timed.map((t) => t.event);
        expect(grammarViolations(events)).toEqual([]);
        for (const e of events) if (e.type === 'complete') expect(e.payload).toEqual(byTapeId.get(e.tapeId));
        // A tape whose first pass is clean completes on that pass.
        const firstPass = new Map<number, Damage>();
        for (const s of segments) if (s.kind === 'pass' && !firstPass.has(s.tape)) firstPass.set(s.tape, s.damage);
        for (const [tape, damage] of firstPass) {
          if (damage !== 'clean') continue;
          const id = crc32(bytesOf(pool[tape]!.payload));
          expect(events.some((e) => e.type === 'complete' && e.tapeId === id), `tape ${tape}`).toBe(true);
        }
        // Cadence (R8.3): from a header to the first progress, and between progress events, at most 250 ms of audio (here measured to 128 samples).
        let last: number | undefined;
        for (const { event, at } of timed) {
          if (event.type === 'header') last = at;
          else if (event.type === 'progress') {
            expect(at - last!).toBeLessThanOrEqual(sampleAtMs(250, FS));
            last = at;
          } else if (event.type !== 'signal-detected') last = undefined;
        }
      }),
      fcParams(3, 15),
    );
  });

  it('a clean pass sends progress every 200 ms of payload, in order, and the bytes it shows are the true bytes (R8.3, R8.8)', () => {
    const payload = ghostOf('Every flicker on screen is a real byte arriving.');
    const bytes = bytesOf(payload);
    const timed = runTimed(createDecoder({ sampleRate: FS }), encodeOrThrow(payload, 'standard', FS), 128, 'P23 grammar');
    const progress = timed.filter((t): t is { event: Extract<DecoderEvent, { type: 'progress' }>; at: number } => t.event.type === 'progress');
    const symbols = payloadSymbolCount(geometry(bytes.length), STANDARD);
    // One every 8 Standard symbols (200 ms), except at the very end, where the pass result follows instead.
    expect(progress.length).toBe(Math.ceil(symbols / (PROGRESS_INTERVAL_MS / STANDARD.symbolMs)) - 1);
    let shown = 0;
    let fraction = 0;
    for (const { event } of progress) {
      expect(event.fractionReceived).toBeGreaterThan(fraction);
      fraction = event.fractionReceived;
      expect(event.provisional.length).toBeGreaterThanOrEqual(shown); // a clean pass never loses a byte it showed
      shown = event.provisional.length;
      for (const b of event.provisional) expect(b.byte).toBe(bytes[b.position]);
    }
    for (let k = 1; k < progress.length; k++) {
      const gap = progress[k]!.at - progress[k - 1]!.at;
      expect(Math.abs(gap - sampleAtMs(200, FS))).toBeLessThanOrEqual(256); // 200 ms, to the chunk size
    }
  });

  it('provisional bytes combine retained passes with the current one (R8.9): the second pass shows most bytes from its first progress', () => {
    const payload = ghostOf(`${'Shown at once on the second play. '.repeat(5)}`.slice(0, 140));
    const P = bytesOf(payload).length;
    const span = payloadSpan(payload, 'standard', FS);
    const track = encodeOrThrow(payload, 'standard', FS);
    // The first 65% is clean, the rest drowned: accepted, its clean runs committed, but it cannot complete alone.
    const passA = losePayloadPart(track, span, 0.65, 1, 21);
    const events = runInChunks(createDecoder({ sampleRate: FS }), concat(passA, new Float32Array(FS), track), [4096], 'P23 grammar', FS);
    const firstProgress: Array<Extract<DecoderEvent, { type: 'progress' }>> = [];
    let headers = 0;
    for (const e of events) {
      if (e.type === 'header') headers++;
      if (e.type === 'progress' && firstProgress.length < headers) firstProgress.push(e);
    }
    expect(firstProgress).toHaveLength(2);
    // First play, 200 ms in: only what this pass has read. Second play, 200 ms in: the first play's evidence too.
    expect(firstProgress[0]!.provisional.length).toBeLessThan(0.2 * P);
    expect(firstProgress[1]!.provisional.length).toBeGreaterThan(0.5 * P);
    // The drowned 35% of the first play was not committed (S9 gating), so its bytes are not yet shown.
    expect(firstProgress[1]!.provisional.length).toBeLessThan(0.9 * P);
    for (const b of firstProgress[1]!.provisional) if (b.confidence > 0.9) expect(b.byte).toBe(bytesOf(payload)[b.position]);
  });

  it('a repeat of a completed tape sends no progress: header, then already-received (R8.17)', () => {
    const events = runInChunks(createDecoder({ sampleRate: FS }), encodeOrThrow(pool[0].payload, 'standard', FS, 2), [4096], 'P23 grammar', FS);
    const second = events.slice(events.findIndex((e) => e.type === 'complete') + 1);
    expect(second.map((e) => e.type)).toEqual(['signal-detected', 'header', 'already-received']);
  });
});

describe('R8.16 through the decoder: early bytes are spread over every tenth of the tape', () => {
  // The byte-level rule is checked exhaustively for every length in interleave.prop.test.ts; this checks the decoder delivers it.
  const cases: Array<{ size: number; profile: 'standard' | 'robust' }> = isDeep
    ? [{ size: 60, profile: 'standard' }, { size: 256, profile: 'standard' }, { size: 560, profile: 'standard' }, { size: 1024, profile: 'standard' }, { size: 60, profile: 'robust' }, { size: 256, profile: 'robust' }]
    : [{ size: 60, profile: 'standard' }, { size: 60, profile: 'robust' }];
  it.each(cases)('$profile, $size B', ({ size, profile }) => {
    const p = profile === 'robust' ? ROBUST : STANDARD;
    const payload = seededTapeOfSize(size, 0x816 + size);
    expect(bytesOf(payload).length).toBe(size);
    const events = runInChunks(createDecoder({ sampleRate: FS }), encodeOrThrow(payload, profile, FS), [4096], 'R8.16 spread', FS);
    const S = payloadSymbolCount(geometry(size), p);
    const needed = Math.ceil(0.1 * S);
    const first = events.find((e): e is Extract<DecoderEvent, { type: 'progress' }> => e.type === 'progress' && e.fractionReceived * S >= needed - 1e-9);
    expect(first).toBeDefined();
    const payloadBytes = first!.provisional.length;
    if (bytesInFirstSymbols(needed, p) >= 20 && payloadBytes >= 20) {
      for (let k = 0; k < 10; k++) {
        const lo = Math.floor((k * size) / 10);
        const hi = Math.floor(((k + 1) * size) / 10);
        expect(first!.provisional.some((b) => b.position >= lo && b.position < hi), `tenth ${k}`).toBe(true);
      }
    }
  });
});

describe('P16: chunking invariance (R4.2, R4.3)', () => {
  const payloadA = ghostOf('Chunk me any way you like.');
  const payloadB = ghostOf('A second tape in the same stream.');
  const spanA = payloadSpan(payloadA, 'standard', FS);
  const trackA = encodeOrThrow(payloadA, 'standard', FS);
  // Noise in front, a damaged pass, a clean pass, a different tape, a repeat, and a pass cut off by the end of the stream.
  const stream = concat(
    whiteNoise(12345, 0.05, 3),
    losePayloadPart(trackA, spanA, 0.2, 0.7, 4),
    new Float32Array(FS),
    trackA,
    new Float32Array(FS / 3),
    encodeOrThrow(payloadB, 'robust', FS),
    new Float32Array(FS),
    trackA, // a repeat: already-received
    new Float32Array(FS),
    trackA.slice(0, spanA.start + Math.round(0.5 * (spanA.end - spanA.start))),
  );
  const reference = runInChunks(createDecoder({ sampleRate: FS }), stream, [stream.length], 'P16 chunking', FS);

  it('the reference run itself is not trivial', () => {
    const kinds = new Set(reference.map((e) => e.type));
    for (const k of ['header', 'progress', 'pass-complete', 'complete', 'already-received', 'pass-discarded'] as const) expect(kinds.has(k), k).toBe(true);
  });

  it('random splits, including 0- and 1-sample chunks, give identical events', () => {
    const chunkArb = fc.oneof(fc.constant(0), fc.constant(1), fc.integer({ min: 2, max: 300 }), fc.integer({ min: 301, max: 20000 }), fc.integer({ min: 20001, max: 200000 }));
    fc.assert(
      fc.property(fc.array(chunkArb, { minLength: 1, maxLength: 40 }).filter((c) => c.some((n) => n > 1000)), (chunks) => {
        expect(runInChunks(createDecoder({ sampleRate: FS }), stream, chunks, 'P16 chunking', FS)).toEqual(reference);
      }),
      // Each run streams the 55 s scenario once: 10 deep runs ≈ 600 s of the audio cap.
      fcParams(4, 10),
    );
  });
});

describe('P17: push and flush never throw (R3.6, R11.6, R11.7)', () => {
  const special = fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1, -1, 0, Number.MAX_VALUE, -Number.MIN_VALUE);
  const sampleArb = fc.oneof(special, fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ noNaN: false }));
  const chunkArb = fc.array(sampleArb, { minLength: 0, maxLength: 10 }).map((xs) => Float32Array.from(xs));

  it('every buffer length 0–10 of finite, clipped and non-finite samples, in any order, with flush and reset mixed in', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof({ weight: 6, arbitrary: chunkArb.map((c) => ({ op: 'push' as const, c })) }, { weight: 1, arbitrary: fc.constantFrom({ op: 'flush' as const }, { op: 'reset' as const }) }), { maxLength: 60 }), (ops) => {
        const d = createDecoder({ sampleRate: FS });
        for (const o of ops) {
          if (o.op === 'push') expect(() => d.push(o.c)).not.toThrow();
          else if (o.op === 'flush') expect(() => d.flush()).not.toThrow();
          else expect(() => d.reset()).not.toThrow();
        }
        expect(() => d.flush()).not.toThrow();
      }),
      fcParams(50, 500),
    );
  });

  it('long noise, silence, a clipped square wave and all-NaN audio, around a real pass, never throw, and NaN counts as 0', () => {
    const payload = ghostOf('Still here after the garbage.');
    const track = encodeOrThrow(payload, 'standard', FS);
    const square = Float32Array.from({ length: FS }, (_, i) => (Math.floor(i / 20) % 2 === 0 ? 1 : -1));
    const nan = new Float32Array(FS / 2).fill(Number.NaN);
    const inf = Float32Array.from({ length: FS / 2 }, (_, i) => (i % 2 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY));
    const garbage = concat(whiteNoise(FS, 1, 5), new Float32Array(FS), square, nan, inf);
    const stream = concat(garbage, track, nan, garbage);
    const asZeros = concat(concat(whiteNoise(FS, 1, 5), new Float32Array(FS), square, new Float32Array(FS)), track, new Float32Array(FS / 2), concat(whiteNoise(FS, 1, 5), new Float32Array(FS), square, new Float32Array(FS)));
    let events: DecoderEvent[] = [];
    expect(() => (events = runInChunks(createDecoder({ sampleRate: FS }), stream, [997, 1, 0, 4096], 'P17 never throws', FS))).not.toThrow();
    expect(events.filter((e) => e.type === 'complete').map((e) => (e as Extract<DecoderEvent, { type: 'complete' }>).payload)).toEqual([payload]);
    expect(runInChunks(createDecoder({ sampleRate: FS }), asZeros, [997, 1, 0, 4096], 'P17 never throws', FS)).toEqual(events);
  });

  it('wrong inputs to push are ignored, not thrown on', () => {
    const d = createDecoder({ sampleRate: FS });
    const bad = [undefined, null, 3, 'samples', [0.1, 0.2], new Float64Array(10), {}] as unknown as Float32Array[];
    for (const x of bad) expect(() => d.push(x)).not.toThrow();
    expect(d.flush()).toEqual([]);
  });
});

describe('P21: tapes do not mix (R4.6, R4.7)', () => {
  const pool = [
    ghostOf('Tape one, first of four.'),
    ghostOf('Tape two has its own words.'),
    ghostOf('Tape three, somewhat different.'),
    ghostOf('And tape four closes the set.'),
  ];
  const tracks = pool.map((p) => encodeOrThrow(p, 'standard', FS));
  const spans = pool.map((p) => payloadSpan(p, 'standard', FS));

  /** Group events into passes (from one signal-detected to the next), keyed by the tapeId the pass's header named. */
  function passesByTape(events: readonly DecoderEvent[]): Map<number, unknown[][]> {
    const out = new Map<number, unknown[][]>();
    let current: DecoderEvent[] = [];
    const close = (): void => {
      const header = current.find((e): e is Extract<DecoderEvent, { type: 'header' }> => e.type === 'header');
      if (header) {
        const list = out.get(header.tapeId) ?? [];
        list.push(current.filter((e) => e.type !== 'signal-detected'));
        out.set(header.tapeId, list);
      }
      current = [];
    };
    for (const e of events) {
      if (e.type === 'signal-detected') close();
      current.push(e);
    }
    close();
    return out;
  }

  it('interleaved, partly damaged passes of 2–4 tapes give each tape what a fresh decoder fed only its passes gives', () => {
    const passArb = fc.record({ tape: fc.integer({ min: 0, max: 3 }), from: fc.double({ min: 0, max: 0.9, noNaN: true }), lost: fc.double({ min: 0, max: 0.6, noNaN: true }) });
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), fc.array(passArb, { minLength: 3, maxLength: 7 }), fc.integer({ min: 1, max: 10_000 }), (tapes, plan, seed) => {
        const passes = plan.map((p, i) => {
          const tape = p.tape % tapes;
          const to = Math.min(1, p.from + p.lost);
          return { tape, samples: p.lost < 0.05 ? tracks[tape]! : losePayloadPart(tracks[tape]!, spans[tape]!, p.from, to, seed + i) };
        });
        const gap = new Float32Array(FS);
        const mixed = runInChunks(createDecoder({ sampleRate: FS }), concat(...passes.flatMap((p) => [p.samples, gap])), [8192], 'P21 tapes do not mix', FS);
        const grouped = passesByTape(mixed);
        for (let t = 0; t < tapes; t++) {
          const own = passes.filter((p) => p.tape === t);
          if (own.length === 0) continue;
          const alone = runInChunks(createDecoder({ sampleRate: FS }), concat(...own.flatMap((p) => [p.samples, gap])), [8192], 'P21 tapes do not mix', FS);
          const id = crc32(bytesOf(pool[t]!));
          expect(grouped.get(id) ?? [], `tape ${t}`).toEqual(passesByTape(alone).get(id) ?? []);
        }
      }),
      fcParams(1, 4),
    );
  });
});

describe('R4.4: streaming speed with 128-sample chunks (deep suite only; wall clock)', () => {
  it.runIf(isDeep)('a 1024 B Standard tape decodes in at most 0.2× its audio duration', () => {
    const payload = seededTapeOfSize(1024, 0x44);
    const track = encodeOrThrow(payload, 'standard', FS);
    recordAudio('R4.4 benchmark', track.length, FS);
    const d = createDecoder({ sampleRate: FS });
    const events: DecoderEvent[] = [];
    const t0 = performance.now();
    for (let at = 0; at < track.length; at += 128) events.push(...d.push(track.subarray(at, Math.min(track.length, at + 128))));
    events.push(...d.flush());
    const seconds = (performance.now() - t0) / 1000;
    const duration = track.length / FS;
    recordReport('R4.4 streaming benchmark (Node, 128-sample chunks)', [`1024 B Standard: ${duration.toFixed(1)} s of audio decoded in ${seconds.toFixed(2)} s = ${(seconds / duration).toFixed(3)}× the audio duration (limit 0.2×)`]);
    expect(events.find((e) => e.type === 'complete')).toMatchObject({ payload });
    expect(seconds / duration).toBeLessThanOrEqual(0.2);
  });
});

