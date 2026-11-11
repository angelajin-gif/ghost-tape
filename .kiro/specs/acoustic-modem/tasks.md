# Implementation Plan: Acoustic Modem

Ordered so everything is testable before the microphone is involved.
- **Week 1 goal:** tasks 1–10 green (tape → WAV → tape through the channel simulator).
- **Week 2 goal:** tasks 11–15 (drift, multi-pass, streaming, browser adapters, real-world measurements).

Items marked `*` are on the cut list (see `steering/product.md`).

- [ ] 1. Project scaffold
  - Vite + TypeScript strict, Vitest, fast-check; `npm test`, `npm run test:deep`.
  - MIT `LICENSE`, `README.md`, `KIRO_LOG.md`; confirm `.kiro/` is not gitignored.
  - Folder tree per `steering/structure.md`.
  - _Requirements: 11.1_

- [ ] 2. Bits and Gray code (`bits.ts`) — P1, P2
  - _Requirements: 1.1, 5.5_

- [ ] 3. CRC-32 (`crc32.ts`) — known answer `"123456789"` → `0xCBF43926`; P3
  - _Requirements: 7.2_

- [ ] 4. Reed–Solomon over GF(2⁸) (`reedSolomon.ts`) — shortened codes (header 12+8, payload ≤ 223+32); P4, P5
  - _Requirements: 5.6, 7.1_

- [ ] 5. Interleaver (`interleave.ts`) — near-equal split, interleave, inverse; P6
  - _Requirements: 5.6_

- [ ] 6. Tape format (`tape.ts`)
  - Validate fields and character set, serialize, deserialize (strict), size estimate.
  - P7.
  - _Requirements: 2.1–2.5, 1.2_

- [ ] 7. Profiles and frame (`profiles.ts`, `frame.ts`)
  - Profile table as data (Robust music-box tones, Standard); header with `tapeId`; payload pipeline with pilots; inverse at symbol level.
  - P8.
  - _Requirements: 1.1, 7.3, 9.1–9.4_

- [ ] 8. Modulator (`modulate.ts`)
  - Continuous phase, bell envelope for Robust, chirps, fades, normalization, loop mode with N passes.
  - `encodePayload` with duration.
  - Unit tests: no clicks; peak in [0.5, 0.9]; loop output = N × single pass + gaps.
  - Listen to the overture and log first impressions in `KIRO_LOG.md`.
  - _Requirements: 1.1, 1.3, 1.5, 1.6, 9.2_

- [ ] 9. Single-pass demodulator (`sync.ts`, `demodulate.ts`)
  - Chirp matched filter, fine timing, Goertzel energies with per-symbol normalization, header then payload.
  - `decodeFile` for one pass. P9.
  - _Requirements: 3.1, 3.3, 9.3_

- [ ] 10. Channel simulator (`channel.ts`) and damaged-channel tests
  - All impairments; seedable; independent noise per pass.
  - P10, P13. Log which impairment breaks first and at what level.
  - _Requirements: 5.1–5.6, 11.2_

- [ ] 11. Timing tracking
  - Early–late gate + pilot re-anchoring; extend P10 to ±0.2% with maximum-size tapes.
  - _Requirements: 5.2_

- [ ] 12. Multi-pass accumulator (`accumulator.ts`)
  - Keyed by `tapeId`; add normalized energies; decide from sums; clarity; expiry; discard misaligned passes.
  - `decodeFile` combines all passes in a file.
  - P14, P15, P16. Chart success rate vs. SNR for 1–4 passes and save it to `docs/` for the write-up.
  - _Requirements: 6.1–6.6, 3.4_

- [ ] 13. Streaming decoder (`createDecoder`)
  - `push` / `flush` / `reset`; event sequence per design; provisional bytes at de-interleaved positions.
  - P11, P12.
  - _Requirements: 4.2, 4.4, 4.5, 8.1–8.3, 11.4_

- [ ] 14. Browser adapters (`src/audio/`)
  - WAV write/read; mic capture with processing disabled; AudioWorklet → decoder (Worker if needed); playback including loop.
  - _Requirements: 1.4, 3.3, 4.1, 4.3_

- [ ] 15. Real-world measurements (manual, logged)
  - Matrix: {laptop self-loop, phone → laptop, laptop → phone} × {quiet, noisy} × {Robust, Standard} × {1, 2, 3 passes}; 10 trials each.
  - Airplane mode on both devices for the phone → laptop runs (this is also the demo setup).
  - Resolve open questions 2 and 3; update `design.md`.
  - _Requirements: 5.5, 6.3_

- [ ] 15b. Carrier measurements for the impact story (manual, logged)
  - Phone call: phone A plays the ghost track into a call; phone B's call audio is played aloud to the laptop receiver. Standard and Robust, 10 trials each.
  - Broadcast: loop a ghost message; receive at 1 m, 3 m, 6 m; record passes needed.
  - Save a short clip of each successful run for the demo video.
  - _Requirements: 10.1, 10.2, 10.4_

- [ ]* 16. Musical payload profile experiment (8-tone pentatonic) — keep only if within 2 dB of Standard
  - _Requirements: 9.4_

- [ ]* 17. Voice-message codecs
  - `ffmpeg` fixtures: Opus 16/24/32 kbps, AAC 64 kbps; measure Standard and Robust.
  - _Requirements: 10.3, 10.4_

- [ ]* 18. Errors-and-erasures RS using symbol confidence
  - _Requirements: 5.6_

- [ ]* 19. Pixel doodle in the tape format
  - _Requirements: 2.2_
