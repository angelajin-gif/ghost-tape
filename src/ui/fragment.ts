// Tape link fragment (R22): '1' + unpadded base64url of the serialized payload.
// Hand-rolled base64url so the module has no Node-only API (no Buffer) and stays tiny.
import { deserializePayload, serializePayload } from '../modem/tape';
import type { Payload, Result } from '../modem/types';
import { routeById } from './routes';

/** The one-character version prefix; a future format gets a different character. */
export const FRAGMENT_VERSION = '1';
/** Longest Tape link we create (R22.5), counted in UTF-16 units of the whole URL. */
export const MAX_LINK_LENGTH = 2000;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ALPHABET_INDEX: ReadonlyMap<string, number> = new Map([...ALPHABET].map((c, i) => [c, i]));

function fail<T>(reason: string): Result<T> {
  return { ok: false, reason };
}

/** Characters needed for n bytes: 3 bytes give 4 characters; a 1- or 2-byte tail gives 2 or 3. */
export function base64urlLength(byteCount: number): number {
  return Math.ceil((4 * byteCount) / 3);
}

export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    // Pack up to 3 bytes into 24 bits, then read them back 6 bits at a time.
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    const chars = Math.min(4, bytes.length - i + 1);
    for (let k = 0; k < chars; k++) out += ALPHABET[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

/** Strict: alphabet only, no padding, length not 1 mod 4, and zero trailing bits (canonical). */
export function base64urlDecode(text: string): Result<Uint8Array> {
  if (text.length % 4 === 1) return fail('length');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < text.length; i++) {
    const v = ALPHABET_INDEX.get(text[i] as string);
    if (v === undefined) return fail('character');
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >> bits) & 255;
    }
  }
  // Leftover bits must be zero, otherwise two texts would decode to the same bytes.
  if ((acc & ((1 << bits) - 1)) !== 0) return fail('trailing-bits');
  return { ok: true, value: out };
}

export function encodeFragment(payload: Payload): Result<string> {
  const bytes = serializePayload(payload);
  if (!bytes.ok) return bytes;
  return { ok: true, value: FRAGMENT_VERSION + base64urlEncode(bytes.value) };
}

/** Accepts the fragment with or without one leading '#'. Never throws. */
export function decodeFragment(fragment: string): Result<Payload> {
  if (typeof fragment !== 'string') return fail('not-a-string');
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (text.length < 2 || text[0] !== FRAGMENT_VERSION) return fail('version');
  const bytes = base64urlDecode(text.slice(1));
  if (!bytes.ok) return bytes;
  try {
    return deserializePayload(bytes.value);
  } catch {
    return fail('payload');
  }
}

/** Length of origin + path + '#' + version, the part of a link before the payload text. */
export function linkPrefix(origin: string): string {
  return `${origin}${routeById('player').path}#${FRAGMENT_VERSION}`;
}

/** The cap as a pure length check: does a link with this prefix and payload size fit? */
export function linkFitsCap(prefixLength: number, byteCount: number): boolean {
  return prefixLength + base64urlLength(byteCount) <= MAX_LINK_LENGTH;
}

/** Reason 'too-long' tells the caller to show the "too long for a link" message (R22.5). */
export function buildTapeLink(origin: string, payload: Payload): Result<string> {
  const bytes = serializePayload(payload);
  if (!bytes.ok) return bytes;
  const prefix = linkPrefix(origin);
  if (!linkFitsCap(prefix.length, bytes.value.length)) return fail('too-long');
  return { ok: true, value: prefix + base64urlEncode(bytes.value) };
}
