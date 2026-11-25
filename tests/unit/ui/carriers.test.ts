// P30 (table half): the Carrier table and the Receive URL.
// Validates: Requirements 2.2, 24.2, 27.1, 27.2, 27.3, 27.4, 27.6, 27.7
// Mapping facts only. The examples, the charset check and the "no profile name in copy.ts" checks
// are in examples.test.ts and copyScan.test.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES } from '../../../src/modem/profiles';
import { CARRIER_PROFILE, capBytes, carrierProfile, type Carrier } from '../../../src/ui/carriers';
import { receiveUrl } from '../../../src/ui/receiveUrl';
import { stringLiterals } from '../../support/lexer';

const UI_DIR = new URL('../../../src/ui', import.meta.url).pathname;

describe('Carrier table (R27.1 to R27.3)', () => {
  it('has exactly the keys link, file, broadcast, demo', () => {
    expect(Object.keys(CARRIER_PROFILE).sort()).toEqual(['broadcast', 'demo', 'file', 'link']);
  });

  it('maps broadcast to robust and the other three to standard', () => {
    expect(CARRIER_PROFILE).toEqual({ link: 'standard', file: 'standard', broadcast: 'robust', demo: 'standard' });
    for (const c of Object.keys(CARRIER_PROFILE) as Carrier[]) expect(carrierProfile(c)).toBe(CARRIER_PROFILE[c]);
  });

  it('capBytes is the cap of the mapped profile: 1024 for standard, 256 for robust (R27.4)', () => {
    expect(capBytes('link')).toBe(1024);
    expect(capBytes('file')).toBe(1024);
    expect(capBytes('demo')).toBe(1024);
    expect(capBytes('broadcast')).toBe(256);
    for (const c of Object.keys(CARRIER_PROFILE) as Carrier[]) {
      expect(capBytes(c)).toBe(PROFILES.find((p) => p.name === CARRIER_PROFILE[c])!.capBytes);
    }
  });
});

// R27.1 scan. Approach: the table is the only place that may name a profile, so outside
// carriers.ts (and the dev-only harness dev.ts, not shipped UI) no file in src/ui may contain
//  (a) a string literal equal to a profile name taken from PROFILES (catches `profile: 'standard'`,
//      `carrier === 'broadcast' ? 'robust' : ...`), or
//  (b) the identifiers ROBUST / STANDARD / PROFILES / profileById / profileByName, which would pick a
//      profile without going through the table.
// It cannot see a mapping built from computed strings; a reviewer still has to.
const SCAN_EXEMPT = new Set(['carriers.ts', 'dev.ts']);
const NAMES = PROFILES.map((p) => p.name as string);
const BYPASS_IDENTIFIERS = /\b(?:ROBUST|STANDARD|PROFILES|profileById|profileByName)\b/;

/** Problems found in one source: profile-name literals and table bypasses. */
export function scanForCarrierMapping(relFile: string, source: string): string[] {
  const problems: string[] = [];
  for (const lit of stringLiterals(source)) {
    if (NAMES.includes(lit.text.toLowerCase())) problems.push(`${relFile} line ${lit.line}: profile name literal "${lit.text}"`);
  }
  source.split('\n').forEach((line, i) => {
    if (BYPASS_IDENTIFIERS.test(line) && !/^\s*(?:\/\/|\*|\/\*)/.test(line)) problems.push(`${relFile} line ${i + 1}: names a profile outside the table`);
  });
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

describe('no other Carrier-to-profile mapping in src/ui (R27.1)', () => {
  it('the scan flags a deliberately bad fixture', () => {
    expect(scanForCarrierMapping('f.ts', "const p = carrier === 'broadcast' ? 'robust' : 'standard';")).not.toEqual([]);
    expect(scanForCarrierMapping('f.ts', 'const p = PROFILES[0];')).not.toEqual([]);
    expect(scanForCarrierMapping('f.ts', "const p = carrierProfile('link');")).toEqual([]);
  });

  it('finds no mapping outside carriers.ts', () => {
    const problems: string[] = [];
    for (const file of listTsFiles(UI_DIR)) {
      const name = file.slice(file.lastIndexOf('/') + 1);
      if (SCAN_EXEMPT.has(name)) continue;
      problems.push(...scanForCarrierMapping(relative(UI_DIR, file), readFileSync(file, 'utf8')));
    }
    expect(problems).toEqual([]);
  });
});

describe('receiveUrl (R24.2)', () => {
  it('is origin + /receive with no mode hint', () => {
    expect(receiveUrl('https://ghost-tape.pages.dev')).toBe('https://ghost-tape.pages.dev/receive');
    expect(receiveUrl('https://ghost-tape.pages.dev')).toHaveLength(36);
    expect(receiveUrl('http://localhost:5173')).not.toMatch(/[?#]/);
  });
});
