import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analysisSamples, decide, goertzelEnergies, normalizeEnergies, readSymbol, windowStart } from '../../src/modem/demodulate';
import { sampleAtMs } from '../../src/modem/frame';
import { PROFILES, ROBUST, STANDARD } from '../../src/modem/profiles';
import { fcParams } from '../support/runs';

const tone = (freqHz: number, rate: number, length: number, amplitude = 1, phase = 0): Float32Array =>
  Float32Array.from({ length }, (_, n) => amplitude * Math.sin((2 * Math.PI * freqHz * n) / rate + phase));

describe('goertzelEnergies', () => {
  it('equals |DFT at that frequency|² for any window and any frequency (the definition)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 200 }),
        fc.double({ min: 100, max: 7000, noNaN: true }),
        (xs, freq) => {
          const rate = 16000;
          const energy = goertzelEnergies(Float32Array.from(xs), [freq], rate)[0]!;
          let re = 0;
          let im = 0;
          const x32 = Float32Array.from(xs);
          x32.forEach((x, n) => {
            re += x * Math.cos((2 * Math.PI * freq * n) / rate);
            im -= x * Math.sin((2 * Math.PI * freq * n) / rate);
          });
          expect(energy).toBeCloseTo(re * re + im * im, 6);
        },
      ),
      fcParams(50, 2000),
    );
  });

  it('scales with amplitude squared and ignores the starting phase of a whole-cycle window', () => {
    const n = analysisSamples(STANDARD, 48000);
    const base = goertzelEnergies(tone(2000, 48000, n), [2000], 48000)[0]!;
    // Samples are stored as Float32, so ratios are exact only to about 1e-7.
    expect(goertzelEnergies(tone(2000, 48000, n, 3), [2000], 48000)[0]! / base).toBeCloseTo(9, 6);
    expect(goertzelEnergies(tone(2000, 48000, n, 1, 1.234), [2000], 48000)[0]! / base).toBeCloseTo(1, 6);
  });

  it.each([16000, 22050, 32000, 44100, 48000])('built-in tones are orthogonal at %i Hz: a clean tone leaks nothing into the others', (rate) => {
    for (const profile of PROFILES) {
      const n = analysisSamples(profile, rate);
      profile.tonesHz.forEach((f, k) => {
        const e = goertzelEnergies(tone(f, rate, n, 1, 0.7), profile.tonesHz, rate);
        e.forEach((v, j) => {
          if (j !== k) expect(v / e[k]!, `${profile.name} tone ${k} -> ${j} at ${rate} Hz`).toBeLessThan(1e-9);
        });
      });
    }
  });
});

describe('normalizeEnergies and decide', () => {
  it('normalised vectors sum to 1 and keep the ratios; zeros and non-finite input become zeros', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), { minLength: 2, maxLength: 16 }).filter((a) => a.some((v) => v > 0)), (xs) => {
        const out = normalizeEnergies(Float64Array.from(xs));
        expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        const total = xs.reduce((a, b) => a + b, 0);
        xs.forEach((v, i) => expect(out[i]).toBeCloseTo(v / total, 9));
      }),
      fcParams(50, 2000),
    );
    expect([...normalizeEnergies(new Float64Array(4))]).toEqual([0, 0, 0, 0]);
    expect([...normalizeEnergies(Float64Array.of(1, NaN))]).toEqual([0, 0]);
  });

  it('decide returns the strongest tone (first on a tie) with confidence 1 - second/best', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 2, maxLength: 16 }), (xs) => {
        const v = Float64Array.from(xs);
        const d = decide(v);
        expect(v[d.tone]).toBe(Math.max(...xs));
        expect(xs.indexOf(Math.max(...xs))).toBe(d.tone);
        expect(d.confidence).toBeGreaterThanOrEqual(0);
        expect(d.confidence).toBeLessThanOrEqual(1);
      }),
      fcParams(50, 2000),
    );
    expect(decide(Float64Array.of(0, 1, 0, 0))).toEqual({ tone: 1, confidence: 1 });
    expect(decide(Float64Array.of(0.5, 0.5, 0, 0))).toEqual({ tone: 0, confidence: 0 });
    expect(decide(Float64Array.of(0.6, 0.3, 0.1))).toEqual({ tone: 0, confidence: 0.5 });
    expect(decide(new Float64Array(4))).toEqual({ tone: 0, confidence: 0 });
  });

  it('readSymbol picks the right tone from a clean window, for every tone of both profiles', () => {
    for (const profile of PROFILES) {
      const n = analysisSamples(profile, 48000);
      profile.tonesHz.forEach((f, k) => {
        const d = decide(readSymbol(tone(f, 48000, n, 0.2), profile, 48000));
        expect(d.tone).toBe(k);
        expect(d.confidence).toBeGreaterThan(0.999);
      });
    }
  });
});

describe('window geometry', () => {
  it('analysis windows are whole numbers of samples at the encoder rates', () => {
    expect([analysisSamples(ROBUST, 44100), analysisSamples(ROBUST, 48000), analysisSamples(STANDARD, 44100), analysisSamples(STANDARD, 48000)]).toEqual([1764, 1920, 882, 960]);
  });

  it('windowStart skips the guard: pass start + shift + round(time of symbol k + guard)', () => {
    for (const fs of [44100, 48000, 16000]) {
      for (const k of [0, 1, 7, 100, 2000]) {
        expect(windowStart(1000, -12, 4850, k, STANDARD, fs)).toBe(1000 - 12 + sampleAtMs(4850 + k * 25 + 5, fs));
        expect(windowStart(0, 0, 850, k, ROBUST, fs)).toBe(sampleAtMs(850 + k * 50 + 10, fs));
      }
    }
  });
});
