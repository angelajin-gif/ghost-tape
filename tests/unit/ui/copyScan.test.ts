// R38: every user-visible string lives in src/ui/copy.ts; copy-dependent assertions read from it.
// Validates: Requirements 2.2, 2.3, 2.5, 3.1, 9.1, 27.6, 29.1, 29.6, 36.5, 38.1 to 38.6
//
// DEVIATION from design.md section 11: the design says "TypeScript compiler API". The installed
// typescript is 7.0.2, which has no JS compiler API, so this is a LEXER SCAN built on the
// string-literal lexer in tests/support/lexer.ts (design.md should say "lexer scan").
// Consequence: the scan sees string and template literals and the code just before each one,
// not the type checker. Literals in `import`/`export ... from` lines and in `type`/`interface`
// declarations are skipped (type-only positions).
//
// Two rules:
//  1. HEURISTIC: a literal that looks like user-visible text (see looksVisible).
//  2. SINK: a non-empty literal given to a visible-text sink (VISIBLE_SINKS), whatever it looks like.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as copy from '../../../src/ui/copy';
import { encodePayload } from '../../../src/modem';
import { encodeText, LIMITS, serializePayload } from '../../../src/modem/tape';
import type { Payload } from '../../../src/modem/types';
import { stringLiterals } from '../../support/lexer';

const UI_DIR = new URL('../../../src/ui', import.meta.url).pathname;

// Not scanned: copy.ts and tokens.ts (R38 task), plus the dev-only harness (dev.ts, spectrogram.ts),
// which is not shipped UI. Listed here so the exemption is explicit.
const NOT_SCANNED = new Set(['copy.ts', 'tokens.ts', 'dev.ts', 'spectrogram.ts']);

/**
 * Visible-text sinks: code that ends right before a literal. Each pattern is matched against
 * the source text immediately preceding the literal (R38.5).
 */
export const VISIBLE_SINKS: readonly (readonly [string, RegExp])[] = [
  ['textContent/innerText/innerHTML/outerText assignment', /\.(?:textContent|innerText|innerHTML|outerText)\s*\+?=\s*$/],
  ['title/placeholder/alt/ariaLabel/ariaDescription property assignment', /\.(?:title|placeholder|alt|ariaLabel|ariaDescription|ariaValueText)\s*\+?=\s*$/],
  ['setAttribute of a visible-text attribute', /\.setAttribute\(\s*['"](?:aria-label|aria-description|aria-valuetext|title|placeholder|alt)['"]\s*,\s*$/],
  ['createTextNode', /\bcreateTextNode\(\s*$/],
  ['announcer or notice helper call', /\b(?:announce|announcePolite|notice|showNotice|setNotice|showMessage|setMessage)\w*\(\s*$/],
];

/** Allow-list for literals that look like text but are not (R38.5). Every entry needs a reason. */
export interface AllowEntry {
  readonly file: string; // path relative to src/ui, or '*' for any file
  readonly literal: string;
  readonly why: string;
}
export const ALLOW_LIST: readonly AllowEntry[] = [
  // Add { file, literal, why } here only for a non-visible string that trips the heuristic
  // and is not covered by a pattern below. The scan is clean on the current files without any.
];

/** Allow patterns for whole classes of non-user strings. Applied to the heuristic rule only. */
export const ALLOW_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['URL or absolute path', /^(?:https?:\/\/\S+|\/[\w\-./?=&%#]*)$/],
  ['CSS selector (starts with . # [ : * >, no sentence case)', /^[.#[:*>][^A-Z]*$/],
  ['element selector with class, id or attribute (e.g. div.card, a[href])', /^[a-z][a-z0-9-]*(?:[.#[:][\w\-=\]"'()*^$~|]+)+(?:\s+[\w.#[\]>+~:=\-"'*]+)*$/],
  ['dotted or slashed lower-case token (file name, MIME type, event or message type)', /^[a-z][\w-]*(?:[./:][\w-]+)+$/],
];

/** Rule 1 of design.md section 11: does this literal look like user-visible text? */
export function looksVisible(text: string): boolean {
  if (/\p{L}\s+\p{L}/u.test(text)) return true; // a space between letters
  if (/^\p{Lu}\p{Ll}/u.test(text)) return true; // begins with Upper then lower
  if (/[.,!?…]\p{L}|\p{L}[.,!?…]/u.test(text)) return true; // punctuation next to a letter
  // Non-ASCII letter or typographic mark (curly quotes, dashes, ellipsis, symbols)
  if (/[^\x00-\x7F]/.test(text) && /[\p{L}\p{P}\p{S}]/u.test(text)) return true;
  return false;
}

function isAllowed(relFile: string, text: string): boolean {
  if (ALLOW_LIST.some((e) => (e.file === '*' || e.file === relFile) && e.literal === text)) return true;
  return ALLOW_PATTERNS.some(([, re]) => re.test(text));
}

const TYPE_DECLARATION = /^\s*(?:export\s+)?(?:declare\s+)?(?:type|interface)\b/;
const IMPORT_EXPORT_FROM = /^\s*(?:import|export)\b[^\n]*\bfrom\b/;

/** Scans one source text. Returns one problem per offending literal. */
export function scanSource(relFile: string, source: string): string[] {
  const problems: string[] = [];
  const lines = source.split('\n');
  for (const literal of stringLiterals(source)) {
    const line = lines[literal.line - 1] ?? '';
    if (IMPORT_EXPORT_FROM.test(line) || TYPE_DECLARATION.test(line)) continue;
    if (literal.text.trim() === '') continue;
    const before = source.slice(Math.max(0, literal.start - 120), literal.start);
    const sink = VISIBLE_SINKS.find(([, re]) => re.test(before));
    if (sink) {
      problems.push(`${relFile} line ${literal.line}: literal "${literal.text}" given to ${sink[0]}`);
    } else if (looksVisible(literal.text) && !isAllowed(relFile, literal.text)) {
      problems.push(`${relFile} line ${literal.line}: user-visible literal "${literal.text}"`);
    }
  }
  return problems;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

describe('copy scan (R38.2, R38.5)', () => {
  it('fails on a deliberately bad fixture, for each sink and for the heuristic', () => {
    const bad = [
      "el.textContent = 'x';",
      "el.innerText = 'Hello';",
      'el.innerHTML = `<b>x</b>`;',
      "el.title = 'ok';",
      "input.placeholder = 'Your name';",
      "img.alt = 'a';",
      "el.setAttribute('aria-label', 'Close');",
      "el.setAttribute('title', 'x');",
      "document.createTextNode('Hi');",
      "announcer.announce('Done');",
      "const label = 'Play it again';",
      "const a = 'Tape.';",
      "const b = 'it\u2019s';",
      'const c = `Pass ${n} of ${m}`;',
    ];
    for (const source of bad) expect(scanSource('fixture.ts', source), source).not.toEqual([]);
  });

  it('accepts code, ids, selectors, URLs, empty text and type positions', () => {
    const good = [
      "el.textContent = '';",
      "el.className = 'dr-card';",
      "el.setAttribute('role', 'status');",
      "el.setAttribute('aria-live', 'polite');",
      "el.setAttribute('aria-label', copy.nav.label);",
      "el.textContent = copy.home.heading;",
      "document.querySelector('.dr-card .title');",
      "document.querySelector('a[href]');",
      "const url = 'https://www.youtube.com/results?search_query=';",
      "const file = 'ghost-tape.wav';",
      "const type = 'audio/wav';",
      "addEventListener('pass-complete', f);",
      "import { a } from './some file.ts';",
      "type Mode = 'play again' | 'x';",
      "const route = '/receive';",
    ];
    for (const source of good) expect(scanSource('fixture.ts', source), source).toEqual([]);
  });

  it('finds no user-visible literal in src/ui outside copy.ts and tokens.ts', () => {
    const problems: string[] = [];
    for (const file of listTsFiles(UI_DIR)) {
      const name = file.slice(file.lastIndexOf('/') + 1);
      if (NOT_SCANNED.has(name)) continue;
      problems.push(...scanSource(relative(UI_DIR, file), readFileSync(file, 'utf8')));
    }
    expect(problems).toEqual([]);
  });
});

// ---------- copy.ts content ----------

/** Every string reachable in copy.ts; functions are called with two argument shapes. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    const f = value as (...args: unknown[]) => unknown;
    for (const args of [[1, 2, 3, 4], ['Field', 3, 5, 7], [0, 0], [2, 1]]) allStrings(f(...args), out);
  } else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

const GROUPS = [
  'app', 'nav', 'home', 'demoTape', 'permission', 'micErrors', 'darkroom', 'notices', 'actions', 'compose',
  'cassette', 'rec', 'validation', 'send', 'player', 'broadcast', 'examples', 'print', 'a11y', 'errors',
] as const;

const demoPayload: Payload = {
  kind: 'tape',
  title: copy.demoTape.title,
  from: copy.demoTape.from,
  to: copy.demoTape.to,
  date: copy.demoTape.date,
  tracks: [...copy.demoTape.tracks],
  letter: copy.demoTape.letter,
};

const exampleList = Object.values(copy.examples);

describe('copy.ts content (R38.4, R27.6)', () => {
  it('exports every group of the design', () => {
    for (const group of GROUPS) expect(copy, group).toHaveProperty(group);
  });

  it('is marked as draft in the header comment', () => {
    const header = readFileSync(join(UI_DIR, 'copy.ts'), 'utf8').slice(0, 300);
    expect(header).toMatch(/DRAFT COPY/);
  });

  it('names no profile in any string (R27.6)', () => {
    const hits = allStrings(copy).filter((s) => /\b(?:robust|standard)\b/i.test(s));
    expect(hits).toEqual([]);
  });

  it('keeps a string with a number a function of the number (R38.3)', () => {
    // A digit in a plain (non-function) string is a number baked into text. Fixed rule numbers
    // from the quoted drafts (10 tracks, 1 to 140, the year range) are allowed; demoTape and
    // examples are data.
    const fixedNumbers = /10 tracks|1 to 140|2000 and 2255/;
    const statics: string[] = [];
    for (const [name, group] of Object.entries(copy)) {
      if (name === 'demoTape' || name === 'examples') continue;
      for (const v of Object.values(group)) if (typeof v === 'string') statics.push(v);
    }
    expect(statics.filter((s) => /\d/.test(s) && !fixedNumbers.test(s))).toEqual([]);
  });
});

describe('demo tape and examples (R2.3, R2.5, R29.6, R38.6)', () => {
  it('the demo tape passes serializePayload and has 1 to 3 tracks and a short letter (R2.1, R2.3)', () => {
    const r = serializePayload(demoPayload);
    expect(r.ok).toBe(true);
    expect(copy.demoTape.tracks.length).toBeGreaterThanOrEqual(1);
    expect(copy.demoTape.tracks.length).toBeLessThanOrEqual(3);
    expect(copy.demoTape.letter.length).toBeGreaterThan(0);
  });

  it('the demo tape uses the quoted placeholder content', () => {
    expect(copy.demoTape).toEqual({
      title: 'A tape from the other side',
      from: 'A ghost',
      to: 'You',
      date: '2026-10-31',
      tracks: ['Static Lullaby', 'Hiss and Hum'],
      letter: 'Tapes remember what we forget. This one kept a voice for you.',
    });
  });

  it('there are three examples with the quoted labels and texts (R29.1, R29.3, R29.4)', () => {
    expect(exampleList.map((e) => e.label)).toEqual(['party secret', 'exhibition label', 'public notice']);
    expect(copy.examples.partySecret.text).toBe('Happy birthday \u2014 look under your pillow.');
    expect(copy.examples.publicNotice.text).toBe('Shelter open at Sayles Hall. Water and blankets until 10 pm.');
  });

  it.each(exampleList.map((e) => [e.label, e.text] as const))('example "%s" is 1..140 chars, one line, passes encodeText', (_label, text) => {
    expect(text.length).toBeGreaterThanOrEqual(1);
    expect(text.length).toBeLessThanOrEqual(140);
    expect(text).not.toMatch(/[\r\n]/);
    expect(encodeText('message', text, LIMITS.ghostMessageMax, false).ok).toBe(true);
    expect(serializePayload({ kind: 'ghost', message: text }).ok).toBe(true);
  });

  it('no example or demo text contains a profile name (R27.6)', () => {
    const texts = [...exampleList.map((e) => e.text), ...allStrings(copy.demoTape)];
    for (const t of texts) expect(t).not.toMatch(/\b(?:robust|standard)\b/i);
  });

  // P-demo (R2.2, R2.5): the demo tape's single pass is at most 15.0 s at both rates.
  it.each([44100, 48000])('the demo tape encodes (standard) to at most 15.0 s at %i Hz', (sampleRate) => {
    const r = encodePayload(demoPayload, { profile: 'standard', sampleRate });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.durationSec).toBeLessThanOrEqual(15.0);
  });

  it('every example encodes (broadcast carrier = robust profile) at both rates (R29.6)', () => {
    for (const sampleRate of [44100, 48000])
      for (const e of exampleList) expect(encodePayload({ kind: 'ghost', message: e.text }, { profile: 'robust', sampleRate }).ok, e.label).toBe(true);
  });
});
