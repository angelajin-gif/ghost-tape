# Design: Acoustic Modem (Ghost Tape core)

Implements `requirements.md` (approved 2026-11-10, updated after design review the same day). Design approved 2026-11-10. Section numbers in brackets, e.g. [R8.11], point to acceptance criteria.

## Spec decisions from design review (approved 2026-11-10)

| # | Issue found | Evidence | Decision | Where |
|---|---|---|---|---|
| S1 | The original permutation rule (a = nearest coprime to 0.618·L) violated the darkroom spread property [R8.16] | `node scripts/check-scramble.mjs`: 8.12 and 8.13 passed all 1,280 (profile, P) cases; 8.16 failed 16. Smallest counterexample: P = 202, L = 238, B = 1, a = 149; after the first 10% of payload symbols (21 payload bytes) tenth 2 (positions 40–59) was empty. Moving the trigger to 12/15/20% still failed 12–14 cases. | a = the coprime candidate closest to 0.618·L (ties: smaller) whose order also satisfies 8.13 and 8.16 for that L, B and profile. Passes all 1,280 cases in `explore` mode; changes a for 16 lengths; max \|a/L − 0.618\| = 0.0147. | R8.11 reworded; task 0, task 5 |
| S2 | Glossary listed six marks for seven codes | — | En dash – (U+2013) is 0x86. | Glossary; *Charset* |
| S3 | R11.10 did not allow the 560 B typical tape that R5.9 needs | — | The deep suite uses the 560 B Standard tape and 256 B Robust tape for R5 cells. | R5.9, R11.10 |
| S4 | The first test plan needed ≈ 210,000 s of simulated audio (≥ 44× real time per core) | Estimate in the previous design | Cap the deep suite at ≈ 15,000 s of simulated audio; fewer seeds and conditions; claims stated as counts with confidence bounds; reverb by FFT convolution. | R5.10, R6.3, R6.4, R11.13, R11.14; *Deep-suite plan* |

Decisions after the week-1 measurements (developer, 2026-11-12):

| # | Question | Decision | Where |
|---|---|---|---|
| S5 | The R5.4/R5.5 placeholder levels (15 dB, 6 dB) were 19 and 17 dB above where decoding starts to fail | R5.4 becomes −1 dB (Standard) and R5.5 −8 dB (Robust), each 3 dB above the lowest level at which all 12 measured trials decoded (−4 dB and −11 dB). A test at the old levels could not fail. | R5.4, R5.5; cells in `channel.prop.test.ts` |
| S6 | Standard fails from RT60 150 ms at DRR 0 dB | Do not change the profile yet. R5.7's 150 ms target is scoped to Robust (met); Standard is pending. Task 14 adds a simulator comparison of guard and symbol-length variants (for example 10 ms guard, 30 ms symbols) next to the open-question-5 sound options, reporting symbol error rate against RT60. The final choice comes from the real-room trials of task 16. | R5.7; tasks 14, 16, 17 |
| S7 | R6.3 levels −5/−6/−7 dB were measured on 560 B tapes, but the plan ran R6.3 on a 60 B ghost | R6.3 uses the typical 560 B tape so the levels mean what was measured (a 60 B ghost is one RS block and tolerates about 17% byte errors, so at these levels it would decode almost every time and leave nothing for R6.4 to show). At about 199 s of audio per seed (5 passes), the required 30 + 10 + 10 seeds cost about 9,950 s, which does not fit the 15,000 s cap next to the rest of the plan (see *Deep-suite plan*). The full experiment therefore runs as `npm run measure:passes` outside the cap and reports its counts (as R6.4 requires); the deep suite keeps a small regression cell. | R6.3, R6.4; task 12 |
| S9 (2026-11-24) | The fixed alignment rule (2/T of the pilots) let noise payloads in (56–67% for speech-like noise), and accepted noise passes measurably slowed combining | Adaptive pass-level rule (pilot reads must be a count that chance, estimated from the pass's unclear data decisions, reaches with probability < 1/1000; all pilots when that is impossible), plus run-level gating: commit only data runs with a read bounding pilot. Option B of three; the fallback was a 1/100 bound. Short ghosts partly drowned are no longer combined | R6.6; task 14 |
| S8 (2026-11-19) | After timing tracking (task 11), Standard decodes every 12-trial cell down to −7 dB (was −4 dB); at the S7 levels one pass already decoded 30/30, 10/10, 10/10, so R6.4 could not be shown | Re-measured with `npm run measure` (12 trials) on the current code. R5.4 becomes −4 dB (3 dB above −7 dB); R5.5 stays −8 dB (Robust still −11 dB). R6.3 levels become −8, −9, −10 dB, 30 seeds at −10 dB; the deep-suite regression cell moves to −9 dB. | R5.4, R5.5, R6.3, R6.4; task 12 |

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
| `demodulate.ts` | `goertzelEnergies`, `goertzelEnergy`, `normalizeEnergies`, `decide`, `calibrateGate` (early/late gate), `ClockTracker` (alpha-beta filter) |
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

- Continuous-phase oscillator: phase carries across symbols, so the wave never jumps.
- **Frequency glide (added in task 8).** Phase continuity alone was not enough for R1.7: with hard frequency jumps the Robust header measured only 34.3 dB below the telephone band at 4 kHz (limit 40). Each symbol now starts with a 2 ms raised-cosine glide from the previous tone to the new one, always inside the profile's guard period (`min(2 ms, guard)`), so the Goertzel window never sees it. Measured after the change, over three messages per profile at both rates: worst boundary 54 dB (Standard) and 73 dB (Robust).
- **Level easing at profile hand-over.** The Robust header ends at envelope level 0.6 and a flat Standard payload starts at 1.0. That step alone held the Standard result at 34 dB, so any difference between the previous symbol's end level and the new symbol's start level is eased over the same 2 ms. Bell-to-bell and flat-to-flat have no difference, so the bell's 3 ms rise is untouched.
- The R1.7 test measures with a Hann window: a rectangular 10 ms window leaks about −30 dB at 1 kHz from any tone, so it would measure the window, not the signal.
- 2 ms raised-cosine fade at the start of the sync stream and the end of the payload stream, where tone meets silence or a chirp; the chirps carry their own 20 ms tapers, which also give the pass its silent first and last samples.
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
FFT overlap-save cross-correlation with a **complex** up-chirp template (`taper·e^(jφ)`, built from the same `chirpSample` numbers the encoder plays). A complex template gives the envelope of the match, so the chirp is found whatever phase the speaker, room and microphone have rotated it by; a real template scores zero for a chirp 90° out of phase. The FFT size is the next power of two above template length + 0.25 s (32768 at 44.1 and 48 kHz), so a block is about 0.3 s, not the 8192 of the first draft: the template alone is 19,200 samples at 48 kHz. Blocks sit on an absolute grid, so the correlation values do not depend on how the audio was chunked [R4.3].

A sample `n` is a chirp start when all three hold:
1. `|c[n]|` is the largest within ±0.1 s (the first of equals wins).
2. `|c[n]| ≥ 8 ×` the median of `|c|` over ±0.5 s, the 1 s centred on the peak. A ratio, not a level, so it is gain-independent. (A cheap pre-check against the mean, 4×, avoids sorting for ordinary samples.)
3. Normalised correlation `|c[n]| / (‖template‖·‖audio under the template‖) ≥ 0.05`. A real chirp scores about 0.7 clean; a 10 ms burst of noise in silence scores about 0.03. In digital silence the median is 0, so check 2 alone would accept any sharp noise burst; this check is what rejects it (a mutation test confirms it).

A candidate is judged only when 0.5 s of correlation exists beyond it, or at the end of the stream, so the decision depends only on the audio and not on how it arrived. While a pass is being decoded the detector is idle, which saves most of the decode cost; afterwards it resumes after the postamble.

### 2. Fine timing
Search ±10 ms around the predicted sync start in 0.5 ms steps. The score of an offset is the average, over the 8 sync notes, of **expected-tone energy ÷ energy of all 4 tones** (a share, 0..1; random would give 0.25). Choose the offset with the best `score − 0.0005·|offset in ms|`; the small second term only breaks ties towards the chirp's own timing. If the best share is below 0.45, return to SEARCHING without an event; otherwise emit `signal-detected`.

Why a share and not the summed energy of the first draft: the Robust bell envelope makes early windows louder, so summed energy would pull the windows into the guard period. What the share shows (measured with a pass reported 0–10 ms late): a window up to about 2 ms past the symbol edge still scores ≥ 0.998, because the next symbol opens with its quiet 2 ms glide, so alignment settles within +1 ms of the edge; a window reported early stays where it is, since anything up to 8 ms early is still clear of the glide.

### 3. Symbol energies (`demodulate.ts`)
- Skip the guard, then Goertzel for each tone over the analysis window: energy vector `e[0..T−1]`.
- Normalize: `ê = e / Σe` (all zeros if Σe = 0). Passes at different volumes become comparable before combining.
- **Timing tracking [R5.2], as built in task 11.** A receiver clock that is 0.2% off moves symbols by 132 ms over a 66 s pass, several whole symbols; without tracking the decoder failed from ±0.05% (a 33 ms drift), and was only good to about ±0.02%. Two parts, both in `demodulate.ts`:
  - **Early/late gate (`calibrateGate`).** For a symbol whose tone has been decided, measure that tone's energy in one window shifted earlier and one shifted later than the current window. A window that sits late has its late probe slide off the end of the symbol and lose energy; one that sits early loses it at the early probe. So `ln(E_late / E_early)` says how late the window is. The mapping from that ratio to a lateness differs by profile (Standard's energy has a flat top about 5 ms wide with steep sides, Robust's a broad bell with a peak near the start of the symbol), so it is **learned, not assumed**: at construction the gate renders reference symbols with the real modulator (`renderSymbolRun`), measures the decided tone's energy at many shifts, puts each probe where that energy has fallen to 85% of its value at the target position, and tabulates ratio against lateness. It therefore also works for a profile added to the table. A reading is used only when the symbol was decided clearly (confidence ≥ 0.5) and neither neighbour has the same tone, whose energy would leak into a probe and pass for a timing error; the reading for symbol k is taken once symbol k+1 is decided.
  - **Where windows are kept.** The gate's target is 1.5 ms before the nominal alignment (but never into the glide), which puts the window in the middle of its flat top for Standard and clear of the late edge for both. Windows therefore sit about 1.5 ms earlier than the first design had them.
  - **Clock tracker (`ClockTracker`).** An alpha-beta filter on position offset (gain 0.15) and drift per sample (gain 0.012, clamped to ±0.3%). Once the drift is known the windows ride the ramp without further readings, so a steady clock error costs nothing; a dropout simply stops the readings and the ramp continues. It runs through the header (80 Robust symbols, no pilots) and the payload, and the search for the next pass resumes at the end the tracker predicts.
  - **Not built: pilot re-anchoring.** The first design also re-anchored at each pilot by searching ±3 ms. The gate already reads every clearly decided symbol, pilots included, and recovered from the step test (3 ms jump) in a few dozen readings, so the pilot search was not needed for R5.2. Pilots are still used for the alignment rule of task 12.
  - **Measured (task 11).** All R5.2 cells pass: Standard 560 B 10/10, Robust 256 B 6/6, Standard 1024 B 4/4 (both endpoints, both rates). Margin beyond the requirement, a 560/256 B tape with 1 s of silence around it, clean and at the −1 dB / −8 dB noise levels of R5.4/R5.5 (3 seeds): ±0.5% decodes in every trial for both profiles; ±0.7% decodes clean but mostly fails with noise; ±1.0% fails. Disabling the tracker, or flipping the sign of the gate, fails the R5.2 cells and the gate tests.
  - **Known edge.** If a file begins exactly at the first sample of the chirp and the receiver clock is fast, the correlation peak's best position lies before the file starts and the detector can miss it (with noise at the threshold level and +0.2%, none of 12 such tracks decoded, and for the Standard 48 kHz case the chirp detector was confirmed as the stage that failed). Real recordings have lead-in, so the R5.2 cells place the track inside 1 s of silence; a file cut tight at the chirp is a limitation, not a requirement.

### 4. Pass handling and accumulation (`accumulator.ts`) [R6]
- During PAYLOAD, normalized vectors go into a **pending buffer** for the pass, never directly into the accumulator. This makes discarding a pass trivially exact [R6.5, R6.6].
- **Alignment rule [R6.6] (decision S9, 2026-11-24; replaces the fixed 2/T rule).** Two levels:
  - **Pass level.** At pass end, count the pilots read as the pilot tone (a zero-energy window is never a read). Estimate *chance*, how often this pass's noise lands on the pilot tone, from its data positions whose decision was unclear (confidence < 0.5), floored at 1/T, and 1/T when fewer than 32 such decisions exist. Unclear decisions only, because a clearly heard data symbol is on the pilot tone when the message put it there: a letter of repeated characters put 34% of its data symbols on it, against 4% for random text. The pass is aligned iff its pilot reads are a count that chance reaches with probability below 1/1000 (binomial tail). With so few pilots that no count is that unlikely (Standard ≤ 2, Robust ≤ 4), all pilots must be read. Examples at chance 1/16: 5 of 11, 6 of 16, 9 of 40; Robust at 1/4: 7 of 8, 11 of 16.
  - **Run level (gating).** In an aligned pass, the data symbols between two pilots are committed only if either bounding pilot was read; the first and last runs have one bounding pilot. Dropped runs add nothing. This keeps the clean stretches of a partly drowned pass and leaves its noisy stretches out.
  - The old rule accepted noise payloads 9–22% of the time (white) and 56–67% (speech-like), and one accepted noise pass cut two-pass decodes at −11 dB from 10/30 to 2/30 (*Task 14 measurements*).
  - **Cost.** A short ghost (3–4 pilots) that is partly drowned is now discarded, because the pass-level check needs every pilot read. Its passes still combine when each is complete but noisy.
- **Timing tracking ignores absent signal (task 14).** A clock reading is taken only when the symbol's tone level is within 10 dB of the header's. Twenty seconds of loud noise in place of the ghost had walked the clock estimate away, and the clean rest of the pass was then read at the wrong times: a 560 B play whose first 45% was drowned was accepted 2/6 times before this change and 6/6 after.
- **Signal lost.** During PAYLOAD, if the energy over a sliding 400 ms window is more than 30 dB below the header's mean, the pass ends with `signal-lost`. The 400 ms window is wider than the longest allowed dropout (150 ms) [R5.6].
  - **As built (task 13).** "Energy" is the *tone level*: the summed Goertzel energy at the profile's own tones divided by the window length squared (≈ A²/4 for a tone of amplitude A, whatever the window length), averaged over the last ceil(400 / symbolMs) payload symbols and compared with the mean over the 80 header symbols. It stays inside the band the ghost uses without a separate band-pass filter; hum or hiss between the tones barely moves it. By estimate (16 tones × σ²/N for white noise of RMS σ in an N-sample window, against A²/4), white noise at RMS 0.3 sits about 20 dB below a full-level ghost on this measure, so a payload drowned in loud noise is *not* signal-lost (the alignment rule or RS deals with it); silence is. The unit test checks that the discard comes 350–500 ms into the silence, and searching resumes there.
  - A repeat pass of a completed tape can also end with `signal-lost` (instead of `already-received`) when it stops early; the *Events* table did not cover that case.
  - Consequence: a pass with ≥ 400 ms of silence anywhere in its payload is discarded whole, so its evidence before the silence is not combined. Partial passes are combined only when the lost part is noisy, not silent.
- **Commit** (aligned only): add pending vectors into the tapeId's accumulator, creating it if needed. If 4 tapeIds are held, first evict the one with the oldest last activity [R6.9, R6.10]. Eviction happens at commit, not at header time, so a discarded pass leaves every accumulator unchanged.
- **Retention** [R6.8]: each tapeId records last activity (audio time of its last commit or repeat pass). Before each hop, entries older than 600 s of audio time are dropped. `reset()` clears everything [R6.11].
- **Decision**: per symbol `argmax(Σê)`; confidence `1 − second/best` (0 if best = 0). Clarity = mean confidence over payload symbols [R6.7]. `blocksRecovered / blocksTotal` from the RS step.
- **Completed tapes (built in task 12).** A tape that reached `complete` stays in the store, marked complete, under the same retention and eviction rules. A later pass of it is a repeat: at pass end the decoder emits `already-received` and refreshes the tape's activity, without adding energy or emitting `complete` again [R8.17]. This lives here because it is accumulator state; without it every pass of a looped tape would re-emit `complete`.
- **Implemented as** `AccumulatorStore` (`peek`, `held`, `expire`, `commit`, `noteRepeat`, `clear`) plus `isAligned` and `decideFromSums`. `expire` runs at each header; the pass number is the tape's received count + 1; `complete.passesUsed` is the number of passes summed.
- **Measured (task 12, `npm run measure:passes`, Standard 560 B, 48 kHz).** Tapes decoded by pass 1/2/3: −10 dB 0/29/30 of 30; −9 dB 0/10/10 of 10; −8 dB 7/10/10 of 10. No wrong texts. Mean clarity rose each pass (−10 dB: 0.505, 0.611, 0.661).
- Why combining works: the true tone's energy adds up pass after pass while noise spreads across all tones, so the margin between the right tone and the rest grows with each pass (equal-gain energy combining).

### 5. Bytes and verification [R7]
argmax → Gray⁻¹ → bits → bytes → unpermute → deinterleave → RS-decode each block. `complete` only if every block decodes, the trailing CRC-32 equals the CRC of the reassembled P bytes, that CRC equals the header tapeId, and strict deserialization succeeds [R7.2]. Any failure: no `complete`, accumulator kept, keep developing [R7.1, R7.3, R7.4]. RS miscorrection plus a CRC-32 match plus a strict parse is the only path to a wrong `complete`; the probability is below 2⁻³², and P13 checks it empirically.

### 6. Progress and provisional bytes [R8]
- `progress` every 200 ms of audio time from the `header` event until pass end (≤ 250 ms [R8.3]).
  - **As built (task 13).** The cadence is counted in payload symbols, which are fixed points of the stream, so it cannot depend on chunking: after the symbol at which waiting one more symbol would pass 200 ms since the last `progress` (or the header). Standard and Robust symbols divide 200 ms, so the gap is exactly 200 ms of payload time; for an injected profile it is between 200 − symbolMs and 200 ms. None after the last symbol (the pass result follows at once) and none in repeat passes [R8.17]. Measured with 128-sample chunks: header to first `progress` and every gap ≤ 250 ms (P23).
  - Provisional bytes are built by `provisionalBytes` in `frame.ts` from the hard decisions of the summed shares. A symbol "has evidence" when some pass put energy into it, and a byte is shown only when all of its symbols have evidence. Bytes are sorted by position. Every `progress` carries the full current snapshot, not a delta.
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
- **As built (task 15, 2026-11-23).**
  - Files: `file.ts` (decodeAudioFile with an injected context, mixToMono; uploads decode in an `OfflineAudioContext` at 48 kHz so the rate is always inside 16–48 kHz), `mic.ts` (startListening; if the context runs above 48 kHz it is reopened at 48 kHz), `capture.worklet.ts`, `decoder.worker.ts`, `protocol.ts`, `playback.ts` (play once or loop with 1 s gaps, WAV Blob, download).
  - The worklet sends each quantum straight to the worker over a `MessageChannel`, stamped with the audio clock (`currentFrame`). When the clock skips, the worker fills the hole with silence, capped at 5 s, so a lost stretch becomes a dropout and not a time slip. It counts the filled samples.
  - About once per second of audio the worker reports audio heard, input level (dBFS) and filled samples. The harness shows them, so a trial can tell "no signal" from "no audio".
  - Uploads are decoded in the worker. `summarizeEvents` (decoder.ts) gives the same result as `decodeFile` from the events, so the file is decoded once.
  - Phone testing: `npm run dev:phone` serves the harness over HTTPS on the local network (self-signed certificate from `@vitejs/plugin-basic-ssl`; the phone must accept it once). Phone browsers allow the microphone only on HTTPS.
- **Browser smoke test (`npm run smoke:browser`, 2026-11-23).** Headless Chrome on the Developer laptop, the demo tape (509 B Standard, 36.45 s) looped with 1 s gaps as the "microphone", 200 s of listening.
  - Chrome's file-based fake microphone delivered only silence headless, so the script swaps the page's `getUserMedia` for a stream played from the WAV in a second AudioContext. Everything after `getUserMedia` is the real code.
  - Result: the first pass COMPLETE (clarity 0.999–1.000), later passes `already-received`. In the 160–200 s runs, 1 or 2 of 5–6 passes ended `header-invalid`.
  - Pass starts came 37.28–37.47 s apart instead of 37.45 s, while the worklet clock showed at most 11 ms of gaps. So the bridge between the two contexts (separate clocks) dropped audio before the worklet saw it. A slip inside the 4 s header breaks it; the payload survived (RS + tracking). A real microphone whose clock differs from the output's could do the same; task 14 looks at header robustness, and task 16 will show whether phones do this.

## Channel simulator (`channel.ts`, test-only) [R5, R11.3, R11.4]

Seeded PRNG (mulberry32) inside the simulator only; the modem library has no randomness [R11.11]. Same input, parameters and seed → identical output. Each pass in a multi-pass trial gets its own derived seed [R11.12].

| Impairment | Model |
|---|---|
| Gain | Multiply by g, 0.05–2 [R5.1] |
| Surrounding audio | 0–60 s before/after; silence, white noise, music-like chords (3–4 random sines 100–4000 Hz, changing every 300–800 ms), speech-like noise (noise through 3 formant band-passes, 4 Hz syllabic AM). Level = ghost-track RMS [R3.2] |
| White noise | Gaussian noise generated, then measured and rescaled so the in-band SNR is exact (within 0.02 dB at any length and rate), not just right on average |
| Rate mismatch | The receiver's clock runs `ratio` times as fast (0.998–1.002): a windowed-sinc rate change that keeps the nominal rate label, so every pitch shifts by the same percentage and symbols drift in time [R5.2] |
| Telephone band | 2nd-order Butterworth high-pass at 300 Hz followed by a 2nd-order Butterworth low-pass at 3400 Hz (bilinear transform, causal, so it also delays the signal slightly) [R5.3] |
| Reverberation | Unit direct impulse + white-noise tail with amplitude envelope `exp(−6.91·t / RT60)` (−60 dB at RT60), truncated at RT60; tail energy scaled to the DRR. Applied by FFT overlap-add convolution (FFT size = next power of two ≥ 4 × IR length) [R5.7, R11.14] |
| Dropout | One segment ≤ 150 ms inside the payload, zeroed or white noise at 4× signal RMS [R5.6] |
| Rate conversion | Windowed-sinc resampler (Blackman-windowed sinc, cut-off at 90% of the lower Nyquist rate), any pair of rates |

**Combining.** `applyChannel(samples, rate, spec, seed)` applies any subset in the order a signal meets them: reverb, band-pass, gain, dropout, receiver clock, noise, then the audio before and after. Each impairment draws from its own stream, `deriveSeed(seed, tag)`. `damagePasses` applies a spec to every pass with an independent seed (`deriveSeed(seed, pass, index)`) and joins the passes with 1 s of digital silence [R11.12].

**Diagnostics hook.** `createDecoder({ onPassSymbols })` reports each pass's raw hard symbol decisions and confidences. Tests use it to measure symbol error rate against what was sent (the R5.7 table, `npm run measure`); it changes nothing about decoding.

**SNR [Glossary].** Signal and noise powers are each measured by FFT over the whole signal (in 65,536-sample segments, so long tracks stay cheap), summing bins in 300–3400 Hz. The same function serves every sample rate.

### Deep-suite plan [R11.8–R11.10, R11.13]

**Budget.** At most 15,000 s of simulated audio pushed into decoders in `test:deep` [R11.13]. A shared test harness (`tests/support/budget.ts`) adds up every sample pushed, prints the total and each cell's trial count at the end, and fails the suite if the total exceeds 15,000 s. At this size the suite needs ≈ 25× real time overall (≈ 3× per core on 8 performance cores), so it does not depend on heavy optimization.

Track lengths used below (one pass): Standard 560 B = 39.1 s; Robust 256 B = 71.9 s; Standard 1024 B = 66.4 s; 60 B ghost = 10.0 s Standard, 24.9 s Robust.

| Block | Cells and trials | Simulated audio |
|---|---|---|
| R5.1–5.6 single impairments | 6 criteria × Standard 10 trials (560 B) + 6 × Robust 6 trials (256 B), half per rate [R5.8–5.10] | 2,346 + 2,588 = 4,934 s |
| R5.7 reverb table | RT60 {50, 100, 150, 200, 300} ms, DRR 0 dB, 2 trials (one per rate) per RT60 per profile; logged, not asserted | 391 + 719 = 1,110 s |
| R5.11 realistic room | Standard 10, Robust 6, half per rate | 391 + 431 = 822 s |
| R6.3 / R6.4 multi-pass, regression cell | Standard, 560 B tape, −9 dB, 3 passes + 2 × 1 s gaps ≈ 119 s per seed, 6 seeds. The full experiment (30 seeds at −10 dB, 10 each at −9 and −8 dB, 5 passes, ≈ 9,970 s) runs as `npm run measure:passes`, outside the cap (S7, S8) | 715 s (measured) |
| R3.2 surrounding audio | 4 types × 3 trials, 60 B ghost: Standard with 60 s before and after; Standard with seeded 0–60 s each side; Robust with seeded 0–60 s each side (expected totals) | ≈ 1,140 s |
| R5.2 at maximum size | Standard 1024 B at −0.2% and +0.2%, both rates (Robust 256 B is already in the R5 block) | 266 s |
| Other properties | P13 rate sweep 350, P14 loop 210, P15b 192, P16 chunking ≈ 600 (10 runs of a 55 s stream; 20 runs measured 1,151 s), P17 fuzz 34, P20 210, P21 334, P22 ≈ 690 (one 601 s idle run + eviction run), P23 458, R8.16 through the decoder 234, P24 20, R4.4 benchmark 66 (measured, task 13) | ≈ 3,400 s |
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

**R6.3 / R6.4 method.** For each seed, render 5 passes of a 560 B tape with independent noise (`damagePasses`) and feed them to one decoder. Success at N = a `complete` by the end of pass N. Because the decoder is causal and `complete` is sticky while retained, this makes R6.3's monotonicity hold by construction, so the real content of the experiment is R6.4 (at −10 dB with 30 seeds: 3-pass successes ≥ 1-pass successes + 6) and the clarity-per-pass curve. P15b checks on 3 seeds that a fresh decoder fed passes 1..N (N = 2, 4) gives the same result as the prefix of the long run; that is a small sample, and it relies on the hop-based processing that P16 tests more thoroughly. The report states seed counts and raw counts, not percentages alone.

**Where it runs (S7, S8).** The full experiment is `npm run measure:passes`: 30 seeds at −10 dB and 10 each at −9 and −8 dB, 5 passes each, printed with the counts and the clarity per pass, logged in `KIRO_LOG.md`, and saved as `docs/passes-results.csv` (plus `.json` and an SVG chart). It is outside the deep suite and its 15,000 s cap, like `npm run measure`. The deep suite keeps a small regression cell (6 seeds at −9 dB, 3 passes; 2 seeds in the fast suite) that must show success counts never falling with more passes and 3 passes decoding at least ceil(0.2 × seeds) more tapes than 1 pass. That cell guards against regressions; the statistical claim of R6.4 rests on the script's counts.

| Item | Value |
|---|---|
| R5.11 realistic room (provisional) | gain 0.3, telephone band-pass, RT60 100 ms at DRR 3 dB, white noise 3 dB above the single-pass threshold: Standard −1 dB (R5.4 −4 dB + 3, after S8), Robust −5 dB (the room costs some margin; the old 18 dB and 9 dB were set from the placeholders). Fixed in task 14 from data |
| R6.3 SNR levels | −8, −9, −10 dB in-band, Standard, 560 B typical tape (decisions S7, S8; single-pass success after tracking 9/12 at −8 dB and 0/12 at −10 dB in `npm run measure`) |
| Short tape for other deep tests | 60 B ghost (58-character message) |
| `npm test` (fast) | Each R5 criterion once per profile at 48 kHz with the 60 B ghost; fast properties with ≤ 50 cases; `tsc --noEmit`; under 60 s [R11.8] |

**Measurement sweeps** (single-pass success and symbol error rate vs. SNR per profile, used by task 14 to set thresholds) run as `npm run measure`, outside the deep suite and its cap. Each sweep's trial counts are logged with its results.

**Measured so far (task 9):** `npm test` takes 16 s; `npm run test:deep` takes 16 s and has pushed 1,017 s of simulated audio into decoders (P13 about 485 s over its three cells, including the exactly-256 B Robust and exactly-1024 B Standard tapes; P14 127 s; P24 33 s; decoder unit tests 372 s). P13 already uses more than the 350 s the plan gave it; the 1,700 s of headroom absorbs that. Re-check the total at task 14.

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
1. Single-pass SNR thresholds per profile (replace the R5.4/5.5 placeholders and the R6.3 levels). **Measured in task 10, see "Week-1 measurements" below; the requirement edits were made on 2026-11-12 (S5, S7).**
2. Reverb tolerance vs. guard length (R5.7 table) and the realistic-room parameters (R5.11). **Reverb measured in task 10: Standard fails from RT60 150 ms at DRR 0 dB, Robust does not. Decided 2026-11-12 (S6): no profile change yet. Task 14 adds a simulator comparison of guard and symbol-length variants (for example 10 ms guard, 30 ms symbols) alongside the sound options of question 5, reporting symbol error rate against RT60; the final choice comes from the real-room trials of task 16. R5.11 parameters are still to fix in task 14.**
3. Do 16 tones at 100 Hz spacing survive real phone speakers (R10.1)?
4. Is the musical payload profile within 2 dB of Standard (cut list)?
5. **Soften the payload sound (week 2).** Listening check of `demo/ghost-tape-demo.wav` (2026-11-12): the overture sounds good and stays as it is; the Standard payload (1500–3000 Hz) sounds too high-pitched and a bit harsh over about 30 s. The sound is **not changed now**. Compare these candidates, decide in task 17:
   - **(a) Payload level a few dB below the overture.** The overture and chirps keep the 0.8 peak; only payload symbols are scaled (R1.8 unaffected). Receiver decisions compare energies, so level does not matter to the decoder, only to SNR against room noise: compare at equal absolute noise, not at equal SNR, because the simulator's SNR target is relative to the signal and would hide the loss.
   - **(b) Shift the Standard band down**, e.g. 800 + 100·k Hz, k = 0…15 (800–2300 Hz, on the same 50 Hz grid, inside the 300–3400 Hz phone band). Needs a change to R9.3 and the Profiles table. Risk to check: small phone speakers roll off below about 800 Hz, and the band now overlaps the Robust overture tones (1175–2350 Hz).
   - **(c) The musical payload profile (task 18):** 8 pentatonic tones, 3 bits/symbol, 25 ms. Raw rate falls from 160 to 120 bit/s, so the typical tape grows from about 39 s to about 50 s. Task 18's keep-if-within-2-dB rule was written for robustness only; if comfort is the reason to adopt it, that rule needs revisiting.
   - **How to compare:** simulator single-pass threshold per candidate from `npm run measure` (task 10) at equal absolute noise; real-room success counts (task 16); and the developer's listening at the same playback volume over a full-length tape.

## Week-1 measurements (task 10)

Source: `npm run measure` (single pass, white noise, 12 trials per level, half at 44.1 kHz and half at 48 kHz, a different seeded tape every trial, no wrong decodes in any trial) and the deep suite's R5.7 cells. SNR is the in-band SNR of the Glossary (300–3400 Hz). Every cell is a count over a small fixed seed set, so "12/12" supports a success rate above 78% at 95% confidence, not "always".

### Single-pass SNR thresholds

| SNR (dB) | Standard, 560 B: decoded | Standard symbol errors | | SNR (dB) | Robust, 256 B: decoded | Robust symbol errors |
|---|---|---|---|---|---|---|
| 0 | 12/12 | 0.01% | | −3 | 12/12 | 0.00% |
| −2 | 12/12 | 0.10% | | −6 | 12/12 | 0.00% |
| −3 | 12/12 | 0.40% | | −8 | 12/12 | 0.01% |
| −4 | 12/12 | 0.58% | | −9 | 12/12 | 0.05% |
| −5 | 9/12 | 2.0% | | −10 | 12/12 | 0.28% |
| −6 | 8/12 | 1.9% | | −11 | 12/12 | 0.95% |
| −7 | 3/12 | 8.0% | | −12 | 4/12 | 2.7% |
| −8 | 2/12 | 12.5% | | −13 | 0/12 | 5.6% |
| −10 | 0/12 | 27% | | −15 | 0/12 | pass not found |
| −12 | 0/12 (pass found 3/12) | 45% | | −18 | 0/12 | pass not found |
| −14 | 0/12 (pass found 0/12) | none found | | | | |

- Standard decodes every trial down to −4 dB and falls through −5…−8 dB; Robust decodes every trial down to −11 dB and fails from −12 dB. The two profiles are about 7 dB apart.
- Past the decoding threshold the pass is still *found* (chirp and sync detected): Standard in 12/12 trials down to −10 dB (6 dB beyond its last all-decode level), Robust in 9/12 at −13 dB (2 dB beyond), and neither at −14 / −15 dB. Missing the pass is therefore not what limits either profile; error correction is.
- The placeholder targets in R5.4 (15 dB, Standard) and R5.5 (6 dB, Robust) sit 19 and 17 dB above the last all-decode level (−4 dB and −11 dB). Those cells pass with a very wide margin, so as written they test almost nothing. **Decided 2026-11-12 (S5, S7) and applied to the requirements:** R5.4 and R5.5 test at 3 dB above the all-decode level (Standard −1 dB, Robust −8 dB), and the three R6.3 levels (Standard, 560 B tapes) sit in the transition, where one pass is unreliable and more passes can help: −5, −6 and −7 dB (single-pass success 9/12, 8/12, 3/12). The R5.11 and R5.7 parameters are still open (task 14).

### Reverberation (R5.7), DRR 0 dB, one tape per rate in each cell

| RT60 | Standard decoded | Standard symbol errors | Robust decoded | Robust symbol errors |
|---|---|---|---|---|
| 50 ms | 2/2 | 0 / 2722 | 2/2 | 0 / 2672 |
| 100 ms | 2/2 | 9 / 2722 (0.3%) | 2/2 | 4 / 2672 (0.1%) |
| 150 ms | 0/2 | 380 / 2722 (14.0%) | 2/2 | 0 / 2672 |
| 200 ms | 1/2 | 257 / 2722 (9.4%) | 2/2 | 0 / 2672 |
| 300 ms | 0/2 | 168 / 2722 (6.2%) | 2/2 | 0 / 2672 |

- With only 2 trials per cell the decode counts are anecdotal; the symbol error rate over about 2,700 symbols is the informative number. Standard's rate is not monotonic in RT60 because DRR is held at 0 dB: a longer decay spreads the same echo energy over more time, so the echo is weaker at any one moment.
- R5.7's targets were Standard RT60 ≤ 150 ms and Robust ≤ 300 ms. Robust meets its target with zero symbol errors. **Standard meets only RT60 ≤ 100 ms at DRR 0 dB.** The echo of one 25 ms symbol (5 ms guard) lands in the next symbol's analysis window.
- **Decided 2026-11-12 (S6): no change to the profile yet.** R5.7's 150 ms target now applies to Robust only; Standard is pending. The candidates: (a) lengthen the Standard guard (a shorter analysis window, so the tones must move to a coarser grid), (b) lengthen the Standard symbol, (c) keep Standard as is and tell the sender to choose Robust for echoey spaces, a static recommendation in the future UI spec, or (d) combine with open question 5, since moving the band changes how much room echo there is. Task 14 compares variants such as a 10 ms guard and 30 ms symbols in the simulator, next to the question-5 sound options, as symbol error rate against RT60; the final choice comes from the real-room trials of task 16. DRR 0 dB is a hard room; real rooms at 1–3 m are often better, which the task 16 measurements will show.

### Re-measured after timing tracking (task 12, 2026-11-19)

Single pass, `npm run measure`, 12 trials per level, same method and seeds as above:

| SNR (dB) | Standard, 560 B: decoded | Standard SER | | SNR (dB) | Robust, 256 B: decoded | Robust SER |
|---|---|---|---|---|---|---|
| −4 | 12/12 | 0.00% | | −10 | 12/12 | 0.44% |
| −5 | 12/12 | 0.01% | | −11 | 12/12 | 1.48% |
| −6 | 12/12 | 0.21% | | −12 | 0/12 | 3.65% |
| −7 | 12/12 | 0.75% | | −13 | 0/12 | 13.3% |
| −8 | 9/12 | 2.77% | | | | |
| −10 | 0/12 | 12.6% | | | | |

- Standard's all-decode level moved from −4 dB to −7 dB; Robust's stayed at −11 dB. Decision S8 applies this.
- **Where the gain came from (quick sweep, 4 trials per level).** Task 10 code: all decode down to −4 dB. Current code with the clock tracker's correction removed (gate target shift kept): all decode only down to −2 dB, with symbol errors even at 0 dB. Current code: −7 dB. So the tracker's corrections give the gain; the gain appears even with no clock error in the channel. A likely reason, not verified: fine timing from the chirp is off by a fraction of a millisecond under noise, and the tracker removes that offset over the pass. Robust was −11 dB in all three variants.
- **Reverb table, deep suite, current code** (2 trials per cell): Standard decoded 2, 2, 0, 1, 0 of 2 at RT60 50, 100, 150, 200, 300 ms (SER 0, 0.6, 16.1, 6.2, 5.1%); Robust 2, 1, 2, 2, 2 (SER 0, 0, 0.9, 0, 0.04%). The Robust miss at 100 ms is a header that failed at 44.1 kHz; the task-10 code decoded that trial.
- **Reverb probe, 16 trials per cell, DRR 0 dB** (not part of the suite): Robust decoded 13, 14, 11 of 16 at RT60 100, 150, 200 ms with the current code and 14, 15, 12 with the task-10 code; Standard 10, 1, 3 now and 11, 2, 1 then. Tracking does not change reverb tolerance by much. **But Robust does not decode every trial in reverb at DRR 0 dB**: 1–4 of 16 trials per cell lose the header. The 2-trial table above hid this. For the task 14 comparison.

### Streaming (task 13, 2026-11-19)

- **R4.4.** 1024 B Standard tape (66.4 s of audio) streamed in 128-sample chunks: 0.26 s from the first `push` to the `flush` return, 0.004× the audio duration (limit 0.2×). One run inside the deep suite; the machine was heavily loaded at the time (load average above 200), so this is not a best case.
- **Chunking bug found by P16.** With 1001-sample chunks (the shrunk counterexample) the events differed from one whole-stream push in the fifth decimal of provisional confidences. Cause: the buffer kept 40 ms before the next window, but the clock tracker's early probe for the previous symbol reaches one symbol plus up to 18 ms back. Chunked runs had already dropped that audio and skipped the reading; whole-stream runs had not. Present since task 11. Fixed by keeping one more symbol; `npm run measure:passes` gave the same counts before and after.

### Task 14 measurements (2026-11-23): reverberation, the header, the alignment rule

Scripts outside the deep suite: `npm run measure:reverb` (parts `--part=table`, `--part=header`) and `npm run measure:alignment`. All channels are the simulator's; DRR 0 dB is a hard room. No profile, sound or protocol change came from these runs; the variants below were temporary edits, reverted.

**1. Decode outcome under reverberation** (DRR 0 dB, 40 trials per cell, half at each rate, 1 s lead-in; no wrong texts in any cell):

| tape | RT60 | decoded | no signal | header invalid | payload failed | payload SER |
|---|---|---|---|---|---|---|
| Robust 256 B | 100 ms | 36/40 | 0 | 1 | 3 | 0.4% |
| Robust 256 B | 200 ms | 29/40 | 0 | 7 | 4 | 1.6% |
| Robust 256 B | 300 ms | 20/40 | 0 | 11 | 9 | 2.7% |
| Standard 560 B | 100 ms | 23/40 | 0 | 2 | 15 | 3.1% |
| Standard 560 B | 200 ms | 9/40 | 0 | 5 | 26 | 12.0% |
| Standard 560 B | 300 ms | 5/40 | 0 | 13 | 22 | 13.8% |

R5.7's Robust target (RT60 ≤ 300 ms) is **not met at DRR 0 dB**: 20/40 at 300 ms. Chirp and sync were never missed; failures split between the header and the payload.

**2. Why headers fail.** 100 trials per cell with a 60 B ghost (the header is the same 80 Robust symbols whatever the payload). Valid headers: no reverb 100/100; RT60 100 / 200 / 300 ms: **96 / 84 / 70**.
- **Cause: frequency-selective fading.** Convolving a tone with the random reverb tail gives every frequency its own random gain; at DRR 0 dB the reverberant part can nearly cancel the direct part at one of the four Robust tones. In headers with more than 4 wrong bytes, 74–88% of the symbol errors are on one sent tone, which carries 26–29% of the symbols. Errors therefore cluster in some rooms (seeds) and are rare in others.
- Not the cause: the fine-timing offset (window offsets of −10…+10 ms occur in both good and bad headers, with no clear link to errors). Timing tracking inside the header costs a little under reverb: in 40-trial runs, valid headers were 40, 34, 30 of 40 with header tracking switched off against 38, 32, 27 with it (RT60 100 / 200 / 300 ms).
- **Variants, same 100 trials and seeds:**

| variant | airtime cost per pass | valid headers at RT60 100 / 200 / 300 ms |
|---|---|---|
| current (12 + 8 RS bytes) | — | 96 / 84 / 70 |
| 16 parity bytes (12 + 16) | +1.6 s (32 Robust symbols) | 95 / 88 / 77 |
| Robust symbols 70 ms with a 30 ms guard (same cost in the header; Robust payloads +40%) | +1.6 s | 92 / 81 / 62 |
| per-tone equalization from the 8 sync symbols (each tone sent twice), decoder only | 0 s | 94 / 87 / 78 |
| equalization + 16 parity bytes | +1.6 s | 95 / 86 / 83 |

  Doubling the parity buys 4–7 headers in 100 at 200–300 ms and nothing at 100 ms, for 1.6 s on every pass: failing headers have 10–20 wrong bytes out of 28, far beyond any parity budget, because a faded tone damages a quarter of the symbols. A longer guard is worse (the echo is not what breaks the header). Equalization gives a similar gain for free, but two sync symbols per tone are a noisy gain estimate and it lost 2 headers at 100 ms.
- **Proposals (not built).** (a) Equalization with a better estimate: decision-directed per-tone gains updated over the header, and for the payload from all decided symbols. Decoder-only and free. (b) Frequency diversity in the header: send each header symbol's information on tones far apart, so that one faded tone cannot take out a quarter of the symbols; this is a protocol change. (c) For Robust payloads, the same fading explains the 3–9 payload failures per 40. Which to pursue depends on whether real rooms fade like this simulator; task 16 should log per-tone levels.

**3. The alignment rule (R6.6) and noise passes.** A pass with a real header whose payload is replaced by noise at the signal's RMS, 300 trials per row:

| payload (pilots) | noise | accepted now | if noise were uniform | fixed tighter rule (pure-noise tail < 1/1000) | adaptive rule |
|---|---|---|---|---|---|
| 140 B (11) | white | 67/300 | 14.8% | 0/300 | 0/300 |
| 140 B (11) | speech-like | 168/300 | 14.8% | 7/300 | 0/300 |
| 251 B (20) | white | 57/300 | 12.6% | 0/300 | 0/300 |
| 251 B (20) | speech-like | 192/300 | 12.6% | 6/300 | 0/300 |
| 540 B (40) | white | 28/300 | 10.2% | 1/300 | 1/300 |
| 540 B (40) | speech-like | 202/300 | 10.2% | 39/300 | 0/300 |

- Speech-like noise is accepted far more often than the 1/16-per-pilot model predicts: colored noise favors some tones, and the rule assumes every tone is equally likely.
- **Harm, measured** (140 B ghost, two real passes with independent white noise, with or without one accepted noise pass between them; 30 seeds): at −11 dB two real passes decode 10/30, with the noise pass **2/30**; at −10 dB 28/30 either way, but mean clarity drops from 0.615 to 0.505. So accepted noise passes measurably slow development.
- **Proposed rule (adaptive).** Estimate how often this pass reads the pilot tone where no pilot was sent (its data positions), floored at 1/T; the pass is aligned if its pilot reads are a count that this chance rate reaches with probability below 1/1000 (binomial tail). Real weak passes it would have rejected: 0/57 at −10 dB, 0/40 at −11 dB, 2/12 at −12 dB (the fixed tighter rule rejects the same). It needs only the pass's own decisions. **Adopted with run-level gating as S9** (see *Pass handling*); built results below.

**4. As built (S9, option B), same scripts, 2026-11-24.**
- **Noise payloads accepted by the decoder** (300 trials per row): 140 B white 1/300, speech-like 1/300; 251 B white 0/300, speech-like 1/300; 540 B white 0/300, speech-like 0/300. Before S9: 9–22% (white) and 56–67% (speech-like). In the rare accepted cases gating committed 75–82% of the noise pass's symbols: noise that gets past the pass-level check reads many pilots, so gating does not remove much of it.
- **Two noisy real passes, 140 B ghost** (30 seeds): decoded after two passes 27/30 at −10 dB (28/30 before S9), 8/30 at −11 dB (10/30 before), 0/30 at −12 dB. A noise pass the decoder accepts turned up in only 1 of 30 seeds (20 tries each) at every level.
- **Partly drowned plays** (play 1 loses the first 45% of its payload to loud noise, play 2 the last 45%; 30 seeds): 140 B ghost decoded 30/30 and 560 B tape 30/30 (each play accepted 30/30). A 30 B ghost (4 pilots) decoded 1/30: its second play was accepted 2/30, because the pass-level check needs all 4 pilots read. Before the tracking fix (*Pass handling*), the 560 B play whose noise came first was accepted 2/6 in a quick run.
- **Multi-pass cells** (`npm run measure:passes`, 560 B Standard, 5 passes): decoded by pass 1/2/3: −10 dB 0/25/30 of 30 (0/29/30 before S9), −9 dB 0/10/10 of 10, −8 dB 7/10/10 of 10; no wrong texts. R6.4 still holds (gain 30 of 30 at −10 dB). At −10 dB gating costs a few tapes a third pass: a clean run is dropped when both its pilots are misread, which at this noise level happens often enough to matter.
- **Suites:** 561 fast tests, 568 deep tests pass; deep suite 101 s and 12,537 s of simulated audio.

### Task 16: real-room results (developer's trials)

Setup: iPhone plays the ghost track from the Files app; MacBook listens on the dev page (`/?dev`); quiet dorm room, no other sounds. One tape throughout: `743b64c6`, Standard, 119 B (one RS block). Counts are from the developer's dev-page logs (UTC).

| Test | Distance, volume | Code | Plays (passes detected) | Headers valid | Decoded | Clarity |
|---|---|---|---|---|---|---|
| 1 | 30 cm, 70% | before S9 | 10 (10) | 10/10 | 8/10 on pass 1 | decoded 0.903–0.988; the two failures 0.851 and 0.888 (0/1 blocks) |
| 2 | 1 m, 70% and 100% | after S9 | 5 listening sessions (8) | 2/8 | 1 | the decode 0.954; the other valid header's payload failed at 0.491 |

- Runs at 1 m on 2026-11-24, 22:48–22:52 UTC, are excluded: they ran while the decoder was being edited, and three of them logged a header with no pass result (see below).
- At 1 m, 6 of 8 detected passes failed with `header-invalid` while the chirp and sync were found every time. That is the pattern the simulator showed under reverberation (*Task 14 measurements* §2), but these logs cannot say whether a tone faded: they have no per-tone levels. The recordings below will.
- At 30 cm the header never failed, but 2 of 10 payloads did (one RS block; clarity 0.85–0.89 still left more than 16 byte errors).
- **Missing pass results in the 22:48–22:49 logs.** Found a real bug: `stop()` sent `flush` to the worker on its main port, waited a fixed 300 ms and terminated it. Frames still queued on the audio channel were lost, and with them the pass's end; the decoder worker falls behind when the laptop is busy (my measurement runs had the load average above 100 that evening). Fixed 2026-11-25: the worklet now sends an end marker on the audio channel itself, behind its last frame; the worker flushes when it arrives and replies `flushed`; `stop()` waits for that (at most 5 s, and says so in the log if it times out). Checked in headless Chrome: stopping mid-pass now logs the pass's `signal-lost`.
- **Tools for the next trials (2026-11-25).** The dev page can record exactly what the decoder receives ("Record raw audio while listening", saved as WAV on Stop); recordings go to `tests/fixtures/real-room/` with a `manifest.json`; `npm run measure:fixtures` decodes each with and without per-tone equalization and prints the per-tone levels at the sync notes.
- **Per-tone equalization (built, off by default).** Decoder option `equalize`: the header's tone gains are estimated from the sync notes and refined from clearly decided header symbols; each payload's from its clearly decided symbols; the gains are divided out before deciding. On a perfect channel it changes nothing (tested). Risk, from the toy model in the tests: boosting a faded tone also boosts that tone's echo, which can then win the next symbol; whether a real room's echo of a faded tone is itself faded decides whether equalization helps. Evaluate on the recordings before turning it on.
- **Equalization in the simulator (2026-11-25, same seeds as *Task 14 measurements*, DRR 0 dB).** Valid headers in 100: 95 / 86 / 79 at RT60 100 / 200 / 300 ms (without: 96 / 84 / 70). Decoded in 40, RT60 100 / 200 / 300 ms: Robust 256 B 37 / 31 / 24 (without: 36 / 29 / 20), its payload failures 1 / 3 / 3 (without: 3 / 4 / 9); Standard 560 B 27 / 13 / 7 (without: 23 / 9 / 5). No wrong texts. A modest gain, mostly in payloads; it does not close the gap the 1 m trials show (2 valid headers in 8). If the recordings agree, the next step is a protocol change (task 16 plan, item 4).

### Decoder speed and test cost

- Offline decode of a clean maximum-size pass in Node on the Developer laptop: Standard 1024 B (66.2 s of audio) in 0.57 s, Robust 256 B (71.8 s) in 0.58 s: about 117–124× real time, 0.008–0.009 of the audio duration. R4.4 asks for ≤ 0.2× with 128-sample chunks; that is checked in task 13.
- `npm test` 17 s, `npm run test:deep` 103 s, and the deep suite has pushed 7,453 s of simulated audio into decoders (cap 15,000 s). Left in the plan: R5.2 at 266 s (task 11), the R6.3 regression cell at about 714 s (task 12), and R5.11 at 822 s (task 14); the full R6.3/R6.4 experiment runs outside the cap (S7). That totals about 9,255 s of the 15,000 s.
