// R34.5: nothing in src/ sends tape, payload or recording data over the network.
// The scan fails on any network call (fetch, XMLHttpRequest, sendBeacon, WebSocket) outside
// the allow-list below. Each allow-listed call only downloads a static app asset.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', '..', 'src');

/**
 * Allowed network calls, by file, with the maximum count and the reason.
 * - src/audio/audioPortImpl.ts: `fetchAsset(url)` GETs a same-origin static asset (the demo WAV).
 *   It sends no body and no tape, payload or recording data.
 */
const ALLOW_LIST: Readonly<Record<string, { readonly max: number; readonly why: string }>> = {
  'src/audio/audioPortImpl.ts': { max: 1, why: 'fetchAsset: GET of a static asset such as the demo WAV' },
};

const NETWORK_CALL = /\b(?:fetch\s*\(|new\s+XMLHttpRequest\b|XMLHttpRequest\b|sendBeacon\b|new\s+WebSocket\b|new\s+EventSource\b)/g;

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listTs(path));
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}

/** Remove comments so prose such as "fetch(" in a comment does not count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function countNetworkCalls(source: string): number {
  return (stripComments(source).match(NETWORK_CALL) ?? []).length;
}

describe('R34.5 network scan', () => {
  it('detects network calls and ignores comments', () => {
    expect(countNetworkCalls('await fetch(url)')).toBe(1);
    expect(countNetworkCalls('navigator.sendBeacon("/x", data)')).toBe(1);
    expect(countNetworkCalls('const x = new XMLHttpRequest()')).toBe(1);
    expect(countNetworkCalls('// fetch(url)\n/* sendBeacon */ const a = 1;')).toBe(0);
    expect(countNetworkCalls('fetchAsset(url)')).toBe(0);
  });

  it('finds no network call in src/ outside the allow-list', () => {
    const offenders: string[] = [];
    const used = new Map<string, number>();
    for (const file of listTs(SRC)) {
      const rel = relative(join(SRC, '..'), file).split('\\').join('/');
      const count = countNetworkCalls(readFileSync(file, 'utf8'));
      if (count === 0) continue;
      used.set(rel, count);
      const allowed = ALLOW_LIST[rel];
      if (allowed === undefined || count > allowed.max) offenders.push(`${rel}: ${count} network call(s)`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allow-list honest: every entry still has a call', () => {
    for (const rel of Object.keys(ALLOW_LIST)) {
      const source = readFileSync(join(SRC, '..', rel), 'utf8');
      expect(countNetworkCalls(source), rel).toBeGreaterThan(0);
    }
  });
});
