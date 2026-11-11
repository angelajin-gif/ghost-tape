// R11.1: the modem library loads and runs in Node with no browser APIs or globals.
// R11.2: no runtime module imports the test-only channel simulator.
// tsconfig.modem.json already rejects DOM/Node globals at compile time; this test
// adds a runtime import check and a source scan that also catches `any`-typed escapes.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MODEM_DIR = fileURLToPath(new URL('../../src/modem/', import.meta.url));

const modemFiles = (): string[] => readdirSync(MODEM_DIR).filter((f) => f.endsWith('.ts'));

const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// Browser and Node globals the modem must never touch.
const FORBIDDEN = [
  'window', 'document', 'navigator', 'globalThis', 'self', 'AudioContext', 'OfflineAudioContext',
  'AudioWorklet', 'AudioWorkletNode', 'MediaStream', 'fetch', 'localStorage', 'performance',
  'process', 'Buffer', 'require', 'setTimeout', 'setInterval', 'Math.random', 'crypto', 'Date.now',
];

describe('modem library purity', () => {
  it('imports in Node with no browser globals defined', async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    const mod = await import('../../src/modem/index');
    expect(mod).toBeTypeOf('object');
  });

  it('source files reference no browser or Node globals and no runtime randomness (R11.11)', () => {
    const hits: string[] = [];
    for (const file of modemFiles()) {
      const src = stripComments(readFileSync(`${MODEM_DIR}${file}`, 'utf8'));
      for (const name of FORBIDDEN) {
        const pattern = new RegExp(`(^|[^\\w.$'"])${name.replace('.', '\\.')}(?![\\w$])`);
        if (pattern.test(src)) hits.push(`${file}: ${name}`);
      }
      if (/from\s+['"]node:/.test(src)) hits.push(`${file}: node: import`);
    }
    expect(hits).toEqual([]);
  });

  it('no runtime module imports channel.ts (R11.2)', () => {
    const offenders = modemFiles()
      .filter((f) => f !== 'channel.ts')
      .filter((f) => /from\s+['"]\.\/channel(\.ts)?['"]/.test(stripComments(readFileSync(`${MODEM_DIR}${f}`, 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
