import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resample } from '../../src/modem/channel';
import { fcParams } from '../support/runs';

const sine = (freqHz: number, rate: number, seconds: number): Float32Array =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, n) => 0.5 * Math.sin((2 * Math.PI * freqHz * n) / rate));

/** Amplitude of the component at freqHz in the middle of the signal (away from the edges), by projecting on sine and cosine. */
function amplitudeAt(x: Float32Array, freqHz: number, rate: number): number {
  const from = Math.floor(x.length * 0.25);
  const to = Math.floor(x.length * 0.75);
  let c = 0;
  let s = 0;
  for (let n = from; n < to; n++) {
    c += x[n]! * Math.cos((2 * Math.PI * freqHz * n) / rate);
    s += x[n]! * Math.sin((2 * Math.PI * freqHz * n) / rate);
  }
  return (2 * Math.hypot(c, s)) / (to - from);
}

describe('resample (test-only rate converter)', () => {
  it.each([
    [48000, 16000],
    [48000, 44100],
    [44100, 48000],
    [48000, 22050],
    [44100, 32000],
    [48000, 24000],
  ])('keeps a 2 kHz tone at the same pitch and level going %i -> %i Hz', (from, to) => {
    const out = resample(sine(2000, from, 0.5), from, to);
    expect(out.length).toBe(Math.floor((0.5 * from) / (from / to)));
    expect(amplitudeAt(out, 2000, to)).toBeGreaterThan(0.5 * 0.99);
    expect(amplitudeAt(out, 2000, to)).toBeLessThan(0.5 * 1.01);
    expect(amplitudeAt(out, 2150, to)).toBeLessThan(0.01);
  });

  it('removes content above the new Nyquist instead of folding it down (no aliasing)', () => {
    const out = resample(sine(10000, 48000, 0.5), 48000, 16000); // 10 kHz is above 16 kHz / 2
    let peak = 0;
    for (let n = 2000; n < out.length - 2000; n++) peak = Math.max(peak, Math.abs(out[n]!));
    expect(peak).toBeLessThan(0.005);
  });

  it('returns a copy at the same rate and handles empty and tiny inputs', () => {
    const x = Float32Array.of(0.1, -0.2, 0.3);
    const same = resample(x, 48000, 48000);
    expect(same).toEqual(x);
    expect(same).not.toBe(x);
    expect(resample(new Float32Array(0), 48000, 16000).length).toBe(0);
    expect(resample(Float32Array.of(1), 48000, 16000).length).toBe(0);
  });

  it('is deterministic and rejects bad rates', () => {
    const x = sine(1000, 48000, 0.1);
    expect(resample(x, 48000, 16000)).toEqual(resample(x, 48000, 16000));
    expect(() => resample(x, 0, 16000)).toThrow(RangeError);
    expect(() => resample(x, 48000, NaN)).toThrow(RangeError);
  });

  it('48k -> 44.1k -> 48k returns the original within -40 dB for in-band signals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 300, max: 3200 }), (freq) => {
        const x = sine(freq, 48000, 0.4);
        const back = resample(resample(x, 48000, 44100), 44100, 48000);
        let err = 0;
        let power = 0;
        for (let n = 4000; n < Math.min(back.length, x.length) - 4000; n++) {
          err += (back[n]! - x[n]!) ** 2;
          power += x[n]! ** 2;
        }
        expect(10 * Math.log10(err / power)).toBeLessThan(-40);
      }),
      fcParams(50, 200),
    );
  });
});
