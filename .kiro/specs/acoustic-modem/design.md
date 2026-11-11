# Design: Acoustic Modem (Ghost Tape core)

Implements `requirements.md` (approved 2026-11-10, updated after design review the same day). Design approved 2026-11-10. Section numbers in brackets, e.g. [R8.11], point to acceptance criteria.

## Spec decisions from design review (approved 2026-11-10)

| # | Issue found | Evidence | Decision | Where |
|---|---|---|---|---|
| S1 | The original permutation rule (a = nearest coprime to 0.618·L) violated the darkroom spread property [R8.16] | `node scripts/check-scramble.mjs`: 8.12 and 8.13 passed all 1,280 (profile, P) cases; 8.16 failed 16. Smallest counterexample: P = 202, L = 238, B = 1, a = 149; after the first 10% of payload symbols (21 payload bytes) tenth 2 (positions 40–59) was empty. Moving the trigger to 12/15/20% still failed 12–14 cases. | a = the coprime candidate closest to 0.618·L (ties: smaller) whose order also satisfies 8.13 and 8.16 for that L, B and profile. Passes all 1,280 cases in `explore` mode; changes a for 16 lengths; max \|a/L − 0.618\| = 0.0147. | R8.11 reworded; task 0, task 5 |
| S2 | Glossary listed six marks for seven codes | — | En dash – (U+2013) is 0x86. | Glossary; *Charset* |
| S3 | R11.10 did not allow the 560 B typical tape that R5.9 needs | — | The deep suite uses the 560 B Standard tape and 256 B Robust tape for R5 cells. | R5.9, R11.10 |
| S4 | The first test plan needed ≈ 210,000 s of simulated audio (≥ 44× real time per core) | Estimate in the previous design | Cap the deep suite at ≈ 15,000 s of simulated audio; fewer seeds and conditions; claims stated as counts with confidence bounds; reverb by FFT convolution. | R5.10, R6.3, R6.4, R11.13, R11.14; *Deep-suite plan* |

`scripts/check-scramble.mjs` is a design-time check. Its assumptions: S counts pilot symbols; a pilot follows every 32 data symbols; interleaving and RS are as in *Payload pipeline*. Its default mode still checks the old rule; task 0 switches the default to the approved rule.

## Overview

Ghost Tape uses **MFSK** (multiple frequency-shift keying): each symbol is one tone from a small set and the tone index carries 2 or 4 bits. MFSK tolerates unknown gain and echo, needs no phase tracking, and descends directly from the 1975 Kansas City Standard (two tones on cassette).

```
SENDER
payload ─serialize─▶ P bytes ─+CRC32─▶ M bytes ─pad─▶ B blocks of k ─RS(+32)─▶ interleave ─▶ permute(a)
        ─▶ bits ─Gray─▶ tone indices ─+pilots─▶ symbols
header (12 B) ─RS(+8)─▶ 20 B ─▶ Robust symbols
[up-chirp][gap][sync][header][payload + pilots][down-chirp] ─▶ samples      (loop: N passes, 1 s apart)

RECEIVER (one streaming state machine; decodeFile wraps it)
samples ─sanitize─▶ chirp matched filter ─▶ fine timing on sync ─▶ header (Robust, RS) ─▶ tapeId
  ─▶ per symbol: skip guard, Goertzel per tone, normalize ─▶ pending pass buffer
  ─▶ progress: (accumulator + pending) ─argmax─▶ provisional bytes at final positions
  ─▶ pass end: alignment check ─▶ commit to accumulator ─▶ RS per block ─▶ CRC = trailer = tapeId
  ─▶ strict deserialize ─▶ complete      (otherwise: keep developing)
```

## Modules

All under `src/modem/` unless noted. Each stage is an inverse pair.

| Module | Exports (encode / decode pair) |
|---|---|
| `types.ts` | Public types: `Payload`, `Tape`, `Ghost`, `ProvisionalByte`, `DecoderEvent`, `Result<T>` |
| `bits.ts` | `bytesToBits` / `bitsToBytes`, `grayEncode` / `grayDecode`, `bitsToSymbols` / `symbolsToBits` |
| `crc32.ts` | `crc32` (IEEE 802.3, reflected, init/xorout 0xFFFFFFFF) |
| `reedSolomon.ts` | `rsEncode(data, nParity)` / `rsDecode(codeword, nParity)` |
| `interleave.ts` | `padAndSplit` / `joinAndTrim`, `interleave` / `deinterleave`, `chooseMultiplier`, `permute` / `unpermute` |
| `tape.ts` | `validatePayload`, `serializePayload` / `deserializePayload`, charset `encodeText` / `decodeText` |
| `profiles.ts` | `PROFILES` table, `ProfileId`, `profileById` |
| `frame.ts` | `buildHeader` / `parseHeader`, `buildPayloadSymbols` / `parsePayloadSymbols`, `frameLayout` |
| `modulate.ts` | `renderPass`, `renderChirp`, `encodePayload` |
| `sync.ts` | `ChirpDetector` (streaming matched filter), `fineTiming` |
| `demodulate.ts` | `goertzelEnergies`, `normalize`, `SymbolTracker` (early–late gate, pilot re-anchoring) |
| `accumulator.ts` | `AccumulatorStore` (≤ 4 tapes, keyed by tapeId) |
| `decoder.ts` | `createDecoder` (streaming state machine), `decodeFile` |
| `channel.ts` | Test-only channel simulator. Imported by no runtime module [R11.2] |
| `index.ts` | Public API re-exports |
| `src/audio/wav.ts` | `encodeWav` / `decodeWav` (16-bit PCM mono); pure, testable in Node |
| `src/audio/` | File decoding, mic capture, worklet, worker, playback |

## Tape format (`tape.ts`) [R2]

### Ghost Tape charset
One character = one byte. `0x20–0x7E` ASCII; `‘`→0x80, `’`→0x81, `“`→0x82, `”`→0x83, `—` (em dash)→0x84, `…`→0x85, `–` (en dash)→0x86; `0x0A` newline, letter only. Bytes 0x87–0xFF and 0x00–0x09, 0x0B–0x1F, 0x7F are invalid. Every other code point, including `\r` and tab, is rejected with the field name [R2.3, R2.4]. Lengths are counted in charset characters, which equal JS code units for every allowed character.

### Serialized layout (big-endian)

Tape, `kind = 0`:

| Field | Encoding | Valid values |
|---|---|---|
| kind | u8 | 0 |
| title | u8 length + bytes | 0–40 |
| from | u8 length + bytes | 0–24 |
| to | u8 length + bytes | 0–24 |
| date | 3 bytes: year − 2000, month, day | `00 00 00` = absent; otherwise a real Gregorian date 2000-01-01…2255-12-31 [R2.7] |
| trackCount | u8 | 0–10 |
| tracks[i] | u8 length + bytes | 0–60 each |
| letter | u16 length + bytes | 0–800 |
| doodleFlag | u8 | 0; 1 only once the doodle task ships [R2.2] |
| doodle | 128 bytes, 32×32, 1 bit/pixel, row-major, MSB = leftmost | present iff flag = 1 |

Ghost, `kind = 1`: `kind`, u8 length (1–140), bytes; newline not allowed [R2.5].

Validation (encoder) and strict deserialization (decoder) share one rule set: every length and value in the table; at least one of title/from/to non-empty [R2.8]; no trailing bytes; `deserialize` returns `{ ok: false }` and never throws [R2.9, R7.4]. A month-0 date with non-zero bytes is invalid, so absent and present dates cannot be confused.

Encoded size = serialized length. Caps: Standard 1024 B, Robust 256 B, checked after serialization; the reason states cap and actual size [R1.2, R1.3]. Size examples: 100-char ghost = 102 B; typical tape ≈ 560 B; largest valid tape without doodle = 1,509 B, so the cap is what limits large tapes.

## Profiles (`profiles.ts`) [R9]

Profiles are data. `ProfileId` is derived from the table's keys, and every encoder/decoder parameter (tones, timing, envelope, pilot, cap) is read from the entry, so a new entry round-trips with no other source change [R9.7]. The encoder and decoder take the table as an optional argument (default `PROFILES`) so the 9.7 test can inject an extra entry.

Tones sit on a grid of 1 / analysis window so they are orthogonal over the window: a Goertzel bin for one tone sees zero energy from the others.

| Parameter | Robust (id 0, music box) | Standard (id 1) |
|---|---|---|
| Tones | 1175, 1475, 1750, 2350 Hz (≈ D6 F♯6 A6 D7) [R9.2] | 1500 + 100·k Hz, k = 0…15 (1500–3000) [R9.3] |
| Bits per symbol | 2 | 4 |
| Symbol duration | 50 ms | 25 ms |
| Guard (skipped by the decoder) | 10 ms | 5 ms |
| Analysis window | 40 ms (25 Hz grid) | 20 ms (50 Hz grid) |
| Envelope | Bell, below [R1.11, R1.12] | Flat |
| Pilot tone index | 3 | 15 |
| Payload cap | 256 B | 1024 B |
| Raw rate | 40 bit/s | 160 bit/s |

All tones are within 300–3200 Hz [R9.8]. Sync and header always use Robust tones and timing [R9.4].

**Bell envelope (Robust).** Raised-cosine rise 0.6 → 1.0 over 0–3 ms (inside the 10 ms guard), then exponential decay `1.0 · 0.6^((t − 3)/47)` from 1.0 at 3 ms to 0.6 at 50 ms. Each symbol starts and ends at 0.6, so the amplitude is continuous across boundaries; with continuous phase this keeps boundary splatter far below the 40 dB limit [R1.7]. The smooth rise avoids a slope corner that would leak energy above 4 kHz.

**Musical payload experiment (cut list).** An 8-tone D-major pentatonic profile, 3 bits/symbol, 25 ms, all tones ≤ 3200 Hz [R9.8]. Adopted only if its single-pass SNR threshold from `npm run measure` is within 2 dB of Standard's.

## Frame (one pass) (`frame.ts`)

| Segment | Content | Duration |
|---|---|---|
| Preamble | Linear up-chirp 1000 → 3200 Hz, 20 ms cosine tapers [R1.15] | 400 ms |
| Gap | Silence | 50 ms |
| Sync | 8 Robust symbols, indices `[0,3,0,3,1,2,1,2]` | 400 ms |
| Header | 20 bytes (12 + 8 RS parity) = 80 Robust symbols | 4000 ms |
| Payload | Payload symbols in the header's profile, pilots included | varies |
| Postamble | Linear down-chirp 3200 → 1000 Hz, 20 ms tapers | 200 ms |

Overture = 4.85 s. Chirp phase: `φ(t) = 2π (f0·t + (f1 − f0)·t² / (2T))`.

**Sample-exact timing [R1.13].** Every segment and symbol start is `round(t · sampleRate)` where `t` is its exact start time from the pass's first sample (e.g. `t = tHeader + k·T`). Rounding the absolute time, never adding rounded lengths, keeps the error below 1 sample with no build-up (25 ms × 44100 = 1102.5 samples).

### Header (12 data bytes)

| Bytes | Field | Valid |
|---|---|---|
| 0–1 | magic | `0x47 0x54` |
| 2 | version | `0x01` |
| 3 | profileId | an id in the profile table |
| 4 | payloadKind | 0 tape, 1 ghost |
| 5–6 | payloadLength P | 1–1024; ≤ 256 for Robust |
| 7 | flags | 0 |
| 8–11 | tapeId | CRC-32 of the serialized payload |

RS(20, 12) corrects up to 4 byte errors. Any RS failure or invalid field → `header-invalid` [R7.5].

### Payload pipeline [R8.10–8.15]
1. `M = P + 4` (payload + CRC-32, big-endian).
2. `B = ceil(M / 223)`, `k = ceil(M / B)`; zero-pad to `B·k`; block b = bytes `b·k … b·k + k − 1`.
3. RS per block: systematic, GF(2⁸), primitive polynomial 0x11D, generator roots α⁰…α³¹, 32 parity bytes after the data. Codeword length `n = k + 32 ≤ 255`, a shortened RS(255, 223). Corrects 16 errors (32 erasures) per block.
4. Interleave: interleaved index `j = pos·B + b` (byte 0 of every block, then byte 1 …). `L = B·n`.
5. Permute: transmitted byte i = interleaved byte `(a·i) mod L`, with a from `chooseMultiplier(L, B, profile)` [R8.11]: walk coprime candidates in order of distance from 0.618·L (ties: smaller first) and return the first whose order passes the 8.13 window check (B ≤ 16) and the 8.16 tenths check for that profile's bits per symbol and pilot interval. A pure function of (P, profile), so encoder and decoder agree with no extra header field, and a new profile entry needs no code change [R9.7]. Cost: the first candidate passes for all but 16 lengths, and each check is O(L), so this is negligible per pass. Applied even when B = 1 [R8.15]. The decoder applies the inverse, then de-interleaves [R8.14].
6. Bytes → bits MSB first → groups of `bitsPerSymbol` (zero-pad the last group for profiles where 8 is not a multiple) → Gray code → tone index.
7. A pilot follows every 32 data symbols: `D = ceil(8L / bps)` data symbols, `floor(D / 32)` pilots, `S = D + floor(D / 32)`.

Why the permutation: interleaving alone sends block-0 bytes in order, so the first seconds of a pass would only reveal the start of each block. Multiplying by a ≈ 0.618·L (golden-ratio stride) spreads consecutive transmitted bytes evenly across the message, so a dropout hits every block a little and the darkroom image sharpens everywhere at once.

### Durations

| Content | P | B / L | Payload symbols | Ghost track (1 pass) |
|---|---|---|---|---|
| Ghost, 100 chars, Standard | 102 | 1 / 138 | 284 | 12.2 s |
| Typical tape, Standard | 560 | 3 / 660 | 1,361 | 39.1 s |
| Max tape, Standard | 1024 | 5 / 1,190 | 2,454 | 66.4 s |
| Max ghost (140), Robust | 142 | 1 / 178 | 734 | 41.8 s |
| Max tape, Robust | 256 | 2 / 324 | 1,336 | 71.9 s |

Duration = `samples.length / sampleRate`, returned by the encoder, so the shown duration is exact [R1.4].

## Modulation (`modulate.ts`) [R1]

- Continuous-phase oscillator: phase carries across symbols, so no clicks.
- 2 ms raised-cosine fade at pass start and end.
- Peak-normalize each pass to 0.8 of full scale (inside 0.5–0.9) [R1.8].
- Loop mode: N identical passes joined by exactly `round(1 · sampleRate)` zero samples, nothing before or after [R1.9]. Each pass is self-contained, so any pass cut at its boundaries decodes alone [R1.10].
- `encodePayload` accepts only sampleRate 44100 or 48000 [R1.1]; it returns `{ ok: false, reason }` and no samples for any invalid input, never throws.

## Decoder

### State machine (`decoder.ts`)

```
SEARCHING ──chirp──▶ SYNC ──timing ok──▶ HEADER ──valid──▶ PAYLOAD ──last symbol──▶ PASS_END ──▶ SEARCHING
                      │                    └─invalid──▶ pass-discarded(header-invalid) ──▶ SEARCHING
                      └─no sync──▶ SEARCHING (no event)          PAYLOAD ─signal lost──▶ pass-discarded(signal-lost)
```

**Chunking invariance [R4.2, R4.3].** `push` appends to an internal buffer; processing runs in fixed hops of 1024 samples aligned to the absolute sample index, so the processing order depends only on the concatenated stream. Events are stamped with sample positions and emitted when their hop completes. `flush` processes the remaining partial hop zero-padded and ends any pass in progress (complete if all payload symbols are in, else `signal-lost`). 0-length chunks are no-ops.

**Input sanitizing [R11.6].** Non-finite samples become 0. No other path can throw: every decode step returns a `Result`, and `push`/`flush` wrap the state machine so an unexpected internal error resets to SEARCHING instead of propagating.

**Sample rate.** Every duration is converted with the decoder's `sampleRate`, any value 16000–48000 Hz [R3.3]. Window lengths are integers at 16000, 44100 and 48000 Hz (e.g. 20 ms × 44100 = 882).

### 1. Preamble detection (`sync.ts`)
FFT overlap-save cross-correlation with the up-chirp template, block size 8192. Detection when the correlation envelope peak ≥ 8× the median absolute correlation over the 1 s centred on the peak. Ratio, not level, so it is gain-independent. While a pass is being decoded the detector is idle, which saves most of the decode cost.

### 2. Fine timing
Search ±10 ms around the predicted sync start in 0.5 ms steps; choose the offset maximizing the summed energy of the expected sync tones. If the best sync score is under 2× the mean of the other offsets, return to SEARCHING without an event.

### 3. Symbol energies (`demodulate.ts`)
- Skip the guard, then Goertzel for each tone over the analysis window: energy vector `e[0..T−1]`.
- Normalize: `ê = e / Σe` (all zeros if Σe = 0). Passes at different volumes become comparable before combining.
- **Timing tracking** (`SymbolTracker`): early–late gate on the decided tone at ±1 ms with loop gain 0.1, plus re-anchoring at each pilot (±3 ms search). Total correction clamped to ±0.3% of elapsed time. Covers ±0.2% rate mismatch [R5.2]: over 66 s that is ±133 ms, far more than the guard.

### 4. Pass handling and accumulation (`accumulator.ts`) [R6]
- During PAYLOAD, normalized vectors go into a **pending buffer** for the pass, never directly into the accumulator. This makes discarding a pass trivially exact [R6.5, R6.6].
- **Alignment rule [R6.6].** At pass end the pass is aligned iff the fraction of pilots whose argmax is the pilot index is ≥ 2/T (Standard ≥ 12.5%, Robust ≥ 50%; twice chance). Thresholds are tunable after week-1 data; changing them is a design change.
- **Signal lost.** During PAYLOAD, if telephone-band energy over a sliding 400 ms window is more than 30 dB below the header's mean, the pass ends with `signal-lost`. The 400 ms window is wider than the longest allowed dropout (150 ms) [R5.6].
- **Commit** (aligned only): add pending vectors into the tapeId's accumulator, creating it if needed. If 4 tapeIds are held, first evict the one with the oldest last activity [R6.9, R6.10]. Eviction happens at commit, not at header time, so a discarded pass leaves every accumulator unchanged.
- **Retention** [R6.8]: each tapeId records last activity (audio time of its last commit or repeat pass). Before each hop, entries older than 600 s of audio time are dropped. `reset()` clears everything [R6.11].
- **Decision**: per symbol `argmax(Σê)`; confidence `1 − second/best` (0 if best = 0). Clarity = mean confidence over payload symbols [R6.7]. `blocksRecovered / blocksTotal` from the RS step.
- Why combining works: the true tone's energy adds up pass after pass while noise spreads across all tones, so the margin between the right tone and the rest grows with each pass (equal-gain energy combining).

### 5. Bytes and verification [R7]
argmax → Gray⁻¹ → bits → bytes → unpermute → deinterleave → RS-decode each block. `complete` only if every block decodes, the trailing CRC-32 equals the CRC of the reassembled P bytes, that CRC equals the header tapeId, and strict deserialization succeeds [R7.2]. Any failure: no `complete`, accumulator kept, keep developing [R7.1, R7.3, R7.4]. RS miscorrection plus a CRC-32 match plus a strict parse is the only path to a wrong `complete`; the probability is below 2⁻³², and P13 checks it empirically.

### 6. Progress and provisional bytes [R8]
- `progress` every 200 ms of audio time from the `header` event until pass end (≤ 250 ms [R8.3]).
- Provisional bytes come from `accumulator + pending` [R8.9]: for each transmitted byte whose symbols have evidence, map it through unpermute and deinterleave to its final position; keep positions 0..P−1 only [R8.8]. Byte confidence = minimum confidence of its symbols.
- Bytes are typed `ProvisionalByte { kind: 'provisional', position, byte, confidence }`. `Payload` variants have `kind: 'tape' | 'ghost'` and different fields, so a provisional entry is not assignable to `Payload` [R7.7, R7.8].

### 7. Events

```ts
type DecoderEvent =
  | { type: 'signal-detected'; atSample: number }
  | { type: 'header'; tapeId: number; profile: ProfileId; payloadLength: number;
      pass: number; estimatedSecondsRemaining: number }
  | { type: 'progress'; tapeId: number; provisional: ProvisionalByte[]; fractionReceived: number }
  | { type: 'pass-complete'; tapeId: number; pass: number;
      blocksRecovered: number; blocksTotal: number; clarity: number }
  | { type: 'complete'; tapeId: number; payload: Payload; passesUsed: number }
  | { type: 'already-received'; tapeId: number }
  | { type: 'pass-discarded'; reason: 'header-invalid' | 'alignment-failed' | 'signal-lost' };
```

| Pass kind | Event sequence |
|---|---|
| Valid header, tape not complete | `signal-detected`, `header`, `progress`×n, `pass-complete` [+ `complete`] [R8.1, R8.4] |
| Valid header, misaligned or signal lost | `signal-detected`, `header`, `progress`×n, `pass-discarded` [R8.6] |
| Invalid header | `signal-detected`, `pass-discarded(header-invalid)` [R8.7] |
| Valid header, tape already complete and retained | `signal-detected`, `header`, `already-received` at pass end; counts as activity [R8.17] |

`pass` in `header` = 1-based count of passes for that tapeId including this one. `estimatedSecondsRemaining` = remaining payload + postamble duration from the frame layout. The pass result is emitted at the last payload symbol's hop, well within 1 s [R4.5]. Passes from up to 4 tapes may interleave in time but not overlap; each is routed by tapeId, so each tape's result equals a fresh decoder fed only its passes [R4.6, R4.7].

### 8. Public API (`index.ts`)

```ts
function encodePayload(p: Payload, opts: { profile: ProfileId; sampleRate: 44100 | 48000;
  passes?: number; profiles?: ProfileTable }): Result<{ samples: Float32Array; durationSec: number }>;
function createDecoder(opts: { sampleRate: number; profiles?: ProfileTable }): Decoder;
interface Decoder { push(s: Float32Array): DecoderEvent[]; flush(): DecoderEvent[]; reset(): void }
function decodeFile(samples: Float32Array, sampleRate: number):
  { ok: true; payload: Payload; passesUsed: number } | { ok: false; reason: string; clarity: number };
type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
```

`decodeFile` = push everything, flush, return the first `complete`. No `header` event ever → `"no signal found"` [R3.5]. Several passes in a file combine automatically [R3.4].

## Audio adapters (`src/audio/`)

- **File decode [R3.7–3.10]:** `AudioContext.decodeAudioData` only, no own parsers; channels averaged to mono; samples passed at the context's sample rate. Rejection → `"unsupported or unreadable audio file"`.
- **WAV export [R1.6]:** `encodeWav` writes 16-bit PCM mono at the track's sample rate (clamp, round to nearest).
- **Mic [R4.1]:** `getUserMedia` with `echoCancellation`, `noiseSuppression`, `autoGainControl` all false. An AudioWorklet forwards 128-sample frames to a Web Worker that owns the decoder; events are posted back to the UI. Sample rate read from `AudioContext.sampleRate`.
- **Dev harness page (`src/ui/dev.ts`):** minimal form to build a tape, show the duration and update it on every edit or profile change [R1.4, R1.5], play, loop, export WAV, decode an upload, and listen on the mic. Used for the manual trials; superseded by the `ghost-tape-ui` spec.

## Channel simulator (`channel.ts`, test-only) [R5, R11.3, R11.4]

Seeded PRNG (mulberry32) inside the simulator only; the modem library has no randomness [R11.11]. Same input, parameters and seed → identical output. Each pass in a multi-pass trial gets its own derived seed [R11.12].

| Impairment | Model |
|---|---|
| Gain | Multiply by g, 0.05–2 [R5.1] |
| Surrounding audio | 0–60 s before/after; silence, white noise, music-like chords (3–4 random sines 100–4000 Hz, changing every 300–800 ms), speech-like noise (noise through 3 formant band-passes, 4 Hz syllabic AM). Level = ghost-track RMS [R3.2] |
| White noise | Scaled to target in-band SNR |
| Rate mismatch | Resample by ratio 0.998–1.002 [R5.2] |
| Telephone band | 2nd-order Butterworth band-pass 300–3400 Hz [R5.3] |
| Reverberation | Unit direct impulse + white-noise tail with amplitude envelope `exp(−6.91·t / RT60)` (−60 dB at RT60), truncated at RT60; tail energy scaled to the DRR. Applied by FFT overlap-add convolution (FFT size = next power of two ≥ 2 × IR length) [R5.7, R11.14] |
| Dropout | One segment ≤ 150 ms inside the payload, zeroed or white noise at 4× signal RMS [R5.6] |
| Rate conversion | Windowed-sinc resampler, any pair of 16000/44100/48000 |

**SNR [Glossary].** Signal and noise powers are each measured by FFT over the whole signal, summing bins in 300–3400 Hz. The same function serves every sample rate.

### Deep-suite plan [R11.8–R11.10, R11.13]

**Budget.** At most 15,000 s of simulated audio pushed into decoders in `test:deep` [R11.13]. A shared test harness (`tests/support/budget.ts`) adds up every sample pushed, prints the total and each cell's trial count at the end, and fails the suite if the total exceeds 15,000 s. At this size the suite needs ≈ 25× real time overall (≈ 3× per core on 8 performance cores), so it does not depend on heavy optimization.

Track lengths used below (one pass): Standard 560 B = 39.1 s; Robust 256 B = 71.9 s; Standard 1024 B = 66.4 s; 60 B ghost = 10.0 s Standard, 24.9 s Robust.

| Block | Cells and trials | Simulated audio |
|---|---|---|
| R5.1–5.6 single impairments | 6 criteria × Standard 10 trials (560 B) + 6 × Robust 6 trials (256 B), half per rate [R5.8–5.10] | 2,346 + 2,588 = 4,934 s |
| R5.7 reverb table | RT60 {50, 100, 150, 200, 300} ms, DRR 0 dB, 2 trials (one per rate) per RT60 per profile; logged, not asserted | 391 + 719 = 1,110 s |
| R5.11 realistic room | Standard 10, Robust 6, half per rate | 391 + 431 = 822 s |
| R6.3 / R6.4 multi-pass | Standard, 60 B ghost, 5 passes + 4 × 1 s gaps = 54 s per seed; 30 seeds at the lowest level, 10 at each other level | 2,700 s |
| R3.2 surrounding audio | 4 types × 3 trials, 60 B ghost: Standard with 60 s before and after; Standard with seeded 0–60 s each side; Robust with seeded 0–60 s each side (expected totals) | ≈ 1,140 s |
| R5.2 at maximum size | Standard 1024 B at −0.2% and +0.2%, both rates (Robust 256 B is already in the R5 block) | 266 s |
| Other properties | P13 rate sweep 350, P14 loop 210, P15b 192, P16 chunking 200, P17 fuzz ≈ 50, P20 210, P21 352, P22 ≈ 690 (one 601 s idle run + eviction run), P24 20, R4.4 benchmark 66 | ≈ 2,340 s |
| **Total** | | **≈ 13,300 s** (≈ 1,700 s headroom) |

**Choosing impairment values.** Within each R5 criterion the trials cover the range deterministically: both endpoints first, then seeded values inside the range. Gain: 0.05, 2, then seeded. Rate mismatch: −0.2%, +0.2%, then seeded. Dropout: zeroed and noise variants alternate; start positions at the first payload symbol, the last possible start, then seeded. Noise criteria (5.4, 5.5) use the threshold SNR itself, the hardest point in the range.

**What a pass means (honest claims).** Every trial uses a fixed seed, so a cell either passes or fails deterministically; it is not flaky. A cell of n trials passes only if all n decode exactly (Glossary "decodes correctly"). Treating trials as independent draws, n/n successes supports a success rate above 0.05^(1/n) at one-sided 95% confidence (Clopper–Pearson):

| Scope | n | Lower bound we may claim |
|---|---|---|
| One R5 criterion, Standard | 10 | 74% |
| One R5 criterion, Robust | 6 | 61% |
| R5.1–5.6 pooled, Standard | 60 | 95% (average over the tested mix of impairments) |
| R5.1–5.6 pooled, Robust | 36 | 92% (same caveat) |
| R5.11, Standard / Robust | 10 / 6 | 74% / 61% |

Reports and the write-up quote these bounds, not "95% per condition". The R5.7 table has only 2 trials per cell, so its whole-tape counts are anecdotal; the symbol error rate (≈ 2,700 symbols per cell) is the informative number [R5.7].

**R6.3 / R6.4 method.** For each seed, render 5 passes with independent noise and feed them to one decoder. Success at N = a `complete` by the end of pass N. Because the decoder is causal and `complete` is sticky while retained, this makes R6.3's monotonicity hold by construction, so the real content of the experiment is R6.4 (at the lowest level with 30 seeds: 3-pass successes ≥ 1-pass successes + 6) and the clarity-per-pass curve. P15b checks on 3 seeds that a fresh decoder fed passes 1..N (N = 2, 4) gives the same result as the prefix of the long run; that is a small sample, and it relies on the hop-based processing that P16 tests more thoroughly. The report states seed counts and raw counts, not percentages alone.

| Item | Value |
|---|---|
| R5.11 realistic room (provisional) | gain 0.3, telephone band-pass, RT60 100 ms at DRR 3 dB, white noise at threshold: Standard 18 dB, Robust 9 dB. Fixed after week-1 data (task 14) |
| R6.3 SNR levels (provisional, Standard, 60 B ghost) | 14, 12, 10 dB (1, 3 and 5 dB below the R5.4 placeholder). Re-fixed in task 14 from the measured 60 B threshold |
| Short tape for other deep tests | 60 B ghost (58-character message) |
| `npm test` (fast) | Each R5 criterion once per profile at 48 kHz with the 60 B ghost; fast properties with ≤ 50 cases; `tsc --noEmit`; under 60 s [R11.8] |

**Measurement sweeps** (single-pass success and symbol error rate vs. SNR per profile, used by task 14 to set thresholds) run as `npm run measure`, outside the deep suite and its cap. Each sweep's trial counts are logged with its results.

## Correctness properties

Seeded fast-check; files under `tests/properties/` mirror module names.

| # | Property | Covers |
|---|---|---|
| P1 | `bitsToBytes(bytesToBits(b)) = b`; `symbolsToBits(bitsToSymbols(x)) = x` | R11.5 |
| P2 | Gray code is a bijection; adjacent indices differ in one bit | R11.5 |
| P3 | CRC-32 known answer `"123456789"` → 0xCBF43926; every single-bit flip changes the CRC | R7.2 |
| P4 | `rsDecode` returns the original for ≤ 16 byte errors per payload block and ≤ 4 per header | R7.1, R7.5 |
| P5 | Beyond capacity, `rsDecode` returns a failure or a genuine codeword within t bytes of the received word (it cannot always return the original: the word may lie near a different codeword; CRC-32 and P18 catch that), and never throws | R7.1 |
| P6 | `joinAndTrim(deinterleave(interleave(padAndSplit(x)))) = x` | R8.10 |
| P7 | `unpermute(permute(x)) = x`; i → a·i mod L is a bijection for every valid (L, B) — exhaustive | R8.12, R8.14 |
| P8 | Every 16 consecutive transmitted bytes touch every block, all valid (L, B), B ≤ 16 — exhaustive | R8.13 |
| P9 | `chooseMultiplier` finds an a for every valid P and profile, and that a satisfies the darkroom spread [R8.16] — exhaustive | R8.11, R8.16 |
| P10 | `deserialize(serialize(p)) = p` for valid tapes and ghosts, absent date stays absent | R2.6 |
| P11 | Invalid fields (charset, newline placement, lengths, dates, empty title/from/to, caps) rejected naming the field; random bytes into `deserialize` never throw and only succeed for valid encodings | R1.2, R2.1–2.9 |
| P12 | `parseHeader(buildHeader(h)) = h`; `parsePayloadSymbols(buildPayloadSymbols(x)) = x`, each profile | R9.1, R9.4 |
| P13 | Perfect channel: `decodeFile(encodePayload(p)) = p`, both profiles, encode at 44100/48000, decode at any rate 16000–48000 after resampling | R1.1, R3.1, R3.3 |
| P14 | Loop: any single pass cut from an N-pass track decodes alone; gaps are exactly 1 s of zeros | R1.9, R1.10 |
| P15 | Damaged channel cells (*Deep-suite plan*), plus the budget counter staying ≤ 15,000 s | R5.1–5.6, R5.11, R11.13 |
| P15b | Prefix equivalence: fresh decoder on passes 1..N gives the same results as the first N passes of a longer stream | R6.3 |
| P16 | Chunking invariance: random splits (including 0- and 1-sample chunks) give identical events | R4.2, R4.3 |
| P17 | Never throws: noise, silence, ±1 clipping, NaN/±∞, every length 0–10, through `push` and `flush` | R3.6, R11.6, R11.7 |
| P18 | Never wrong: every `complete` across all simulator runs equals the encoder input byte for byte | R7.9 |
| P19 | Success counts never fall with more passes; at the lowest level 3-pass successes ≥ 1-pass successes + ceil(0.2 × s), s = 30 seeds | R6.3, R6.4 |
| P20 | Separate plays combine: passes separated by unrelated audio (< 10 min) combine like consecutive passes | R6.1, R6.8 |
| P21 | Tapes don't mix: interleaved passes of up to 4 tapes give per-tape results equal to fresh decoders | R4.6, R4.7 |
| P22 | Store limits: 5th tape evicts oldest activity; > 10 min audio idle expires; `reset` clears; discarded pass leaves state identical | R6.5, R6.6, R6.9–6.11 |
| P23 | Event grammar: sequences match the table in *Events*; `progress` gaps ≤ 250 ms audio; exactly one `complete`; `already-received` for repeats | R7.5–7.7, R8.1–8.9, R8.17 |
| P24 | New profile entry injected via `profiles` round-trips | R9.7 |

Unit tests (not properties): spectral splatter at symbol boundaries (R1.7), peak range (R1.8), envelope shape (R1.11, R1.12), symbol start positions (R1.13), band limits and chirp sweeps (R1.14, R1.15, R9.8), tone tables (R9.2, R9.3), `"no signal found"` (R3.5), type-level test with `@ts-expect-error` run by `tsc --noEmit` in `npm test` (R7.8), WAV header and samples (R1.6), the R4.4 timing benchmark, Node-only import check (R11.1, R11.2).

## Error handling

| Situation | Behavior |
|---|---|
| Invalid tape field / over cap / bad sample rate | `{ ok: false, reason }` naming the field or cap; no samples |
| No chirp | No event |
| Chirp but no sync | Back to SEARCHING, no event |
| Header invalid | `pass-discarded: header-invalid`, keep listening |
| Misaligned / signal lost | `pass-discarded`, accumulator untouched |
| Blocks uncorrectable or CRC mismatch | `pass-complete` with clarity < 1; keep developing |
| Unreadable file | `"unsupported or unreadable audio file"` |

## Decisions taken

1. **Reed–Solomon is hand-written** (~200 lines: BM + Chien + Forney). No dependency, and P4/P5 test it directly.
2. **Decoder runs in a Web Worker** fed by an AudioWorklet, keeping the UI thread free.
3. **Eviction at commit time**, so discarded passes cannot evict a tape.

## Questions answered by measurement (weeks 1–2)
1. Single-pass SNR thresholds per profile (replace the R5.4/5.5 placeholders and the R6.3 levels).
2. Reverb tolerance vs. guard length (R5.7 table) and the realistic-room parameters (R5.11).
3. Do 16 tones at 100 Hz spacing survive real phone speakers (R10.1)?
4. Is the musical payload profile within 2 dB of Standard (cut list)?
