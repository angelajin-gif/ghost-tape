// One pass of a ghost track: header, payload symbols, and the timeline that places
// them in time (design.md "Frame", "Header", "Payload pipeline").
//
//   [up-chirp 400 ms][gap 50][sync 8 symbols][header 80 symbols][payload + pilots][down-chirp 200]
//
// Everything is symbol-level here (tone indices); modulate.ts turns tone indices
// into samples. Each stage is paired with its inverse so it can be round-trip tested.

import {
  bitsToBytes,
  bitsToSymbols,
  bytesToBits,
  symbolsToBits,
  tonesToValues,
  valuesToTones,
} from './bits';
import { appendCrc32, crc32, stripCrc32 } from './crc32';
import {
  chooseMultiplier,
  deinterleave,
  geometry,
  interleave,
  joinAndTrim,
  padAndSplit,
  PAYLOAD_PARITY,
  payloadSymbolCount,
  permute,
  unpermute,
} from './interleave';
import {
  HEADER_PROFILE_NAME,
  MAX_PAYLOAD_BYTES,
  profileById,
  profileByName,
  type Profile,
  type ProfileTable,
} from './profiles';
import { rsDecode, rsEncode } from './reedSolomon';
import type { Result } from './types';

// ---------- timeline constants (milliseconds, whole numbers) ----------

export const PREAMBLE_MS = 400;
export const GAP_MS = 50;
export const POSTAMBLE_MS = 200;
/** Preamble sweeps up 1000 -> 3200 Hz, postamble back down (R1.15). */
export const CHIRP_LOW_HZ = 1000;
export const CHIRP_HIGH_HZ = 3200;
/** A recognisable four-note motif played twice (Robust tone indices). */
export const SYNC_TONES: Uint8Array = Uint8Array.of(0, 3, 0, 3, 1, 2, 1, 2);

export const HEADER_DATA_BYTES = 12;
export const HEADER_PARITY_BYTES = 8;
export const HEADER_BYTES = HEADER_DATA_BYTES + HEADER_PARITY_BYTES;

const MAGIC_0 = 0x47; // 'G'
const MAGIC_1 = 0x54; // 'T'
const VERSION = 0x01;

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

// ---------- header ----------

export interface Header {
  /** Table `id` of the payload profile. */
  readonly profileId: number;
  /** 0 = tape (Side A), 1 = ghost (Side B). */
  readonly payloadKind: 0 | 1;
  /** Serialized payload length in bytes, before CRC and parity. */
  readonly payloadLength: number;
  /** CRC-32 of the serialized payload; recognises repeat passes of the same tape. */
  readonly tapeId: number;
}

/** The 12 data bytes, big-endian. Validates every field (R7.5). */
export function headerToBytes(h: Header, table: ProfileTable): Result<Uint8Array> {
  const problem = headerProblem(h, table);
  if (problem) return fail(problem);
  const out = new Uint8Array(HEADER_DATA_BYTES);
  out[0] = MAGIC_0;
  out[1] = MAGIC_1;
  out[2] = VERSION;
  out[3] = h.profileId;
  out[4] = h.payloadKind;
  out[5] = h.payloadLength >>> 8;
  out[6] = h.payloadLength & 0xff;
  out[7] = 0; // flags, reserved
  out[8] = h.tapeId >>> 24;
  out[9] = (h.tapeId >>> 16) & 0xff;
  out[10] = (h.tapeId >>> 8) & 0xff;
  out[11] = h.tapeId & 0xff;
  return { ok: true, value: out };
}

function headerProblem(h: Header, table: ProfileTable): string | undefined {
  const profile = profileById(table, h.profileId);
  if (!profile) return `profileId ${h.profileId} is not defined`;
  if (h.payloadKind !== 0 && h.payloadKind !== 1) return `payloadKind ${h.payloadKind} must be 0 or 1`;
  if (!Number.isInteger(h.payloadLength) || h.payloadLength < 1 || h.payloadLength > MAX_PAYLOAD_BYTES) {
    return `payloadLength ${h.payloadLength} is outside 1-${MAX_PAYLOAD_BYTES}`;
  }
  if (h.payloadLength > profile.capBytes) return `payloadLength ${h.payloadLength} exceeds the ${profile.capBytes}-byte cap of ${profile.name}`;
  if (!Number.isInteger(h.tapeId) || h.tapeId < 0 || h.tapeId > 0xffffffff) return 'tapeId must be a 32-bit unsigned integer';
  return undefined;
}

/** Strict parse of the 12 data bytes. */
export function bytesToHeader(bytes: Uint8Array, table: ProfileTable): Result<Header> {
  if (bytes.length !== HEADER_DATA_BYTES) return fail(`header needs ${HEADER_DATA_BYTES} bytes, got ${bytes.length}`);
  if (bytes[0] !== MAGIC_0 || bytes[1] !== MAGIC_1) return fail('bad magic');
  if (bytes[2] !== VERSION) return fail(`unsupported version ${bytes[2]}`);
  if (bytes[7] !== 0) return fail('reserved flags must be 0');
  const h = {
    profileId: bytes[3]!,
    payloadKind: bytes[4]! as 0 | 1,
    payloadLength: (bytes[5]! << 8) | bytes[6]!,
    tapeId: ((bytes[8]! << 24) | (bytes[9]! << 16) | (bytes[10]! << 8) | bytes[11]!) >>> 0,
  };
  const problem = headerProblem(h, table);
  return problem ? fail(problem) : { ok: true, value: h };
}

/** Header as 20 Reed–Solomon-protected bytes (12 data + 8 parity; corrects 4 byte errors). */
export function buildHeader(h: Header, table: ProfileTable): Result<Uint8Array> {
  const data = headerToBytes(h, table);
  return data.ok ? rsEncode(data.value, HEADER_PARITY_BYTES) : data;
}

/** Inverse of buildHeader. Any RS failure or invalid field is an error (R7.5). */
export function parseHeader(bytes: Uint8Array, table: ProfileTable): Result<Header> {
  if (bytes.length !== HEADER_BYTES) return fail(`header needs ${HEADER_BYTES} bytes, got ${bytes.length}`);
  const decoded = rsDecode(bytes, HEADER_PARITY_BYTES);
  return decoded.ok ? bytesToHeader(decoded.value.data, table) : fail(`header ${decoded.reason}`);
}

function headerProfile(table: ProfileTable): Result<Profile> {
  const p = profileByName(table, HEADER_PROFILE_NAME);
  return p ? { ok: true, value: p } : fail(`profile table has no "${HEADER_PROFILE_NAME}" profile`);
}

/** The 80 Robust tone indices carrying the header. */
export function headerToTones(h: Header, table: ProfileTable): Result<Uint8Array> {
  const bytes = buildHeader(h, table);
  const robust = headerProfile(table);
  if (!bytes.ok) return bytes;
  if (!robust.ok) return robust;
  return { ok: true, value: valuesToTones(bitsToSymbols(bytesToBits(bytes.value), robust.value.bitsPerSymbol)) };
}

/** Inverse of headerToTones. */
export function tonesToHeader(tones: Uint8Array, table: ProfileTable): Result<Header> {
  const robust = headerProfile(table);
  if (!robust.ok) return robust;
  const bits = symbolsToBits(tonesToValues(tones), robust.value.bitsPerSymbol, HEADER_BYTES * 8);
  if (!bits.ok) return bits;
  const bytes = bitsToBytes(bits.value);
  return bytes.ok ? parseHeader(bytes.value, table) : bytes;
}

// ---------- payload symbols ----------

function checkPayloadLength(length: number, profile: Profile): string | undefined {
  if (!Number.isInteger(length) || length < 1) return 'payload must not be empty';
  if (length > MAX_PAYLOAD_BYTES || length > profile.capBytes) return `payload of ${length} bytes exceeds the ${Math.min(MAX_PAYLOAD_BYTES, profile.capBytes)}-byte cap of ${profile.name}`;
  return undefined;
}

/** Insert one pilot after every `pilotEvery` data symbols (S = D + floor(D / pilotEvery)). */
function addPilots(data: Uint8Array, profile: Profile): Uint8Array {
  const out = new Uint8Array(data.length + Math.floor(data.length / profile.pilotEvery));
  let o = 0;
  for (let i = 0; i < data.length; i++) {
    out[o++] = data[i]!;
    if ((i + 1) % profile.pilotEvery === 0) out[o++] = profile.pilotIndex;
  }
  return out;
}

/** Inverse of addPilots: drop every (pilotEvery + 1)-th symbol. */
function removePilots(withPilots: Uint8Array, profile: Profile): Uint8Array {
  const group = profile.pilotEvery + 1;
  const out = new Uint8Array(withPilots.length - Math.floor(withPilots.length / group));
  let o = 0;
  for (let i = 0; i < withPilots.length; i++) if ((i + 1) % group !== 0) out[o++] = withPilots[i]!;
  return out;
}

/**
 * Serialized payload -> payload tone indices including pilots:
 * +CRC-32, pad and split, RS(+32) per block, byte-interleave, whole-stream
 * permutation, bytes -> bits -> symbol values, Gray code, pilots.
 */
export function buildPayloadSymbols(payload: Uint8Array, profile: Profile): Result<Uint8Array> {
  const bad = checkPayloadLength(payload.length, profile);
  if (bad) return fail(bad);
  const codewords: Uint8Array[] = [];
  for (const block of padAndSplit(appendCrc32(payload))) {
    const cw = rsEncode(block, PAYLOAD_PARITY);
    if (!cw.ok) return cw;
    codewords.push(cw.value);
  }
  const stream = interleave(codewords);
  if (!stream.ok) return stream;
  const a = chooseMultiplier(payload.length, profile);
  if (!a.ok) return a;
  const transmitted = permute(stream.value, a.value);
  const values = bitsToSymbols(bytesToBits(transmitted), profile.bitsPerSymbol);
  return { ok: true, value: addPilots(valuesToTones(values), profile) };
}

/**
 * Inverse of buildPayloadSymbols with hard decisions: the payload and the CRC it
 * carried, or a failure if any RS block is uncorrectable or the CRC trailer
 * does not match. (The streaming decoder, task 12, adds soft combining on top.)
 */
export function parsePayloadSymbols(tones: Uint8Array, payloadLength: number, profile: Profile): Result<{ payload: Uint8Array; crc: number }> {
  const bad = checkPayloadLength(payloadLength, profile);
  if (bad) return fail(bad);
  const g = geometry(payloadLength);
  if (tones.length !== payloadSymbolCount(g, profile)) {
    return fail(`expected ${payloadSymbolCount(g, profile)} payload symbols, got ${tones.length}`);
  }
  const bits = symbolsToBits(tonesToValues(removePilots(tones, profile)), profile.bitsPerSymbol, 8 * g.streamLength);
  if (!bits.ok) return bits;
  const transmitted = bitsToBytes(bits.value);
  if (!transmitted.ok) return transmitted;
  const a = chooseMultiplier(payloadLength, profile);
  if (!a.ok) return a;
  const blocks = deinterleave(unpermute(transmitted.value, a.value), g.blocks);
  if (!blocks.ok) return blocks;
  const data: Uint8Array[] = [];
  for (const cw of blocks.value) {
    const decoded = rsDecode(cw, PAYLOAD_PARITY);
    if (!decoded.ok) return fail(`payload block ${decoded.reason}`);
    data.push(decoded.value.data);
  }
  const joined = joinAndTrim(data, g.crcLength);
  return joined.ok ? stripCrc32(joined.value) : joined;
}

// ---------- whole frame ----------

export interface FrameSymbols {
  readonly header: Header;
  /** Robust tone indices, 8 symbols. */
  readonly syncTones: Uint8Array;
  /** Robust tone indices, 80 symbols. */
  readonly headerTones: Uint8Array;
  /** Tone indices of the payload profile, pilots included. */
  readonly payloadTones: Uint8Array;
}

/** Serialized payload (byte 0 is its kind) -> all symbols of one pass. */
export function buildFrameSymbols(payload: Uint8Array, profile: Profile, table: ProfileTable): Result<FrameSymbols> {
  const bad = checkPayloadLength(payload.length, profile);
  if (bad) return fail(bad);
  const kind = payload[0];
  if (kind !== 0 && kind !== 1) return fail(`payload kind byte ${kind} must be 0 or 1`);
  const header: Header = { profileId: profile.id, payloadKind: kind, payloadLength: payload.length, tapeId: crc32(payload) };
  const headerTones = headerToTones(header, table);
  if (!headerTones.ok) return headerTones;
  const payloadTones = buildPayloadSymbols(payload, profile);
  if (!payloadTones.ok) return payloadTones;
  return { ok: true, value: { header, syncTones: SYNC_TONES, headerTones: headerTones.value, payloadTones: payloadTones.value } };
}

/** Inverse of buildFrameSymbols at symbol level: header, then payload by the profile the header names (R9.6). */
export function parseFrameSymbols(headerTones: Uint8Array, payloadTones: Uint8Array, table: ProfileTable): Result<{ header: Header; payload: Uint8Array }> {
  const header = tonesToHeader(headerTones, table);
  if (!header.ok) return header;
  const profile = profileById(table, header.value.profileId)!;
  const payload = parsePayloadSymbols(payloadTones, header.value.payloadLength, profile);
  if (!payload.ok) return payload;
  if (payload.value.crc !== header.value.tapeId) return fail('payload CRC-32 does not match the header tapeId');
  return { ok: true, value: { header: header.value, payload: payload.value.payload } };
}

// ---------- timeline ----------

/** Symbol counts per segment fix the whole timeline. All times are whole milliseconds from the pass's first sample. */
export interface FrameLayout {
  readonly syncStartMs: number;
  readonly headerStartMs: number;
  readonly payloadStartMs: number;
  readonly payloadSymbols: number;
  readonly postambleStartMs: number;
  readonly totalMs: number;
}

export function frameLayout(payloadSymbols: number, payloadProfile: Profile, robust: Profile): FrameLayout {
  const syncStartMs = PREAMBLE_MS + GAP_MS;
  const headerStartMs = syncStartMs + SYNC_TONES.length * robust.symbolMs;
  const payloadStartMs = headerStartMs + (HEADER_BYTES * 8 / robust.bitsPerSymbol) * robust.symbolMs;
  const postambleStartMs = payloadStartMs + payloadSymbols * payloadProfile.symbolMs;
  return { syncStartMs, headerStartMs, payloadStartMs, payloadSymbols, postambleStartMs, totalMs: postambleStartMs + POSTAMBLE_MS };
}

/**
 * Sample index of a time given in whole milliseconds: round(ms · sampleRate / 1000),
 * halves up. Rounding the absolute time, never adding rounded lengths, keeps the error
 * under half a sample with no build-up even when a symbol is 1102.5 samples long (R1.13).
 */
export function sampleAtMs(ms: number, sampleRate: number): number {
  return Math.floor((ms * sampleRate + 500) / 1000);
}
