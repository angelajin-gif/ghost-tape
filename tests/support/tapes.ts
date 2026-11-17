// Seeded payloads of an exact serialized size, for the damaged-channel cells (R5.9):
// 560 bytes is the "typical-size tape", 256 bytes fills the Robust profile.

import { mulberry32 } from '../../src/modem/channel';
import { CHARSET_MARKS, serializePayload } from '../../src/modem/tape';
import type { Ghost, Tape } from '../../src/modem/types';

/** Mostly lowercase words with the odd capital, digit, punctuation mark and typographic mark: the shape of real letters. */
function randomText(next: () => number, length: number, allowNewline: boolean): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const r = next();
    if (allowNewline && r > 0.985) out += '\n';
    else if (r < 0.7) out += String.fromCharCode(97 + Math.floor(next() * 26));
    else if (r < 0.85) out += ' ';
    else if (r < 0.9) out += String.fromCharCode(65 + Math.floor(next() * 26));
    else if (r < 0.94) out += String.fromCharCode(48 + Math.floor(next() * 10));
    else if (r < 0.99) out += '.,!?\'-:;'[Math.floor(next() * 8)]!;
    else out += CHARSET_MARKS[Math.floor(next() * CHARSET_MARKS.length)]!;
  }
  return out;
}

const between = (next: () => number, lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));

/** A valid tape whose serialized size is exactly `size` bytes, different for every seed. */
export function tapeOfSize(size: number, seed: number): Tape {
  const next = mulberry32(seed);
  const big = size >= 500;
  const huge = size >= 900; // the letter alone cannot reach 1024 B, so fill the ten track slots as well
  const trackCount = huge ? 10 : big ? 5 : size >= 300 ? 3 : 2;
  const tracks = Array.from({ length: trackCount }, () => randomText(next, huge ? between(next, 40, 55) : big ? between(next, 22, 32) : between(next, 10, 16), false));
  const base = {
    kind: 'tape' as const,
    title: randomText(next, big ? between(next, 18, 30) : between(next, 8, 14), false),
    from: randomText(next, between(next, 4, 10), false),
    to: randomText(next, between(next, 4, 10), false),
    ...(size >= 400 ? { date: `20${String(20 + between(next, 0, 9))}-${String(between(next, 1, 12)).padStart(2, '0')}-${String(between(next, 1, 28)).padStart(2, '0')}` } : {}),
    tracks,
  };
  const fixed = serializePayload({ ...base, letter: '' });
  if (!fixed.ok) throw new Error(`tapeOfSize(${size}): ${fixed.reason}`);
  const letterLength = size - fixed.value.length;
  if (letterLength < 0 || letterLength > 800) throw new Error(`tapeOfSize(${size}): letter would need ${letterLength} characters`);
  const tape: Tape = { ...base, letter: randomText(next, letterLength, true) };
  const check = serializePayload(tape);
  if (!check.ok || check.value.length !== size) throw new Error(`tapeOfSize(${size}): got ${check.ok ? check.value.length : check.reason}`);
  return tape;
}

/** A ghost whose serialized size is `size` bytes (message of size − 2 characters). */
export function ghostOfSize(size: number, seed: number): Ghost {
  return { kind: 'ghost', message: randomText(mulberry32(seed), size - 2, false) };
}
