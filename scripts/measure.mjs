// Single-pass success and symbol error rate versus in-band SNR, per profile, plus decoder speed.
//
//   npm run measure              full sweep (about 10 minutes)
//   npm run measure -- --quick   4 trials per level, for a fast look
//
// Outside the deep suite and its 15,000 s audio cap (design "Deep-suite plan"). Its results
// replace the placeholder thresholds in R5.4 / R5.5 and the R6.3 levels (task 14); log them,
// with the trial counts printed here, in KIRO_LOG.md.

import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'vite';

const quick = process.argv.includes('--quick');
const TRIALS = quick ? 4 : 12;
const SWEEPS = [
  // Dense around where decoding starts to fail, sparse elsewhere (found by a 4-trial first pass).
  { profile: 'standard', size: 560, levels: [0, -2, -3, -4, -5, -6, -7, -8, -10, -12, -14] },
  { profile: 'robust', size: 256, levels: [-3, -6, -8, -9, -10, -11, -12, -13, -15, -18] },
];
const BASE_SEED = 0x47540001;

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const load = (path) => server.ssrLoadModule(path);
  const [channel, decoder, modulate, frame, tape, profiles, tapes] = await Promise.all([
    load('/src/modem/channel.ts'),
    load('/src/modem/decoder.ts'),
    load('/src/modem/modulate.ts'),
    load('/src/modem/frame.ts'),
    load('/src/modem/tape.ts'),
    load('/src/modem/profiles.ts'),
    load('/tests/support/tapes.ts'),
  ]);

  /** One single-pass trial at an SNR; returns what happened. */
  function trial(profileName, size, snr, index) {
    const sampleRate = index % 2 === 0 ? 44100 : 48000; // half the trials at each rate (R5.10)
    const seed = channel.deriveSeed(BASE_SEED, size, Math.round(snr * 10) + 1000, index);
    const payload = tapes.tapeOfSize(size, seed);
    const profile = profiles.PROFILES.find((p) => p.name === profileName);
    const encoded = modulate.encodePayload(payload, { profile: profileName, sampleRate });
    if (!encoded.ok) throw new Error(encoded.reason);
    const bytes = tape.serializePayload(payload);
    const expected = frame.buildFrameSymbols(bytes.value, profile, profiles.PROFILES).value.payloadTones;
    const noisy = channel.applyChannel(encoded.value.samples, sampleRate, { noiseSnrDb: snr }, seed);
    const passes = [];
    const d = decoder.createDecoder({ sampleRate, onPassSymbols: (p) => passes.push(p) });
    const events = [...d.push(noisy), ...d.flush()];
    const completes = events.filter((e) => e.type === 'complete');
    return {
      decoded: completes.some((e) => isDeepStrictEqual(e.payload, payload)),
      wrong: completes.some((e) => !isDeepStrictEqual(e.payload, payload)),
      found: passes.length > 0,
      errors: passes.length ? passes[0].tones.reduce((n, t, k) => n + (t !== expected[k] ? 1 : 0), 0) : 0,
      symbols: passes.length ? expected.length : 0,
    };
  }

  console.log(`Single-pass sweep, white noise at in-band SNR (300-3400 Hz), ${TRIALS} trials per level, half at 44.1 kHz and half at 48 kHz`);
  console.log('Tapes of exactly 560 B (Standard) and 256 B (Robust), a different seeded tape every trial.\n');
  for (const { profile, size, levels } of SWEEPS) {
    console.log(`### ${profile}, ${size} B tape`);
    console.log('| SNR dB | trials | decoded exactly | passes found | symbol errors / symbols (SER) | wrong decodes |');
    console.log('|---|---|---|---|---|---|');
    const rows = [];
    for (const snr of levels) {
      let decoded = 0, found = 0, errors = 0, symbols = 0, wrong = 0;
      for (let i = 0; i < TRIALS; i++) {
        const r = trial(profile, size, snr, i);
        decoded += r.decoded ? 1 : 0;
        found += r.found ? 1 : 0;
        errors += r.errors;
        symbols += r.symbols;
        wrong += r.wrong ? 1 : 0;
      }
      rows.push({ snr, decoded });
      console.log(`| ${snr} | ${TRIALS} | ${decoded} | ${found} | ${errors} / ${symbols}${symbols ? ` (${((100 * errors) / symbols).toFixed(2)}%)` : ''} | ${wrong} |`);
    }
    const allOk = rows.filter((r) => r.decoded === TRIALS).map((r) => r.snr);
    const firstFail = rows.find((r) => r.decoded < TRIALS);
    console.log(`\nLowest level where all ${TRIALS} decoded: ${allOk.length ? Math.min(...allOk) : 'none'} dB; first level with a failure: ${firstFail ? firstFail.snr : 'none'} dB.\n`);
  }

  // Decoder speed on a clean maximum-size pass.
  console.log('### Decoder speed (clean pass, Node on this machine)');
  for (const [profileName, size] of [['standard', 1024], ['robust', 256]]) {
    const payload = tapes.tapeOfSize(size <= 560 ? size : 560, 1);
    const big = size > 560 ? { kind: 'tape', title: 'Max', from: 'A', to: 'B', tracks: Array.from({ length: 10 }, () => 'x'.repeat(60)), letter: 'y'.repeat(size - 22 - 610) } : payload;
    const encoded = modulate.encodePayload(big, { profile: profileName, sampleRate: 48000 });
    if (!encoded.ok) throw new Error(encoded.reason);
    const times = [];
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      const result = decoder.decodeFile(encoded.value.samples, 48000);
      times.push((performance.now() - t0) / 1000);
      if (!result.ok) throw new Error(`speed run did not decode: ${result.reason}`);
    }
    const best = Math.min(...times);
    console.log(`- ${profileName} ${size} B: ${encoded.value.durationSec.toFixed(1)} s of audio decoded in ${best.toFixed(2)} s (best of 3) = ${(encoded.value.durationSec / best).toFixed(0)}x real time, ${(best / encoded.value.durationSec).toFixed(3)} of the audio duration`);
  }
} finally {
  await server.close();
}
