// A small string-literal lexer shared by the UI source scans (styleScan, copyScan).
// typescript 7 ships no JS compiler API, so scans work on string literals found here.

export interface Literal {
  readonly text: string;
  readonly line: number;
  /** Offset in the source of the opening quote, backtick or the `}` that resumes a template. */
  readonly start: number;
}

/**
 * Every string literal and template-literal text chunk in a TS source.
 * Skips comments and scans `${}` bodies as code. It does not handle regex literals
 * containing quotes; the UI code has none, and a misparse would show up as a failing
 * scan, not a silent pass.
 */
export function stringLiterals(source: string): Literal[] {
  const out: Literal[] = [];
  const backslash = String.fromCharCode(92);
  const newline = String.fromCharCode(10);
  const templateBraceStack: number[] = [];
  let braceDepth = 0;
  let i = 0;
  let line = 1;

  const readTemplateChunk = (start: number): void => {
    const startLine = line;
    let text = '';
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === backslash) {
        text += source[i + 1] ?? '';
        i += 2;
      } else if (ch === '`') {
        i += 1;
        out.push({ text, line: startLine, start });
        return;
      } else if (ch === '$' && source[i + 1] === '{') {
        i += 2;
        out.push({ text, line: startLine, start });
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
    const start = i;
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
    out.push({ text, line, start });
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
      const start = i;
      i += 1;
      readTemplateChunk(start);
    } else if (ch === '{') {
      braceDepth += 1;
      i += 1;
    } else if (ch === '}') {
      braceDepth -= 1;
      const start = i;
      i += 1;
      if (templateBraceStack.length > 0 && templateBraceStack[templateBraceStack.length - 1] === braceDepth) {
        templateBraceStack.pop();
        readTemplateChunk(start);
      }
    } else {
      i += 1;
    }
  }
  return out;
}
