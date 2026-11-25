// Feature: ghost-tape-ui, Property 4: Glyph visual model; Property 5 (pure part): Symbol history, membership and flicker
// **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHARSET_MARKS } from '../../../src/modem/tape';
import { displayedByte, glyphBlurPx, glyphChar, glyphOpacity, NEUTRAL_MARK, type Glyphs } from '../../../src/ui/darkroom/glyphs';
import { createHistory, historyValues, recordValue, withHistory } from '../../../src/ui/darkroom/history';
import { FLICKER_BELOW, GLYPH_BLUR_MAX_EM, GLYPH_OPACITY_MIN, HISTORY_DEPTH } from '../../../src/ui/tokens';
import { fcUi } from '../../support/uiRuns';

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const sortedPair = fc.tuple(unit, unit).map(([a, b]): [number, number] => (a <= b ? [a, b] : [b, a]));
const fontPx = fc.integer({ min: 1, max: 96 });

describe('P4 glyph visual model', () => {
  it('opacity is non-decreasing in confidence', () => {
    fc.assert(
      fc.property(sortedPair, ([lo, hi]) => glyphOpacity(lo) <= glyphOpacity(hi)),
      fcUi(),
    );
  });

  it('blur is non-increasing in confidence', () => {
    fc.assert(
      fc.property(sortedPair, fontPx, ([lo, hi], px) => glyphBlurPx(lo, px) >= glyphBlurPx(hi, px)),
      fcUi(),
    );
  });

  it('has the endpoints of R7.1', () => {
    expect(glyphOpacity(0)).toBe(GLYPH_OPACITY_MIN);
    expect(glyphOpacity(1)).toBe(1);
    fc.assert(
      fc.property(fontPx, (px) => glyphBlurPx(1, px) === 0 && glyphBlurPx(0, px) === GLYPH_BLUR_MAX_EM * px),
      fcUi(),
    );
  });

  it('maps all 256 byte values to the charset, an empty cell or the one neutral mark', () => {
    for (let b = 0; b < 256; b++) {
      const ch = glyphChar(b);
      if (b >= 0x20 && b <= 0x7e) expect(ch).toBe(String.fromCharCode(b));
      else if (b >= 0x80 && b <= 0x86) expect(ch).toBe(CHARSET_MARKS[b - 0x80]);
      else if (b === 0x0a) expect(ch).toBe('');
      else expect(ch).toBe(NEUTRAL_MARK);
    }
    expect(NEUTRAL_MARK).toBe('\u00b7');
  });
});

// ---- P5, pure part ------------------------------------------------------------------------

const POSITIONS = 6;
interface Report {
  readonly position: number;
  readonly byte: number;
  readonly conf: number;
}
const reports = fc.array(
  fc.record({
    position: fc.integer({ min: 0, max: POSITIONS - 1 }),
    // A small value range makes repeats and ring replacement likely.
    byte: fc.integer({ min: 0x20, max: 0x2f }),
    conf: fc.constantFrom(0, 0.2, 0.5, 0.74, FLICKER_BELOW, 0.9, 1),
  }),
  { maxLength: 80 },
);

/** Mirrors what the reducer does: record the value first, then set the Glyph. */
function apply(list: readonly Report[]): { g: Glyphs; h: ReturnType<typeof createHistory> } {
  const g: Glyphs = { byte: new Uint8Array(POSITIONS), conf: new Float32Array(POSITIONS), has: new Uint8Array(POSITIONS) };
  const h = createHistory(POSITIONS);
  for (const r of list) {
    recordValue(h, r.position, r.byte);
    g.byte[r.position] = r.byte;
    g.conf[r.position] = r.conf;
    g.has[r.position] = 1;
  }
  return { g, h };
}

const nowMs = fc.integer({ min: 0, max: 10 * 60 * 1000 });

describe('P5 symbol history and flicker (pure part)', () => {
  it('shows only the current byte or a history member, and nothing without a byte', () => {
    fc.assert(
      fc.property(reports, fc.integer({ min: 0, max: POSITIONS - 1 }), nowMs, fc.boolean(), (list, p, t, reduced) => {
        const { g, h } = apply(list);
        const shown = displayedByte(g, h, p, t, reduced);
        if (!g.has[p]) return shown === undefined;
        return shown === g.byte[p] || historyValues(h, p).includes(shown as number);
      }),
      fcUi(),
    );
  });

  it('is steady with fewer than two values, under reduced motion, or at confidence >= FLICKER_BELOW', () => {
    fc.assert(
      fc.property(reports, fc.integer({ min: 0, max: POSITIONS - 1 }), nowMs, fc.boolean(), (list, p, t, reduced) => {
        const { g, h } = apply(list);
        if (!g.has[p]) return true;
        const steady = reduced || g.conf[p]! >= FLICKER_BELOW || h.count[p]! < 2;
        return !steady || displayedByte(g, h, p, t, reduced) === g.byte[p];
      }),
      fcUi(),
    );
  });

  it('gives the same result for the same arguments', () => {
    fc.assert(
      fc.property(reports, fc.integer({ min: 0, max: POSITIONS - 1 }), nowMs, fc.boolean(), (list, p, t, reduced) => {
        const a = apply(list);
        const b = apply(list);
        return displayedByte(a.g, a.h, p, t, reduced) === displayedByte(b.g, b.h, p, t, reduced);
      }),
      fcUi(),
    );
  });

  it('keeps at most 8 distinct values per position, with no duplicates, and the last reported value present', () => {
    fc.assert(
      fc.property(reports, (list) => {
        const { h } = apply(list);
        for (let p = 0; p < POSITIONS; p++) {
          const values = historyValues(h, p);
          if (values.length > HISTORY_DEPTH || new Set(values).size !== values.length) return false;
          const last = [...list].reverse().find((r) => r.position === p);
          if (last && !values.includes(last.byte)) return false;
        }
        return true;
      }),
      fcUi(),
    );
  });

  it('replaces the oldest value first once 8 are held', () => {
    const h = createHistory(1);
    for (let b = 1; b <= 9; b++) recordValue(h, 0, b);
    expect(historyValues(h, 0).sort((x, y) => x - y)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    recordValue(h, 0, 10);
    expect(historyValues(h, 0)).not.toContain(2);
  });

  it('withHistory copies on write and returns the same object when nothing is new', () => {
    const h = createHistory(2);
    recordValue(h, 0, 65);
    expect(withHistory(h, (c) => recordValue(c, 0, 65))).toBe(h);
    const next = withHistory(h, (c) => recordValue(c, 1, 66));
    expect(next).not.toBe(h);
    expect(historyValues(h, 1)).toEqual([]);
    expect(historyValues(next, 1)).toEqual([66]);
  });
});
