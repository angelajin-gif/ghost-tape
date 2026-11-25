// Task 14, item 3: does the alignment rule (R6.6) let noise into the accumulator, and does it matter?
//
//   npm run measure:alignment [-- --quick]
//
// Part A, false accepts: a pass whose header is real but whose payload is replaced by noise
// (white noise or speech-like, at the signal's RMS). How often is it accepted as aligned, for
// Standard payloads with about 11, 20 and 40 pilots? Compared with the binomial prediction for the
// current rule (at least 2 pilot reads out of n, each read right with chance 1/16) and with a
// tighter rule: the smallest pilot count that pure noise reaches with probability below 1/1000.
//
// Part B, harm: two real passes at a noise level where one pass rarely decodes and two usually
// do, with and without one accepted noise pass between them. Same seeds, so the only difference
// is the noise pass. Also records the pilot reads of real weak passes, to check that the tighter
// rule would not reject them.
import { createServer } from 'vite';

const quick = process.argv.includes('--quick');
const FALSE_TRIALS = quick ? 40 : 300;
const HARM_SEEDS = quick ? 6 : 30;
/** Noise passes tried per seed to find one the decoder accepts (part B). */
const GARBAGE_TRIES = 20;
const FS = 48000;
const BASE_SEED = 0x4754a116;

/** P(X >= k) for X ~ Binomial(n, p). */
function tail(n, p, k) {
  let sum = 0;
  let term = (1 - p) ** n; // P(X = 0)
  for (let x = 0; x <= n; x++) {
    if (x >= k) sum += term;
    term = (term * (n - x) * p) / ((x + 1) * (1 - p));
  }
  return sum;
}
/** Smallest k with P(X >= k) < limit under pure noise. */
const tighterThreshold = (n, tones, limit = 1e-3) => {
  for (let k = 0; k <= n; k++) if (tail(n, 1 / tones, k) < limit) return k;
  return n + 1;
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const load = (path) => server.ssrLoadModule(path);
  const [channel, decoder, modulate, frame, tape, profiles, interleave] = await Promise.all([
    load('/src/modem/channel.ts'),
    load('/src/modem/decoder.ts'),
    load('/src/modem/modulate.ts'),
    load('/src/modem/frame.ts'),
    load('/src/modem/tape.ts'),
    load('/src/modem/profiles.ts'),
    load('/src/modem/interleave.ts'),
  ]);
  const STANDARD = profiles.STANDARD;
  const ROBUST = profiles.ROBUST;
  const ghostOfBytes = (n, tag) => {
    // A ghost whose serialized size is n bytes (kind byte + length byte + message).
    const message = `${tag} `.repeat(200).slice(0, n - 2);
    return { kind: 'ghost', message };
  };
  const pilotsFor = (bytes) => {
    const symbols = interleave.payloadSymbolCount(interleave.geometry(bytes), STANDARD);
    return Math.floor(symbols / (STANDARD.pilotEvery + 1));
  };
  /** Payload size (bytes, ghost max 142) with exactly `want` pilots, or the nearest. */
  const sizeForPilots = (want) => {
    let best = 3;
    for (let n = 3; n <= 142; n++) if (Math.abs(pilotsFor(n) - want) < Math.abs(pilotsFor(best) - want)) best = n;
    return best;
  };
  const spanOf = (payload) => {
    const bytes = tape.serializePayload(payload).value;
    const layout = frame.frameLayout(interleave.payloadSymbolCount(interleave.geometry(bytes.length), STANDARD), STANDARD, ROBUST);
    return { start: frame.sampleAtMs(layout.payloadStartMs, FS), end: frame.sampleAtMs(layout.postambleStartMs, FS) };
  };
  const encode = (payload) => {
    const r = modulate.encodePayload(payload, { profile: 'standard', sampleRate: FS });
    if (!r.ok) throw new Error(r.reason);
    return r.value.samples;
  };
  /** Pilot reads in a pass's own hard decisions, and how often the pilot tone was read at data positions. */
  const pilotReads = (tones) => {
    let n = 0;
    let right = 0;
    let data = 0;
    let dataAsPilot = 0;
    for (let i = 0; i < tones.length; i++) {
      const isPilot = (i + 1) % (STANDARD.pilotEvery + 1) === 0;
      if (isPilot) {
        n++;
        if (tones[i] === STANDARD.pilotIndex) right++;
      } else {
        data++;
        if (tones[i] === STANDARD.pilotIndex) dataAsPilot++;
      }
    }
    return { n, right, chance: data > 0 ? dataAsPilot / data : 1 / 16 };
  };
  /**
   * Adaptive rule (proposal): the chance that a misaligned or non-ghost pass reads the pilot tone
   * is estimated from the same pass's data positions, where the pilot tone is no more likely than
   * anywhere else; aligned = the pilot count is one that chance reaches with probability < 1/1000.
   * The estimate is floored at 1/T, because real data reads the pilot tone about 1/T of the time.
   */
  const adaptiveAccepts = (reads) => reads.right >= tighterAt(reads.n, Math.max(reads.chance, 1 / 16));
  const tighterAt = (n, p, limit = 1e-3) => {
    for (let k = 0; k <= n; k++) if (tail(n, p, k) < limit) return k;
    return n + 1;
  };
  /** The pass with its payload replaced by noise of the signal's RMS. */
  const garbage = (track, span, kind, seed) => {
    const out = track.slice();
    const level = channel.rms(track.subarray(span.start, span.end));
    out.set(channel.surroundingAudio(kind, span.end - span.start, level, FS, seed), span.start);
    return out;
  };

  console.log(`\n## A. False accepts: real header, payload replaced by noise at the signal's RMS, ${FALSE_TRIALS} trials per row, ${FS} Hz\n`);
  // The pre-S9 rule, for comparison: share of pilot reads >= 2/T, i.e. at least ceil(2n/16) reads.
  const OLD = (n) => Math.ceil((2 * n) / 16);
  console.log('| payload | pilots n | noise | accepted by the decoder (adaptive rule + run gating) | old rule if noise were uniform | fixed tighter rule: reads needed | accepted | predicted if uniform | adaptive rule (script) |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const want of [11, 20, 40]) {
    // Ghosts top out at 142 B (about 13 pilots); larger pilot counts need a tape of the right size.
    let payload;
    let bytes;
    if (want <= 13) {
      bytes = sizeForPilots(want);
      payload = ghostOfBytes(bytes, 'pilot');
    } else {
      const tapes = await load('/tests/support/tapes.ts');
      for (let n = 150; n <= 1024; n++) {
        if (pilotsFor(n) === want) {
          bytes = n;
          break;
        }
      }
      payload = tapes.tapeOfSize(bytes, BASE_SEED + want);
    }
    const n = pilotsFor(bytes);
    const track = encode(payload);
    const span = spanOf(payload);
    const tight = tighterThreshold(n, 16);
    for (const kind of ['noise', 'speech']) {
      let accepted = 0;
      let acceptedTight = 0;
      let acceptedAdaptive = 0;
      let keptShare = 0;
      for (let i = 0; i < FALSE_TRIALS; i++) {
        const passes = [];
        const d = decoder.createDecoder({ sampleRate: FS, onPassSymbols: (p) => passes.push(p) });
        const events = [...d.push(garbage(track, span, kind, channel.deriveSeed(BASE_SEED, want, kind.length, i))), ...d.flush()];
        if (events.some((e) => e.type === 'pass-complete')) {
          accepted++;
          const k = passes[0].kept;
          keptShare += k.reduce((a, b) => a + b, 0) / k.length;
        }
        if (passes.length) {
          const reads = pilotReads(passes[0].tones);
          if (reads.right >= tight) acceptedTight++;
          if (adaptiveAccepts(reads)) acceptedAdaptive++;
        }
      }
      const share = accepted ? `${((100 * keptShare) / accepted).toFixed(0)}%` : '—';
      console.log(`| ${bytes} B | ${n} | ${kind} | ${accepted}/${FALSE_TRIALS} (${((100 * accepted) / FALSE_TRIALS).toFixed(1)}%), ${share} of its symbols committed | ${(100 * tail(n, 1 / 16, OLD(n))).toFixed(1)}% (old rule, >= ${OLD(n)} reads) | ${tight} | ${acceptedTight}/${FALSE_TRIALS} | ${(100 * tail(n, 1 / 16, tight)).toFixed(2)}% | ${acceptedAdaptive}/${FALSE_TRIALS} |`);
    }
  }

  // ---------- B ----------
  const bytes = sizeForPilots(11);
  const n = pilotsFor(bytes);
  const tight = tighterThreshold(n, 16);
  console.log(`\n## B. Harm: ${bytes} B ghost (${n} pilots), two real passes with independent white noise, with and without one accepted noise pass between them; ${HARM_SEEDS} seeds per level\n`);
  console.log('| SNR | decoded after real pass 1 | after 2 real passes | seeds where an accepted noise pass was found (' + GARBAGE_TRIES + ' tries) | of those, decoded after real 1 + noise + real 2 | clarity after 2 real (mean) | real passes the fixed tighter rule (< ' + tight + ' reads) would reject | real passes the adaptive rule would reject |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const snr of [-10, -11, -12]) {
    let rejectedAdaptive = 0;
    let one = 0;
    let two = 0;
    let withGarbage = 0;
    let clarityTwo = 0;
    let found = 0;
    let rejectedReal = 0;
    let realPasses = 0;
    for (let s = 0; s < HARM_SEEDS; s++) {
      const payload = ghostOfBytes(bytes, `seed${s}`);
      const track = encode(payload);
      const span = spanOf(payload);
      // A noise pass that the current rule accepts: try seeds until one is accepted (the harm is measured given acceptance).
      let bad;
      for (let g = 0; g < GARBAGE_TRIES && !bad; g++) {
        const candidate = garbage(track, span, 'noise', channel.deriveSeed(BASE_SEED, 777, s, g));
        const d = decoder.createDecoder({ sampleRate: FS });
        if ([...d.push(candidate), ...d.flush()].some((e) => e.type === 'pass-complete')) bad = candidate;
      }
      const seed = channel.deriveSeed(BASE_SEED, 999, snr + 100, s);
      const [r1, r2] = [0, 1].map((k) => channel.applyChannel(track, FS, { noiseSnrDb: snr }, channel.deriveSeed(seed, k)));
      const gap = new Float32Array(FS);
      const run = (parts) => {
        const passes = [];
        const d = decoder.createDecoder({ sampleRate: FS, onPassSymbols: (p) => passes.push(p) });
        const all = [];
        for (const p of parts) all.push(p, gap);
        const joined = new Float32Array(all.reduce((m, p) => m + p.length, 0));
        let o = 0;
        for (const p of all) {
          joined.set(p, o);
          o += p.length;
        }
        const events = [...d.push(joined), ...d.flush()];
        const clarity = events.filter((e) => e.type === 'pass-complete').at(-1)?.clarity ?? 0;
        return { done: events.some((e) => e.type === 'complete'), clarity, passes };
      };
      const a = run([r1]);
      const b = run([r1, r2]);
      if (a.done) one++;
      if (b.done) two++;
      clarityTwo += b.clarity;
      for (const p of b.passes) {
        realPasses++;
        const reads = pilotReads(p.tones);
        if (reads.right < tight) rejectedReal++;
        if (!adaptiveAccepts(reads)) rejectedAdaptive++;
      }
      if (bad) {
        found++;
        const c = run([r1, bad, r2]);
        if (c.done) withGarbage++;
      }
    }
    console.log(`| ${snr} dB | ${one}/${HARM_SEEDS} | ${two}/${HARM_SEEDS} | ${found}/${HARM_SEEDS} | ${withGarbage}/${found} | ${(clarityTwo / HARM_SEEDS).toFixed(3)} | ${rejectedReal}/${realPasses} | ${rejectedAdaptive}/${realPasses} |`);
  }

  // ---------- C ----------
  // Two plays of the same tape, each with a different part drowned in loud white noise (RMS 0.3,
  // louder than the ghost): play 1 loses the first 45% of its payload, play 2 the last 45%. Neither
  // alone has every byte; together they cover all of it (the middle 10% twice). Does the decoder
  // combine them?
  const DROWNED = 0.45;
  console.log(`\n## C. Partly drowned passes: play 1 loses the first ${100 * DROWNED}%, play 2 the last ${100 * DROWNED}% (loud white noise); ${HARM_SEEDS} seeds per size\n`);
  console.log('| payload | pilots | play 1 accepted | play 2 accepted | decoded after both | share of symbols committed per accepted play |');
  console.log('|---|---|---|---|---|---|');
  const tapes = await load('/tests/support/tapes.ts');
  for (const size of [30, 140, 560]) {
    let accepted1 = 0;
    let accepted2 = 0;
    let decoded = 0;
    let kept = 0;
    let keptCount = 0;
    for (let s = 0; s < HARM_SEEDS; s++) {
      const payload = size <= 142 ? ghostOfBytes(size, `drown${s}`) : tapes.tapeOfSize(size, BASE_SEED + s);
      const track = encode(payload);
      const span = spanOf(payload);
      const drown = (from, to, seed) => {
        const out = track.slice();
        const a = span.start + Math.round(from * (span.end - span.start));
        const b = span.start + Math.round(to * (span.end - span.start));
        out.set(channel.whiteNoise(b - a, 0.3, seed), a);
        return out;
      };
      const p1 = drown(0, DROWNED, channel.deriveSeed(BASE_SEED, size, s, 1));
      const p2 = drown(1 - DROWNED, 1, channel.deriveSeed(BASE_SEED, size, s, 2));
      const passes = [];
      const d = decoder.createDecoder({ sampleRate: FS, onPassSymbols: (p) => passes.push(p) });
      const stream = new Float32Array(p1.length + FS + p2.length);
      stream.set(p1, 0);
      stream.set(p2, p1.length + FS);
      const events = [...d.push(stream), ...d.flush()];
      const results = events.filter((e) => e.type === 'pass-complete' || e.type === 'pass-discarded');
      if (results[0]?.type === 'pass-complete') accepted1++;
      if (results[1]?.type === 'pass-complete') accepted2++;
      if (events.some((e) => e.type === 'complete')) decoded++;
      for (const p of passes) {
        if (!p.aligned) continue;
        kept += p.kept.reduce((a, b) => a + b, 0) / p.kept.length;
        keptCount++;
      }
    }
    const bytes = tape.serializePayload(size <= 142 ? ghostOfBytes(size, 'x') : tapes.tapeOfSize(size, BASE_SEED)).value.length;
    console.log(`| ${bytes} B | ${pilotsFor(bytes)} | ${accepted1}/${HARM_SEEDS} | ${accepted2}/${HARM_SEEDS} | ${decoded}/${HARM_SEEDS} | ${keptCount ? `${((100 * kept) / keptCount).toFixed(0)}%` : '—'} |`);
  }
} finally {
  await server.close();
}
