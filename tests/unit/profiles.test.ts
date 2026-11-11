import { describe, expect, it } from 'vitest';
import {
  HEADER_PROFILE_NAME,
  MAX_TONE_HZ,
  MIN_TONE_HZ,
  PROFILES,
  profileById,
  profileByName,
  ROBUST,
  STANDARD,
  validateProfileTable,
  type Profile,
} from '../../src/modem/profiles';
import { PENTATONIC } from '../support/profiles';

describe('built-in profiles (R9.1–R9.3, R9.8)', () => {
  it('Robust uses exactly the tones 1175, 1475, 1750 and 2350 Hz', () => {
    expect(ROBUST.tonesHz).toEqual([1175, 1475, 1750, 2350]);
    expect(ROBUST.bitsPerSymbol).toBe(2);
  });

  it('Standard uses 1500 + 100·k Hz for k = 0..15', () => {
    expect(STANDARD.tonesHz).toEqual([1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000]);
    expect(STANDARD.bitsPerSymbol).toBe(4);
  });

  it('matches the design table for timing and caps', () => {
    expect([ROBUST.symbolMs, ROBUST.guardMs, ROBUST.analysisMs, ROBUST.capBytes, ROBUST.pilotIndex]).toEqual([50, 10, 40, 256, 3]);
    expect([STANDARD.symbolMs, STANDARD.guardMs, STANDARD.analysisMs, STANDARD.capBytes, STANDARD.pilotIndex]).toEqual([25, 5, 20, 1024, 15]);
    expect([ROBUST.envelope, STANDARD.envelope]).toEqual(['bell', 'flat']);
  });

  it('keeps every tone within 300–3200 Hz, on the orthogonality grid, and the table validates', () => {
    for (const p of PROFILES) {
      for (const f of p.tonesHz) {
        expect(f).toBeGreaterThanOrEqual(MIN_TONE_HZ);
        expect(f).toBeLessThanOrEqual(MAX_TONE_HZ);
        expect((f * p.analysisMs) % 1000).toBe(0);
      }
    }
    expect(validateProfileTable(PROFILES)).toEqual({ ok: true, value: PROFILES });
  });

  it('looks profiles up by name and by header id; the header profile is Robust (R9.4)', () => {
    expect(profileByName(PROFILES, 'standard')).toBe(STANDARD);
    expect(profileById(PROFILES, 0)).toBe(ROBUST);
    expect(profileById(PROFILES, 9)).toBeUndefined();
    expect(HEADER_PROFILE_NAME).toBe('robust');
  });
});

describe('validateProfileTable rejects bad tables without throwing', () => {
  const withProfile = (change: Partial<Profile>): readonly Profile[] => [ROBUST, { ...STANDARD, ...change }];
  const reasonFor = (table: readonly Profile[]): string => {
    const r = validateProfileTable(table);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.reason;
  };

  it('accepts an extra profile with a different bits-per-symbol', () => {
    expect(validateProfileTable([ROBUST, STANDARD, PENTATONIC]).ok).toBe(true);
  });

  it.each([
    ['tone count does not match bitsPerSymbol', { bitsPerSymbol: 3 as const }, /needs 8 tones/],
    ['a tone below 300 Hz', { tonesHz: [200, ...STANDARD.tonesHz.slice(1)] }, /outside 300-3200/],
    ['a tone above 3200 Hz', { tonesHz: [...STANDARD.tonesHz.slice(0, 15), 3300] }, /outside 300-3200/],
    ['a tone off the grid', { tonesHz: [1510, ...STANDARD.tonesHz.slice(1)] }, /orthogonality grid/],
    ['a repeated tone', { tonesHz: [1500, 1500, ...STANDARD.tonesHz.slice(2)] }, /appears twice/],
    ['a non-integer tone', { tonesHz: [1500.5, ...STANDARD.tonesHz.slice(1)] }, /whole number/],
    ['guard + window longer than the symbol', { guardMs: 10 }, /exceeds the symbol length/],
    ['a pilot index that is not a tone', { pilotIndex: 16 }, /pilotIndex/],
    ['a cap above 1024', { capBytes: 2000 }, /capBytes/],
    ['a duplicate id', { id: 0 }, /id 0 appears twice/],
    ['a duplicate name', { name: 'robust', id: 5 }, /appears twice/],
  ] as const)('%s', (_label, change, pattern) => {
    expect(reasonFor(withProfile(change))).toMatch(pattern);
  });

  it('requires a robust profile with 2 bits per symbol', () => {
    expect(reasonFor([STANDARD])).toMatch(/must contain the "robust" profile/);
    expect(reasonFor([{ ...ROBUST, bitsPerSymbol: 3, tonesHz: PENTATONIC.tonesHz.map((f) => f), analysisMs: 20, guardMs: 5, symbolMs: 25 }])).toMatch(/2 bits per symbol/);
  });

  it('rejects an empty table', () => {
    expect(reasonFor([])).toMatch(/empty/);
  });
});
