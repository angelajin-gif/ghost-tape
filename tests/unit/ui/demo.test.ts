// P29: the demo tape and the shipped demo audio.
// Validates: Requirements 2.1 to 2.7, 38.6
// copyScan.test.ts already checks the placeholder content, serializePayload and a 15.0 s cap at
// standard. This file adds: the cap through the Carrier table (and the expected 13.9 s), and the
// shipped WAV, which must decode to the demo tape field by field.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWav } from '../../../src/audio/wav';
import { decodeFile, encodePayload } from '../../../src/modem';
import { serializePayload } from '../../../src/modem/tape';
import type { Payload } from '../../../src/modem/types';
import { carrierProfile } from '../../../src/ui/carriers';
import { demoTape } from '../../../src/ui/copy';

const WAV_URL = new URL('../../../src/ui/assets/ghost-tape-demo.wav', import.meta.url);
const WAV_NAME = 'src/ui/assets/ghost-tape-demo.wav';

const demoPayload: Payload = {
  kind: 'tape',
  title: demoTape.title,
  from: demoTape.from,
  to: demoTape.to,
  date: demoTape.date,
  tracks: [...demoTape.tracks],
  letter: demoTape.letter,
};

/**
 * Decodes the shipped demo audio and compares it with `expected` field by field. On any mismatch the
 * reason names the demo audio file as stale, so a changed demo text with an old WAV fails loudly.
 */
export function checkDemoAudio(expected: Payload, wavBytes: Uint8Array): { ok: true } | { ok: false; reason: string } {
  const stale = (why: string): { ok: false; reason: string } => ({
    ok: false,
    reason: `${WAV_NAME} is stale (${why}); run \`npm run demo:ui\``,
  });
  const wav = decodeWav(wavBytes);
  if (!wav.ok) return stale(`not readable: ${wav.reason}`);
  const decoded = decodeFile(wav.value.samples, wav.value.sampleRate);
  if (!decoded.ok) return stale(`does not decode: ${decoded.reason}`);
  const a = decoded.payload as unknown as Record<string, unknown>;
  const b = expected as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return stale(`field "${key}" differs`);
  }
  return { ok: true };
}

describe('demo tape length through the Carrier table (R2.2, R27.3)', () => {
  it('uses the standard profile for the demo Carrier', () => {
    expect(carrierProfile('demo')).toBe('standard');
  });

  it.each([44100, 48000])('serializes and encodes to at most 15.0 s (about 13.9 s) at %i Hz', (sampleRate) => {
    expect(serializePayload(demoPayload).ok).toBe(true);
    const r = encodePayload(demoPayload, { profile: carrierProfile('demo'), sampleRate });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.durationSec).toBeLessThanOrEqual(15.0);
    expect(r.value.durationSec).toBeCloseTo(13.9, 1);
  });
});

describe('shipped demo audio (R2.5)', () => {
  const haveWav = existsSync(WAV_URL);

  it('exists (npm run demo:ui writes it; npm test runs it as pretest)', () => {
    expect(haveWav, `${WAV_NAME} is missing; run \`npm run demo:ui\``).toBe(true);
  });

  it.runIf(haveWav)('decodes to the demo tape, field by field', () => {
    const bytes = new Uint8Array(readFileSync(WAV_URL));
    const r = checkDemoAudio(demoPayload, bytes);
    expect(r.ok ? 'ok' : r.reason).toBe('ok');
    const wav = decodeWav(bytes);
    expect(wav.ok && wav.value.sampleRate).toBe(48000);
  });

  it.runIf(haveWav)('a changed letter with the unchanged WAV fails and names the demo audio file as stale', () => {
    const changed: Payload = { ...demoPayload, letter: `${demoTape.letter} (edited)` };
    const r = checkDemoAudio(changed, new Uint8Array(readFileSync(WAV_URL)));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('ghost-tape-demo.wav');
      expect(r.reason).toContain('stale');
      expect(r.reason).toContain('letter');
    }
  });
});
