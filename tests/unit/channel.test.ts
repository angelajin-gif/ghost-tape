import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addNoiseAtSnr,
  applyChannel,
  applyGain,
  convolve,
  damagePasses,
  deriveSeed,
  dropout,
  inBandPower,
  rateMismatch,
  reverb,
  rms,
  roomImpulseResponse,
  snrDb,
  surroundingAudio,
  SURROUND_KINDS,
  telephoneBandPass,
  whiteNoise,
  type ChannelSpec,
} from '../../src/modem/channel';
import { bandPower, nextPowerOfTwo, powerSpectrum, toneEnergy } from '../support/dsp';
import { fcParams } from '../support/runs';

const RATES = [16000, 44100, 48000] as const;
const sine = (freqHz: number, rate: number, seconds: number, amplitude = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, n) => amplitude * Math.sin((2 * Math.PI * freqHz * n) / rate));
/** In-band content with several tones, so SNR tests have something realistic to measure. */
const multiTone = (rate: number, seconds: number): Float32Array => {
  const parts = [1175, 1475, 1750, 2350].map((f, i) => sine(f, rate, seconds, 0.2 + 0.05 * i));
  return Float32Array.from({ length: parts[0]!.length }, (_, n) => parts.reduce((s, p) => s + p[n]!, 0));
};
const gainAt = (freqHz: number, rate: number, filter: (x: Float32Array) => Float32Array): number => {
  const out = filter(sine(freqHz, rate, 1, 1));
  return rms(out.subarray(Math.round(rate / 2))) / rms(sine(freqHz, rate, 0.5, 1));
};

describe('seeds and noise (R11.3)', () => {
  it('deriveSeed is deterministic, tag-sensitive and an unsigned 32-bit integer', () => {
    expect(deriveSeed(7, 1, 2)).toBe(deriveSeed(7, 1, 2));
    expect(new Set([deriveSeed(7, 1), deriveSeed(7, 2), deriveSeed(8, 1), deriveSeed(7, 1, 0)]).size).toBe(4);
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (seed, tag) => {
        const s = deriveSeed(seed, tag);
        expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
      }),
      fcParams(50, 1000),
    );
  });

  it('whiteNoise has the requested RMS and zero mean, and the same seed gives the same noise', () => {
    for (const length of [1, 2, 999, 50001]) {
      const x = whiteNoise(length, 0.3, 5);
      expect(x).toEqual(whiteNoise(length, 0.3, 5));
      expect(x.length).toBe(length);
    }
    const big = whiteNoise(200000, 0.3, 5);
    expect(rms(big)).toBeGreaterThan(0.3 * 0.98);
    expect(rms(big)).toBeLessThan(0.3 * 1.02);
    expect(Math.abs(big.reduce((s, v) => s + v, 0) / big.length)).toBeLessThan(0.005);
    expect(whiteNoise(1000, 1, 1)).not.toEqual(whiteNoise(1000, 1, 2));
  });
});

describe('measuring: in-band power and SNR', () => {
  it.each(RATES)('a 1 kHz tone of amplitude a has power a²/2 at %i Hz; a 6 kHz tone is outside the band', (rate) => {
    expect(inBandPower(sine(1000, rate, 1, 0.5), rate)).toBeCloseTo(0.125, 2);
    expect(inBandPower(sine(6000, rate, 1, 0.5), rate)).toBeLessThan(1e-4);
    expect(inBandPower(sine(100, rate, 1, 0.5), rate)).toBeLessThan(1e-3);
  });

  it.each(RATES)('white noise of RMS σ has in-band power σ² × (3100 / (fs/2)) at %i Hz', (rate) => {
    const x = whiteNoise(rate * 2, 0.4, 3);
    const expected = 0.16 * (3100 / (rate / 2));
    expect(inBandPower(x, rate)).toBeGreaterThan(expected * 0.95);
    expect(inBandPower(x, rate)).toBeLessThan(expected * 1.05);
  });

  it('handles signals shorter and longer than one analysis segment, and empty input', () => {
    expect(inBandPower(new Float32Array(0), 48000)).toBe(0);
    for (const length of [1000, 65536, 65537, 150000]) {
      const x = sine(1500, 48000, length / 48000);
      expect(inBandPower(x, 48000), `length ${length}`).toBeGreaterThan(0.11);
      expect(inBandPower(x, 48000), `length ${length}`).toBeLessThan(0.14);
    }
    // A 10-sample burst has no clear spectral line, so only a finite, non-negative number is promised.
    const tiny = inBandPower(sine(1500, 48000, 10 / 48000), 48000);
    expect(Number.isFinite(tiny) && tiny >= 0).toBe(true);
  });
});

describe('white noise at a target SNR (R5.4, R5.5)', () => {
  it('achieves the requested in-band SNR exactly, at any length, rate and level', () => {
    fc.assert(
      fc.property(fc.constantFrom(...RATES), fc.integer({ min: 20000, max: 300000 }), fc.integer({ min: -20, max: 30 }), fc.integer({ min: 1, max: 1e6 }), (rate, length, snr, seed) => {
        const x = multiTone(rate, length / rate);
        const y = addNoiseAtSnr(x, snr, rate, seed);
        const noise = y.map((v, i) => v - x[i]!);
        expect(Math.abs(snrDb(x, noise, rate) - snr)).toBeLessThan(0.02);
      }),
      fcParams(50, 200),
    );
  });

  it('is deterministic and different seeds give different noise', () => {
    const x = multiTone(48000, 1);
    expect(addNoiseAtSnr(x, 10, 48000, 1)).toEqual(addNoiseAtSnr(x, 10, 48000, 1));
    expect(addNoiseAtSnr(x, 10, 48000, 1)).not.toEqual(addNoiseAtSnr(x, 10, 48000, 2));
  });
});

describe('gain, dropout', () => {
  it('applyGain multiplies every sample', () => {
    expect(applyGain(Float32Array.of(0.5, -1, 0), 0.05)).toEqual(Float32Array.of(0.025, -0.05, 0));
  });

  it('dropout replaces exactly the chosen stretch with silence or noise and leaves the rest alone', () => {
    const x = whiteNoise(10000, 0.5, 1);
    const zeroed = dropout(x, 3000, 2000, 'zero', 0, 1);
    expect(zeroed.subarray(3000, 5000).every((v) => v === 0)).toBe(true);
    expect(zeroed.subarray(0, 3000)).toEqual(x.subarray(0, 3000));
    expect(zeroed.subarray(5000)).toEqual(x.subarray(5000));
    const noisy = dropout(x, 3000, 2000, 'noise', 2, 9);
    expect(rms(noisy.subarray(3000, 5000))).toBeGreaterThan(2 * 0.9);
    expect(rms(noisy.subarray(3000, 5000))).toBeLessThan(2 * 1.1);
    expect(noisy.subarray(0, 3000)).toEqual(x.subarray(0, 3000));
    expect(dropout(x, 3000, 2000, 'noise', 2, 9)).toEqual(noisy);
  });

  it('clamps a stretch that runs outside the signal, and never changes the input', () => {
    const x = Float32Array.of(1, 2, 3, 4);
    const copy = x.slice();
    expect([...dropout(x, -2, 4, 'zero', 0, 1)]).toEqual([0, 0, 3, 4]);
    expect([...dropout(x, 2, 100, 'zero', 0, 1)]).toEqual([1, 2, 0, 0]);
    expect([...dropout(x, 9, 3, 'zero', 0, 1)]).toEqual([1, 2, 3, 4]);
    expect(x).toEqual(copy);
  });
});

describe('telephone band-pass (R5.3)', () => {
  it.each([44100, 48000])('has 2nd-order Butterworth edges at 300 and 3400 Hz and a flat middle (%i Hz)', (rate) => {
    const bp = (x: Float32Array) => telephoneBandPass(x, rate);
    expect(gainAt(1000, rate, bp)).toBeGreaterThan(0.97);
    expect(gainAt(1000, rate, bp)).toBeLessThan(1.03);
    expect(gainAt(300, rate, bp)).toBeGreaterThan(0.67); // about −3 dB: 0.707
    expect(gainAt(300, rate, bp)).toBeLessThan(0.75);
    expect(gainAt(3400, rate, bp)).toBeGreaterThan(0.67);
    expect(gainAt(3400, rate, bp)).toBeLessThan(0.75);
    // 12 dB per octave outside: one octave below the corner is about 1/16 of the power-law, two octaves about 1/16 in amplitude.
    expect(gainAt(150, rate, bp)).toBeLessThan(0.3);
    expect(gainAt(75, rate, bp)).toBeLessThan(0.08);
    expect(gainAt(6800, rate, bp)).toBeLessThan(0.3);
  });

  it('is deterministic and keeps the length', () => {
    const x = whiteNoise(5000, 0.3, 4);
    expect(telephoneBandPass(x, 48000)).toEqual(telephoneBandPass(x, 48000));
    expect(telephoneBandPass(x, 48000).length).toBe(5000);
  });
});

describe('reverberation (R5.7, R11.14)', () => {
  it.each([[50, 0], [150, 0], [300, 6], [100, -3]])('impulse response for RT60 %i ms, DRR %i dB: unit direct path, tail energy = 10^(−DRR/10), cut at RT60', (rt60, drr) => {
    const fs = 48000;
    const h = roomImpulseResponse(fs, rt60, drr, 7);
    expect(h[0]).toBe(1);
    expect(h.length).toBe(Math.round((rt60 / 1000) * fs) + 1);
    let tail = 0;
    for (let n = 1; n < h.length; n++) tail += h[n]! * h[n]!;
    expect(10 * Math.log10(1 / tail)).toBeCloseTo(drr, 5);
  });

  it('the tail falls by about 60 dB over RT60: the last tenth is far quieter than the first tenth', () => {
    const fs = 48000;
    const h = roomImpulseResponse(fs, 300, 0, 3);
    const tenth = Math.floor(h.length / 10);
    const early = rms(h.subarray(1, 1 + tenth));
    const late = rms(h.subarray(h.length - tenth));
    expect(20 * Math.log10(late / early)).toBeLessThan(-35);
    expect(20 * Math.log10(late / early)).toBeGreaterThan(-60);
  });

  it('FFT overlap-add convolution equals direct convolution, for any lengths including several blocks', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 1, max: 300 }), fc.integer({ min: 1, max: 1e6 }), (xl, hl, seed) => {
        const x = whiteNoise(xl, 1, seed);
        const h = whiteNoise(hl, 1, seed + 1);
        const fast = convolve(x, h);
        expect(fast.length).toBe(xl);
        for (let n = 0; n < xl; n++) {
          let direct = 0;
          for (let k = 0; k < hl && k <= n; k++) direct += x[n - k]! * h[k]!;
          expect(fast[n]).toBeCloseTo(direct, 3);
        }
      }),
      fcParams(50, 300),
    );
  });

  it('reverb of an impulse is the room response; output keeps the input length; same seed, same room', () => {
    const impulse = new Float32Array(20000);
    impulse[0] = 1;
    const out = reverb(impulse, 48000, 100, 0, 5);
    const h = roomImpulseResponse(48000, 100, 0, 5);
    for (let n = 0; n < h.length; n += 37) expect(out[n]).toBeCloseTo(h[n]!, 5);
    expect(out.length).toBe(20000);
    expect(reverb(impulse, 48000, 100, 0, 5)).toEqual(out);
    expect(reverb(impulse, 48000, 100, 0, 6)).not.toEqual(out);
  });
});

describe('sample-rate mismatch (R5.2, to be decoded from task 11)', () => {
  it('a 0.2% fast receiver shortens the signal by 0.2% and raises every pitch by 0.2%', () => {
    const fs = 48000;
    const x = sine(2000, fs, 2);
    for (const ratio of [1.002, 0.998]) {
      const y = rateMismatch(x, fs, ratio);
      expect(y.length).toBe(Math.floor(x.length / ratio));
      const mid = y.subarray(20000, 20000 + 48000);
      const at = (f: number) => toneEnergy(mid, 0, mid.length, f, fs);
      expect(at(2000 * ratio) / at(2000)).toBeGreaterThan(50);
    }
  });

  it('a ratio of exactly 1 changes nothing', () => {
    const x = whiteNoise(3000, 0.2, 1);
    expect(rateMismatch(x, 48000, 1)).toEqual(x);
  });
});

describe('surrounding audio (R3.2, R11.4)', () => {
  it.each(SURROUND_KINDS)('%s: right length, requested RMS, deterministic, seed-dependent', (kind) => {
    const fs = 48000;
    const x = surroundingAudio(kind, 3 * fs, 0.25, fs, 5);
    expect(x.length).toBe(3 * fs);
    expect(surroundingAudio(kind, 3 * fs, 0.25, fs, 5)).toEqual(x);
    if (kind === 'silence') {
      expect(x.every((v) => v === 0)).toBe(true);
    } else {
      expect(rms(x)).toBeGreaterThan(0.25 * 0.999);
      expect(rms(x)).toBeLessThan(0.25 * 1.001);
      expect(surroundingAudio(kind, 3 * fs, 0.25, fs, 6)).not.toEqual(x);
    }
  });

  it('handles zero and negative lengths', () => {
    for (const kind of SURROUND_KINDS) {
      expect(surroundingAudio(kind, 0, 0.3, 48000, 1).length).toBe(0);
      expect(surroundingAudio(kind, -5, 0.3, 48000, 1).length).toBe(0);
    }
  });

  it('chords are a few steady sine lines; noise is flat; speech sits in the telephone band and swells and fades', () => {
    const fs = 48000;
    const chordSpectrum = powerSpectrum(surroundingAudio('chords', fs, 0.3, fs, 11), 0, Math.round(0.25 * fs), 16384, fs, true);
    const sorted = [...chordSpectrum.power].sort((a, b) => b - a);
    const total = sorted.reduce((s, v) => s + v, 0);
    expect(sorted.slice(0, 24).reduce((s, v) => s + v, 0) / total).toBeGreaterThan(0.9);

    const noise = surroundingAudio('noise', 6 * fs, 0.3, fs, 12);
    const noiseSpectrum = powerSpectrum(noise, 0, 65536, 65536, fs, false);
    expect(bandPower(noiseSpectrum, 300, 3400) / bandPower(noiseSpectrum, 0, fs / 2)).toBeCloseTo(3100 / (fs / 2), 1);

    const speech = surroundingAudio('speech', 6 * fs, 0.3, fs, 13);
    const speechSpectrum = powerSpectrum(speech, 0, 262144, nextPowerOfTwo(262144), fs, true);
    // Formant resonators have broad skirts, so not everything lands in the band; white noise would put only 13% there.
    expect(bandPower(speechSpectrum, 250, 3600) / bandPower(speechSpectrum, 0, fs / 2)).toBeGreaterThan(0.8);
    // 62.5 ms blocks are a quarter of the 4 Hz swell period, so the swell shows up as a spread in block loudness.
    const blocks = Array.from({ length: 96 }, (_, i) => rms(speech.subarray(i * 3000, (i + 1) * 3000)));
    const mean = blocks.reduce((s, v) => s + v, 0) / blocks.length;
    const spread = Math.sqrt(blocks.reduce((s, v) => s + (v - mean) ** 2, 0) / blocks.length) / mean;
    const noiseBlocks = Array.from({ length: 96 }, (_, i) => rms(noise.subarray(i * 3000, (i + 1) * 3000)));
    const noiseMean = noiseBlocks.reduce((s, v) => s + v, 0) / noiseBlocks.length;
    const noiseSpread = Math.sqrt(noiseBlocks.reduce((s, v) => s + (v - noiseMean) ** 2, 0) / noiseBlocks.length) / noiseMean;
    expect(spread).toBeGreaterThan(0.3);
    expect(noiseSpread).toBeLessThan(0.05);
  });
});

describe('applyChannel: impairments alone or combined (R11.4, R5.8)', () => {
  const fs = 48000;
  const x = multiTone(fs, 2);

  it('an empty spec returns the same samples', () => {
    expect(applyChannel(x, fs, {}, 1)).toEqual(x);
  });

  it('each single impairment equals the primitive it names, with a derived seed', () => {
    expect(applyChannel(x, fs, { gain: 0.3 }, 1)).toEqual(applyGain(x, 0.3));
    expect(applyChannel(x, fs, { bandPass: true }, 1)).toEqual(telephoneBandPass(x, fs));
    expect(applyChannel(x, fs, { rateMismatch: 1.001 }, 1)).toEqual(rateMismatch(x, fs, 1.001));
    const noisy = applyChannel(x, fs, { noiseSnrDb: 12 }, 1);
    expect(Math.abs(snrDb(x, noisy.map((v, i) => v - x[i]!), fs) - 12)).toBeLessThan(0.02);
    const dropped = applyChannel(x, fs, { dropout: { startSample: 1000, lengthSamples: 500, mode: 'zero' } }, 1);
    expect(dropped.subarray(1000, 1500).every((v) => v === 0)).toBe(true);
    expect(applyChannel(x, fs, { reverb: { rt60Ms: 100, drrDb: 3 } }, 1).length).toBe(x.length);
  });

  it('a dropout in noise mode uses 4x the signal RMS', () => {
    const y = applyChannel(x, fs, { dropout: { startSample: 5000, lengthSamples: 20000, mode: 'noise' } }, 3);
    expect(rms(y.subarray(5000, 25000)) / rms(x)).toBeGreaterThan(3.8);
    expect(rms(y.subarray(5000, 25000)) / rms(x)).toBeLessThan(4.2);
  });

  it('surrounding audio is added around the ghost at the ghost RMS, and the ghost itself is untouched', () => {
    const spec: ChannelSpec = { before: { kind: 'chords', seconds: 1.5 }, after: { kind: 'speech', seconds: 0.5 } };
    const y = applyChannel(x, fs, spec, 2);
    const before = Math.round(1.5 * fs);
    expect(y.length).toBe(before + x.length + Math.round(0.5 * fs));
    expect(y.subarray(before, before + x.length)).toEqual(x);
    expect(rms(y.subarray(0, before)) / rms(x)).toBeCloseTo(1, 2);
    expect(rms(y.subarray(before + x.length)) / rms(x)).toBeCloseTo(1, 2);
  });

  it('combined specs are deterministic for the same seed and differ for another', () => {
    const spec: ChannelSpec = { reverb: { rt60Ms: 80, drrDb: 3 }, bandPass: true, gain: 0.4, noiseSnrDb: 8, dropout: { startSample: 20000, lengthSamples: 3000, mode: 'noise' }, rateMismatch: 1.0005, before: { kind: 'noise', seconds: 0.2 } };
    expect(applyChannel(x, fs, spec, 9)).toEqual(applyChannel(x, fs, spec, 9));
    expect(applyChannel(x, fs, spec, 9)).not.toEqual(applyChannel(x, fs, spec, 10));
  });
});

describe('damagePasses: independent noise per pass (R11.12)', () => {
  const fs = 48000;
  const pass = multiTone(fs, 1);

  it('gives every pass its own noise, joins with 1 s of digital silence, and is reproducible', () => {
    const out = damagePasses([pass, pass, pass], fs, { noiseSnrDb: 5 }, 4);
    expect(out.length).toBe(3 * pass.length + 2 * fs);
    const noiseOf = (i: number) => out.subarray(i * (pass.length + fs), i * (pass.length + fs) + pass.length).map((v, n) => v - pass[n]!);
    expect(noiseOf(0)).not.toEqual(noiseOf(1));
    expect(noiseOf(1)).not.toEqual(noiseOf(2));
    for (let i = 0; i < 2; i++) expect(out.subarray(i * (pass.length + fs) + pass.length, (i + 1) * (pass.length + fs)).every((v) => v === 0)).toBe(true);
    expect(damagePasses([pass, pass, pass], fs, { noiseSnrDb: 5 }, 4)).toEqual(out);
    expect(damagePasses([pass, pass, pass], fs, { noiseSnrDb: 5 }, 5)).not.toEqual(out);
  });

  it('puts surrounding audio only at the two ends of the whole stream', () => {
    const out = damagePasses([pass, pass], fs, { before: { kind: 'noise', seconds: 1 }, after: { kind: 'noise', seconds: 2 } }, 1);
    expect(out.length).toBe(fs + 2 * pass.length + fs + 2 * fs);
    expect(out.subarray(fs, fs + pass.length)).toEqual(pass);
    expect(out.subarray(fs + pass.length, fs + pass.length + fs).every((v) => v === 0)).toBe(true);
  });
});
