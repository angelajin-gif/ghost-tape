// Channel simulator: TEST-ONLY code that damages samples the way a real room, speaker and
// microphone do (R11.2: no runtime module imports this file). Task 10 adds the full set of
// impairments; the sample-rate converter comes first because decoding at 16–48 kHz (R3.3)
// needs audio at those rates and the encoder only writes 44100 and 48000.

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
