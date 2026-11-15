// Seeded pseudo-random numbers for test signals (the modem itself uses none, R11.11).

/** mulberry32: a tiny, fast generator; the same seed always gives the same sequence. */
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

/** White noise with the given RMS, from a seed (Box–Muller turns uniform numbers into Gaussian ones). */
export function whiteNoise(length: number, rms: number, seed: number): Float32Array {
  const next = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 2) {
    const r = Math.sqrt(-2 * Math.log(1 - next()));
    const a = 2 * Math.PI * next();
    out[i] = rms * r * Math.cos(a);
    if (i + 1 < length) out[i + 1] = rms * r * Math.sin(a);
  }
  return out;
}

export const rmsOf = (x: Float32Array): number => {
  let sum = 0;
  for (const v of x) sum += v * v;
  return Math.sqrt(sum / Math.max(1, x.length));
};

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
