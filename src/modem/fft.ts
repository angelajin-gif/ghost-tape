// Radix-2 FFT on separate real and imaginary arrays (Float64).
//
// The Fourier transform rewrites a signal as a sum of spinning phasors, one per
// frequency bin. Its use here: multiplying two spectra is the same as correlating
// the two signals in time, but costs N·log N instead of N² (sync.ts uses that to
// slide the chirp template along the audio).
//
// Convention: forward = Σ x[n]·e^(−j2πkn/N); inverse = (1/N)·Σ X[k]·e^(+j2πkn/N).

interface Plan {
  /** cos(2πk/N) and sin(2πk/N) for k < N/2: the twiddle factors. */
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  /** Bit-reversed index of each position (the order the butterflies expect). */
  readonly reverse: Uint32Array;
}

const plans = new Map<number, Plan>();

export const isPowerOfTwo = (n: number): boolean => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function planFor(n: number): Plan {
  const cached = plans.get(n);
  if (cached) return cached;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  const reverse = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    reverse[i] = r;
  }
  const plan = { cos, sin, reverse };
  plans.set(n, plan);
  return plan;
}

/**
 * In-place FFT. `re` and `im` must have the same power-of-two length (a misuse of this
 * internal helper, so it throws; decoders never pass anything else).
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (im.length !== n || !isPowerOfTwo(n)) throw new RangeError(`fft needs equal power-of-two lengths, got ${re.length} and ${im.length}`);
  if (n === 1) return;
  const { cos, sin, reverse } = planFor(n);
  for (let i = 0; i < n; i++) {
    const j = reverse[i]!;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  // Forward uses e^(−jθ), inverse e^(+jθ): flip the sign of the sine.
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len *= 2) {
    const half = len / 2;
    const stride = n / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * stride]!;
        const wi = sign * sin[k * stride]!;
        const a = start + k;
        const b = a + half;
        // Butterfly: (a, b) -> (a + w·b, a − w·b).
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a]! += tr;
        im[a]! += ti;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i]! /= n;
      im[i]! /= n;
    }
  }
}
