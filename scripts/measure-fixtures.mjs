// Real-room recordings (task 16): decode every WAV in tests/fixtures/real-room/ with the decoder
// as it is and with per-tone equalization, and report what each recording did.
//
//   npm run measure:fixtures [-- --dir=tests/fixtures/real-room]
//
// Per recording: passes found, headers valid, decoded, clarity, header byte errors against the
// expected header (manifest.json), payload symbol errors against the tape (taken from the first
// recording that decodes), and the level of each Robust tone at the sync notes relative to the
// loudest, which shows directly whether the room faded a tone.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const dir = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? 'tests/fixtures/real-room';
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')).sort();
if (files.length === 0) {
  console.log(`no .wav files in ${dir}; record some with the dev page (/?dev, "Record raw audio")`);
  process.exit(0);
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const load = (path) => server.ssrLoadModule(path);
  const [wav, decoder, frame, profiles, demodulate, interleave] = await Promise.all([
    load('/src/audio/wav.ts'),
    load('/src/modem/decoder.ts'),
    load('/src/modem/frame.ts'),
    load('/src/modem/profiles.ts'),
    load('/src/modem/demodulate.ts'),
    load('/src/modem/interleave.ts'),
  ]);
  const ROBUST = profiles.ROBUST;
  const expected = manifest.expected;
  const profile = profiles.PROFILES.find((p) => p.name === expected.profile);
  const headerTones = frame.headerToTones(
    { profileId: profile.id, payloadKind: expected.payloadKind, payloadLength: expected.payloadLength, tapeId: Number.parseInt(expected.tapeId, 16) },
    profiles.PROFILES,
  ).value;
  const layout = frame.frameLayout(interleave.payloadSymbolCount(interleave.geometry(expected.payloadLength), profile), profile, ROBUST);

  const decodeOne = (samples, sampleRate, equalize) => {
    const headers = [];
    const passes = [];
    const d = decoder.createDecoder({ sampleRate, equalize, onHeaderSymbols: (h) => headers.push(h), onPassSymbols: (p) => passes.push(p) });
    const events = [];
    for (let at = 0; at < samples.length; at += 4096) events.push(...d.push(samples.subarray(at, Math.min(samples.length, at + 4096))));
    events.push(...d.flush());
    return { events, headers, passes };
  };
  const decoded = new Map();
  for (const f of files) {
    const r = wav.decodeWav(new Uint8Array(readFileSync(join(dir, f))));
    if (!r.ok) {
      console.log(`${f}: not a readable WAV (${r.reason})`);
      continue;
    }
    decoded.set(f, r.value);
  }

  // The tape itself, for payload symbol errors: from the first recording that decodes (any setting).
  let payloadTones;
  for (const [, { samples, sampleRate }] of decoded) {
    for (const eq of [false, true]) {
      const { events } = decodeOne(samples, sampleRate, eq);
      const done = events.find((e) => e.type === 'complete');
      if (done && done.tapeId === Number.parseInt(expected.tapeId, 16)) {
        const tapeMod = await load('/src/modem/tape.ts');
        payloadTones = frame.buildFrameSymbols(tapeMod.serializePayload(done.payload).value, profile, profiles.PROFILES).value.payloadTones;
        break;
      }
    }
    if (payloadTones) break;
  }

  /** Each Robust tone's energy at its two sync notes, in dB relative to the loudest tone. */
  const syncLevels = (samples, sampleRate, h) => {
    const length = demodulate.analysisSamples(ROBUST, sampleRate);
    const sums = [0, 0, 0, 0];
    frame.SYNC_TONES.forEach((tone, k) => {
      const start = demodulate.windowStart(h.chirpStart, h.shift, layout.syncStartMs, k, ROBUST, sampleRate);
      const segment = samples.subarray(start, start + length);
      if (segment.length === length) sums[tone] += demodulate.goertzelEnergies(segment, ROBUST.tonesHz, sampleRate)[tone];
    });
    const top = Math.max(...sums);
    return sums.map((s) => (s > 0 && top > 0 ? 10 * Math.log10(s / top) : -99));
  };

  const totals = { off: { passes: 0, headers: 0, decoded: 0 }, on: { passes: 0, headers: 0, decoded: 0 } };
  console.log(`Real-room recordings in ${dir}: ${decoded.size} files; expected tape ${expected.tapeId}, ${expected.profile}, ${expected.payloadLength} B; payload reference ${payloadTones ? 'found' : 'not found (no recording decoded)'}\n`);
  console.log('| file | notes | EQ | passes found | headers valid | decoded | clarity | header byte errors | payload SER | sync tone levels dB (1175/1475/1750/2350 Hz) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const [f, { samples, sampleRate }] of decoded) {
    for (const eq of [false, true]) {
      const { events, headers, passes } = decodeOne(samples, sampleRate, eq);
      const found = events.filter((e) => e.type === 'signal-detected').length;
      const valid = headers.filter((h) => h.valid).length;
      const done = events.some((e) => e.type === 'complete');
      const clarity = events.filter((e) => e.type === 'pass-complete').map((e) => e.clarity.toFixed(3)).join(', ') || '—';
      const byteErrors = headers.map((h) => {
        let n = 0;
        for (let b = 0; b < headerTones.length / 4; b++) if ([0, 1, 2, 3].some((j) => h.tones[4 * b + j] !== headerTones[4 * b + j])) n++;
        return n;
      });
      const ser = payloadTones
        ? passes.map((p) => `${((100 * p.tones.reduce((n, t, k) => n + (t !== payloadTones[k] ? 1 : 0), 0)) / payloadTones.length).toFixed(1)}%`).join(', ') || '—'
        : 'n/a';
      const levels = headers.length ? syncLevels(samples, sampleRate, headers[0]).map((v) => v.toFixed(1)).join(' / ') : '—';
      const t = totals[eq ? 'on' : 'off'];
      t.passes += found;
      t.headers += valid;
      t.decoded += done ? 1 : 0;
      console.log(`| ${f} | ${manifest.notes?.[f] ?? ''} | ${eq ? 'on' : 'off'} | ${found} | ${valid}/${headers.length} | ${done ? 'yes' : 'no'} | ${clarity} | ${byteErrors.join(', ') || '—'} | ${ser} | ${eq ? '' : levels} |`);
    }
  }
  console.log(`\nTotals: EQ off ${totals.off.headers} valid headers of ${totals.off.passes} passes found, ${totals.off.decoded}/${decoded.size} recordings decoded; EQ on ${totals.on.headers} of ${totals.on.passes}, ${totals.on.decoded}/${decoded.size}.`);
} finally {
  await server.close();
}
