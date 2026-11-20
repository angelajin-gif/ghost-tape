import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyChannel, deriveSeed, mulberry32, rms, SURROUND_KINDS, type ChannelSpec, type SurroundKind } from '../../src/modem/channel';
import { createDecoder, type PassSymbols } from '../../src/modem/decoder';
import { buildFrameSymbols, frameLayout, sampleAtMs } from '../../src/modem/frame';
import { geometry, payloadSymbolCount } from '../../src/modem/interleave';
import { PROFILES, ROBUST, STANDARD, type Profile } from '../../src/modem/profiles';
import { serializePayload } from '../../src/modem/tape';
import type { DecoderEvent, Payload } from '../../src/modem/types';
import { recordAudio, recordReport, recordTrial } from '../support/budget';
import { decodeCounted, encodeOrThrow, runInChunks } from '../support/decode';
import { ghostOfSize, tapeOfSize } from '../support/tapes';
import { fcParams, isDeep, seed as baseSeed } from '../support/runs';

type ProfileName = 'standard' | 'robust';
const PROFILE: Record<ProfileName, Profile> = { standard: STANDARD, robust: ROBUST };

/** Trials per cell (design "Deep-suite plan"): 10 Standard and 6 Robust in the deep suite, one smoke trial otherwise. */
const trialCount = (profile: ProfileName): number => (isDeep ? (profile === 'standard' ? 10 : 6) : 1);

interface Trial {
  readonly index: number;
  readonly profile: ProfileName;
  readonly sampleRate: number;
  readonly payload: Payload;
  readonly samples: Float32Array;
  /** Sample range of the payload symbols inside the track. */
  readonly payloadStart: number;
  readonly payloadEnd: number;
  readonly seed: number;
}

/** R5.9: typical-size tape (560 B) for Standard, 256 B tape for Robust; fast runs use a 60 B ghost. Half the trials per rate (R5.10). */
function makeTrial(cell: string, profile: ProfileName, index: number): Trial {
  const sampleRate = isDeep && index % 2 === 0 ? 44100 : 48000;
  const trialSeed = deriveSeed(baseSeed, cell.length, ...[...cell].map((c) => c.charCodeAt(0)), index);
  const payload = isDeep ? tapeOfSize(profile === 'standard' ? 560 : 256, trialSeed) : ghostOfSize(60, trialSeed);
  const samples = encodeOrThrow(payload, profile, sampleRate);
  const bytes = serializePayload(payload);
  if (!bytes.ok) throw new Error(bytes.reason);
  const p = PROFILE[profile];
  const layout = frameLayout(payloadSymbolCount(geometry(bytes.value.length), p), p, ROBUST);
  return { index, profile, sampleRate, payload, samples, payloadStart: sampleAtMs(layout.payloadStartMs, sampleRate), payloadEnd: sampleAtMs(layout.postambleStartMs, sampleRate), seed: trialSeed };
}

/**
 * Run one cell: every trial must decode to exactly the payload that was sent. A decoded payload that is
 * *different* from the input fails the test outright (P18, never wrong) and is not counted as a mere failure.
 */
function runCell(cell: string, profile: ProfileName, specFor: (t: Trial) => { spec: ChannelSpec; label: string }): void {
  const failures: string[] = [];
  for (let i = 0; i < trialCount(profile); i++) {
    const t = makeTrial(cell, profile, i);
    const { spec, label } = specFor(t);
    const damaged = applyChannel(t.samples, t.sampleRate, spec, t.seed);
    const result = decodeCounted(cell, damaged, t.sampleRate);
    if (result.ok) expect(result.payload, `${cell} trial ${i} (${label}): decoded a WRONG payload`).toEqual(t.payload);
    else failures.push(`trial ${i} @${t.sampleRate} Hz ${label}: ${result.reason}, clarity ${result.clarity.toFixed(2)}`);
  }
  expect(failures, `${cell}: ${failures.length} of ${trialCount(profile)} trials failed`).toEqual([]);
}

describe('P15: damaged channel, one impairment per trial (R5.1, R5.3–R5.6, R5.8–R5.10)', () => {
  describe.each(['standard', 'robust'] as const)('%s', (profile) => {
    it(`R5.1 gain 0.05x to 2x: both endpoints first, then seeded values`, () => {
      runCell(`R5.1 gain ${profile}`, profile, (t) => {
        const gain = t.index === 0 ? 0.05 : t.index === 1 ? 2 : 0.05 + 1.95 * mulberry32(t.seed)();
        return { spec: { gain }, label: `gain ${gain.toFixed(3)}` };
      });
    });

    it('R5.2 sample-rate mismatch −0.2% to +0.2%: both endpoints first, then seeded values', () => {
      // A real recording has quiet before and after the ghost, so the track sits inside 1 s of silence. A
      // file that began exactly at the chirp with a fast receiver clock would cut the chirp's correlation
      // peak off at sample 0 (its best-matching position lies before the file starts).
      runCell(`R5.2 rate mismatch ${profile}`, profile, (t) => {
        const ppm = t.index === 0 ? 2000 : t.index === 1 ? -2000 : Math.round(-2000 + 4000 * mulberry32(t.seed)());
        return {
          spec: { rateMismatch: 1 + ppm / 1e6, before: { kind: 'silence', seconds: 1 }, after: { kind: 'silence', seconds: 1 } },
          label: `clock ${ppm >= 0 ? '+' : ''}${(ppm / 1e4).toFixed(3)}%`,
        };
      });
    });

    it('R5.3 telephone band-pass 300–3400 Hz', () => {
      runCell(`R5.3 band-pass ${profile}`, profile, () => ({ spec: { bandPass: true }, label: 'band-pass' }));
    });

    it('R5.6 one dropout of up to 150 ms inside the payload, zeroed or noise at 4x RMS', () => {
      runCell(`R5.6 dropout ${profile}`, profile, (t) => {
        const next = mulberry32(t.seed);
        const lengthSamples = Math.round(((t.index < 2 ? 150 : 30 + 120 * next()) / 1000) * t.sampleRate);
        // First trial: at the very first payload symbol. Second: ending at the very last. Then anywhere in between.
        const start = t.index === 0 ? t.payloadStart : t.index === 1 ? t.payloadEnd - lengthSamples : t.payloadStart + Math.floor(next() * (t.payloadEnd - t.payloadStart - lengthSamples));
        const mode = t.index % 2 === 0 ? 'zero' : 'noise';
        return { spec: { dropout: { startSample: start, lengthSamples, mode } }, label: `${mode} dropout ${((lengthSamples / t.sampleRate) * 1000).toFixed(0)} ms at +${(((start - t.payloadStart) / t.sampleRate) * 1000).toFixed(0)} ms` };
      });
    });
  });

  // Levels from npm run measure (12 trials per level), re-run after timing tracking: every trial decoded
  // down to -7 dB (Standard) and -11 dB (Robust); each test level is 3 dB above that. The old 15 dB and
  // 6 dB placeholders could not fail.
  it('R5.4 white noise at -4 dB in-band SNR, Standard', () => {
    runCell('R5.4 noise -4 dB standard', 'standard', () => ({ spec: { noiseSnrDb: -4 }, label: 'SNR -4 dB' }));
  });

  it('R5.5 white noise at -8 dB in-band SNR, Robust', () => {
    runCell('R5.5 noise -8 dB robust', 'robust', () => ({ spec: { noiseSnrDb: -8 }, label: 'SNR -8 dB' }));
  });
});

describe('R5.2 at maximum size: a 1024-byte Standard tape, where the drift is largest (66 s)', () => {
  it('decodes at both ends of ±0.2% and at both sample rates', () => {
    const cases = isDeep
      ? [{ ppm: 2000, rate: 44100 }, { ppm: -2000, rate: 44100 }, { ppm: 2000, rate: 48000 }, { ppm: -2000, rate: 48000 }]
      : [{ ppm: 2000, rate: 48000 }];
    const failures: string[] = [];
    cases.forEach(({ ppm, rate }, i) => {
      const seed = deriveSeed(baseSeed, 1024, i);
      const payload = tapeOfSize(1024, seed);
      const damaged = applyChannel(encodeOrThrow(payload, 'standard', rate), rate, { rateMismatch: 1 + ppm / 1e6, before: { kind: 'silence', seconds: 1 }, after: { kind: 'silence', seconds: 1 } }, seed);
      const result = decodeCounted('R5.2 rate mismatch standard 1024 B', damaged, rate);
      if (result.ok) expect(result.payload, 'decoded a WRONG payload').toEqual(payload);
      else failures.push(`${ppm / 1e4}% @${rate} Hz: ${result.reason}, clarity ${result.clarity.toFixed(2)}`);
    });
    expect(failures).toEqual([]);
  });
});

describe('R3.2: surrounding audio before and after the ghost, at the ghost RMS', () => {
  it.each(SURROUND_KINDS)('%s', (kind: SurroundKind) => {
    const cell = `R3.2 surround ${kind}`;
    const failures: string[] = [];
    // Deep: Standard with the full 60 s each side, Standard with seeded 0-60 s, Robust with seeded 0-60 s. Fast: 3 s each side.
    const plan: Array<{ profile: ProfileName; fixed: boolean }> = isDeep ? [{ profile: 'standard', fixed: true }, { profile: 'standard', fixed: false }, { profile: 'robust', fixed: false }] : [{ profile: 'standard', fixed: false }];
    plan.forEach(({ profile, fixed }, i) => {
      const sampleRate = i % 2 === 0 ? 48000 : 44100;
      const trialSeed = deriveSeed(baseSeed, 32, kind.length, i);
      const payload = ghostOfSize(60, trialSeed);
      const next = mulberry32(trialSeed);
      const before = isDeep ? (fixed ? 60 : 60 * next()) : 3;
      const after = isDeep ? (fixed ? 60 : 60 * next()) : 3;
      const damaged = applyChannel(encodeOrThrow(payload, profile, sampleRate), sampleRate, { before: { kind, seconds: before }, after: { kind, seconds: after } }, trialSeed);
      const result = decodeCounted(cell, damaged, sampleRate);
      if (result.ok) expect(result.payload, `${cell}: decoded a WRONG payload`).toEqual(payload);
      else failures.push(`${profile} @${sampleRate} Hz, ${before.toFixed(1)} s before, ${after.toFixed(1)} s after: ${result.reason}`);
    });
    expect(failures, `${cell}`).toEqual([]);
  });
});

describe('R5.7: reverberation table (logged, not pass/fail)', () => {
  const RT60S = isDeep ? [50, 100, 150, 200, 300] : [100];

  it('reports trials, exact decodes and symbol error rate per RT60 and profile, and never decodes a wrong tape', () => {
    const rows: string[] = ['| RT60 | profile | trials | decoded exactly | passes found | symbol errors / symbols (SER) |', '|---|---|---|---|---|---|'];
    for (const rt60Ms of RT60S) {
      for (const profile of ['standard', 'robust'] as const) {
        let decoded = 0;
        let found = 0;
        let errors = 0;
        let symbols = 0;
        const trials = isDeep ? 2 : 1;
        for (let i = 0; i < trials; i++) {
          const t = makeTrial(`R5.7 reverb ${rt60Ms} ${profile}`, profile, i);
          const bytes = serializePayload(t.payload);
          const expectedFrame = bytes.ok ? buildFrameSymbols(bytes.value, PROFILE[profile], PROFILES) : undefined;
          if (!expectedFrame?.ok) throw new Error('could not build the expected symbols');
          const damaged = applyChannel(t.samples, t.sampleRate, { reverb: { rt60Ms, drrDb: 0 } }, t.seed);
          const passes: PassSymbols[] = [];
          const decoder = createDecoder({ sampleRate: t.sampleRate, onPassSymbols: (p) => passes.push(p) });
          const events: DecoderEvent[] = [...decoder.push(damaged), ...decoder.flush()];
          recordTrial(`R5.7 reverb ${profile}`);
          recordAudio(`R5.7 reverb ${profile}`, damaged.length, t.sampleRate);
          for (const e of events) if (e.type === 'complete') expect(e.payload, 'reverb: decoded a WRONG payload').toEqual(t.payload);
          if (events.some((e) => e.type === 'complete')) decoded++;
          if (passes.length > 0) {
            found++;
            const sent = expectedFrame.value.payloadTones;
            symbols += sent.length;
            errors += passes[0]!.tones.reduce((n, tone, k) => n + (tone !== sent[k] ? 1 : 0), 0);
          }
        }
        rows.push(`| ${rt60Ms} ms | ${profile} | ${trials} | ${decoded} | ${found} | ${errors} / ${symbols}${symbols ? ` (${((100 * errors) / symbols).toFixed(1)}%)` : ''} |`);
      }
    }
    recordReport('R5.7 reverberation, DRR 0 dB, single pass (2 trials per cell: one at 44.1 kHz, one at 48 kHz)', rows);
    expect(rows.length).toBeGreaterThan(2);
  });
});

describe('P18: never wrong, however the channel is damaged (R7.9)', () => {
  const specArb: fc.Arbitrary<{ profile: ProfileName; rate: number; seed: number; gain: number; snr: number | undefined; reverb: { rt60Ms: number; drrDb: number } | undefined; bandPass: boolean; dropoutAt: number | undefined; mismatchPpm: number | undefined; surround: SurroundKind | undefined }> = fc.record({
    profile: fc.constantFrom<ProfileName>('standard', 'robust'),
    rate: fc.constantFrom(44100, 48000),
    seed: fc.integer({ min: 1, max: 1e9 }),
    gain: fc.double({ min: 0.05, max: 2, noNaN: true }),
    snr: fc.option(fc.integer({ min: -25, max: 25 }), { nil: undefined }),
    reverb: fc.option(fc.record({ rt60Ms: fc.integer({ min: 50, max: 300 }), drrDb: fc.integer({ min: -6, max: 6 }) }), { nil: undefined }),
    bandPass: fc.boolean(),
    dropoutAt: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    mismatchPpm: fc.option(fc.integer({ min: -2000, max: 2000 }), { nil: undefined }),
    surround: fc.option(fc.constantFrom(...SURROUND_KINDS), { nil: undefined }),
  });

  it('every decoded payload equals the input byte for byte, across random combinations of impairments', () => {
    let decodedCount = 0;
    fc.assert(
      fc.property(specArb, (s) => {
        const payload = ghostOfSize(24, s.seed);
        const clean = encodeOrThrow(payload, s.profile, s.rate);
        const bytes = serializePayload(payload);
        if (!bytes.ok) throw new Error(bytes.reason);
        const p = PROFILE[s.profile];
        const layout = frameLayout(payloadSymbolCount(geometry(bytes.value.length), p), p, ROBUST);
        const start = sampleAtMs(layout.payloadStartMs, s.rate);
        const end = sampleAtMs(layout.postambleStartMs, s.rate);
        const dropLength = Math.round(0.15 * s.rate);
        const spec: ChannelSpec = {
          gain: s.gain,
          ...(s.snr !== undefined ? { noiseSnrDb: s.snr } : {}),
          ...(s.reverb ? { reverb: s.reverb } : {}),
          ...(s.bandPass ? { bandPass: true } : {}),
          ...(s.dropoutAt !== undefined ? { dropout: { startSample: Math.round(start + s.dropoutAt * (end - start - dropLength)), lengthSamples: dropLength, mode: 'noise' as const } } : {}),
          ...(s.mismatchPpm !== undefined ? { rateMismatch: 1 + s.mismatchPpm / 1e6 } : {}),
          ...(s.surround ? { before: { kind: s.surround, seconds: 2 }, after: { kind: s.surround, seconds: 1 } } : {}),
        };
        const damaged = applyChannel(clean, s.rate, spec, s.seed);
        const events = runInChunks(createDecoder({ sampleRate: s.rate }), damaged, [8192], 'P18 never wrong', s.rate);
        for (const e of events) {
          if (e.type === 'complete') {
            decodedCount++;
            expect(e.payload).toEqual(payload);
          }
        }
        expect(decodeCounted('P18 never wrong (decodeFile)', damaged, s.rate)).toSatisfy((r: { ok: boolean; payload?: Payload }) => !r.ok || JSON.stringify(r.payload) === JSON.stringify(payload));
      }),
      fcParams(4, 24),
    );
    // Not a requirement, a guard against the property passing only because nothing ever decodes.
    expect(decodedCount).toBeGreaterThan(0);
  });

  it('control: with no impairment at all the same setup does decode (the property is not vacuous)', () => {
    for (const profile of ['standard', 'robust'] as const) {
      const payload = ghostOfSize(24, 5);
      expect(rms(applyChannel(encodeOrThrow(payload, profile, 48000), 48000, {}, 1))).toBeGreaterThan(0);
      expect(decodeCounted('P18 control', applyChannel(encodeOrThrow(payload, profile, 48000), 48000, {}, 1), 48000)).toEqual({ ok: true, payload, passesUsed: 1 });
    }
  });
});
