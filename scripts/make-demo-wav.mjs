// Writes a demo ghost track you can listen to: demo/ghost-tape-demo.wav.
//
//   npm run demo:wav
//
// A typical mixtape (Standard profile, 48 kHz). The first ~5 s are the Robust
// "music box" overture; the rest is the fast Standard payload. Uses Vite's module
// loader so the TypeScript sources run as they are, with no extra dependencies.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const SAMPLE_RATE = 48000;
const OUT_DIR = new URL('../demo/', import.meta.url);
const OUT_FILE = new URL('ghost-tape-demo.wav', OUT_DIR);

const tape = {
  kind: 'tape',
  title: 'Songs for a Long Night',
  from: 'Angela',
  to: 'Ben',
  date: '2026-10-31',
  tracks: [
    'Fade Into You - Mazzy Star',
    'Space Song - Beach House',
    'Dreams - Fleetwood Mac',
    'Los Angeles - Ferraby Lionheart',
    'Kiss Me - Sixpence None The Richer',
  ],
  letter:
    'Dear Ben,\n\nI found the old tape deck in the attic and it still hums. ' +
    'This is the first mixtape I have made in years. Every song here was ' +
    'playing the night we missed the last train.\n\nIf you can hear this, the ' +
    'ghost made it through. Play it loud, hold your phone up, and wait for ' +
    'the picture to develop.\n\nYours, always \u2014 Angela',
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const modem = await server.ssrLoadModule('/src/modem/index.ts');
  const tapeFormat = await server.ssrLoadModule('/src/modem/tape.ts');
  const wav = await server.ssrLoadModule('/src/audio/wav.ts');

  const serialized = tapeFormat.serializePayload(tape);
  if (!serialized.ok) throw new Error(`tape rejected: ${serialized.reason}`);

  const track = modem.encodePayload(tape, { profile: 'standard', sampleRate: SAMPLE_RATE });
  if (!track.ok) throw new Error(`encode failed: ${track.reason}`);

  const file = wav.encodeWav(track.value.samples, SAMPLE_RATE);
  if (!file.ok) throw new Error(`WAV export failed: ${file.reason}`);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, file.value);

  console.log(`wrote ${OUT_FILE.pathname}`);
  console.log(`  tape: ${serialized.value.length} bytes encoded, Standard profile`);
  console.log(`  audio: ${track.value.durationSec.toFixed(2)} s, ${SAMPLE_RATE} Hz, mono, 16-bit PCM`);
  console.log(`  file: ${(file.value.length / 1e6).toFixed(2)} MB`);
} finally {
  await server.close();
}
