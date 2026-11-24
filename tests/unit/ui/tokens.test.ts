// P31: tokens and contrast. Validates: Requirements 7.10, 32.2, 32.9, 36.1, 36.3, 36.6, 36.9, 36.10
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLORS,
  CONTRAST_PAIRS,
  FIX_TOTAL_MS,
  FLICKER_BELOW,
  FONT_SIZES_PX,
  FORBIDDEN_PAIRS,
  GLYPH_PAIR,
  KIND_CONFIDENCE_MIN,
  LAYOUT_CONFIDENCE_MIN,
  MOTION_MS,
  MOTION_REDUCED_MS,
  PALETTES,
  REDUCED_MOTION_MAX_MS,
  TOKENS,
  TOKENS_REDUCED,
  contrastRatio,
  createReducedMotionStore,
  parseHex,
  resolveColor,
  type MotionName,
  type ReducedMotionSource,
} from '../../../src/ui/tokens';

const css = readFileSync(new URL('../../../src/ui/tokens.css', import.meta.url), 'utf8');

function parseCustomProperties(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[match[1]!] = match[2]!.trim();
  return out;
}

const mediaStart = css.indexOf('@media');
const baseCss = css.slice(0, mediaStart).replace(/\/\*[\s\S]*?\*\//g, '');
const reducedCss = css.slice(mediaStart).replace(/\/\*[\s\S]*?\*\//g, '');

describe('P31 contrast', () => {
  it('declares the 22 pairs from the design', () => {
    expect(CONTRAST_PAIRS).toHaveLength(22);
  });

  it.each(CONTRAST_PAIRS.map((pair, index) => [index, pair] as const))('pair %i meets its threshold and the design ratio', (_index, pair) => {
    const ratio = contrastRatio(resolveColor(pair.fg), resolveColor(pair.bg));
    expect(ratio).toBeGreaterThanOrEqual(pair.min);
    expect(Math.abs(ratio - pair.designRatio)).toBeLessThan(0.01);
  });

  it('highlight blend equals the design colour #E3C3B0', () => {
    const blend = CONTRAST_PAIRS.map((p) => p.bg).find((bg) => typeof bg !== 'string');
    expect(blend).toBeDefined();
    expect(resolveColor(blend!)).toEqual(parseHex('#E3C3B0'));
  });

  it('forbidden pairs do fail, so they stay out of the table', () => {
    for (const forbidden of FORBIDDEN_PAIRS) {
      const declared = CONTRAST_PAIRS.some((p) => p.fg === forbidden.fg && p.bg === forbidden.bg);
      expect(declared).toBe(false);
      expect(contrastRatio(resolveColor(forbidden.fg), resolveColor(forbidden.bg))).toBeLessThan(3);
    }
  });

  it('declares the Glyph pair at confidence 1 and nothing for confidence below 1', () => {
    const glyphPairs = CONTRAST_PAIRS.filter((p) => p.scope === 'glyph-confidence-1');
    expect(glyphPairs).toHaveLength(1);
    expect(glyphPairs[0]!.fg).toBe(GLYPH_PAIR.fg);
    expect(glyphPairs[0]!.bg).toBe(GLYPH_PAIR.bg);
    expect(CONTRAST_PAIRS.some((p) => /provisional/i.test(p.use))).toBe(false);
  });

  it('only uses colours that exist', () => {
    for (const pair of CONTRAST_PAIRS) expect(COLORS[pair.fg]).toBeDefined();
  });
});

describe('P31 palettes', () => {
  it('has at most six colours per palette and every colour is in exactly one', () => {
    for (const names of Object.values(PALETTES)) expect(names.length).toBeLessThanOrEqual(6);
    const all = Object.values(PALETTES).flat().sort();
    expect(all).toEqual(Object.keys(COLORS).sort());
  });
});

describe('P31 CSS and TS tokens', () => {
  it('tokens.css :root has the same names and values as TOKENS', () => {
    expect(parseCustomProperties(baseCss)).toEqual(TOKENS);
  });

  it('tokens.css reduced-motion block equals TOKENS_REDUCED', () => {
    expect(reducedCss).toContain('prefers-reduced-motion: reduce');
    expect(parseCustomProperties(reducedCss)).toEqual(TOKENS_REDUCED);
  });
});

describe('P31 motion and type', () => {
  const names = Object.keys(MOTION_MS) as MotionName[];

  it('reduced-motion durations are 0 or at most 200 ms', () => {
    for (const name of names) {
      const ms = MOTION_REDUCED_MS[name];
      expect(ms === 0 || ms <= REDUCED_MOTION_MAX_MS).toBe(true);
    }
  });

  it('body type is at least 16 px', () => {
    expect(FONT_SIZES_PX['fs-body']).toBeGreaterThanOrEqual(16);
    for (const px of Object.values(FONT_SIZES_PX)) expect(px).toBeGreaterThanOrEqual(16);
  });

  it('fixed design values', () => {
    expect(KIND_CONFIDENCE_MIN).toBe(0.6);
    expect(LAYOUT_CONFIDENCE_MIN).toBe(0.6);
    expect(FLICKER_BELOW).toBe(0.75);
    expect(FIX_TOTAL_MS).toBe(1300);
  });
});

describe('reduced-motion store', () => {
  function fakeSource(initial: boolean): ReducedMotionSource & { set(value: boolean): void } {
    let listener: ((event: { readonly matches: boolean }) => void) | null = null;
    const source = {
      matches: initial,
      addEventListener: (_type: 'change', fn: (event: { readonly matches: boolean }) => void) => {
        listener = fn;
      },
      removeEventListener: () => {
        listener = null;
      },
      set(value: boolean) {
        source.matches = value;
        listener?.({ matches: value });
      },
    };
    return source;
  }

  it('exposes effective durations and notifies on change', () => {
    const source = fakeSource(false);
    const store = createReducedMotionStore(source);
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe((reduced) => seen.push(reduced));
    expect(store.durationMs('dur-fix')).toBe(1300);
    source.set(true);
    expect(store.get()).toBe(true);
    expect(store.durationMs('dur-fix')).toBe(0);
    expect(store.durationMs('dur-fade')).toBe(200);
    unsubscribe();
    source.set(false);
    expect(seen).toEqual([true]);
  });

  it('allows motion when there is no media query', () => {
    expect(createReducedMotionStore(null).get()).toBe(false);
  });
});
