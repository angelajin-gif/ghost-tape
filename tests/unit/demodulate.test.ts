import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  analysisSamples,
  calibrateGate,
  CLOCK_RATE_LIMIT,
  ClockTracker,
  decide,
  goertzelEnergies,
  goertzelEnergy,
  normalizeEnergies,
  readSymbol,
  windowStart,
} from '../../src/modem/demodulate';
import { renderSymbolRun } from '../../src/modem/modulate';
import { mulberry32 } from '../../src/modem/channel';
import { PENTATONIC } from '../support/profiles';
import { sampleAtMs } from '../../src/modem/frame';
import { PROFILES, ROBUST, STANDARD, type Profile } from '../../src/modem/profiles';
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

describe('goertzelEnergy (one tone)', () => {
  it('equals the matching entry of goertzelEnergies for any window and tone', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 300 }), fc.double({ min: 100, max: 7000, noNaN: true }), (xs, freq) => {
        const x = Float32Array.from(xs);
        expect(goertzelEnergy(x, freq, 16000)).toBeCloseTo(goertzelEnergies(x, [freq], 16000)[0]!, 9);
      }),
      fcParams(50, 1000),
    );
  });
});

describe('early/late gate calibration (timing tracking)', () => {
  const profiles = [ROBUST, STANDARD, PENTATONIC];

  it.each([16000, 44100, 48000])('every profile gets a usable gate with sensible probes at %i Hz, and the result is cached', (rate) => {
    for (const profile of profiles) {
      const gate = calibrateGate(profile, rate);
      expect(gate.usable, profile.name).toBe(true);
      expect(gate.targetShift).toBeLessThanOrEqual(0); // windows are kept a little before the nominal alignment
      expect(gate.targetShift).toBeGreaterThanOrEqual(-Math.round((profile.guardMs * rate) / 1000));
      expect(gate.earlyProbe).toBeGreaterThan(0);
      expect(gate.lateProbe).toBeGreaterThan(0);
      expect(calibrateGate(profile, rate)).toBe(gate);
    }
  });

  /**
   * Round trip: put the windows a known number of ms late, measure the two probe energies of the decided
   * tone on real rendered symbols (different tones from the calibration's), and ask the gate how late it
   * thinks they are. Averaged over the symbols whose neighbours differ, as the decoder does.
   */
  function estimatedLateness(profile: Profile, rate: number, latenessMs: number): number {
    const n = profile.tonesHz.length;
    const tones = Uint8Array.from({ length: 40 }, (_, k) => (k * 5 + 2) % n); // neighbours always differ
    const signal = renderSymbolRun(tones, profile, rate);
    const gate = calibrateGate(profile, rate);
    const length = analysisSamples(profile, rate);
    const estimates: number[] = [];
    for (let k = 8; k < 30; k++) {
      const start = sampleAtMs(k * profile.symbolMs + profile.guardMs, rate) + gate.targetShift + Math.round((latenessMs * rate) / 1000);
      const f = profile.tonesHz[tones[k]!]!;
      const early = goertzelEnergy(signal.subarray(start - gate.earlyProbe, start - gate.earlyProbe + length), f, rate);
      const late = goertzelEnergy(signal.subarray(start + gate.lateProbe, start + gate.lateProbe + length), f, rate);
      estimates.push(gate.latenessOf(Math.log(late / early)));
    }
    return ((estimates.reduce((a, b) => a + b, 0) / estimates.length) * 1000) / rate;
  }

  it.each([44100, 48000])('reads back the lateness it was given, Standard within 1 ms (%i Hz)', (rate) => {
    for (const ms of [-6, -4, -2, 0, 2, 4, 6]) expect(Math.abs(estimatedLateness(STANDARD, rate, ms) - ms), `${ms} ms late`).toBeLessThanOrEqual(1);
  });

  it.each([44100, 48000])('reads back the lateness it was given, Robust within 2.5 ms: its windows are far more tolerant (%i Hz)', (rate) => {
    for (const ms of [-8, -4, 0, 4, 8]) expect(Math.abs(estimatedLateness(ROBUST, rate, ms) - ms), `${ms} ms late`).toBeLessThanOrEqual(2.5);
  });

  it('works for a profile it was never built for (the 3-bit table entry)', () => {
    for (const ms of [-4, 0, 4]) expect(Math.abs(estimatedLateness(PENTATONIC, 48000, ms) - ms)).toBeLessThanOrEqual(1);
  });

  it('a later window always reads as later: the estimate rises with the true lateness', () => {
    for (const profile of profiles) {
      const readings = [-6, -3, 0, 3, 6].map((ms) => estimatedLateness(profile, 48000, ms));
      for (let i = 1; i < readings.length; i++) expect(readings[i]!, profile.name).toBeGreaterThan(readings[i - 1]!);
    }
  });
});

describe('ClockTracker (alpha-beta filter)', () => {
  const SYMBOL = 1200; // samples between readings, about one Standard symbol at 48 kHz

  /** Feed readings as the decoder would: lateness = what we predicted − where the symbol really is. */
  function run(truth: (t: number) => number, readings: number, noise: (k: number) => number = () => 0): { tracker: ClockTracker; error: number } {
    const tracker = new ClockTracker(0);
    for (let k = 1; k <= readings; k++) {
      const t = k * SYMBOL;
      tracker.update(t, tracker.predict(t) - truth(t) + noise(k));
    }
    const end = (readings + 1) * SYMBOL;
    return { tracker, error: tracker.predict(end) - truth(end) };
  }

  it('locks onto any steady drift: error under 2 samples and drift estimate within 2%, noiseless', () => {
    fc.assert(
      fc.property(fc.integer({ min: -300, max: 300 }), fc.double({ min: -0.003, max: 0.003, noNaN: true }), (offset, drift) => {
        const { tracker, error } = run((t) => offset + drift * t, 400);
        expect(Math.abs(error)).toBeLessThan(2);
        expect(Math.abs(tracker.drift - drift)).toBeLessThanOrEqual(Math.abs(drift) * 0.02 + 1e-6);
      }),
      fcParams(50, 1000),
    );
  });

  it('stays within a few samples with noisy readings (±30 samples is about ±0.6 ms at 48 kHz)', () => {
    const next = mulberry32(5);
    for (const drift of [0, 0.002, -0.002]) {
      let worst = 0;
      const tracker = new ClockTracker(0);
      for (let k = 1; k <= 600; k++) {
        const t = k * SYMBOL;
        const reading = tracker.predict(t) - drift * t + (next() - 0.5) * 60;
        tracker.update(t, reading);
        if (k > 100) worst = Math.max(worst, Math.abs(tracker.predict(t) - drift * t));
      }
      expect(worst, `drift ${drift}`).toBeLessThan(30);
    }
  });

  it('with no error it never moves, and the same readings give the same corrections (deterministic)', () => {
    const { tracker, error } = run(() => 0, 100);
    expect(error).toBe(0);
    expect(tracker.drift).toBe(0);
    const a = run((t) => 5 + 0.001 * t, 50).error;
    expect(run((t) => 5 + 0.001 * t, 50).error).toBe(a);
  });

  it('never believes a drift beyond its limit, however wrong the readings', () => {
    const tracker = new ClockTracker(0);
    for (let k = 1; k <= 300; k++) tracker.update(k * SYMBOL, 500); // keeps saying "too late"
    expect(Math.abs(tracker.drift)).toBeLessThanOrEqual(CLOCK_RATE_LIMIT);
    const other = new ClockTracker(0);
    for (let k = 1; k <= 300; k++) other.update(k * SYMBOL, -500);
    expect(Math.abs(other.drift)).toBeLessThanOrEqual(CLOCK_RATE_LIMIT);
  });

  it('recovers from a sudden jump in the signal timing (a step of 3 ms) within a few dozen readings', () => {
    const jump = 144; // 3 ms at 48 kHz
    const { error } = run((t) => (t > 100 * SYMBOL ? jump : 0), 200);
    expect(Math.abs(error)).toBeLessThan(3);
  });
});
