// P30 (examples half): the Side B examples and everything copy.ts asks the modem to encode.
// Validates: Requirements 27.6, 27.7, 29.3 to 29.6, 38.6
// copyScan.test.ts checks the quoted label and text content, 1 to 140 characters, no newline,
// encodeText, and a robust encode. This file adds: exactly three, the encode through the
// `broadcast` Carrier, no profile name or id in any string, and the charset check for the demo tape.
import { describe, expect, it } from 'vitest';
import { encodePayload } from '../../../src/modem';
import { PROFILES } from '../../../src/modem/profiles';
import { encodeText, LIMITS } from '../../../src/modem/tape';
import { carrierProfile } from '../../../src/ui/carriers';
import * as copy from '../../../src/ui/copy';

const exampleList = Object.values(copy.examples);

/** Every string reachable in `value`; functions are called with a few argument shapes. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    const f = value as (...args: unknown[]) => unknown;
    for (const args of [[1, 2, 3, 4], ['Field', 3, 5, 7], [0, 0], [2, 1]]) allStrings(f(...args), out);
  } else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

describe('examples (R29.3 to R29.6)', () => {
  it('there are exactly three', () => {
    expect(exampleList).toHaveLength(3);
  });

  it.each([44100, 48000])('each encodes with the broadcast Carrier profile at %i Hz', (sampleRate) => {
    for (const e of exampleList) {
      const r = encodePayload({ kind: 'ghost', message: e.text }, { profile: carrierProfile('broadcast'), sampleRate });
      expect(r.ok, e.label).toBe(true);
    }
  });
});

describe('no profile name or id in any copy string (R27.6, R27.7)', () => {
  it('names and ids from the profile table appear nowhere in copy.ts', () => {
    const tokens = PROFILES.flatMap((p) => [p.name as string, `profile ${p.id}`, `profile id ${p.id}`, `profileId`]);
    const hits = allStrings(copy).filter((s) => tokens.some((t) => s.toLowerCase().includes(t.toLowerCase())));
    expect(hits).toEqual([]);
  });
});

describe('every string the UI encodes passes the charset check (R38.6)', () => {
  const t = copy.demoTape;
  const fields: readonly (readonly [string, string, number, boolean])[] = [
    ['title', t.title, LIMITS.title, false],
    ['from', t.from, LIMITS.from, false],
    ['to', t.to, LIMITS.to, false],
    ...t.tracks.map((x, i) => [`track ${i + 1}`, x, LIMITS.track, false] as const),
    ['letter', t.letter, LIMITS.letter, true],
    ...exampleList.map((e) => [`example ${e.label}`, e.text, LIMITS.ghostMessageMax, false] as const),
  ];
  it.each(fields)('%s', (field, text, max, newline) => {
    const r = encodeText(field, text, max, newline);
    expect(r.ok ? 'ok' : r.reason).toBe('ok');
  });
});
