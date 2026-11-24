// R36.4: no literal colour, font family, font size, spacing or duration outside the token files.
// Validates: Requirements 36.3, 36.4
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringLiterals } from '../../support/lexer';

const UI_DIR = new URL('../../../src/ui', import.meta.url).pathname;

// tokens.* define the values. dev.ts and spectrogram.ts are the dev-only harness (not shipped
// UI); they are listed so the exemption is explicit and reviewable.
const EXEMPT = new Set(['tokens.css', 'tokens.ts', 'dev.ts', 'spectrogram.ts']);

const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/i;
const FONT_FAMILY = /font-family\s*:|\bfont\s*:/i;
const LENGTH_OR_TIME = /(?<![\w.#-])\d*\.?\d+(?:px|rem|em|ms|s|pt|vh|vw)\b/;
const RULES: readonly (readonly [string, RegExp])[] = [
  ['literal colour', HEX_COLOR],
  ['literal colour function', COLOR_FUNCTION],
  ['literal font family', FONT_FAMILY],
  ['literal size, spacing or duration', LENGTH_OR_TIME],
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(css|ts)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

export function scanText(text: string): string[] {
  const problems: string[] = [];
  for (const [label, rule] of RULES) if (rule.test(text)) problems.push(label);
  return problems;
}

/** CSS: comments blanked, `@media` lines exempt (custom properties cannot be used in them). */
export function scanCss(source: string): string[] {
  const problems: string[] = [];
  const blanked = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  blanked.split('\n').forEach((line, index) => {
    if (/^\s*@media\b/.test(line)) return;
    for (const problem of scanText(line)) problems.push(`line ${index + 1}: ${problem}`);
  });
  return problems;
}

/** TS: only string and template literals count, so numbers and comments in code are not flagged. */
export function scanTs(fileName: string, source: string): string[] {
  const problems: string[] = [];
  const importLine = /^\s*(?:import|export)\b[^\n]*\bfrom\b/;
  const lines = source.split('\n');
  for (const literal of stringLiterals(source)) {
    if (importLine.test(lines[literal.line - 1] ?? '')) continue;
    for (const problem of scanText(literal.text)) problems.push(`${fileName} line ${literal.line}: ${problem}`);
  }
  return problems;
}

describe('style scan (R36.4)', () => {
  it('catches each kind of literal (scanner self-check)', () => {
    expect(scanCss('a { color: #fff; }')).not.toEqual([]);
    expect(scanCss('a { color: rgb(0, 0, 0); }')).not.toEqual([]);
    expect(scanCss('a { font-family: serif; }')).not.toEqual([]);
    expect(scanCss('a { font-size: 17px; }')).not.toEqual([]);
    expect(scanCss('a { padding: 0.5rem; }')).not.toEqual([]);
    expect(scanCss('a { transition: opacity 200ms; }')).not.toEqual([]);
    expect(scanTs('x.ts', "el.style.color = '#abc';")).not.toEqual([]);
    expect(scanTs('x.ts', 'const s = `margin:${n}px 4px`;')).not.toEqual([]);
    expect(scanTs('x.ts', 'const s = `a${`b`}` + "12px";')).not.toEqual([]);
  });

  it('accepts token use, zero, ids and @media lines', () => {
    expect(scanCss('a { color: var(--dr-ink); padding: var(--sp-2) 0; transition: opacity var(--dur-fade); }')).toEqual([]);
    expect(scanCss('@media (min-width: 600px) {\n}')).toEqual([]);
    expect(scanTs('x.ts', "const a = '#main'; const b = 'p1'; // 12px in a comment")).toEqual([]);
  });

  it('finds no literal style values in src/ui outside the token files', () => {
    const problems: string[] = [];
    for (const file of listFiles(UI_DIR)) {
      const name = file.slice(file.lastIndexOf('/') + 1);
      if (EXEMPT.has(name)) continue;
      const source = readFileSync(file, 'utf8');
      const found = file.endsWith('.css') ? scanCss(source) : scanTs(file, source);
      for (const problem of found) problems.push(`${relative(UI_DIR, file)}: ${problem}`);
    }
    expect(problems).toEqual([]);
  });
});
