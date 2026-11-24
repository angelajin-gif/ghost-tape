// R36.4: no literal colour, font family, font size, spacing or duration outside the token files.
// Validates: Requirements 36.3, 36.4
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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

interface Literal {
  readonly text: string;
  readonly line: number;
}

/**
 * Every string literal and template-literal text chunk in a TS source.
 * typescript 7 ships no JS compiler API, so this is a small lexer. It skips comments and
 * scans `${}` bodies as code. It does not handle regex literals containing quotes; the UI
 * code has none, and a misparse would show up as a failing scan, not a silent pass.
 */
export function stringLiterals(source: string): Literal[] {
  const out: Literal[] = [];
  const backslash = String.fromCharCode(92);
  const newline = String.fromCharCode(10);
  const templateBraceStack: number[] = [];
  let braceDepth = 0;
  let i = 0;
  let line = 1;

  const readTemplateChunk = (): void => {
    const startLine = line;
    let text = '';
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === backslash) {
        text += source[i + 1] ?? '';
        i += 2;
      } else if (ch === '`') {
        i += 1;
        out.push({ text, line: startLine });
        return;
      } else if (ch === '$' && source[i + 1] === '{') {
        i += 2;
        out.push({ text, line: startLine });
        templateBraceStack.push(braceDepth);
        braceDepth += 1;
        return;
      } else {
        if (ch === newline) line += 1;
        text += ch;
        i += 1;
      }
    }
  };

  const readQuoted = (quote: string): void => {
    let text = '';
    i += 1;
    while (i < source.length && source[i] !== quote && source[i] !== newline) {
      if (source[i] === backslash) {
        text += source[i + 1] ?? '';
        i += 2;
      } else {
        text += source[i];
        i += 1;
      }
    }
    i += 1;
    out.push({ text, line });
  };

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === newline) {
      line += 1;
      i += 1;
    } else if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== newline) i += 1;
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === newline) line += 1;
        i += 1;
      }
      i += 2;
    } else if (ch === "'" || ch === '"') {
      readQuoted(ch);
    } else if (ch === '`') {
      i += 1;
      readTemplateChunk();
    } else if (ch === '{') {
      braceDepth += 1;
      i += 1;
    } else if (ch === '}') {
      braceDepth -= 1;
      i += 1;
      if (templateBraceStack.length > 0 && templateBraceStack[templateBraceStack.length - 1] === braceDepth) {
        templateBraceStack.pop();
        readTemplateChunk();
      }
    } else {
      i += 1;
    }
  }
  return out;
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
