// Symbol history (ghost-tape-ui R7.7, design "Symbol history").
//
// Per position, the distinct byte values ever reported by `progress` events. Flicker cycles
// only among these, so no character is ever shown that the decoder did not actually report.
// Kept in flat typed arrays (about 10 KB for 1024 positions). Mutated in place by
// `recordValue`; callers that need a snapshot (checkpoint, reducer state) use `cloneHistory`.

import { HISTORY_DEPTH } from '../tokens';

export interface SymbolHistory {
  readonly depth: typeof HISTORY_DEPTH;
  /** Length positions * depth; values[p * depth + i] is valid for i < count[p]. */
  readonly values: Uint8Array;
  /** Length positions, 0..depth. */
  readonly count: Uint8Array;
  /** Length positions; ring index that is overwritten next once count reaches depth. */
  readonly next: Uint8Array;
}

export function createHistory(positions: number): SymbolHistory {
  return {
    depth: HISTORY_DEPTH,
    values: new Uint8Array(positions * HISTORY_DEPTH),
    count: new Uint8Array(positions),
    next: new Uint8Array(positions),
  };
}

/** Number of positions the history covers. */
export function historyPositions(h: SymbolHistory): number {
  return h.count.length;
}

/**
 * Adds `byte` to the position's list unless it is already there. When the list holds `depth`
 * values the oldest one is overwritten. Out-of-range positions are ignored (a stale event
 * must not throw). The reducer calls this before it sets the Glyph, so the shown byte is
 * always a member of the list.
 */
export function recordValue(h: SymbolHistory, position: number, byte: number): void {
  if (!Number.isInteger(position) || position < 0 || position >= h.count.length) return;
  const value = byte & 0xff;
  const base = position * h.depth;
  const n = h.count[position]!;
  for (let i = 0; i < n; i++) if (h.values[base + i] === value) return;
  if (n < h.depth) {
    h.values[base + n] = value;
    h.count[position] = n + 1;
    return;
  }
  const slot = h.next[position]!;
  h.values[base + slot] = value;
  h.next[position] = (slot + 1) % h.depth;
}

/** Distinct values recorded for a position, in storage order. */
export function historyValues(h: SymbolHistory, position: number): number[] {
  if (!Number.isInteger(position) || position < 0 || position >= h.count.length) return [];
  const base = position * h.depth;
  return Array.from(h.values.subarray(base, base + h.count[position]!));
}

/** Deep copy, so a state snapshot never shares arrays with the live history (copy-on-write). */
export function cloneHistory(h: SymbolHistory): SymbolHistory {
  return { depth: h.depth, values: h.values.slice(), count: h.count.slice(), next: h.next.slice() };
}

/**
 * Copy-on-write helper: returns the same history when `update` records nothing new, and a
 * modified copy otherwise. `update` receives the copy and may call `recordValue` on it.
 */
export function withHistory(h: SymbolHistory, update: (copy: SymbolHistory) => void): SymbolHistory {
  const copy = cloneHistory(h);
  update(copy);
  const same = copy.count.every((c, i) => c === h.count[i]) && copy.values.every((v, i) => v === h.values[i]);
  return same ? h : copy;
}
