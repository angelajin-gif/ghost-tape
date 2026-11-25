// Writes the UI's demo audio: src/ui/assets/ghost-tape-demo.wav.
//
//   npm run demo:ui
//
// The tape comes from src/ui/copy.ts (the single source, R38.6) and is encoded with the `demo`
// Carrier's profile at 48 kHz. Runs as predev, prebuild and pretest, so it skips the work when
// nothing it depends on has changed: a SHA-256 of the inputs is kept in assets/.demo-hash.
// Uses Vite's module loader (same approach as make-demo-wav.mjs) so the TypeScript runs as is.
// Creates src/ui/assets/ if it does not exist.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const SAMPLE_RATE = 48000;
const ROOT = new URL('../', import.meta.url);
const OUT_DIR = new URL('src/ui/assets/', ROOT);
const OUT_FILE = new URL('ghost-tape-demo.wav', OUT_DIR);
const HASH_FILE = new URL('.demo-hash', OUT_DIR);

// Everything that can change the bytes of the WAV.
function inputHash() {
  const hash = createHash('sha256');
  const files = [
    new URL('src/ui/copy.ts', ROOT),
    new URL('src/ui/carriers.ts', ROOT),
    new URL('src/audio/wav.ts', ROOT),
    new URL('scripts/make-ui-demo.mjs', ROOT),
    ...readdirSync(new URL('src/modem/', ROOT))
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => new URL(`src/modem/${name}`, ROOT)),
  ];
  for (const file of files) hash.update(file.pathname).update(readFileSync(file));
  return hash.digest('hex');
}

const hash = inputHash();
if (existsSync(OUT_FILE) && existsSync(HASH_FILE) && readFileSync(HASH_FILE, 'utf8').trim() === hash) {
  console.log('demo:ui up to date');
  process.exit(0);
}

const { createServer } = await import('vite');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const copy = await server.ssrLoadModule('/src/ui/copy.ts');
  const carriers = await server.ssrLoadModule('/src/ui/carriers.ts');
  const modem = await server.ssrLoadModule('/src/modem/index.ts');
  const tapeFormat = await server.ssrLoadModule('/src/modem/tape.ts');
  const wav = await server.ssrLoadModule('/src/audio/wav.ts');

  const tape = {
    kind: 'tape',
    title: copy.demoTape.title,
    from: copy.demoTape.from,
    to: copy.demoTape.to,
    date: copy.demoTape.date,
    tracks: [...copy.demoTape.tracks],
    letter: copy.demoTape.letter,
  };
  const serialized = tapeFormat.serializePayload(tape);
  if (!serialized.ok) throw new Error(`demo tape rejected: ${serialized.reason}`);

  const profile = carriers.carrierProfile('demo');
  const track = modem.encodePayload(tape, { profile, sampleRate: SAMPLE_RATE });
  if (!track.ok) throw new Error(`encode failed: ${track.reason}`);
  const file = wav.encodeWav(track.value.samples, SAMPLE_RATE);
  if (!file.ok) throw new Error(`WAV export failed: ${file.reason}`);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, file.value);
  writeFileSync(HASH_FILE, `${hash}\n`);
  console.log(`wrote ${OUT_FILE.pathname}`);
  console.log(`  audio: ${track.value.durationSec.toFixed(2)} s, ${SAMPLE_RATE} Hz, mono, 16-bit PCM, ${(file.value.length / 1e6).toFixed(2)} MB`);
} finally {
  await server.close();
}
