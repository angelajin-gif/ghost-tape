// Profiles as data (design.md "Profiles", requirements 9).
//
// Every encoder and decoder parameter is read from a Profile entry, so adding an
// entry to the table is enough to get a new working profile (R9.7). The two
// built-in entries are Robust (music box, slow, tolerant) and Standard (fast).
//
// Tones sit on a grid of 1 / analysisWindow. A tone whose frequency is a whole
// number of cycles in the analysis window leaks nothing into the Goertzel bin of
// any other grid tone, so the tones are orthogonal: a clean 1500 Hz symbol
// registers zero energy at 1600 Hz. validateProfileTable enforces this.

import type { BitsPerSymbol } from './bits';
import type { ProfileId, Result } from './types';

export type EnvelopeKind = 'bell' | 'flat';

export interface Profile {
  /** Name used in the API (`ProfileId`), e.g. 'robust'. */
  readonly name: ProfileId;
  /** Byte carried in the header's profileId field. */
  readonly id: number;
  /** Tone frequencies in Hz; index = tone index. Length is 2^bitsPerSymbol. */
  readonly tonesHz: readonly number[];
  readonly bitsPerSymbol: BitsPerSymbol;
  readonly symbolMs: number;
  /** Start of each symbol the decoder skips: room echo from the previous symbol lingers there. */
  readonly guardMs: number;
  /** Goertzel window; guardMs + analysisMs <= symbolMs. */
  readonly analysisMs: number;
  readonly envelope: EnvelopeKind;
  /** Tone index of the pilot symbol inserted after every `pilotEvery` data symbols. */
  readonly pilotIndex: number;
  readonly pilotEvery: number;
  /** Largest serialized payload (bytes) this profile may carry (R1.2). */
  readonly capBytes: number;
}

export type ProfileTable = readonly Profile[];

/** Protocol-wide maximum payload (header payloadLength is 1..1024). */
export const MAX_PAYLOAD_BYTES = 1024;

/** The sync and header are always sent with this profile, whatever the payload profile (R9.4). */
export const HEADER_PROFILE_NAME = 'robust';

export const MIN_TONE_HZ = 300;
export const MAX_TONE_HZ = 3200;

/** 4 tones: a D-major arpeggio (D6 F#6 A6 D7) rounded to the 25 Hz grid. */
export const ROBUST: Profile = {
  name: 'robust',
  id: 0,
  tonesHz: [1175, 1475, 1750, 2350],
  bitsPerSymbol: 2,
  symbolMs: 50,
  guardMs: 10,
  analysisMs: 40,
  envelope: 'bell',
  pilotIndex: 3,
  pilotEvery: 32,
  capBytes: 256,
};

/** 16 tones, 100 Hz apart from 1500 Hz. */
export const STANDARD: Profile = {
  name: 'standard',
  id: 1,
  tonesHz: Array.from({ length: 16 }, (_, k) => 1500 + 100 * k),
  bitsPerSymbol: 4,
  symbolMs: 25,
  guardMs: 5,
  analysisMs: 20,
  envelope: 'flat',
  pilotIndex: 15,
  pilotEvery: 32,
  capBytes: 1024,
};

export const PROFILES: ProfileTable = [ROBUST, STANDARD];

export function profileByName(table: ProfileTable, name: ProfileId): Profile | undefined {
  return table.find((p) => p.name === name);
}

export function profileById(table: ProfileTable, id: number): Profile | undefined {
  return table.find((p) => p.id === id);
}

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Check one profile; returns a reason or undefined. */
function problemWith(p: Profile): string | undefined {
  const who = `profile "${p.name}"`;
  if (typeof p.name !== 'string' || p.name === '') return 'profile name must be a non-empty string';
  if (!Number.isInteger(p.id) || p.id < 0 || p.id > 255) return `${who}: id must be an integer 0..255`;
  if (!Number.isInteger(p.bitsPerSymbol) || p.bitsPerSymbol < 1 || p.bitsPerSymbol > 8) return `${who}: bitsPerSymbol must be 1..8`;
  if (p.tonesHz.length !== 2 ** p.bitsPerSymbol) return `${who}: needs ${2 ** p.bitsPerSymbol} tones for ${p.bitsPerSymbol} bits per symbol, has ${p.tonesHz.length}`;
  if (![p.symbolMs, p.guardMs, p.analysisMs].every(isPositiveInt)) return `${who}: symbolMs, guardMs and analysisMs must be positive whole milliseconds`;
  if (p.guardMs + p.analysisMs > p.symbolMs) return `${who}: guard + analysis window exceeds the symbol length`;
  if (!isPositiveInt(p.pilotEvery)) return `${who}: pilotEvery must be a positive integer`;
  if (!Number.isInteger(p.pilotIndex) || p.pilotIndex < 0 || p.pilotIndex >= p.tonesHz.length) return `${who}: pilotIndex is not a tone index`;
  if (!isPositiveInt(p.capBytes) || p.capBytes > MAX_PAYLOAD_BYTES) return `${who}: capBytes must be 1..${MAX_PAYLOAD_BYTES}`;
  if (p.envelope !== 'bell' && p.envelope !== 'flat') return `${who}: unknown envelope`;
  const seen = new Set<number>();
  for (const f of p.tonesHz) {
    if (!Number.isInteger(f)) return `${who}: tone ${f} Hz is not a whole number of Hz`;
    if (f < MIN_TONE_HZ || f > MAX_TONE_HZ) return `${who}: tone ${f} Hz is outside ${MIN_TONE_HZ}-${MAX_TONE_HZ} Hz`;
    if (seen.has(f)) return `${who}: tone ${f} Hz appears twice`;
    seen.add(f);
    // A whole number of cycles fits in the analysis window: f · window = integer.
    if ((f * p.analysisMs) % 1000 !== 0) return `${who}: tone ${f} Hz is off the ${1000 / p.analysisMs} Hz orthogonality grid`;
  }
  return undefined;
}

/** Validate a table (used for injected tables; built-ins are covered by tests). Never throws. */
export function validateProfileTable(table: ProfileTable): Result<ProfileTable> {
  if (!Array.isArray(table) || table.length === 0) return fail('profile table is empty');
  const names = new Set<string>();
  const ids = new Set<number>();
  for (const p of table) {
    const problem = problemWith(p);
    if (problem) return fail(problem);
    if (names.has(p.name)) return fail(`profile name "${p.name}" appears twice`);
    if (ids.has(p.id)) return fail(`profile id ${p.id} appears twice`);
    names.add(p.name);
    ids.add(p.id);
  }
  const header = profileByName(table, HEADER_PROFILE_NAME);
  // The sync pattern uses tone indices 0..3 and the header is 160 bits = 80 symbols at 2 bits.
  if (!header) return fail(`profile table must contain the "${HEADER_PROFILE_NAME}" profile`);
  if (header.bitsPerSymbol !== 2) return fail(`"${HEADER_PROFILE_NAME}" must use 2 bits per symbol`);
  return { ok: true, value: table };
}
