// Channel simulator: TEST-ONLY code that damages samples the way a real room, speaker and
// microphone do (R11.2: no runtime module imports this file). Every function is a pure
// function of its input and an explicit seed, so the same input, parameters and seed always
// give the same output (R11.3). The modem itself uses no randomness (R11.11); the seeded
// generator lives here and in the tests only.

import { fft, nextPowerOfTwo } from './fft';

// ---------- seeded randomness ----------

/** mulberry32: a tiny, fast generator; the same seed always gives the same sequence in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a seed with integer tags into a new, unrelated-looking seed (a murmur-style finaliser per tag). */
export function deriveSeed(seed: number, ...tags: number[]): number {
  let h = seed >>> 0;
  for (const tag of tags) {
    h = Math.imul(h ^ (tag >>> 0), 0x9e3779b1) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** Gaussian white noise with the given RMS. Box–Muller turns two uniform numbers into two Gaussian ones. */
export function whiteNoise(length: number, rms: number, seed: number): Float32Array {
  const next = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - next()));
    const angle = 2 * Math.PI * next();
    out[i] = rms * radius * Math.cos(angle);
    if (i + 1 < length) out[i + 1] = rms * radius * Math.sin(angle);
  }
  return out;
}

// ---------- measuring ----------

export const TELEPHONE_BAND = { lowHz: 300, highHz: 3400 } as const;
const POWER_SEGMENT = 1 << 16;

export function rms(x: Float32Array): number {
  let sum = 0;
  for (const v of x) sum += v * v;
  return Math.sqrt(sum / Math.max(1, x.length));
}

/**
 * Average power inside a frequency band, measured by FFT. The signal is cut into 65,536-sample
 * segments; for each, the power of bins inside the band is added up (doubled to count the
 * mirror-image negative frequencies). Parseval's relation, total power = Σ|X|² / N², is what
 * makes this a power in the same units as the time-domain mean square. The same function serves
 * every sample rate, as the SNR definition requires.
 */
export function inBandPower(x: Float32Array, sampleRate: number, band: { lowHz: number; highHz: number } = TELEPHONE_BAND): number {
  if (x.length === 0) return 0;
  const size = Math.min(POWER_SEGMENT, nextPowerOfTwo(x.length));
  const first = Math.max(1, Math.ceil((band.lowHz * size) / sampleRate));
  const last = Math.min(size / 2 - 1, Math.floor((band.highHz * size) / sampleRate));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let weighted = 0;
  for (let start = 0; start < x.length; start += size) {
    const length = Math.min(size, x.length - start);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < length; i++) re[i] = x[start + i]!;
    fft(re, im);
    let sum = 0;
    for (let k = first; k <= last; k++) sum += re[k]! * re[k]! + im[k]! * im[k]!;
    weighted += (2 * sum) / size; // power of this segment × its length
  }
  return weighted / x.length;
}

/** Signal-to-noise ratio in dB, both powers measured inside the telephone band. */
export function snrDb(signal: Float32Array, noise: Float32Array, sampleRate: number): number {
  return 10 * Math.log10(inBandPower(signal, sampleRate) / inBandPower(noise, sampleRate));
}

// ---------- simple impairments ----------

/** Multiply by `gain`. No clipping: the simulator reports what the receiver would hear before its converter. */
export function applyGain(x: Float32Array, gain: number): Float32Array {
  return x.map((v) => v * gain);
}

/**
 * Add white noise so that signal power / noise power = `snr` dB, both measured in the
 * telephone band. The generated noise is measured and rescaled, so the SNR is exact for
 * any length and sample rate, not merely correct on average. `signalPower` can be passed
 * to avoid measuring the signal again.
 */
export function addNoiseAtSnr(x: Float32Array, snr: number, sampleRate: number, seed: number, signalPower: number = inBandPower(x, sampleRate)): Float32Array {
  const noise = whiteNoise(x.length, 1, seed);
  const target = signalPower / 10 ** (snr / 10);
  const scale = Math.sqrt(target / inBandPower(noise, sampleRate));
  return x.map((v, i) => v + noise[i]! * scale);
}

/** Replace a stretch of samples with silence, or with white noise at `noiseRms` (R5.6 uses 4× the signal RMS). */
export function dropout(x: Float32Array, startSample: number, lengthSamples: number, mode: 'zero' | 'noise', noiseRms: number, seed: number): Float32Array {
  const out = x.slice();
  const from = Math.max(0, Math.min(x.length, startSample));
  const to = Math.max(from, Math.min(x.length, startSample + lengthSamples));
  const fill = mode === 'zero' ? new Float32Array(to - from) : whiteNoise(to - from, noiseRms, seed);
  out.set(fill, from);
  return out;
}

// ---------- filters ----------

/** One biquad section, direct form II transposed, in double precision. */
function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const out = new Float32Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    out[i] = y;
  }
  return out;
}

/** 2nd-order Butterworth (Q = 1/√2) high- or low-pass by the bilinear transform. */
function butterworth2(x: Float32Array, cutoffHz: number, sampleRate: number, kind: 'high' | 'low'): Float32Array {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const sign = kind === 'high' ? 1 : -1;
  const b0 = (1 + sign * cos) / 2 / a0;
  return biquad(x, b0, (-sign * (1 + sign * cos)) / a0, b0, (-2 * cos) / a0, (1 - alpha) / a0);
}

/**
 * Telephone band-pass (R5.3): a 2nd-order Butterworth high-pass at 300 Hz followed by a
 * 2nd-order Butterworth low-pass at 3400 Hz. Both are causal, so they also delay the signal a
 * little, as a real handset path does.
 */
export function telephoneBandPass(x: Float32Array, sampleRate: number): Float32Array {
  return butterworth2(butterworth2(x, TELEPHONE_BAND.lowHz, sampleRate, 'high'), TELEPHONE_BAND.highHz, sampleRate, 'low');
}

// ---------- reverberation ----------

/**
 * Room impulse response: a unit direct path, then a white-noise tail whose amplitude falls as
 * e^(−6.91·t/RT60) (that is −60 dB at t = RT60, the definition of RT60) and is cut off at RT60.
 * The tail is scaled so direct energy / tail energy = DRR.
 */
export function roomImpulseResponse(sampleRate: number, rt60Ms: number, drrDb: number, seed: number): Float32Array {
  const length = Math.max(2, Math.round((rt60Ms / 1000) * sampleRate) + 1);
  const noise = whiteNoise(length, 1, seed);
  const h = new Float32Array(length);
  let tailEnergy = 0;
  for (let n = 1; n < length; n++) {
    h[n] = noise[n]! * Math.exp((-6.91 * (n / sampleRate)) / (rt60Ms / 1000));
    tailEnergy += h[n]! * h[n]!;
  }
  const scale = Math.sqrt(10 ** (-drrDb / 10) / tailEnergy);
  for (let n = 1; n < length; n++) h[n]! *= scale;
  h[0] = 1;
  return h;
}

/**
 * Convolve by FFT overlap-add (R11.14): cut the input into blocks, multiply each block's
 * spectrum by the impulse response's spectrum (multiplication of spectra is convolution in
 * time), and add the overlapping tails. Output has the input's length.
 */
export function convolve(x: Float32Array, h: Float32Array): Float32Array {
  const size = nextPowerOfTwo(4 * h.length);
  const step = size - h.length + 1;
  const hRe = new Float64Array(size);
  const hIm = new Float64Array(size);
  hRe.set(h);
  fft(hRe, hIm);
  const out = new Float64Array(x.length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start < x.length; start += step) {
    const length = Math.min(step, x.length - start);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < length; i++) re[i] = x[start + i]!;
    fft(re, im);
    for (let k = 0; k < size; k++) {
      const a = re[k]!;
      const b = im[k]!;
      re[k] = a * hRe[k]! - b * hIm[k]!;
      im[k] = a * hIm[k]! + b * hRe[k]!;
    }
    fft(re, im, true);
    for (let i = 0; i < length + h.length - 1 && start + i < x.length; i++) out[start + i]! += re[i]!;
  }
  return Float32Array.from(out);
}

export function reverb(x: Float32Array, sampleRate: number, rt60Ms: number, drrDb: number, seed: number): Float32Array {
  return convolve(x, roomImpulseResponse(sampleRate, rt60Ms, drrDb, seed));
}

// ---------- sample rates ----------

const KERNEL_STEPS_PER_SAMPLE = 256;
/** Zero crossings of the low-pass kernel on each side. More = sharper cut-off, slower. */
const KERNEL_LOBES = 12;
/** Cut-off as a share of the lower of the two Nyquist rates; the rest is the transition band. */
const CUTOFF_SHARE = 0.9;

/** Blackman window over x in [-1, 1]: tapers the sinc so it ends smoothly (low ripple, low leakage). */
const blackman = (x: number): number => (Math.abs(x) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x));

/**
 * Windowed-sinc sample-rate conversion. Each output sample is a weighted sum of nearby
 * input samples; the weights are a sinc, the impulse response of an ideal low-pass filter,
 * cut off below the lower Nyquist rate so downsampling does not fold high frequencies back
 * down (aliasing). Deterministic.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0) || !Number.isFinite(fromRate) || !Number.isFinite(toRate)) throw new RangeError('sample rates must be positive');
  if (fromRate === toRate) return Float32Array.from(input);
  const ratio = fromRate / toRate; // input samples per output sample
  const cutoff = (CUTOFF_SHARE * Math.min(1, 1 / ratio)) / 2; // in cycles per input sample
  const halfWidth = KERNEL_LOBES / (2 * cutoff); // input samples each side of the output position
  const tableLength = Math.ceil(halfWidth * KERNEL_STEPS_PER_SAMPLE) + 2;
  const kernel = new Float64Array(tableLength);
  for (let i = 0; i < tableLength; i++) {
    const u = i / KERNEL_STEPS_PER_SAMPLE;
    const x = 2 * cutoff * u;
    kernel[i] = 2 * cutoff * (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * blackman(u / halfWidth);
  }
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let o = 0; o < outLength; o++) {
    const centre = o * ratio;
    const first = Math.max(0, Math.ceil(centre - halfWidth));
    const last = Math.min(input.length - 1, Math.floor(centre + halfWidth));
    let sum = 0;
    for (let i = first; i <= last; i++) {
      const position = Math.abs(i - centre) * KERNEL_STEPS_PER_SAMPLE;
      const index = Math.floor(position);
      const weight = kernel[index]! + (kernel[index + 1]! - kernel[index]!) * (position - index); // linear interpolation in the table
      sum += input[i]! * weight;
    }
    out[o] = sum;
  }
  return out;
}

/**
 * The receiver's clock runs `ratio` times as fast as the sender's (1.002 = 0.2% fast): it takes
 * its samples a little too often or too seldom, so tones come out slightly off pitch and symbols
 * drift in time. Modelled as a rate change that keeps the nominal sample rate label (R5.2).
 */
export function rateMismatch(x: Float32Array, sampleRate: number, ratio: number): Float32Array {
  return resample(x, sampleRate * ratio, sampleRate);
}

// ---------- surrounding audio ----------

export type SurroundKind = 'silence' | 'noise' | 'chords' | 'speech';
export const SURROUND_KINDS: readonly SurroundKind[] = ['silence', 'noise', 'chords', 'speech'];

function scaleToRms(x: Float32Array, target: number): Float32Array {
  const current = rms(x);
  return current > 0 ? x.map((v) => (v * target) / current) : x;
}

/** Music-like: a new chord of 3–4 random sines (100–4000 Hz) every 300–800 ms, each chord faded in and out. */
function chords(length: number, sampleRate: number, seed: number): Float32Array {
  const next = mulberry32(seed);
  const out = new Float32Array(length);
  const fade = Math.round(0.005 * sampleRate);
  for (let start = 0; start < length; ) {
    const span = Math.min(length - start, Math.round((0.3 + 0.5 * next()) * sampleRate));
    const notes = 3 + Math.floor(next() * 2);
    for (let k = 0; k < notes; k++) {
      const freq = 100 + 3900 * next();
      const amp = 0.5 + 0.5 * next();
      const phase = 2 * Math.PI * next();
      for (let n = 0; n < span; n++) {
        const edge = Math.min(n, span - 1 - n);
        const envelope = edge < fade ? 0.5 * (1 - Math.cos((Math.PI * edge) / fade)) : 1;
        out[start + n]! += amp * envelope * Math.sin(phase + (2 * Math.PI * freq * n) / sampleRate);
      }
    }
    start += span;
  }
  return out;
}

/** RBJ band-pass (constant 0 dB peak gain) centred at `centreHz` with quality factor `q`. */
function bandPassBiquad(x: Float32Array, centreHz: number, q: number, sampleRate: number): Float32Array {
  const w0 = (2 * Math.PI * centreHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return biquad(x, alpha / a0, 0, -alpha / a0, (-2 * Math.cos(w0)) / a0, (1 - alpha) / a0);
}

/**
 * Speech-like: white noise through three resonances (formants) that move every 300–700 ms,
 * with a 4 Hz syllable-rate loudness swell. Not intelligible, but it has speech's spectral
 * shape (energy at 300–3200 Hz), its slow on/off rhythm, and nothing at the ghost's own rate.
 */
function speechLike(length: number, sampleRate: number, seed: number): Float32Array {
  const next = mulberry32(seed);
  const out = new Float32Array(length);
  for (let start = 0; start < length; ) {
    const span = Math.min(length - start, Math.round((0.3 + 0.4 * next()) * sampleRate));
    const vowel = new Float32Array(span);
    const source = whiteNoise(span, 1, deriveSeed(seed, start));
    const formants = [300 + 500 * next(), 900 + 1300 * next(), 2300 + 900 * next()];
    for (const f of formants) {
      const filtered = bandPassBiquad(source, f, 6, sampleRate);
      for (let n = 0; n < span; n++) vowel[n]! += filtered[n]!;
    }
    out.set(vowel, start);
    start += span;
  }
  const phase = 2 * Math.PI * next();
  return out.map((v, n) => v * (0.5 + 0.5 * Math.sin(phase + (2 * Math.PI * 4 * n) / sampleRate)));
}

/** Audio that is not the ghost, at the given RMS (R3.2: equal to the ghost track's RMS). */
export function surroundingAudio(kind: SurroundKind, lengthSamples: number, targetRms: number, sampleRate: number, seed: number): Float32Array {
  if (lengthSamples <= 0 || kind === 'silence') return new Float32Array(Math.max(0, lengthSamples));
  const raw = kind === 'noise' ? whiteNoise(lengthSamples, 1, seed) : kind === 'chords' ? chords(lengthSamples, sampleRate, seed) : speechLike(lengthSamples, sampleRate, seed);
  return scaleToRms(raw, targetRms);
}

// ---------- combining ----------

export interface ChannelSpec {
  readonly reverb?: { readonly rt60Ms: number; readonly drrDb: number };
  readonly bandPass?: boolean;
  readonly gain?: number;
  readonly dropout?: { readonly startSample: number; readonly lengthSamples: number; readonly mode: 'zero' | 'noise' };
  /** Receiver clock ratio, e.g. 1.002 for 0.2% fast. */
  readonly rateMismatch?: number;
  readonly noiseSnrDb?: number;
  readonly before?: { readonly kind: SurroundKind; readonly seconds: number };
  readonly after?: { readonly kind: SurroundKind; readonly seconds: number };
}

/** Seed tags, so each impairment draws from its own stream. */
const TAG = { reverb: 1, dropout: 2, noise: 3, before: 4, after: 5, pass: 100 } as const;

/**
 * Apply any combination of impairments in the order a signal meets them: the room (reverb),
 * the speaker and microphone (band-pass), the volume (gain), a dropout, the receiver's clock,
 * then noise; finally the audio before and after the ghost. Unset fields do nothing.
 */
export function applyChannel(x: Float32Array, sampleRate: number, spec: ChannelSpec, seed: number): Float32Array {
  let y = x;
  if (spec.reverb) y = reverb(y, sampleRate, spec.reverb.rt60Ms, spec.reverb.drrDb, deriveSeed(seed, TAG.reverb));
  if (spec.bandPass) y = telephoneBandPass(y, sampleRate);
  if (spec.gain !== undefined) y = applyGain(y, spec.gain);
  if (spec.dropout) y = dropout(y, spec.dropout.startSample, spec.dropout.lengthSamples, spec.dropout.mode, 4 * rms(y), deriveSeed(seed, TAG.dropout));
  if (spec.rateMismatch !== undefined) y = rateMismatch(y, sampleRate, spec.rateMismatch);
  if (spec.noiseSnrDb !== undefined) y = addNoiseAtSnr(y, spec.noiseSnrDb, sampleRate, deriveSeed(seed, TAG.noise));
  if (!spec.before && !spec.after) return y;
  const level = rms(y);
  const before = spec.before ? surroundingAudio(spec.before.kind, Math.round(spec.before.seconds * sampleRate), level, sampleRate, deriveSeed(seed, TAG.before)) : new Float32Array(0);
  const after = spec.after ? surroundingAudio(spec.after.kind, Math.round(spec.after.seconds * sampleRate), level, sampleRate, deriveSeed(seed, TAG.after)) : new Float32Array(0);
  const joined = new Float32Array(before.length + y.length + after.length);
  joined.set(before, 0);
  joined.set(y, before.length);
  joined.set(after, before.length + y.length);
  return joined;
}

/**
 * Damage several passes independently (R11.12): each pass gets its own noise seed, so noise is
 * never repeated from one pass to the next, and the passes are joined by digital silence. Any
 * surrounding audio is added once, around the whole stream.
 */
export function damagePasses(passes: readonly Float32Array[], sampleRate: number, spec: ChannelSpec, seed: number, gapSeconds = 1): Float32Array {
  const { before, after, ...perPass } = spec;
  const damaged = passes.map((pass, i) => applyChannel(pass, sampleRate, perPass, deriveSeed(seed, TAG.pass, i)));
  const gap = Math.round(gapSeconds * sampleRate);
  const joined = new Float32Array(damaged.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, damaged.length - 1));
  let offset = 0;
  for (const p of damaged) {
    joined.set(p, offset);
    offset += p.length + gap;
  }
  return before || after ? applyChannel(joined, sampleRate, { ...(before ? { before } : {}), ...(after ? { after } : {}) }, seed) : joined;
}
