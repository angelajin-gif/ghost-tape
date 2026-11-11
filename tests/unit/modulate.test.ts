import { describe, expect, it } from 'vitest';
import {
  CHIRP_HIGH_HZ,
  CHIRP_LOW_HZ,
  frameLayout,
  POSTAMBLE_MS,
  PREAMBLE_MS,
  sampleAtMs,
  buildFrameSymbols,
  SYNC_TONES,
} from '../../src/modem/frame';
import {
  BELL_FLOOR,
  BELL_RISE_MS,
  encodePayload,
  PEAK_LEVEL,
  symbolEnvelope,
  type EncodedTrack,
} from '../../src/modem/modulate';
import { HEADER_PROFILE_NAME, MAX_TONE_HZ, MIN_TONE_HZ, PROFILES, profileByName, ROBUST, STANDARD, type Profile } from '../../src/modem/profiles';
import { serializePayload } from '../../src/modem/tape';
import type { Ghost, Payload, Tape } from '../../src/modem/types';
import { PENTATONIC } from '../support/profiles';
import { bandPower, dominantFrequencyHz, nextPowerOfTwo, powerSpectrum, toDb, toneEnergy } from '../support/dsp';

const RATES = [44100, 48000] as const;
const PHRASE = 'A letter hidden in sound, for whoever is listening. 1975 never really went away! ';

const ghost = (length: number): Ghost => ({ kind: 'ghost', message: PHRASE.repeat(3).slice(0, length) });

const typicalTape: Tape = {
  kind: 'tape',
  title: 'Songs for a Long Night',
  from: 'Angela',
  to: 'Ben',
  date: '2026-10-31',
  tracks: ['Fade Into You - Mazzy Star', 'Space Song - Beach House', 'Dreams - Fleetwood Mac', 'Los Angeles - Ferraby Lionheart', 'Kiss Me - Sixpence None The Richer'],
  letter: PHRASE.repeat(5).slice(0, 350),
};

const encode = (payload: Payload, profile: 'robust' | 'standard', sampleRate: number, passes?: number): EncodedTrack => {
  const r = encodePayload(payload, { profile, sampleRate, ...(passes !== undefined ? { passes } : {}) });
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

const framesFor = (payload: Payload, profile: Profile) => {
  const bytes = serializePayload(payload);
  if (!bytes.ok) throw new Error(bytes.reason);
  const frame = buildFrameSymbols(bytes.value, profile, PROFILES);
  if (!frame.ok) throw new Error(frame.reason);
  return { frame: frame.value, layout: frameLayout(frame.value.payloadTones.length, profile, ROBUST), size: bytes.value.length };
};

/** Start sample of every tone symbol and the profile that carries it: sync, header, payload. */
function symbolWindows(payload: Payload, profile: Profile) {
  const { frame, layout } = framesFor(payload, profile);
  const runs = [
    { startMs: layout.syncStartMs, profile: ROBUST, tones: Uint8Array.of(...frame.syncTones, ...frame.headerTones) },
    { startMs: layout.payloadStartMs, profile, tones: frame.payloadTones },
  ];
  return { layout, runs };
}

describe('length, level and format of the ghost track (R1.1, R1.4, R1.8)', () => {
  it.each(RATES)('a 100-character ghost lasts 12.15 s at %i Hz, mono, with duration equal to its length', (fs) => {
    const t = encode(ghost(100), 'standard', fs);
    expect(t.samples).toBeInstanceOf(Float32Array);
    expect(t.samples.length).toBe(Math.round(12.15 * fs));
    expect(t.durationSec).toBe(t.samples.length / fs);
    expect(t.durationSec).toBeCloseTo(12.15, 6);
  });

  it.each(RATES)('track length follows the frame layout for every profile and payload at %i Hz', (fs) => {
    for (const [payload, profile] of [[ghost(140), ROBUST], [ghost(1), STANDARD], [typicalTape, STANDARD]] as const) {
      const { layout } = framesFor(payload, profile);
      expect(encode(payload, profile.name as 'robust' | 'standard', fs).samples.length).toBe(sampleAtMs(layout.totalMs, fs));
    }
  });

  it('matches the design duration table: typical Standard tape ≈ 39 s, 140-char Robust ghost ≈ 41.8 s', () => {
    expect(encode(typicalTape, 'standard', 48000).durationSec).toBeGreaterThan(36);
    expect(encode(typicalTape, 'standard', 48000).durationSec).toBeLessThan(42);
    expect(encode(ghost(140), 'robust', 48000).durationSec).toBeCloseTo(41.75, 2);
  });

  it.each(RATES)('peak absolute amplitude is 0.8 of full scale at %i Hz, and every sample is finite', (fs) => {
    for (const [payload, profile] of [[ghost(100), 'standard'], [ghost(60), 'robust']] as const) {
      const { samples } = encode(payload, profile, fs);
      let peak = 0;
      for (const x of samples) {
        expect(Number.isFinite(x)).toBe(true);
        peak = Math.max(peak, Math.abs(x));
      }
      expect(peak).toBeGreaterThanOrEqual(0.5);
      expect(peak).toBeLessThanOrEqual(0.9);
      expect(peak).toBeCloseTo(PEAK_LEVEL, 6);
    }
  });

  it('is deterministic: the same input gives identical samples (no runtime randomness, R11.11)', () => {
    expect(encode(typicalTape, 'standard', 44100).samples).toEqual(encode(typicalTape, 'standard', 44100).samples);
  });

  it('keeps the 50 ms gap after the preamble and the sync-fade as exact digital silence', () => {
    const { samples } = encode(ghost(20), 'standard', 48000);
    // `=== 0` rather than Object.is: -0 is silence too, and encodes to the same 16-bit zero.
    for (let n = sampleAtMs(PREAMBLE_MS, 48000); n <= sampleAtMs(PREAMBLE_MS + 50, 48000); n++) expect(samples[n] === 0, `sample ${n}`).toBe(true);
    expect(samples[0] === 0).toBe(true);
    expect(samples[samples.length - 1] === 0).toBe(true);
  });
});

describe('rejections return a reason and no audio (R1.1–R1.3)', () => {
  const reason = (r: ReturnType<typeof encodePayload>): string => {
    expect(r.ok).toBe(false);
    expect('value' in r).toBe(false);
    return r.ok ? '' : r.reason;
  };

  it.each([8000, 22050, 44101, 96000, 0, -1, NaN, Infinity])('sample rate %s', (sampleRate) => {
    expect(reason(encodePayload(ghost(10), { profile: 'standard', sampleRate }))).toMatch(/sample rate/);
  });

  it.each([0, -1, 1.5, NaN])('passes %s', (passes) => {
    expect(reason(encodePayload(ghost(10), { profile: 'standard', sampleRate: 48000, passes }))).toMatch(/passes/);
  });

  it('an unknown profile name', () => {
    expect(reason(encodePayload(ghost(10), { profile: 'turbo', sampleRate: 48000 }))).toMatch(/unknown profile "turbo"/);
  });

  it('a tape over the Robust cap, naming the cap and the actual size (R1.2)', () => {
    const size = framesFor(typicalTape, STANDARD).size;
    const r = reason(encodePayload(typicalTape, { profile: 'robust', sampleRate: 48000 }));
    expect(r).toContain('256');
    expect(r).toContain(String(size));
  });

  it('an invalid field, naming the field', () => {
    expect(reason(encodePayload({ ...typicalTape, title: 'bad\u00e9' }, { profile: 'standard', sampleRate: 48000 }))).toMatch(/^title:/);
    expect(reason(encodePayload({ ...typicalTape, date: '2025-02-29' }, { profile: 'standard', sampleRate: 48000 }))).toMatch(/^date:/);
  });

  it('an invalid profile table', () => {
    expect(reason(encodePayload(ghost(10), { profile: 'standard', sampleRate: 48000, profiles: [STANDARD] }))).toMatch(/robust/);
  });

  it('a payload that is not an object, without throwing', () => {
    expect(reason(encodePayload(null as unknown as Payload, { profile: 'standard', sampleRate: 48000 }))).toMatch(/payload/);
  });

  it('an absurd number of passes before allocating memory', () => {
    expect(reason(encodePayload(ghost(10), { profile: 'standard', sampleRate: 48000, passes: 1e9 }))).toMatch(/limit/);
  });
});

describe('loop mode (R1.9)', () => {
  it.each(RATES)('N passes are N complete copies joined by exactly 1 s of zeros, nothing before or after (%i Hz)', (fs) => {
    const one = encode(ghost(30), 'standard', fs).samples;
    for (const n of [1, 2, 3, 5]) {
      const looped = encode(ghost(30), 'standard', fs, n).samples;
      expect(looped.length).toBe(n * one.length + (n - 1) * fs);
      for (let i = 0; i < n; i++) {
        const start = i * (one.length + fs);
        expect(looped.subarray(start, start + one.length)).toEqual(one);
        if (i < n - 1) {
          const gap = looped.subarray(start + one.length, start + one.length + fs);
          expect(gap.length).toBe(fs);
          expect(gap.every((x) => x === 0)).toBe(true);
        }
      }
    }
  });
});

describe('symbol envelopes (R1.11, R1.12)', () => {
  it('Robust bell: starts at 0.6, reaches 1.0 at 3 ms, decays to 0.6 at 50 ms', () => {
    expect(symbolEnvelope('bell', 0, 50)).toBeCloseTo(0.6, 12);
    expect(symbolEnvelope('bell', 3, 50)).toBeCloseTo(1.0, 12);
    expect(symbolEnvelope('bell', 50, 50)).toBeCloseTo(0.6, 12);
    expect(BELL_FLOOR).toBe(0.6);
    expect(BELL_RISE_MS).toBe(3);
  });

  it('rises monotonically over the first 3 ms and decays monotonically after', () => {
    let prev = symbolEnvelope('bell', 0, 50);
    for (let t = 0.05; t <= 3; t += 0.05) {
      const e = symbolEnvelope('bell', t, 50);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = e;
    }
    for (let t = 3.5; t <= 50; t += 0.5) {
      const e = symbolEnvelope('bell', t, 50);
      expect(e).toBeLessThan(prev);
      prev = e;
    }
  });

  it('Standard symbols are flat', () => {
    for (const t of [0, 1, 12.5, 24.99]) expect(symbolEnvelope('flat', t, 25)).toBe(1);
  });

  it('shapes the rendered Robust symbols the same way (peak of 1 ms windows × gain 0.8)', () => {
    const fs = 48000;
    const { samples } = encode(ghost(20), 'standard', fs);
    // Sync symbol index 4 (tone 1, 1475 Hz) starts at 450 + 4·50 = 650 ms.
    const start = sampleAtMs(650, fs);
    const peakIn = (fromMs: number, toMs: number): number => {
      let m = 0;
      for (let n = start + Math.round((fromMs * fs) / 1000); n < start + Math.round((toMs * fs) / 1000); n++) m = Math.max(m, Math.abs(samples[n]!));
      return m;
    };
    expect(peakIn(0, 1)).toBeLessThan(0.8 * 0.75);
    expect(peakIn(2.5, 3.5)).toBeGreaterThan(0.8 * 0.97);
    for (const t of [10, 20, 30, 40]) expect(peakIn(t, t + 1)).toBeCloseTo(0.8 * symbolEnvelope('bell', t + 0.5, 50), 1);
    expect(peakIn(49, 50)).toBeGreaterThan(0.8 * 0.6 * 0.97);
    expect(peakIn(49, 50)).toBeLessThan(0.8 * 0.6 * 1.04);
  });
});

describe('what is actually in the audio', () => {
  it.each(RATES)('each symbol carries its expected tone, sample-aligned, for sync, header and payload (%i Hz)', (fs) => {
    for (const [payload, profile] of [[ghost(100), STANDARD], [ghost(60), ROBUST], [ghost(100), STANDARD]] as const) {
      const { samples } = encode(payload, profile.name as 'robust' | 'standard', fs);
      const { runs } = symbolWindows(payload, profile);
      let checked = 0;
      for (const run of runs) {
        for (let k = 0; k < run.tones.length; k++) {
          const t0 = run.startMs + k * run.profile.symbolMs + run.profile.guardMs;
          const from = sampleAtMs(t0, fs);
          const length = sampleAtMs(t0 + run.profile.analysisMs, fs) - from;
          const energies = run.profile.tonesHz.map((f) => toneEnergy(samples, from, length, f, fs));
          const want = run.tones[k]!;
          energies.forEach((e, i) => {
            if (i !== want) expect(energies[want]! / Math.max(e, 1e-12), `${run.profile.name} symbol ${k}, tone ${i}`).toBeGreaterThan(30);
          });
          checked++;
        }
      }
      expect(checked).toBe(88 + framesFor(payload, profile).frame.payloadTones.length);
    }
  });

  it.each(RATES)('sync notes start at 450 ms and follow the motif 0,3,0,3,1,2,1,2 (%i Hz)', (fs) => {
    const { samples } = encode(ghost(10), 'standard', fs);
    SYNC_TONES.forEach((tone, k) => {
      const from = sampleAtMs(450 + k * 50 + 10, fs);
      const e = ROBUST.tonesHz.map((f) => toneEnergy(samples, from, sampleAtMs(450 + k * 50 + 50, fs) - from, f, fs));
      expect(e.indexOf(Math.max(...e))).toBe(tone);
    });
  });

  it.each(RATES)('the preamble sweeps up from 1000 to 3200 Hz and the postamble sweeps back down (%i Hz)', (fs) => {
    const { samples } = encode(ghost(10), 'standard', fs);
    const sweep = CHIRP_HIGH_HZ - CHIRP_LOW_HZ;
    const window = Math.round(0.02 * fs);
    for (const ms of [40, 120, 200, 280, 360]) {
      const mid = ms + 10;
      const expected = CHIRP_LOW_HZ + (sweep * mid) / PREAMBLE_MS;
      expect(Math.abs(dominantFrequencyHz(samples, sampleAtMs(ms, fs), window, fs) - expected), `up at ${ms} ms`).toBeLessThan(150);
    }
    const { layout } = framesFor(ghost(10), STANDARD);
    for (const ms of [20, 60, 100, 140, 175]) {
      const mid = ms + 10;
      const expected = CHIRP_HIGH_HZ - (sweep * mid) / POSTAMBLE_MS;
      expect(Math.abs(dominantFrequencyHz(samples, sampleAtMs(layout.postambleStartMs + ms, fs), window, fs) - expected), `down at ${ms} ms`).toBeLessThan(200);
    }
  });

  it.each(RATES)('keeps every tone and chirp inside 300–3400 Hz, with almost no energy outside (%i Hz)', (fs) => {
    for (const p of [ROBUST, STANDARD]) {
      for (const f of p.tonesHz) expect(f >= MIN_TONE_HZ && f <= 3400).toBe(true);
      expect(Math.max(...p.tonesHz)).toBeLessThanOrEqual(MAX_TONE_HZ);
    }
    expect(CHIRP_LOW_HZ).toBeGreaterThanOrEqual(300);
    expect(CHIRP_HIGH_HZ).toBeLessThanOrEqual(3400);
    for (const [payload, profile] of [[ghost(100), 'standard'], [ghost(60), 'robust']] as const) {
      const { samples } = encode(payload, profile, fs);
      const spectrum = powerSpectrum(samples, 0, samples.length, nextPowerOfTwo(samples.length), fs, true);
      const inBand = bandPower(spectrum, 300, 3400);
      const outside = bandPower(spectrum, 0, 300) + bandPower(spectrum, 3400, fs / 2);
      expect(toDb(inBand / outside), `${profile} at ${fs} Hz`).toBeGreaterThan(30);
    }
  });
});

describe('R1.7: no splatter above 4 kHz at symbol boundaries', () => {
  // Window choice matters. A plain rectangular 10 ms window leaks about -30 dB at 1 kHz
  // from any tone, whatever the signal does. A Hann window's own leakage falls far faster,
  // so what is measured here is the splatter the signal really makes at the boundary.
  function worstBoundaryDb(samples: Float32Array, boundaries: number[], fs: number): { db: number; at: number } {
    const length = Math.round(0.01 * fs);
    let worst = { db: Infinity, at: -1 };
    for (const b of boundaries) {
      const spectrum = powerSpectrum(samples, Math.round(b - length / 2), length, 8192, fs, true);
      const db = toDb(bandPower(spectrum, 300, 3400) / bandPower(spectrum, 4000, fs / 2));
      // A NaN here would make every "db >= 40" comparison pass without measuring anything.
      expect(Number.isFinite(db), `boundary at sample ${b}`).toBe(true);
      if (db < worst.db) worst = { db, at: b };
    }
    expect(worst.at).toBeGreaterThanOrEqual(0);
    return worst;
  }

  it.each(RATES)('every symbol boundary is at least 40 dB below the telephone band, both profiles (%i Hz)', (fs) => {
    for (const [payload, profile] of [[ghost(140), ROBUST], [ghost(140), STANDARD]] as const) {
      const { samples } = encode(payload, profile.name as 'robust' | 'standard', fs);
      const { runs } = symbolWindows(payload, profile);
      const boundaries: number[] = [];
      for (const run of runs) for (let k = 0; k < run.tones.length; k++) boundaries.push(sampleAtMs(run.startMs + k * run.profile.symbolMs, fs));
      expect(boundaries.length).toBe(88 + framesFor(payload, profile).frame.payloadTones.length);
      const worst = worstBoundaryDb(samples, boundaries, fs);
      expect(worst.db, `${profile.name} at ${fs} Hz, worst boundary sample ${worst.at}`).toBeGreaterThanOrEqual(40);
    }
  });

  it.each(RATES)('the edges of the tone stream (silence to tone, tone to chirp) are clean too (%i Hz)', (fs) => {
    const { samples } = encode(ghost(140), 'standard', fs);
    const { layout } = framesFor(ghost(140), STANDARD);
    const edges = [sampleAtMs(layout.syncStartMs, fs), sampleAtMs(layout.postambleStartMs, fs)];
    expect(worstBoundaryDb(samples, edges, fs).db).toBeGreaterThanOrEqual(40);
  });
});

describe('profiles are data (R9.7)', () => {
  it('an injected 3-bit profile encodes with no other source change', () => {
    const r = encodePayload(ghost(50), { profile: 'pentatonic', sampleRate: 48000, profiles: [...PROFILES, PENTATONIC] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(profileByName([...PROFILES, PENTATONIC], HEADER_PROFILE_NAME)).toBe(ROBUST);
    const bytes = serializePayload(ghost(50));
    if (!bytes.ok) throw new Error(bytes.reason);
    const frame = buildFrameSymbols(bytes.value, PENTATONIC, [...PROFILES, PENTATONIC]);
    if (!frame.ok) throw new Error(frame.reason);
    const layout = frameLayout(frame.value.payloadTones.length, PENTATONIC, ROBUST);
    expect(r.value.samples.length).toBe(sampleAtMs(layout.totalMs, 48000));
    // Spot-check that the audio carries the profile's own tones.
    const k = 10;
    const t0 = layout.payloadStartMs + k * 25 + 5;
    const from = sampleAtMs(t0, 48000);
    const e = PENTATONIC.tonesHz.map((f) => toneEnergy(r.value.samples, from, sampleAtMs(t0 + 20, 48000) - from, f, 48000));
    expect(e.indexOf(Math.max(...e))).toBe(frame.value.payloadTones[k]);
  });
});
