// Pad, split, interleave and permute the payload codeword stream
// (design.md "Payload pipeline" steps 2, 4, 5; requirements 8.10–8.16).
//
// Why two shuffles?
// - Block interleaving (byte 0 of every block, then byte 1, ...) spreads a burst of
//   damaged bytes over all RS blocks, so no single block gets more than its share.
// - The whole-stream permutation i -> (a·i) mod L, with a near 0.618·L (the golden
//   ratio), then spreads consecutive transmitted bytes evenly over the message, so
//   the darkroom image fills in everywhere at once instead of top to bottom.

import type { Result } from './types';

/** RS parity bytes per payload block, and the largest data length per block. */
export const PAYLOAD_PARITY = 32;
export const MAX_BLOCK_DATA = 223;
/** CRC-32 trailer length. */
export const CRC_LENGTH = 4;

/** Profile facts the darkroom spread check (R8.16) depends on. */
export interface SpreadParams {
  readonly bitsPerSymbol: number;
  /** A pilot symbol follows every `pilotEvery` data symbols. */
  readonly pilotEvery: number;
}

/** Block layout for a payload of P bytes (R8.10). */
export interface Geometry {
  /** Payload bytes P (before CRC). */
  readonly payloadLength: number;
  /** P + 4 (payload + CRC-32). */
  readonly crcLength: number;
  /** RS blocks B = ceil(M / 223). */
  readonly blocks: number;
  /** Data bytes per block k = ceil(M / B), after zero padding. */
  readonly blockData: number;
  /** Codeword bytes per block n = k + 32. */
  readonly blockLength: number;
  /** Codeword stream length L = B·n. */
  readonly streamLength: number;
}

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export function geometry(payloadLength: number): Geometry {
  const crcLength = payloadLength + CRC_LENGTH;
  const blocks = Math.ceil(crcLength / MAX_BLOCK_DATA);
  const blockData = Math.ceil(crcLength / blocks);
  const blockLength = blockData + PAYLOAD_PARITY;
  return { payloadLength, crcLength, blocks, blockData, blockLength, streamLength: blocks * blockLength };
}

/**
 * Zero-pad payload+CRC to B·k bytes and cut it into B blocks of k bytes (R8.10).
 * Equal block lengths make B divide the stream length, which the interleaver needs.
 */
export function padAndSplit(withCrc: Uint8Array): Uint8Array[] {
  const g = geometry(withCrc.length - CRC_LENGTH);
  const padded = new Uint8Array(g.blocks * g.blockData);
  padded.set(withCrc);
  return Array.from({ length: g.blocks }, (_, b) => padded.slice(b * g.blockData, (b + 1) * g.blockData));
}

/** Inverse of padAndSplit: join blocks and drop the zero padding after `crcLength` bytes. */
export function joinAndTrim(blocks: readonly Uint8Array[], crcLength: number): Result<Uint8Array> {
  const total = blocks.reduce((sum, b) => sum + b.length, 0);
  if (crcLength < 0 || crcLength > total) return fail(`cannot take ${crcLength} bytes from ${total}`);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const b of blocks) {
    joined.set(b, offset);
    offset += b.length;
  }
  return { ok: true, value: joined.slice(0, crcLength) };
}

/** Byte-interleave equal-length codewords: stream[pos·B + b] = codeword b, byte pos. */
export function interleave(codewords: readonly Uint8Array[]): Result<Uint8Array> {
  const B = codewords.length;
  if (B === 0) return fail('no codewords');
  const n = codewords[0]!.length;
  if (codewords.some((c) => c.length !== n)) return fail('codewords differ in length');
  const stream = new Uint8Array(B * n);
  for (let b = 0; b < B; b++) {
    const c = codewords[b]!;
    for (let pos = 0; pos < n; pos++) stream[pos * B + b] = c[pos]!;
  }
  return { ok: true, value: stream };
}

/** Inverse of interleave for B blocks. */
export function deinterleave(stream: Uint8Array, blocks: number): Result<Uint8Array[]> {
  if (!Number.isInteger(blocks) || blocks < 1) return fail(`invalid block count ${blocks}`);
  if (stream.length % blocks !== 0) return fail(`stream length ${stream.length} is not a multiple of ${blocks}`);
  const n = stream.length / blocks;
  const out = Array.from({ length: blocks }, () => new Uint8Array(n));
  for (let j = 0; j < stream.length; j++) out[j % blocks]![Math.floor(j / blocks)] = stream[j]!;
  return { ok: true, value: out };
}

/** Transmission order (R8.11): transmitted byte i = interleaved byte (a·i) mod L. */
export function permute(interleaved: Uint8Array, a: number): Uint8Array {
  const L = interleaved.length;
  const out = new Uint8Array(L);
  for (let i = 0; i < L; i++) out[i] = interleaved[(a * i) % L]!;
  return out;
}

/** Inverse of permute (R8.14). */
export function unpermute(transmitted: Uint8Array, a: number): Uint8Array {
  const L = transmitted.length;
  const out = new Uint8Array(L);
  for (let i = 0; i < L; i++) out[(a * i) % L] = transmitted[i]!;
  return out;
}

/**
 * Final payload position (0..P-1) of interleaved byte j, or -1 for CRC, padding
 * or parity bytes. RS is systematic, so a block's first k bytes are its data.
 */
export function payloadPositionOfInterleaved(j: number, g: Geometry): number {
  const posInBlock = Math.floor(j / g.blocks);
  if (posInBlock >= g.blockData) return -1;
  const position = (j % g.blocks) * g.blockData + posInBlock;
  return position < g.payloadLength ? position : -1;
}

/** Payload symbols in one pass: data symbols plus one pilot after every `pilotEvery` data symbols. */
export function payloadSymbolCount(g: Geometry, spread: SpreadParams): number {
  const dataSymbols = Math.ceil((8 * g.streamLength) / spread.bitsPerSymbol);
  return dataSymbols + Math.floor(dataSymbols / spread.pilotEvery);
}

/** Complete transmitted bytes carried by the first `symbols` payload symbols (pilots skipped). */
export function bytesInFirstSymbols(symbols: number, spread: SpreadParams): number {
  const pilots = Math.floor(symbols / (spread.pilotEvery + 1));
  return Math.floor(((symbols - pilots) * spread.bitsPerSymbol) / 8);
}

/** R8.13: every 16 consecutive transmitted bytes include a byte of every block (only required for B <= 16). */
export function windowCoversAllBlocks(g: Geometry, a: number): boolean {
  if (g.blocks > 16) return true;
  const L = g.streamLength;
  const seen = new Uint8Array(g.blocks);
  for (let start = 0; start + 16 <= L; start++) {
    seen.fill(0);
    let distinct = 0;
    for (let i = start; i < start + 16; i++) {
      const block = ((a * i) % L) % g.blocks;
      if (seen[block] === 0) {
        seen[block] = 1;
        distinct++;
      }
    }
    if (distinct < g.blocks) return false;
  }
  return true;
}

/**
 * R8.16: after ceil(0.1·S) payload symbols, if they carry >= 20 payload bytes,
 * every tenth of positions 0..P-1 has at least one byte. Returns true when the
 * precondition is not met (nothing to check).
 */
export function spreadsOverTenths(g: Geometry, a: number, spread: SpreadParams): boolean {
  const P = g.payloadLength;
  const bytes = bytesInFirstSymbols(Math.ceil(0.1 * payloadSymbolCount(g, spread)), spread);
  const hit = new Uint8Array(10);
  let payloadBytes = 0;
  for (let i = 0; i < bytes; i++) {
    const position = payloadPositionOfInterleaved((a * i) % g.streamLength, g);
    if (position < 0) continue;
    payloadBytes++;
    // Tenth t covers floor(t·P/10) .. floor((t+1)·P/10) - 1.
    for (let t = 0; t < 10; t++) {
      if (position >= Math.floor((t * P) / 10) && position < Math.floor(((t + 1) * P) / 10)) hit[t] = 1;
    }
  }
  return payloadBytes < 20 || hit.every((h) => h === 1);
}

const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));

const multiplierCache = new Map<string, number>();

/**
 * Permutation multiplier a (R8.11): among 1 <= a < L coprime to L and B whose order
 * passes R8.13 and R8.16 for this profile, the one closest to 0.618·L (tie: smaller).
 * Coprime to L makes i -> a·i mod L a bijection; coprime to B keeps consecutive
 * bytes cycling through the blocks. A pure function of (P, profile), so encoder and
 * decoder agree with no extra header field.
 */
export function chooseMultiplier(payloadLength: number, spread: SpreadParams): Result<number> {
  if (!Number.isInteger(payloadLength) || payloadLength < 1) return fail(`invalid payload length ${payloadLength}`);
  if (!Number.isInteger(spread.bitsPerSymbol) || spread.bitsPerSymbol < 1 || !Number.isInteger(spread.pilotEvery) || spread.pilotEvery < 1) {
    return fail('invalid spread parameters');
  }
  const key = `${payloadLength}/${spread.bitsPerSymbol}/${spread.pilotEvery}`;
  const cached = multiplierCache.get(key);
  if (cached !== undefined) return { ok: true, value: cached };

  const g = geometry(payloadLength);
  const L = g.streamLength;
  const target = 0.618 * L;
  const candidates: number[] = [];
  for (let a = 1; a < L; a++) if (gcd(a, L) === 1 && gcd(a, g.blocks) === 1) candidates.push(a);
  candidates.sort((x, y) => Math.abs(x - target) - Math.abs(y - target) || x - y);

  const a = candidates.find((c) => windowCoversAllBlocks(g, c) && spreadsOverTenths(g, c, spread));
  if (a === undefined) return fail(`no permutation multiplier satisfies R8.13 and R8.16 for P = ${payloadLength}`);
  multiplierCache.set(key, a);
  return { ok: true, value: a };
}
