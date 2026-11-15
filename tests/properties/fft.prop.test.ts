import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fft, isPowerOfTwo, nextPowerOfTwo } from '../../src/modem/fft';
import { fcParams } from '../support/runs';

const sizeArb = fc.constantFrom(1, 2, 4, 8, 16, 32, 64, 256, 1024);
const complexArb = (n: number) =>
  fc.tuple(
    fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
    fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: n, maxLength: n }),
  );
const vectorArb = sizeArb.chain((n) => complexArb(n));

/** Direct O(N²) DFT, the definition, used as the independent reference. */
function naiveDft(re: readonly number[], im: readonly number[]): { re: number[]; im: number[] } {
  const n = re.length;
  const outRe: number[] = [];
  const outIm: number[] = [];
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      sr += re[t]! * Math.cos(a) - im[t]! * Math.sin(a);
      si += re[t]! * Math.sin(a) + im[t]! * Math.cos(a);
    }
    outRe.push(sr);
    outIm.push(si);
  }
  return { re: outRe, im: outIm };
}

describe('FFT', () => {
  it('matches the textbook DFT (sizes 1 to 256)', () => {
    fc.assert(
      fc.property(fc.constantFrom(1, 2, 4, 8, 16, 64, 256).chain((n) => complexArb(n)), ([re, im]) => {
        const r = Float64Array.from(re);
        const i = Float64Array.from(im);
        fft(r, i);
        const ref = naiveDft(re, im);
        for (let k = 0; k < re.length; k++) {
          expect(r[k]).toBeCloseTo(ref.re[k]!, 9);
          expect(i[k]).toBeCloseTo(ref.im[k]!, 9);
        }
      }),
      fcParams(50, 500),
    );
  });

  it('inverse(forward(x)) = x (round trip)', () => {
    fc.assert(
      fc.property(vectorArb, ([re, im]) => {
        const r = Float64Array.from(re);
        const i = Float64Array.from(im);
        fft(r, i);
        fft(r, i, true);
        for (let k = 0; k < re.length; k++) {
          expect(r[k]).toBeCloseTo(re[k]!, 10);
          expect(i[k]).toBeCloseTo(im[k]!, 10);
        }
      }),
      fcParams(50, 1000),
    );
  });

  it("keeps energy: Parseval's relation, sum|x|² = sum|X|²/N", () => {
    fc.assert(
      fc.property(vectorArb, ([re, im]) => {
        const r = Float64Array.from(re);
        const i = Float64Array.from(im);
        const before = re.reduce((s, v, k) => s + v * v + im[k]! * im[k]!, 0);
        fft(r, i);
        let after = 0;
        for (let k = 0; k < r.length; k++) after += r[k]! * r[k]! + i[k]! * i[k]!;
        expect(after / re.length).toBeCloseTo(before, 9);
      }),
      fcParams(50, 1000),
    );
  });

  it('puts a pure tone in one bin and an impulse in every bin', () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * 5 * t) / n));
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      const mag = Math.hypot(re[k]!, im[k]!);
      expect(mag).toBeCloseTo(k === 5 || k === n - 5 ? n / 2 : 0, 9);
    }
    const impulse = new Float64Array(n);
    impulse[0] = 1;
    const zeros = new Float64Array(n);
    fft(impulse, zeros);
    for (let k = 0; k < n; k++) {
      expect(impulse[k]).toBeCloseTo(1, 12);
      expect(zeros[k]).toBeCloseTo(0, 12);
    }
  });

  it('multiplying spectra correlates signals: peak at the true lag', () => {
    const n = 256;
    const lag = 37;
    const pattern = Float64Array.from({ length: 20 }, (_, k) => Math.sin(k * 0.9) * Math.exp(-k / 15));
    const signal = new Float64Array(n);
    pattern.forEach((v, k) => (signal[lag + k] = v));
    const sRe = Float64Array.from(signal);
    const sIm = new Float64Array(n);
    const zRe = new Float64Array(n);
    const zIm = new Float64Array(n);
    zRe.set(pattern);
    fft(sRe, sIm);
    fft(zRe, zIm);
    const pRe = new Float64Array(n);
    const pIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      pRe[k] = sRe[k]! * zRe[k]! + sIm[k]! * zIm[k]!; // S · conj(Z)
      pIm[k] = sIm[k]! * zRe[k]! - sRe[k]! * zIm[k]!;
    }
    fft(pRe, pIm, true);
    let best = 0;
    for (let k = 1; k < n; k++) if (pRe[k]! > pRe[best]!) best = k;
    expect(best).toBe(lag);
  });

  it('helper functions and misuse', () => {
    expect([1, 2, 3, 4, 1000, 1024, 1025].map(nextPowerOfTwo)).toEqual([1, 2, 4, 4, 1024, 1024, 2048]);
    expect([0, 1, 2, 3, 6, 8, 1.5].map(isPowerOfTwo)).toEqual([false, true, true, false, false, true, false]);
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
    expect(() => fft(new Float64Array(4), new Float64Array(8))).toThrow(RangeError);
  });
});
