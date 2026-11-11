// Small signal-processing helpers for tests only (independent of the modem code,
// so a bug in modulate.ts cannot hide behind the same bug in the measurement).

/** In-place iterative radix-2 FFT. re.length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const tRe = re[b]! * cRe - im[b]! * cIm;
        const tIm = re[b]! * cIm + im[b]! * cRe;
        re[b] = re[a]! - tRe;
        im[b] = im[a]! - tIm;
        re[a]! += tRe;
        im[a]! += tIm;
        [cRe, cIm] = [cRe * wRe - cIm * wIm, cRe * wIm + cIm * wRe];
      }
    }
  }
}

export const nextPowerOfTwo = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Power spectrum of x[start, start+length) zero-padded to `size` bins (a power of two),
 * optionally Hann-windowed. Returns power for bins 0..size/2 and the bin width in Hz.
 */
export function powerSpectrum(x: Float32Array, start: number, length: number, size: number, sampleRate: number, hann: boolean): { power: Float64Array; binHz: number } {
  // A fractional start reads undefined samples and yields NaN, which silently passes "dB >= 40" checks.
  if (!Number.isInteger(start) || !Number.isInteger(length)) throw new Error(`window start ${start} and length ${length} must be whole samples`);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < length; i++) {
    const w = hann ? 0.5 * (1 - Math.cos((2 * Math.PI * (i + 0.5)) / length)) : 1;
    re[i] = (x[start + i] ?? 0) * w;
  }
  fft(re, im);
  const power = new Float64Array(size / 2 + 1);
  for (let k = 0; k <= size / 2; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
  return { power, binHz: sampleRate / size };
}

/** Sum of spectrum power for bins whose frequency lies in [loHz, hiHz]. */
export function bandPower(spectrum: { power: Float64Array; binHz: number }, loHz: number, hiHz: number): number {
  let sum = 0;
  for (let k = 0; k < spectrum.power.length; k++) {
    const f = k * spectrum.binHz;
    if (f >= loHz && f <= hiHz) sum += spectrum.power[k]!;
  }
  return sum;
}

/** Goertzel energy of x[start, start+length) at freqHz (direct evaluation of one DFT bin). */
export function toneEnergy(x: Float32Array, start: number, length: number, freqHz: number, sampleRate: number): number {
  const w = (2 * Math.PI * freqHz) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < length; i++) {
    const s0 = (x[start + i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/** Frequency (Hz) of the strongest bin of x[start, start+length) with a Hann window. */
export function dominantFrequencyHz(x: Float32Array, start: number, length: number, sampleRate: number): number {
  const spectrum = powerSpectrum(x, start, length, nextPowerOfTwo(length) * 8, sampleRate, true);
  let best = 1;
  for (let k = 1; k < spectrum.power.length; k++) if (spectrum.power[k]! > spectrum.power[best]!) best = k;
  return best * spectrum.binHz;
}

export const toDb = (ratio: number): number => 10 * Math.log10(ratio);
