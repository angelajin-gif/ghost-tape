import { describe, expect, it } from 'vitest';
import { SampleBuffer } from '../../src/modem/buffer';
import { analysisSamples } from '../../src/modem/demodulate';
import { frameLayout, PREAMBLE_MS, sampleAtMs, CHIRP_HIGH_HZ, CHIRP_LOW_HZ } from '../../src/modem/frame';
import { renderChirp } from '../../src/modem/modulate';
import { ROBUST } from '../../src/modem/profiles';
import { chirpTemplate, ChirpDetector, fineTiming, fineTimingSpan, MIN_SYNC_FRACTION } from '../../src/modem/sync';
import { encodeOrThrow } from '../support/decode';
import { concat, rmsOf, whiteNoise } from '../support/random';

const RATES = [44100, 48000] as const;
const track = (fs: number): Float32Array => encodeOrThrow({ kind: 'ghost', message: 'Sync test.' }, 'standard', fs);

/** Feed a stream to a fresh detector in chunks, scanning after each; returns the first hit. */
function firstHit(samples: Float32Array, fs: number, chunk: number = samples.length): number | undefined {
  const detector = new ChirpDetector(fs);
  detector.resume(0);
  const buffer = new SampleBuffer();
  for (let offset = 0; offset < samples.length; offset += chunk) {
    buffer.append(samples.subarray(offset, Math.min(samples.length, offset + chunk)));
    const hit = detector.scan(buffer, false);
    if (hit !== undefined) return hit;
  }
  return detector.scan(buffer, true);
}

describe('chirp template', () => {
  it.each(RATES)('is the encoder chirp, sample for sample, at %i Hz (shared source of truth)', (fs) => {
    const t = chirpTemplate(fs);
    expect(t.length).toBe(sampleAtMs(PREAMBLE_MS, fs));
    const played = new Float32Array(t.length);
    renderChirp(played, 0, t.length, CHIRP_LOW_HZ, CHIRP_HIGH_HZ, PREAMBLE_MS, fs);
    for (let n = 0; n < t.length; n += 7) expect(t.im[n]).toBeCloseTo(played[n]!, 6);
    for (let n = 0; n < t.length; n += 7) expect(Math.hypot(t.re[n]!, t.im[n]!)).toBeLessThanOrEqual(1 + 1e-12); // amplitude = the taper
  });
});

describe('ChirpDetector finds the preamble (R3.2 smoke; full matrix in task 10)', () => {
  it.each(RATES)('at the exact sample, after silence or noise of any length (%i Hz)', (fs) => {
    const ghostTrack = track(fs);
    const noiseRms = rmsOf(ghostTrack);
    for (const lead of [0, 1, 777, Math.round(3.3 * fs) + 1, 123457]) {
      for (const kind of ['silence', 'noise'] as const) {
        const before = kind === 'silence' ? new Float32Array(lead) : whiteNoise(lead, noiseRms, lead + 1);
        const hit = firstHit(concat(before, ghostTrack), fs);
        expect(hit, `${kind} lead ${lead}`).toBeDefined();
        expect(Math.abs(hit! - lead), `${kind} lead ${lead}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is gain-independent: the same position at 0.001x and 50x', () => {
    const t = track(48000);
    const lead = new Float32Array(30000);
    for (const gain of [0.001, 1, 50]) expect(firstHit(concat(lead, t.map((x) => x * gain)), 48000)).toBe(firstHit(concat(lead, t), 48000));
  });

  it('gives the same answer however the audio is chunked', () => {
    const stream = concat(whiteNoise(40001, 0.1, 3), track(48000));
    const reference = firstHit(stream, 48000);
    expect(reference).toBeDefined();
    for (const chunk of [1000, 4096, 12345, 48000]) expect(firstHit(stream, 48000, chunk)).toBe(reference);
  });

  it('finds the next pass of a loop after resuming past the first', () => {
    const fs = 48000;
    const one = track(fs);
    const loop = concat(one, new Float32Array(fs), one);
    const detector = new ChirpDetector(fs);
    detector.resume(0);
    const buffer = new SampleBuffer();
    buffer.append(loop);
    const first = detector.scan(buffer, true);
    expect(first).toBe(0);
    detector.resume(first! + detector.templateLength);
    const second = detector.scan(buffer, true);
    expect(Math.abs(second! - (one.length + fs))).toBeLessThanOrEqual(1);
  });
});

describe('ChirpDetector stays quiet when there is no chirp', () => {
  const fs = 48000;
  const seconds = 8;
  const n = seconds * fs;

  it('on silence, white noise at several levels, a pure tone and the down-chirp', () => {
    const tone = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1500 * i) / fs));
    const t = track(fs);
    const downChirp = concat(new Float32Array(fs), t.slice(t.length - sampleAtMs(200, fs)), new Float32Array(fs));
    for (const x of [new Float32Array(n), whiteNoise(n, 0.001, 1), whiteNoise(n, 0.3, 2), whiteNoise(n, 1, 3), tone, downChirp]) {
      expect(firstHit(x, fs)).toBeUndefined();
    }
  });

  it('on a lone click in silence: the normalised-correlation check rejects it', () => {
    // In digital silence the median correlation is 0, so the ratio test alone would accept any click.
    const x = new Float32Array(n);
    x[40000] = 1;
    expect(firstHit(x, fs)).toBeUndefined();
    const y = new Float32Array(n);
    for (let i = 0; i < 50; i++) y[20000 + i * 3] = i % 2 ? 1 : -1; // a burst of clicks
    expect(firstHit(y, fs)).toBeUndefined();
  });

  it('on a short burst of noise in silence: the ratio test alone would accept it, normalised correlation rejects it', () => {
    // Against silence the median correlation is 0 and a noise burst makes a sharp, locally largest
    // peak, so only the NCC check (a burst correlates ~0.03 with the chirp, a real chirp 0.7) says no.
    for (const seed of [1, 2, 3, 4, 5]) {
      const x = new Float32Array(n);
      x.set(whiteNoise(480, 0.5, seed), 100000);
      expect(firstHit(x, fs), `seed ${seed}`).toBeUndefined();
    }
  });

  it('does not report a chirp whose first or last part is missing in a way that leaves no match', () => {
    const t = track(fs);
    expect(firstHit(t.slice(sampleAtMs(150, fs)), fs)).toBeUndefined(); // the first 150 ms of a 400 ms chirp is gone
  });
});

describe('fineTiming (design "Fine timing")', () => {
  const fs = 48000;
  const syncStartMs = frameLayout(0, ROBUST, ROBUST).syncStartMs;
  const buffer = new SampleBuffer();
  const t = track(fs);
  buffer.append(concat(new Float32Array(sampleAtMs(40, fs)), t)); // the pass really starts 40 ms into the stream

  it('keeps shift 0 when the chirp start is exact, with a score near 1', () => {
    const r = fineTiming(buffer, sampleAtMs(40, fs), syncStartMs, ROBUST, fs);
    expect(r).toBeDefined();
    expect(r!.shift).toBe(0);
    expect(r!.score).toBeGreaterThan(0.99);
  });

  it('pulls windows back when the chirp is reported late, until they end at most ~1 ms past the symbol edge', () => {
    // A window that ends 1-2 ms late only reaches the next symbol's 2 ms glide at low level, which costs
    // almost nothing, so exact alignment is not forced; more than ~1 ms of spill is.
    for (const lateMs of [1, 2, 4, 6, 8, 10]) {
      const r = fineTiming(buffer, sampleAtMs(40 + lateMs, fs), syncStartMs, ROBUST, fs);
      expect(r, `late ${lateMs} ms`).toBeDefined();
      const netMs = lateMs + (r!.shift * 1000) / fs;
      expect(netMs, `late ${lateMs} ms`).toBeLessThanOrEqual(1.1);
      expect(netMs, `late ${lateMs} ms`).toBeGreaterThanOrEqual(-0.1);
      expect(r!.score).toBeGreaterThan(0.99);
    }
  });

  it('accepts a chirp reported early (windows stay inside the symbol) and the score stays high', () => {
    for (const earlyMs of [1, 3, 6]) {
      const r = fineTiming(buffer, sampleAtMs(40 - earlyMs, fs), syncStartMs, ROBUST, fs);
      expect(r, `early ${earlyMs} ms`).toBeDefined();
      expect(r!.score).toBeGreaterThan(0.97);
    }
  });

  it('rejects silence and noise: no sync notes there', () => {
    for (const x of [new Float32Array(6 * fs), whiteNoise(6 * fs, 0.3, 8)]) {
      const b = new SampleBuffer();
      b.append(x);
      expect(fineTiming(b, 1000, syncStartMs, ROBUST, fs)).toBeUndefined();
    }
    expect(MIN_SYNC_FRACTION).toBeGreaterThan(0.25); // above what 4 random tones would score
  });

  it('knows how much audio it needs after the chirp start', () => {
    const span = fineTimingSpan(syncStartMs, ROBUST, fs);
    expect(span).toBeGreaterThan(sampleAtMs(syncStartMs + 400, fs));
    expect(span).toBeLessThan(sampleAtMs(syncStartMs + 400 + 12, fs));
    expect(analysisSamples(ROBUST, fs)).toBe(1920);
  });
});
