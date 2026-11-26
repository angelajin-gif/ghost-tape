// Task 14: reverberation, DRR 0 dB, outside the deep suite and its audio cap.
//
//   npm run measure:reverb                        both parts
//   npm run measure:reverb -- --part=table        1. decode outcome per profile and RT60
//   npm run measure:reverb -- --part=header       2. why headers fail, and what 16 parity bytes would buy
//   add --quick for 4 trials per cell
//
// Part 1: 40 trials per cell (half at 44.1 kHz, half at 48 kHz), Robust 256 B and Standard 560 B
// tapes, RT60 100 / 200 / 300 ms. Every trial is classified: decoded exactly, no signal found
// (chirp or sync notes missed), header invalid, or header fine but the payload failed.
//
// Part 2: the header only. The header is always Robust and the same 80 symbols whatever the
// payload, so a short 60 B ghost carries it as well as a long tape and costs a tenth of the audio.
// For each trial it records the header symbol and byte errors (4 symbols per byte), where in the
// header they fall, and how far the windows sat from the true pass start.
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'vite';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const quick = process.argv.includes('--quick');
const part = arg('part', 'all');
const TABLE_TRIALS = quick ? 4 : Number(arg('trials', 40));
const HEADER_TRIALS = quick ? 8 : Number(arg('header-trials', 100));
const RT60S = [100, 200, 300];
const BASE_SEED = 0x47540014;
const LEAD_S = 1; // silence before the track, so the chirp is never at sample 0 (design, task 11 edge)
// --eq: decode with per-tone equalization (decoder option `equalize`, task 16).
const EQUALIZE = process.argv.includes('--eq');
console.log(`decoder equalization: ${EQUALIZE ? 'on' : 'off'}`);

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const load = (path) => server.ssrLoadModule(path);
  const [channel, decoder, modulate, frame, tape, profiles, tapes, rs] = await Promise.all([
    load('/src/modem/channel.ts'),
    load('/src/modem/decoder.ts'),
    load('/src/modem/modulate.ts'),
    load('/src/modem/frame.ts'),
    load('/src/modem/tape.ts'),
    load('/src/modem/profiles.ts'),
    load('/tests/support/tapes.ts'),
    load('/src/modem/reedSolomon.ts'),
  ]);
  void rs;
  const profileOf = (name) => profiles.PROFILES.find((p) => p.name === name);

  /** One trial: encode, put it in 1 s of silence, add the room, decode with both diagnostic hooks. */
  function trial(payload, profileName, sampleRate, rt60Ms, seed) {
    const encoded = modulate.encodePayload(payload, { profile: profileName, sampleRate });
    if (!encoded.ok) throw new Error(encoded.reason);
    const bytes = tape.serializePayload(payload);
    const sent = frame.buildFrameSymbols(bytes.value, profileOf(profileName), profiles.PROFILES).value;
    const lead = Math.round(LEAD_S * sampleRate);
    const clean = new Float32Array(lead + encoded.value.samples.length + Math.round(0.5 * sampleRate));
    clean.set(encoded.value.samples, lead);
    const heard = rt60Ms > 0 ? channel.applyChannel(clean, sampleRate, { reverb: { rt60Ms, drrDb: 0 } }, seed) : clean;
    const headers = [];
    const passes = [];
    const d = decoder.createDecoder({ sampleRate, equalize: EQUALIZE, onHeaderSymbols: (h) => headers.push(h), onPassSymbols: (p) => passes.push(p) });
    const events = [...d.push(heard), ...d.flush()];
    const decoded = events.some((e) => e.type === 'complete' && isDeepStrictEqual(e.payload, payload));
    const wrong = events.some((e) => e.type === 'complete' && !isDeepStrictEqual(e.payload, payload));
    // The header read nearest the true start is the one that matters (a second, spurious read is possible).
    const h = headers.find((x) => Math.abs(x.chirpStart - lead) < 0.2 * sampleRate);
    const headerSymbolErrors = h ? h.tones.reduce((n, t, k) => n + (t !== sent.headerTones[k] ? 1 : 0), 0) : undefined;
    const wrongBytes = [];
    if (h) for (let b = 0; b < sent.headerTones.length / 4; b++) if ([0, 1, 2, 3].some((j) => h.tones[4 * b + j] !== sent.headerTones[4 * b + j])) wrongBytes.push(b);
    const payloadErrors = passes.length ? passes[0].tones.reduce((n, t, k) => n + (t !== sent.payloadTones[k] ? 1 : 0), 0) : undefined;
    let outcome;
    if (decoded) outcome = 'decoded';
    else if (!h) outcome = 'no signal';
    else if (!h.valid) outcome = 'header invalid';
    else outcome = 'payload failed';
    // Which tone was sent when a header symbol came out wrong, and how often each tone was sent.
    const errorsBySentTone = [0, 0, 0, 0];
    const sentByTone = [0, 0, 0, 0];
    for (let k = 0; k < sent.headerTones.length; k++) {
      sentByTone[sent.headerTones[k]]++;
      if (h && h.tones[k] !== sent.headerTones[k]) errorsBySentTone[sent.headerTones[k]]++;
    }
    return {
      outcome,
      wrong,
      errorsBySentTone,
      sentByTone,
      headerSymbolErrors,
      wrongBytes,
      offsetMs: h ? ((h.chirpStart + h.shift - lead) / sampleRate) * 1000 : undefined,
      payloadErrors,
      payloadSymbols: sent.payloadTones.length,
    };
  }

  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

  if (part === 'all' || part === 'table') {
    console.log(`\n## 1. Decode outcome under reverberation, DRR 0 dB, ${TABLE_TRIALS} trials per cell (half per rate), 1 s lead-in\n`);
    console.log('| profile | RT60 | decoded | no signal | header invalid | payload failed | wrong | payload symbol errors (SER) |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const [profileName, size] of [['robust', 256], ['standard', 560]]) {
      for (const rt60 of RT60S) {
        const counts = { decoded: 0, 'no signal': 0, 'header invalid': 0, 'payload failed': 0 };
        let wrong = 0;
        let errors = 0;
        let symbols = 0;
        for (let i = 0; i < TABLE_TRIALS; i++) {
          const rate = i % 2 === 0 ? 44100 : 48000;
          const seed = channel.deriveSeed(BASE_SEED, size, rt60, i);
          const t = trial(tapes.tapeOfSize(size, seed), profileName, rate, rt60, seed);
          counts[t.outcome]++;
          if (t.wrong) wrong++;
          if (t.payloadErrors !== undefined) {
            errors += t.payloadErrors;
            symbols += t.payloadSymbols;
          }
        }
        const n = TABLE_TRIALS;
        console.log(`| ${profileName} ${size} B | ${rt60} ms | ${counts.decoded}/${n} | ${counts['no signal']} | ${counts['header invalid']} | ${counts['payload failed']} | ${wrong} | ${errors} / ${symbols} (${pct(errors, symbols)}) |`);
      }
    }
  }

  if (part === 'all' || part === 'header') {
    console.log(`\n## 2. The header under reverberation: ${HEADER_TRIALS} trials per cell, 60 B ghost (Standard payload), half per rate; header ${frame.HEADER_DATA_BYTES} + ${frame.HEADER_PARITY_BYTES} RS bytes (${frame.HEADER_BYTES * 4} Robust symbols, ${(frame.HEADER_BYTES * 4 * 0.05).toFixed(1)} s)\n`);
    console.log('| RT60 | header found | header valid | byte errors per header: mean / 95th pct / max | headers with > 4 byte errors | > 8 byte errors | errors in first / second half | window offset ms: mean / min / max |');
    console.log('|---|---|---|---|---|---|---|---|');
    const ghost = { kind: 'ghost', message: 'Header study, sixty bytes of payload for the reverb room test!!' };
    for (const rt60 of [0, ...RT60S]) {
      const rows = [];
      for (let i = 0; i < HEADER_TRIALS; i++) {
        const rate = i % 2 === 0 ? 44100 : 48000;
        const seed = channel.deriveSeed(BASE_SEED, 60, rt60, 1000 + i);
        rows.push(trial(ghost, 'standard', rate, rt60, seed));
      }
      const found = rows.filter((r) => r.headerSymbolErrors !== undefined);
      if (process.argv.includes('--dump')) {
        const line = found.map((r) => `${r.offsetMs.toFixed(1)}:${r.wrongBytes.length}`).join(' ');
        console.log(`RT60 ${rt60}: window offset ms : header byte errors -> ${line}`);
      }
      // Fading check: in headers with more than 4 wrong bytes, what share of the symbol errors fall on the single worst sent tone?
      const failing = found.filter((r) => r.wrongBytes.length > 4);
      if (failing.length) {
        const shares = failing.map((r) => Math.max(...r.errorsBySentTone) / Math.max(1, r.errorsBySentTone.reduce((a, b) => a + b, 0)));
        const meanShare = shares.reduce((a, b) => a + b, 0) / shares.length;
        const sentShare = failing.map((r) => r.sentByTone[r.errorsBySentTone.indexOf(Math.max(...r.errorsBySentTone))] / 80);
        console.log(`RT60 ${rt60}: ${failing.length} headers with > 4 wrong bytes; on average ${(100 * meanShare).toFixed(0)}% of their symbol errors are on one sent tone, which carries ${(100 * sentShare.reduce((a, b) => a + b, 0) / sentShare.length).toFixed(0)}% of the header symbols`);
      }
      const valid = found.filter((r) => r.outcome !== 'header invalid');
      const byteErrors = found.map((r) => r.wrongBytes.length).sort((a, b) => a - b);
      const mean = byteErrors.reduce((a, b) => a + b, 0) / Math.max(1, byteErrors.length);
      const p95 = byteErrors[Math.min(byteErrors.length - 1, Math.floor(0.95 * byteErrors.length))] ?? 0;
      const half = frame.HEADER_BYTES / 2;
      const firstHalf = found.reduce((n, r) => n + r.wrongBytes.filter((b) => b < half).length, 0);
      const secondHalf = found.reduce((n, r) => n + r.wrongBytes.filter((b) => b >= half).length, 0);
      const offsets = found.map((r) => r.offsetMs);
      const over4 = byteErrors.filter((e) => e > 4).length;
      const over8 = byteErrors.filter((e) => e > 8).length;
      console.log(`| ${rt60 || 'none'}${rt60 ? ' ms' : ''} | ${found.length}/${HEADER_TRIALS} | ${valid.length}/${found.length} | ${mean.toFixed(2)} / ${p95} / ${byteErrors.at(-1) ?? 0} | ${over4} | ${over8} | ${firstHalf} / ${secondHalf} | ${offsets.length ? `${(offsets.reduce((a, b) => a + b, 0) / offsets.length).toFixed(2)} / ${Math.min(...offsets).toFixed(2)} / ${Math.max(...offsets).toFixed(2)}` : 'n/a'} |`);
    }
  }
} finally {
  await server.close();
}
