// R6.3 / R6.4: how much does each extra pass help? Standard profile, 560-byte tapes, five
// independently noisy passes per trial, noise levels -8, -9 and -10 dB in-band SNR.
//
//   npm run measure:passes             30 seeds at -10 dB, 10 each at -9 and -8 dB (several minutes)
//   npm run measure:passes -- --quick  3 seeds per level, a fast look
//
// Outside the deep suite and its 15,000 s audio cap (design "Deep-suite plan"): this one
// experiment is about 10,000 s of audio. Prints the counts and writes docs/passes-results.csv
// (one row per level and pass count, for charting), docs/passes-results.json and
// docs/passes-chart.svg. Log the printed counts in KIRO_LOG.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'vite';

const quick = process.argv.includes('--quick');
const SAMPLE_RATE = 48000;
const PASSES = 5;
const SIZE = 560;
// --levels=-8,-9,-10 overrides the noise levels (used to find where one pass starts to fail).
const override = process.argv.find((a) => a.startsWith('--levels='));
const LEVELS = override
  ? override.slice('--levels='.length).split(',').map((s, k) => ({ snr: Number(s), seeds: quick ? 3 : k === 0 ? 30 : 10 }))
  : [
      { snr: -10, seeds: quick ? 3 : 30 },
      { snr: -9, seeds: quick ? 3 : 10 },
      { snr: -8, seeds: quick ? 3 : 10 },
    ];
const BASE_SEED = 0x47540012;

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const load = (path) => server.ssrLoadModule(path);
  const [channel, decoder, modulate, tapes] = await Promise.all([
    load('/src/modem/channel.ts'),
    load('/src/modem/decoder.ts'),
    load('/src/modem/modulate.ts'),
    load('/tests/support/tapes.ts'),
  ]);

  /** One trial: five noisy copies of one tape, decoded in a single stream. */
  function trial(snr, index) {
    const seed = channel.deriveSeed(BASE_SEED, SIZE, Math.round(snr * 10) + 1000, index);
    const payload = tapes.tapeOfSize(SIZE, seed);
    const encoded = modulate.encodePayload(payload, { profile: 'standard', sampleRate: SAMPLE_RATE });
    if (!encoded.ok) throw new Error(encoded.reason);
    const stream = channel.damagePasses(Array.from({ length: PASSES }, () => encoded.value.samples), SAMPLE_RATE, { noiseSnrDb: snr }, seed);
    const d = decoder.createDecoder({ sampleRate: SAMPLE_RATE });
    const events = [];
    for (let at = 0; at < stream.length; at += 8192) events.push(...d.push(stream.subarray(at, Math.min(stream.length, at + 8192))));
    events.push(...d.flush());
    let completedAtPass = 0;
    let wrong = false;
    let lastPass = 0;
    const clarity = Array(PASSES).fill(NaN);
    for (const e of events) {
      if (e.type === 'pass-complete') {
        lastPass = e.pass;
        clarity[e.pass - 1] = e.clarity;
      } else if (e.type === 'complete') {
        if (isDeepStrictEqual(e.payload, payload)) completedAtPass ||= lastPass;
        else wrong = true;
      }
    }
    return { completedAtPass, wrong, clarity, audioSeconds: stream.length / SAMPLE_RATE };
  }

  const results = [];
  let audio = 0;
  console.log(`Multi-pass sweep: Standard, ${SIZE} B tapes, ${PASSES} passes each, in-band SNR, ${SAMPLE_RATE} Hz`);
  for (const { snr, seeds } of LEVELS) {
    const trials = [];
    for (let i = 0; i < seeds; i += 1) {
      const t = trial(snr, i);
      audio += t.audioSeconds;
      trials.push(t);
    }
    const decodedBy = Array.from({ length: PASSES }, (_, n) => trials.filter((t) => t.completedAtPass > 0 && t.completedAtPass <= n + 1).length);
    const meanClarity = Array.from({ length: PASSES }, (_, n) => {
      const v = trials.map((t) => t.clarity[n]).filter((x) => Number.isFinite(x));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
    });
    const wrong = trials.filter((t) => t.wrong).length;
    results.push({ snr, seeds, decodedBy, meanClarity, wrong });
    console.log(`${snr} dB, ${seeds} seeds: decoded by pass 1..${PASSES} = ${decodedBy.join(', ')}; wrong texts = ${wrong}`);
    console.log(`    mean clarity per pass: ${meanClarity.map((c) => (Number.isFinite(c) ? c.toFixed(3) : 'n/a')).join(', ')}`);
  }
  const lowest = results[0]; // the first (lowest-SNR, most seeds) level carries the R6.4 check
  const gain = lowest.decodedBy[2] - lowest.decodedBy[0];
  console.log(`R6.4 check at ${lowest.snr} dB: 3 passes decode ${lowest.decodedBy[2]}, 1 pass decodes ${lowest.decodedBy[0]}, gain ${gain} (need >= 6 of ${lowest.seeds}): ${quick ? 'not evaluated in --quick' : gain >= 6 ? 'PASS' : 'FAIL'}`);
  console.log(`Audio simulated: ${Math.round(audio)} s`);

  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/passes-results.json', JSON.stringify({ quick, sampleRate: SAMPLE_RATE, size: SIZE, results }, null, 2) + '\n');
  // Mean clarity is over the tapes still being combined at that pass; it is empty once every tape is complete.
  const csv = ['snr_db,seeds,passes,decoded,decoded_share,mean_clarity'];
  for (const r of results) {
    for (let n = 0; n < PASSES; n += 1) {
      const c = r.meanClarity[n];
      csv.push(`${r.snr},${r.seeds},${n + 1},${r.decodedBy[n]},${(r.decodedBy[n] / r.seeds).toFixed(3)},${Number.isFinite(c) ? c.toFixed(3) : ''}`);
    }
  }
  writeFileSync('docs/passes-results.csv', csv.join('\n') + '\n');

  // Chart: share of tapes decoded after N passes, one line per noise level.
  const W = 520, H = 320, L = 50, B = 40, T = 20, R = 20;
  const x = (n) => L + ((n - 1) / (PASSES - 1)) * (W - L - R);
  const y = (share) => H - B - share * (H - B - T);
  const colours = ['#b5651d', '#4b7f52', '#3b5b92'];
  const lines = results.map((r, k) => {
    const pts = r.decodedBy.map((c, n) => `${x(n + 1).toFixed(1)},${y(c / r.seeds).toFixed(1)}`).join(' ');
    return `<polyline fill="none" stroke="${colours[k]}" stroke-width="2" points="${pts}"/>` + `<text x="${W - R - 4}" y="${(T + 14 + k * 16).toFixed(0)}" text-anchor="end" font-size="12" fill="${colours[k]}">${r.snr} dB (${r.seeds} tapes)</text>`;
  });
  const ticks = Array.from({ length: PASSES }, (_, n) => `<text x="${x(n + 1).toFixed(1)}" y="${H - B + 16}" text-anchor="middle" font-size="12">${n + 1}</text>`);
  const yticks = [0, 0.25, 0.5, 0.75, 1].map((s) => `<text x="${L - 6}" y="${(y(s) + 4).toFixed(1)}" text-anchor="end" font-size="12">${Math.round(s * 100)}%</text><line x1="${L}" x2="${W - R}" y1="${y(s).toFixed(1)}" y2="${y(s).toFixed(1)}" stroke="#ddd"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>${yticks.join('')}${lines.join('')}${ticks.join('')}<text x="${(W + L) / 2}" y="${H - 6}" text-anchor="middle" font-size="12">passes combined</text><text x="14" y="${H / 2}" font-size="12" transform="rotate(-90 14 ${H / 2})" text-anchor="middle">tapes decoded</text></svg>\n`;
  writeFileSync('docs/passes-chart.svg', svg);
} finally {
  await server.close();
}
