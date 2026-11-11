# Implementation Plan: Acoustic Modem

Matches `requirements.md` (approved) and `design.md`. Ordered so everything is testable before a microphone is involved.

- **Week 1 (tasks 0–10):** tape → samples → tape through the channel simulator, single pass, both profiles, both sample rates. Ends with the first simulator thresholds.
- **Week 2 (tasks 11–17):** timing tracking, multi-pass accumulator, streaming decoder, browser adapters, thresholds fixed in the spec, real-world measurements.
- Items marked `*` are optional/cut-list items (see `steering/product.md` and Requirement 10.4).
- Every modem task is done only when its property tests pass (`steering/tech.md`).

- [x] 0. Lock in the approved permutation rule (design S1)
  - Make the approved R8.11 rule the default mode of `scripts/check-scramble.mjs` (keep the old rule behind a flag for the write-up).
  - Run it and confirm: a candidate a exists for every valid P and profile; 8.12, 8.13 and 8.16 report 0 failures.
  - Record the result (and the 16 lengths whose a changed) in `KIRO_LOG.md`.
  - _Requirements: 8.11–8.13, 8.16_

- [x] 1. Project scaffold
  - Vite + TypeScript strict, Vitest, fast-check; scripts `npm test` (unit + fast properties + `tsc --noEmit`) and `npm run test:deep`.
  - `README.md`; folder tree per `steering/structure.md`; `src/modem/types.ts` with the public types.
  - Node-only import test: loading `src/modem/index.ts` touches no browser globals; no runtime module imports `channel.ts`.
  - `tests/support/budget.ts`: counts simulated audio pushed in `test:deep`, prints the total and per-cell trial counts, fails above 15,000 s.
  - _Requirements: 11.1, 11.2, 11.11, 11.13_

- [x] 2. Bits and Gray code (`bits.ts`)
  - bytes ↔ bits ↔ symbols for 2/3/4 bits per symbol; Gray encode/decode.
  - P1, P2.
  - _Requirements: 11.5_

- [x] 3. CRC-32 (`crc32.ts`)
  - P3 (known answer 0xCBF43926, single-bit flips).
  - _Requirements: 7.2, 11.5_

- [x] 4. Reed–Solomon over GF(2⁸) (`reedSolomon.ts`)
  - Hand-written, systematic, shortened codes: header RS(20,12), payload k + 32 with k ≤ 223.
  - P4, P5.
  - _Requirements: 7.1, 7.5, 11.5_

- [x] 5. Pad, interleave and permute (`interleave.ts`) — after task 0
  - `padAndSplit` / `joinAndTrim`, `interleave` / `deinterleave`, `chooseMultiplier` (approved R8.11 search), `permute` / `unpermute`; permutation also for B = 1.
  - P6, P7, P8 (exhaustive), P9 (exhaustive over every valid P and profile).
  - _Requirements: 8.10–8.16_

- [x] 6. Tape format (`tape.ts`)
  - Charset, validation with field-named reasons, size caps, serialize, strict deserialize (never throws).
  - P10, P11.
  - _Requirements: 1.2, 1.3, 2.1, 2.3–2.9, 7.4_

- [ ] 7. Profiles and frame (`profiles.ts`, `frame.ts`)
  - Profile table as data with optional injection; header build/parse; payload symbols with pilots; frame layout with sample-exact starts.
  - P12. Unit tests: tone tables, all tones 300–3200 Hz, sync/header always Robust.
  - _Requirements: 9.1–9.5, 9.8, 1.13_

- [ ] 8. Modulator (`modulate.ts`)
  - Continuous phase, bell envelope, chirps 1000↔3200 Hz, fades, peak 0.8, loop mode with 1 s gaps, `encodePayload` with exact duration.
  - Unit tests: splatter > 4 kHz ≥ 40 dB down at symbol boundaries; peak in [0.5, 0.9]; envelope 0.6→1.0→0.6; symbol starts within 1 sample at 44100 and 48000; all energy in 300–3400 Hz; loop = N passes + exact gaps.
  - `src/audio/wav.ts` `encodeWav` / `decodeWav` with a round-trip test.
  - Listen to the overture; log first impressions in `KIRO_LOG.md`.
  - _Requirements: 1.1, 1.3, 1.6–1.9, 1.11–1.15, 9.4, 9.5_

- [ ] 9. Single-pass decoder (`sync.ts`, `demodulate.ts`, `decoder.ts`)
  - Chirp matched filter, fine timing, header, Goertzel + normalization, verification chain, `decodeFile` for one pass; hop-based processing so chunking invariance holds from the start.
  - P13 (perfect channel, decode rates 16000–48000), P14 (cut single pass from a loop), P24 (injected profile). Unit test for `"no signal found"`.
  - _Requirements: 1.10, 3.1, 3.3, 3.5, 3.6, 7.2, 9.6, 9.7_

- [ ] 10. Channel simulator (`channel.ts`) and damaged-channel tests
  - All impairments from design; seeded; in-band SNR function; reverb by FFT overlap-add convolution; independent seeds per pass.
  - P15 cells for R5.1, 5.3–5.6 and R3.2 (surrounding audio) with the trial counts in the design's *Deep-suite plan*; P18.
  - Produce the R5.7 reverb table (trial counts, exact decodes, symbol error rate with symbol counts).
  - `npm run measure`: single-pass success and symbol error rate vs. SNR per profile (outside the deep-suite cap); log results with trial counts in `KIRO_LOG.md`.
  - Measure decoder speed (× real time) and the deep-suite audio total so far.
  - _Requirements: 3.2, 5.1, 5.3–5.10, 7.9, 11.3, 11.4, 11.12–11.14_

- [ ] 11. Timing tracking (`demodulate.ts` `SymbolTracker`)
  - Early–late gate + pilot re-anchoring; P15 cells for R5.2 (±0.2%) with typical and maximum-size tapes; rate-conversion cases.
  - _Requirements: 5.2_

- [ ] 12. Multi-pass accumulator (`accumulator.ts`)
  - Pending buffer per pass, alignment rule, commit, ≤ 4 tapeIds, eviction at commit, 10 min audio-time retention, `reset`, clarity and block fraction.
  - `decodeFile` combines all passes in a file.
  - P15b, P19, P20, P22. Chart success rate vs. SNR for 1–5 passes; save to `docs/` for the write-up.
  - _Requirements: 3.4, 6.1–6.11_

- [ ] 13. Streaming decoder events (`createDecoder`)
  - `push` / `flush` / `reset`; full event grammar including `already-received`; progress every 200 ms of audio from accumulator + pending; provisional bytes at final positions; signal-lost detection.
  - P16, P17, P21, P23. Type-level test: provisional entry not assignable to `Payload`. R4.4 benchmark (1024 B Standard, 128-sample chunks, ≤ 0.2× audio duration).
  - _Requirements: 4.2–4.7, 7.1–7.8, 8.1–8.9, 8.17, 11.6, 11.7_

- [ ] 14. Fix thresholds in the spec from simulator data
  - Replace the R5.4/R5.5 placeholders with measured single-pass thresholds; fix R5.11 realistic-room parameters and R6.3 SNR levels; decide whether R5.7 becomes pass/fail or changes the guard.
  - Check `npm test` ≤ 60 s, `npm run test:deep` ≤ 10 min and deep-suite simulated audio ≤ 15,000 s on the Developer laptop; if over, cut trials and update the design's confidence-bound table to match.
  - Update `requirements.md` and `design.md` with the developer; log the change.
  - _Requirements: 5.4, 5.5, 5.7, 5.11, 6.3, 6.4, 11.8–11.10, 11.13_

- [ ] 15. Browser adapters (`src/audio/`) and dev harness (`src/ui/dev.ts`)
  - File upload via `decodeAudioData`, mono averaging, unreadable-file failure; mic with processing disabled; AudioWorklet → Worker → decoder; playback including loop; WAV export.
  - Dev harness: build a tape, live duration on every edit/profile change, play, loop, export, upload, listen.
  - Manual check on the Test phone (Safari): real-time streaming decode, result logged.
  - _Requirements: 1.4–1.6, 3.7–3.10, 4.1, 4.8_

- [ ] 16. Real-world measurements (manual, logged)
  - Phone → laptop, Standard: quiet and noisy room, 10 trials each, both devices in airplane mode.
  - Phone call, Standard, 5 trials: two phone models and speaker-to-mic distance recorded.
  - Looping ghost broadcast at 3 m, 5 runs: passes needed.
  - Every trial uses the full R10.5 record; failures stay in the log.
  - _Requirements: 10.1–10.3, 10.5–10.7_

- [ ] 17. Update design from measurements
  - Answer design questions 3 (16 tones on phone speakers) from task 16 data; record any profile change as a spec change with the developer.
  - _Requirements: 9.1, 10.1_

- [ ]* 18. Musical payload profile experiment (8-tone pentatonic) — keep only if within 2 dB of Standard
  - _Requirements: 9.7, 9.8_

- [ ]* 19. Voice-message codecs and compressed uploads
  - `ffmpeg` fixtures: Opus 16/24/32 kbps, AAC 64 kbps; MP3/M4A uploads; measure both profiles; log codec, bitrate, producing app.
  - _Requirements: 10.4_

- [ ]* 20. Errors-and-erasures RS using symbol confidence
  - _Requirements: 6.3, 7.1_

- [ ]* 21. Pixel doodle in the tape format
  - _Requirements: 2.2, 2.6_
