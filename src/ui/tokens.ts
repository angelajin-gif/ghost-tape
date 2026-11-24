// Design tokens (R36.1). Every name and value here is also in tokens.css; the unit test
// parses the CSS and compares. Values are CSS strings so both files stay literally equal.
// Canvas code cannot read CSS variables cheaply, so it uses these exports.

export type Palette = 'darkroom' | 'cassette';

/** Six named colours per palette at most (R36.6). */
export const COLORS = {
  'dr-ground': '#0E0908',
  'dr-paper': '#2A1815',
  'dr-safelight': '#FF6B5B',
  'dr-ink': '#F6D9D0',
  'dr-mute': '#C9A096',
  'dr-warm': '#F7EBD7',
  'cs-desk': '#D8CCB2',
  'cs-card': '#F6EEDB',
  'cs-ink': '#221B16',
  'cs-rule': '#5E5143',
  'cs-accent': '#9E2A16',
  'cs-shell': '#2B2724',
} as const;

export type ColorName = keyof typeof COLORS;

export const PALETTES: Readonly<Record<Palette, readonly ColorName[]>> = {
  darkroom: ['dr-ground', 'dr-paper', 'dr-safelight', 'dr-ink', 'dr-mute', 'dr-warm'],
  cassette: ['cs-desk', 'cs-card', 'cs-ink', 'cs-rule', 'cs-accent', 'cs-shell'],
};

/** Type scale in CSS px, ratio about 1.25. Body never below 16 px (R36.10). */
export const FONT_SIZES_PX = {
  'fs-body': 16,
  'fs-lead': 20,
  'fs-h3': 24,
  'fs-h2': 30,
  'fs-h1': 38,
  'fs-display': 48,
} as const;

/** 4 px base spacing plus fixed control sizes. */
export const SPACING_PX = {
  'sp-1': 4,
  'sp-2': 8,
  'sp-3': 12,
  'sp-4': 16,
  'sp-5': 24,
  'sp-6': 32,
  'sp-7': 48,
  'sp-8': 64,
  hairline: 1,
  'tap-min': 44,
  'rec-min': 56,
} as const;

/** Motion durations in ms (normal motion). */
export const MOTION_MS = {
  'dur-flicker': 240,
  'dur-slide': 600,
  'dur-fix': 1300,
  'dur-flip': 500,
  'dur-pulse': 1600,
  'dur-spin': 2400,
  'dur-fade': 200,
} as const;

export type MotionName = keyof typeof MOTION_MS;

/**
 * Under prefers-reduced-motion everything stops except the fade, which stays as a
 * cross-fade within 200 ms so state changes are still visible without movement (R36.9, R32.1).
 */
export const MOTION_REDUCED_MS: Readonly<Record<MotionName, number>> = {
  'dur-flicker': 0,
  'dur-slide': 0,
  'dur-fix': 0,
  'dur-flip': 0,
  'dur-pulse': 0,
  'dur-spin': 0,
  'dur-fade': 200,
};

export const REDUCED_MOTION_MAX_MS = 200;

export const FONT_FAMILY = '"EB Garamond", Georgia, "Times New Roman", serif';

const withUnit = <K extends string>(table: Readonly<Record<K, number>>, unit: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(table) as K[]) out[key] = `${table[key]}${unit}`;
  return out;
};

/** Custom property name (without the leading `--`) to its CSS value. Mirrors the `:root` block of tokens.css. */
export const TOKENS: Readonly<Record<string, string>> = {
  ...COLORS,
  'font-serif': FONT_FAMILY,
  ...withUnit(FONT_SIZES_PX, 'px'),
  ...withUnit(SPACING_PX, 'px'),
  ...withUnit(MOTION_MS, 'ms'),
};

/** Custom properties that the reduced-motion media block of tokens.css overrides. */
export const TOKENS_REDUCED: Readonly<Record<string, string>> = withUnit(MOTION_REDUCED_MS, 'ms');

// Values fixed in design (design.md, "Values fixed in design").
export const KIND_CONFIDENCE_MIN = 0.6;
export const LAYOUT_CONFIDENCE_MIN = 0.6;
export const GLYPH_OPACITY_MIN = 0.1;
export const GLYPH_BLUR_MAX_EM = 0.3;
export const FLICKER_BELOW = 0.75;
export const FLICKER_PERIOD_MS = 250;
export const HISTORY_DEPTH = 8;
export const SAFELIGHT_FLICKER_MS = MOTION_MS['dur-flicker'];
export const FIX_TOTAL_MS = MOTION_MS['dur-fix'];
export const FAINT_GRACE_MS = 120;
export const SHEET_CELL_MIN_PX = 8;
export const FILE_CHUNK_SEC = 0.5;
export const ENCODE_TIMEOUT_MS = 10_000;
export const LINK_MAX_CHARS = 2000;
export const PNG_W = 1080;
export const PNG_H = 1350;
export const PNG_MAX_IMAGES = 4;
export const TAPE_MIN_SEC = 7.525;
export const TAPE_MAX_SEC = 66.4;

// ---- Contrast ----------------------------------------------------------------------------

/** A colour that is a token, or a token blended over another (used for the highlighted character). */
export type ColorRef = ColorName | { readonly overlay: ColorName; readonly alpha: number; readonly base: ColorName };

export type ContrastScope = 'text' | 'control' | 'focus' | 'outline' | 'glyph-confidence-1';

export interface ContrastPair {
  readonly fg: ColorName;
  readonly bg: ColorRef;
  /** WCAG minimum: 4.5 for text under 24 px, 3 for large text, boundaries and focus indicators. */
  readonly min: 3 | 4.5;
  /** Ratio computed in design.md; the test recomputes it from the colours. */
  readonly designRatio: number;
  readonly scope: ContrastScope;
  readonly use: string;
}

// Only a Glyph at confidence 1 is declared. Provisional Glyphs below 1 are exempt (R7.10, design I4):
// they are aria-hidden and the same state is always also given as text.
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'dr-ink', bg: 'dr-ground', min: 4.5, designRatio: 14.85, scope: 'text', use: 'body text' },
  { fg: 'dr-ink', bg: 'dr-paper', min: 4.5, designRatio: 12.71, scope: 'glyph-confidence-1', use: 'text on the tray paper; Glyph at confidence 1' },
  { fg: 'dr-mute', bg: 'dr-ground', min: 4.5, designRatio: 8.44, scope: 'text', use: 'secondary text' },
  { fg: 'dr-mute', bg: 'dr-paper', min: 4.5, designRatio: 7.22, scope: 'text', use: 'secondary text on paper' },
  { fg: 'dr-safelight', bg: 'dr-ground', min: 4.5, designRatio: 7.07, scope: 'text', use: 'Safelight label, ON AIR light, links' },
  { fg: 'dr-safelight', bg: 'dr-paper', min: 4.5, designRatio: 6.05, scope: 'text', use: 'Safelight label on paper' },
  { fg: 'dr-ground', bg: 'dr-warm', min: 4.5, designRatio: 16.79, scope: 'text', use: 'developed text' },
  { fg: 'dr-paper', bg: 'dr-warm', min: 4.5, designRatio: 14.37, scope: 'text', use: 'secondary text after fixing' },
  { fg: 'dr-ground', bg: 'dr-safelight', min: 4.5, designRatio: 7.07, scope: 'control', use: 'label on a red button' },
  { fg: 'dr-warm', bg: 'dr-ground', min: 3, designRatio: 16.79, scope: 'focus', use: 'focus ring on dark' },
  { fg: 'dr-warm', bg: 'dr-paper', min: 3, designRatio: 14.37, scope: 'focus', use: 'focus ring on paper' },
  { fg: 'cs-ink', bg: 'cs-card', min: 4.5, designRatio: 14.7, scope: 'text', use: 'J-card text' },
  { fg: 'cs-ink', bg: 'cs-desk', min: 4.5, designRatio: 10.68, scope: 'text', use: 'page text' },
  { fg: 'cs-rule', bg: 'cs-card', min: 4.5, designRatio: 6.65, scope: 'text', use: 'placeholders and rules on the card' },
  { fg: 'cs-rule', bg: 'cs-desk', min: 4.5, designRatio: 4.83, scope: 'text', use: 'secondary text on the desk' },
  { fg: 'cs-accent', bg: 'cs-card', min: 4.5, designRatio: 6.5, scope: 'text', use: 'error text on the card' },
  { fg: 'cs-accent', bg: 'cs-desk', min: 4.5, designRatio: 4.72, scope: 'text', use: 'error text on the desk' },
  { fg: 'cs-card', bg: 'cs-accent', min: 4.5, designRatio: 6.5, scope: 'control', use: '"REC" on the REC key' },
  { fg: 'cs-card', bg: 'cs-shell', min: 4.5, designRatio: 12.81, scope: 'text', use: 'labels on the cassette body' },
  { fg: 'cs-desk', bg: 'cs-shell', min: 3, designRatio: 9.31, scope: 'focus', use: 'focus ring on the cassette' },
  { fg: 'cs-shell', bg: 'cs-desk', min: 3, designRatio: 9.31, scope: 'outline', use: 'cassette outline' },
  { fg: 'cs-ink', bg: { overlay: 'cs-accent', alpha: 0.22, base: 'cs-card' }, min: 4.5, designRatio: 10.27, scope: 'text', use: 'highlighted character' },
];

/** The pair used to draw a Glyph at confidence 1: dr-ink on dr-paper (R7.10). */
export const GLYPH_PAIR = { fg: 'dr-ink', bg: 'dr-paper' } as const;

/** Pairs that fail and must not be used (design.md, computed). */
export const FORBIDDEN_PAIRS: readonly { readonly fg: ColorName; readonly bg: ColorName }[] = [
  { fg: 'cs-accent', bg: 'cs-shell' },
  { fg: 'cs-ink', bg: 'cs-accent' },
];

function channelToLinear(value8: number): number {
  const c = value8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function resolveColor(ref: ColorRef): Rgb {
  if (typeof ref === 'string') return parseHex(COLORS[ref]);
  const top = parseHex(COLORS[ref.overlay]);
  const base = parseHex(COLORS[ref.base]);
  // Blend in sRGB 8-bit space as a browser compositor does, rounding once.
  const mix = (i: 0 | 1 | 2): number => Math.round(top[i] * ref.alpha + base[i] * (1 - ref.alpha));
  return [mix(0), mix(1), mix(2)];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * channelToLinear(rgb[0]) + 0.7152 * channelToLinear(rgb[1]) + 0.0722 * channelToLinear(rgb[2]);
}

/** WCAG 2.x contrast ratio, always at least 1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---- Reduced motion ----------------------------------------------------------------------

export interface ReducedMotionSource {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { readonly matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { readonly matches: boolean }) => void): void;
}

export interface ReducedMotionStore {
  get(): boolean;
  subscribe(listener: (reduced: boolean) => void): () => void;
  /** Effective duration for a motion token under the current preference. */
  durationMs(name: MotionName): number;
}

export function effectiveMotionMs(name: MotionName, reduced: boolean): number {
  return reduced ? MOTION_REDUCED_MS[name] : MOTION_MS[name];
}

/**
 * Reads the media query once and then on change. The source is injected so the store runs
 * without a DOM in tests; `null` (no matchMedia) means motion is allowed.
 */
export function createReducedMotionStore(source: ReducedMotionSource | null): ReducedMotionStore {
  let reduced = source?.matches ?? false;
  const listeners = new Set<(reduced: boolean) => void>();
  source?.addEventListener('change', (event) => {
    reduced = event.matches;
    for (const listener of [...listeners]) listener(reduced);
  });
  return {
    get: () => reduced,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    durationMs: (name) => effectiveMotionMs(name, reduced),
  };
}

/** Store bound to the real media query; used by app.ts at boot. */
export function createBrowserReducedMotionStore(): ReducedMotionStore {
  const hasMatchMedia = typeof globalThis.matchMedia === 'function';
  return createReducedMotionStore(hasMatchMedia ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null);
}
