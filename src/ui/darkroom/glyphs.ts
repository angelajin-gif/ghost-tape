// Glyph model (ghost-tape-ui R7, design "Glyph state and model").
//
// Pure: no DOM, no randomness, no clock reads. Time is an argument. Flicker is a fixed
// integer hash of (position, time step), so the same arguments always give the same byte.

import { CHARSET_MARKS } from '../../modem/tape';
import { FLICKER_BELOW, FLICKER_PERIOD_MS, GLYPH_BLUR_MAX_EM, GLYPH_OPACITY_MIN } from '../tokens';
import type { SymbolHistory } from './history';

export interface Glyphs {
  /** Current provisional byte per position; valid where `has` is 1. */
  readonly byte: Uint8Array;
  /** Confidence 0..1 per position. */
  readonly conf: Float32Array;
  /** 1 once a provisional byte exists for the position. */
  readonly has: Uint8Array;
}

const ASCII_FIRST = 0x20;
const ASCII_LAST = 0x7e;
const MARK_BASE = 0x80;
const NEWLINE = 0x0a;
/** Neutral mark for any byte outside the charset (U+00B7), identical everywhere (R7.2). */
export const NEUTRAL_MARK = String.fromCharCode(0xb7);

const clamp01 = (c: number): number => (Number.isNaN(c) ? 0 : Math.min(1, Math.max(0, c)));

/** Minimum at confidence 0, 1 at confidence 1, linear between (R7.1). */
export function glyphOpacity(confidence: number): number {
  return GLYPH_OPACITY_MIN + (1 - GLYPH_OPACITY_MIN) * clamp01(confidence);
}

/** Maximum blur at confidence 0, exactly 0 at confidence 1. Quadratic, so it sharpens late. */
export function glyphBlurPx(confidence: number, fontPx: number): number {
  const rest = 1 - clamp01(confidence);
  return GLYPH_BLUR_MAX_EM * fontPx * rest * rest;
}

/** Character drawn for a byte. A newline is an empty cell; everything else outside the charset is the neutral mark. */
export function glyphChar(byte: number): string {
  if (byte >= ASCII_FIRST && byte <= ASCII_LAST) return String.fromCharCode(byte);
  if (byte >= MARK_BASE && byte < MARK_BASE + CHARSET_MARKS.length) return CHARSET_MARKS[byte - MARK_BASE]!;
  if (byte === NEWLINE) return '';
  return NEUTRAL_MARK;
}

/** Fixed 32-bit integer hash (xorshift-multiply, the murmur3 finalizer). Returns an unsigned value. */
export function mix32(value: number): number {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Index of the current flicker interval for a position. The per-position phase offset keeps
 * positions out of step, so no frame changes every character at once (no full-field flash).
 */
export function flickerStep(position: number, nowMs: number): number {
  const phase = mix32(Math.imul(position, 0x9e3779b1)) % FLICKER_PERIOD_MS;
  return Math.floor((nowMs + phase) / FLICKER_PERIOD_MS);
}

/**
 * Byte to draw at a position, or undefined for unexposed grain (no provisional byte yet).
 * While flickering it picks only from the position's Symbol history, so every character
 * shown was really reported by the decoder (R7.6, R7.9).
 */
export function displayedByte(
  g: Glyphs,
  h: SymbolHistory,
  position: number,
  nowMs: number,
  reducedMotion: boolean,
): number | undefined {
  if (!g.has[position]) return undefined;
  const current = g.byte[position]!;
  const n = h.count[position] ?? 0;
  if (reducedMotion || g.conf[position]! >= FLICKER_BELOW || n < 2) return current;
  const pick = mix32(position + Math.imul(flickerStep(position, nowMs), 0x85ebca6b)) % n;
  return h.values[position * h.depth + pick]!;
}
