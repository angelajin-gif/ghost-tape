// Seeded pseudo-random numbers for test signals (the modem itself uses none, R11.11).
// The generators live with the channel simulator; they are re-exported here so tests have one place to import from.

export { mulberry32, whiteNoise, rms as rmsOf } from '../../src/modem/channel';

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
