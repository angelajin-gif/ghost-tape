# Requirements Document

Acoustic Modem (Ghost Tape core)

## Introduction

The acoustic modem is the engine of Ghost Tape. It turns a **tape** (a J-card plus a letter, optionally a doodle; up to 1024 bytes serialized, 256 bytes in the Robust profile) into audio that can travel through air or ride inside other audio, and turns recorded or live audio back into the exact original tape. It is a pure TypeScript library (`src/modem/`) plus thin browser adapters for audio files and the microphone. Screens and animations are specified separately (`.kiro/specs/ghost-tape-ui/`).

## Glossary
- **Tape**: the structured payload — J-card fields, letter, optional doodle.
- **Ghost track**: the audio produced by the encoder: overture, header, payload.
- **Overture**: the opening melodic section (preamble chirp, sync and header) using music-box tones.
- **Pass**: one complete playback of a ghost track. A looping track produces many consecutive passes.
- **Profile**: a set of modulation parameters. *Robust* (slow, tolerant) and *Standard* (faster).
- **Profile table**: the data table in `profiles.ts` listing each profile's tones, timing and envelope.
- **Channel**: everything between encoder and decoder (speaker, room, microphone, compression).
- **Channel simulator**: test-only code that applies realistic damage to samples.
- **Encoder**: the modem function `encodePayload` that turns a tape or ghost into ghost-track samples.
- **Decoder**: the streaming decoder created by `createDecoder` (`push`/`flush`/`reset`) and the file decoder `decodeFile` built on it.
- **Modem library**: the code in `src/modem/`, including the Encoder and the Decoder.
- **Tape ID (tapeId)**: the 32-bit identifier carried in the header; equal to the CRC-32 of the serialized payload. Used to recognise passes of the same tape.
- **Accumulator**: the decoder's per-tape store of combined evidence across passes, keyed by tapeId.
- **Ghost Tape charset**: the 1-byte character set for all text fields: printable ASCII 0x20–0x7E; the seven marks ‘ ’ “ ” — … mapped to 0x80–0x86; and newline (0x0A), allowed in the letter only. One character is exactly one byte.
- **Encoded size**: the size in bytes of the serialized tape, before the CRC-32 is appended.
- **Block count (B)**: the number of RS payload blocks, B = ceil(M / 223), where M is the encoded size plus 4 CRC bytes.
- **Codeword stream**: the payload bytes after CRC-32, Reed–Solomon encoding, block interleaving and the whole-stream permutation (Requirement 8), in transmission order.
- **Telephone band**: 300–3400 Hz.
- **SNR**: signal power divided by noise power, both measured within the telephone band, computed the same way at every supported sample rate.
- **Decodes correctly** (simulator): at least 95% of seeded simulator trials return the exact input payload.
- **Typical-size tape**: a tape with an encoded size of about 560 bytes (title, names, 5 tracks of ~30 chars, ~350-char letter).
- **Short tape**: a tape or ghost with encoded size ≤ 140 bytes.
- **Audio time**: time measured by the number of samples pushed into the decoder divided by the sample rate, not by wall-clock time.
- **Audio adapter**: the browser-side code in `src/audio/` that turns files or microphone input into Float32 samples for the modem.
- **Measurement log**: the trial records kept in `KIRO_LOG.md`.
- **Developer laptop**: the developer's Apple M1 Pro laptop.
- **Test phone**: the developer's iPhone 17 Pro.

## Requirements

### Requirement 1: Encode a tape into a ghost track

**User Story:** As a sender, I want my tape turned into a ghost track, so that I can play it or send it.

#### Acceptance Criteria
1. WHEN the sender provides a valid tape whose encoded size is within the chosen profile's cap, a profile, and a sample rate of 44100 or 48000 Hz, THE Encoder SHALL produce mono samples at the requested sample rate.
2. IF the encoded size exceeds the cap for the chosen profile (Standard: 1024 bytes; Robust: 256 bytes), THEN THE Encoder SHALL reject the tape with a reason that states the cap and the actual encoded size.
3. IF the Encoder rejects a tape, THEN THE Encoder SHALL return no audio samples.
4. THE system SHALL show the ghost track's duration in seconds before the sender exports or plays the ghost track, equal to the produced ghost track's length within 0.1 s.
5. WHEN the sender edits the tape or changes the profile, THE system SHALL replace the shown duration with the duration of the edited ghost track.
6. THE system SHALL export the ghost track as a mono 16-bit PCM WAV file at the ghost track's sample rate.
7. THE Encoder SHALL produce ghost tracks in which, within a 10 ms window centred on each symbol boundary, energy above 4 kHz is at least 40 dB below the telephone-band energy in the same window.
8. THE Encoder SHALL produce ghost tracks whose peak absolute amplitude is between 0.5 and 0.9 of full scale inclusive.
9. WHEN loop mode with N ≥ 1 passes is requested, THE Encoder SHALL produce N consecutive complete passes with exactly 1 s of digital silence between adjacent passes and no silence before the first pass or after the last pass.
10. WHEN any single pass is cut from a looped ghost track at the pass boundaries, THE Decoder SHALL decode that pass alone over a perfect channel to the exact tape.
11. THE Encoder SHALL shape every Robust symbol so that the envelope rises from 0.6 to 1.0 during the first 3 ms of the symbol, inside the 10 ms guard.
12. THE Encoder SHALL shape every Robust symbol so that the envelope decays from 1.0 at 3 ms to 0.6 at 50 ms.
13. THE Encoder SHALL start symbol k at sample round(k × symbolDuration × sampleRate) from the frame's first sample, so that the start error is below 1 sample with no build-up at 44100 Hz and 48000 Hz.
14. THE Encoder SHALL keep every tone and chirp frequency within 300–3400 Hz.
15. THE Encoder SHALL sweep the preamble chirp from 1000 Hz to 3200 Hz and the postamble chirp from 3200 Hz to 1000 Hz.

### Requirement 2: The tape format

**User Story:** As a sender, I want to send a whole mixtape — not just text — so that my friend receives something that feels like a real tape.

#### Acceptance Criteria
1. THE Encoder SHALL accept a tape containing: title (0–40 characters), from (0–24), to (0–24), date (optional: absent, or `YYYY-MM-DD`), 0–10 tracks (each 0–60 characters), and a letter (0–800 characters), with all lengths counted in Ghost Tape charset characters.
2. WHERE doodles are implemented, THE Encoder SHALL accept at most one 32×32 1-bit doodle per tape.
3. THE Encoder SHALL accept only Ghost Tape charset characters in text fields, with newline allowed only in the letter.
4. IF a text field contains a character outside the Ghost Tape charset, or a newline outside the letter, THEN THE Encoder SHALL return `{ ok: false, reason }` naming the field, produce no ghost track, and return without throwing.
5. THE Encoder SHALL accept a ghost (Side B) containing only a message of 1–140 characters with no newline.
6. FOR ALL valid tapes and ghosts, encoding then decoding SHALL return a payload of the same kind with every field equal, an absent date decoded as absent, tracks in the same count and order, and identical doodle pixels (round-trip property).
7. IF a date is present and is malformed, is not a valid Gregorian calendar date (e.g. 2025-02-29, 2024-04-31), or is outside 2000-01-01 to 2255-12-31 inclusive, THEN THE Encoder SHALL reject the tape with a reason naming the date field.
8. IF title, from and to are all empty, THEN THE Encoder SHALL reject the tape with a reason naming the title, from and to fields. Any one or two of these fields may be empty.
9. IF the Decoder deserializes a text byte outside the Ghost Tape charset, or a newline outside the letter, THEN THE Decoder SHALL return `{ ok: false }`, return no tape, and return without throwing.

### Requirement 3: Decode from an audio file

**User Story:** As a recipient without a second device or microphone, I want to upload the audio file, so that I can still open the tape.

#### Acceptance Criteria
1. WHEN the recipient provides a losslessly encoded file (WAV) of a ghost track sent over a perfect channel, THE Decoder SHALL return a tape equal to the original under the Requirement 2 round-trip definition.
2. WHEN the ghost track is preceded by 0–60 s and followed by 0–60 s of any surrounding audio type from the Channel simulator (silence, noise, music-like random chords, speech-like noise) at a level equal to the ghost track's RMS, THE Decoder SHALL decode correctly.
3. THE Modem library SHALL accept mono Float32 samples at any sample rate from 16000 to 48000 Hz inclusive and decode correctly over a perfect channel at that rate.
4. WHEN the file contains two or more passes, THE Decoder SHALL combine the passes as defined in Requirement 6.
5. IF the file contains no ghost track, THEN THE Decoder SHALL return a failure result with the reason "no signal found".
6. THE Decoder SHALL return a result without throwing for every file input.
7. THE Audio adapter SHALL decode every uploaded file with the browser's `decodeAudioData` (WAV, MP3, M4A/AAC, Ogg/Opus where the browser supports them), with no format-specific parser of its own, and pass the decoded samples to the Modem library at the decoding context's sample rate. Successful decoding through lossy formats is measured in Requirement 10, not guaranteed.
8. THE Audio adapter SHALL support files whose source sample rate is 16 kHz or higher; files with lower source sample rates are unsupported and decoding of them is not guaranteed.
9. WHEN the decoded audio has 2 or more channels, THE Audio adapter SHALL mix the channels to mono by averaging all channels.
10. IF the browser cannot decode the file, THEN THE Audio adapter SHALL return a failure result with the reason "unsupported or unreadable audio file" and return without throwing.

### Requirement 4: Decode live from the microphone

**User Story:** As a recipient, I want to hold my device near a speaker and watch the tape develop, so that the message travels only through air.

#### Acceptance Criteria
1. WHEN the recipient starts listening, THE Audio adapter SHALL request microphone access with `echoCancellation`, `noiseSuppression` and `autoGainControl` each disabled.
2. THE Decoder SHALL accept `push` chunks of any length, treating a 0-length chunk as a no-op and accepting 1-sample chunks.
3. FOR ALL ways of splitting the same input into chunks, THE Decoder SHALL emit the same events with the same content in the same order, counting `push` and `flush` events together (chunking invariance).
4. WHEN a maximum-size Standard tape (1024 bytes) is streamed into the Decoder in Node on the Developer laptop (Apple M1 Pro) in 128-sample chunks, THE Decoder SHALL finish with a wall-clock time from the first `push` to the `flush` return of at most 0.2× the ghost track's audio duration.
5. WHEN the last sample of a pass has been pushed, THE Decoder SHALL emit that pass's result event before 1 s more audio time is pushed, or on `flush()` if the stream ends sooner.
6. WHEN passes of up to 4 different tapes arrive interleaved in time without overlapping, THE Decoder SHALL keep a separate Accumulator per tapeId.
7. WHEN passes of up to 4 different tapes arrive interleaved in time, THE Decoder SHALL produce for each tape a result identical to that of a fresh Decoder given only that tape's passes in the same order.
8. THE developer SHALL check real-time streaming decode manually on the Test phone (iPhone 17 Pro, Safari) and record the result (decoded exactly / not decoded) in `KIRO_LOG.md`.

### Requirement 5: Survive a realistic channel

**User Story:** As a recipient in an ordinary room, I want the tape to survive noise, echo and imperfect speakers.

#### Acceptance Criteria
1. WHEN the Channel simulator applies a gain from 0.05× to 2× inclusive, THE Decoder SHALL decode correctly with each profile.
2. WHEN the Channel simulator applies a sample-rate mismatch from −0.2% to +0.2% inclusive, THE Decoder SHALL decode correctly with each profile.
3. WHEN the Channel simulator applies a 300–3400 Hz 2nd-order Butterworth telephone-band band-pass, THE Decoder SHALL decode correctly with each profile.
4. WHEN the Channel simulator applies white noise at SNR ≥ 15 dB to a single pass, THE Decoder SHALL decode correctly with the Standard profile. *(Placeholder target; revise after week-1 simulator results.)*
5. WHEN the Channel simulator applies white noise at SNR ≥ 6 dB to a single pass, THE Decoder SHALL decode correctly with the Robust profile. *(Placeholder target; revise after week-1 simulator results.)*
6. WHEN the Channel simulator applies one dropout of up to 150 ms lying entirely within the payload at any start position, either zeroed or replaced by white noise at 4× the signal RMS, THE Decoder SHALL decode correctly with each profile.
7. WHEN the Channel simulator applies reverberation (direct path plus exponential tail, direct-to-reverberant ratio ≥ 0 dB) at RT60 values from 50 to 300 ms, THE test suite SHALL report the success rate per profile and RT60 in a logged table. *(Targets: Standard RT60 ≤ 150 ms, Robust RT60 ≤ 300 ms. These targets are not pass/fail; the design SHALL decide guard length or profile changes after week-1 simulator data, and only then may they become pass/fail criteria.)*
8. THE Channel simulator SHALL run every trial for criteria 5.1–5.7 as a single pass applying exactly one impairment.
9. THE Channel simulator SHALL use a typical-size tape for Standard trials and a 256-byte tape for Robust trials in criteria 5.1–5.7.
10. THE Channel simulator SHALL run every trial for criteria 5.1–5.7 at both 44100 Hz and 48000 Hz.
11. WHEN the Channel simulator applies the combined "realistic room" scenario (gain, telephone-band band-pass, reverberation and white noise together) at or above a profile's SNR threshold, THE Decoder SHALL decode correctly with that profile; the design SHALL fix the scenario parameters (gain, filter, reverberation RT60 and DRR) and per-profile thresholds after week-1 simulator results.

### Requirement 6: Every séance makes the ghost clearer (multi-pass combining)

**User Story:** As a recipient in a noisy place, I want each additional play to make the message clearer, so that I eventually receive it instead of failing over and over.

#### Acceptance Criteria
1. WHEN a pass with a valid header is received, THE Decoder SHALL identify the tape by its tapeId, treating the tape as known exactly when an Accumulator for that tapeId is held (not expired, evicted or reset), for both looped passes and separate plays within the retention window.
2. WHEN an aligned pass with a valid header is received, THE Decoder SHALL add the pass's normalized per-symbol tone energies to that tapeId's Accumulator, creating the Accumulator if none exists, and attempt decoding from the summed energies.
3. WHEN only passes 1..N are decoded with a fresh Decoder, with independent noise per pass, over the same fixed set of ≥ 200 seeds per SNR level at 3 SNR levels near the single-pass threshold (levels fixed in the design), with success meaning the exact payload, THE Decoder SHALL achieve a success rate at N+1 passes ≥ the success rate at N passes minus 2 percentage points for N = 1…4 at every level.
4. WHEN the criterion 6.3 experiment is run at the lowest of the 3 SNR levels, THE Decoder SHALL achieve a success rate with 3 passes ≥ the success rate with 1 pass plus 20 percentage points.
5. IF a pass has no valid header, THEN THE Decoder SHALL leave every Accumulator unchanged.
6. IF a pass has a valid header but payload alignment fails (alignment rule defined in the design), THEN THE Decoder SHALL leave the Accumulator unchanged, so that later results are identical to never having received the pass.
7. WHEN a pass has been added to an Accumulator, THE Decoder SHALL report the fraction of RS blocks recovered (0–1) and a clarity value (0–1) equal to the mean over payload symbols of confidence = 1 − second/best of the summed normalized energies, with confidence = 0 when best = 0.
8. WHILE less than 10 minutes of audio time have passed since a pass was last added to a tape's Accumulator or a repeat pass of that tape arrived, THE Decoder SHALL retain that tape's Accumulator unless reset or evicted.
9. THE Decoder SHALL hold Accumulators for up to 4 tapeIds at once.
10. IF a pass with a new tapeId arrives while 4 tapeIds are held, THEN THE Decoder SHALL first evict exactly one Accumulator: the one with the oldest last activity in audio time.
11. WHEN `reset()` is called, THE Decoder SHALL clear all Accumulators and completed tapes.

### Requirement 7: Never show a wrong word

**User Story:** As a recipient, I want to see either the true tape or an honest "not yet," so that I never read something my friend did not write.

#### Acceptance Criteria
1. IF any RS payload block of the Accumulator fails to decode after a pass, THEN THE Decoder SHALL emit no `complete` event for that pass.
2. WHEN every RS block decodes, the trailing CRC-32 equals the CRC-32 of the reassembled payload, that CRC-32 equals the header's tapeId, and strict deserialization succeeds, THE Decoder SHALL emit exactly one `complete` event carrying the payload.
3. IF the trailing CRC-32 does not match the reassembled payload or does not equal the tapeId, THEN THE Decoder SHALL emit no `complete` event, keep the Accumulator and continue developing.
4. IF strict deserialization fails because any field is outside its allowed values or lengths, including all Requirement 2 limits, THEN THE Decoder SHALL emit no `complete` event and continue developing.
5. IF the header RS code (12 + 8 bytes) fails, magic ≠ 0x47 0x54, version ≠ 0x01, profileId is not defined, payloadKind ∉ {0, 1}, payloadLength is outside 1–1024 (or above 256 for Robust), or flags ≠ 0, THEN THE Decoder SHALL emit `pass-discarded` with reason `header-invalid` and add nothing to any Accumulator.
6. WHEN a pass has been discarded, THE Decoder SHALL keep processing input and decode the next valid pass.
7. THE Decoder SHALL deliver provisional bytes (position, byte, confidence) only in `progress` events and never in `complete` events.
8. THE Modem library SHALL declare public types under which a provisional entry is not assignable to `Payload`, verified by a type-level test that fails to compile when the assignment is attempted.
9. FOR ALL seeded Channel simulator runs, every `complete` payload SHALL be byte-for-byte equal to the Encoder input.

### Requirement 8: Progress events for the darkroom UI

**User Story:** As a recipient, I want to watch the tape develop, so that receiving feels like a séance, not a loading bar.

#### Acceptance Criteria
1. WHEN a pass with a valid header arrives whose tapeId is not already complete, THE Decoder SHALL emit, in order, `signal-detected`, `header`, zero or more `progress`, and `pass-complete`.
2. THE Decoder SHALL include in each `header` event the tapeId, the payload length in bytes, the pass number (1-based count of passes received for that tapeId) and the estimated seconds of audio time remaining in the pass.
3. THE Decoder SHALL emit the first `progress` event within 250 ms of audio time after `header`, and each subsequent `progress` event within 250 ms of audio time after the previous one.
4. WHEN a pass makes the tape recoverable under Requirement 7, THE Decoder SHALL emit exactly one `complete` event with the tape immediately after that pass's `pass-complete`, and no further `complete` for that tapeId while the tape is retained.
5. IF a pass leaves the tape not recoverable, THEN THE Decoder SHALL emit no `complete` event for that pass.
6. IF a pass with a valid header is discarded because alignment failed or the signal was lost, THEN THE Decoder SHALL emit `pass-discarded` in place of `pass-complete`.
7. IF a pass's header is invalid, THEN THE Decoder SHALL emit `signal-detected` followed by `pass-discarded`, with no `header`, `progress` or `pass-complete` events.
8. THE Decoder SHALL carry in each `progress` event provisional bytes at final payload positions 0..P−1 (P = payloadLength from the header, excluding CRC and RS parity), after the inverse permutation and de-interleaving, each with a confidence in [0, 1] and typed as provisional.
9. THE Decoder SHALL compute provisional bytes and confidences from the tapeId's Accumulator, combining earlier retained passes with the current pass so far.
10. THE Encoder SHALL zero-pad the CRC-appended payload to B·k bytes, k = ceil(M / B), so that all B RS blocks have equal data length k and B divides the codeword stream length L = B·(k + 32). The header's payloadLength identifies the real length; the Decoder discards padding bytes after decoding.
11. THE Encoder SHALL reorder the codeword stream after block interleaving so that transmitted byte i is interleaved byte (a·i + b) mod L, with b = 0 and a = the integer closest to 0.618·L that is coprime to both L and B (on a tie, the smaller), with no runtime randomness.
12. FOR ALL valid L and B, the map i → (a·i + b) mod L of criterion 8.11 SHALL be a bijection on 0..L−1 (property test).
13. FOR ALL valid L and B with B ≤ 16, every 16 consecutive transmitted bytes SHALL include at least one byte from every RS block (property test).
14. THE Decoder SHALL apply the inverse of the criterion 8.11 permutation before de-interleaving.
15. THE Encoder SHALL apply the criterion 8.11 permutation to single-block codeword streams as well, producing the same byte order for the same tape and profile.
16. WHEN ceil(0.1 × S) of a pass's payload symbols have been received (S = payload symbols in the pass) and those symbols carry ≥ 20 payload bytes (bytes mapping to positions 0..P−1), THE Decoder SHALL include in the first following `progress` event at least one provisional byte in each tenth k = 0..9 covering positions floor(k·P/10) to floor((k+1)·P/10)−1. The test suite SHALL verify this property exhaustively for every valid payload length; IF it fails for any length, THEN the failure is a spec issue to be resolved before implementation continues.
17. WHILE a tapeId is complete and retained, WHEN a later pass of that tapeId arrives, THE Decoder SHALL emit `signal-detected`, `header`, and exactly one `already-received { tapeId }` at pass end, with no `progress`, `pass-complete` or `complete` events, leave the retained tape unchanged, and count the repeat pass as activity for Requirement 6 retention and eviction.

### Requirement 9: Two profiles and the overture

**User Story:** As a sender, I want a recognisable musical opening and a fast body, so that the track sounds like Ghost Tape and does not take forever.

#### Acceptance Criteria
1. THE Modem library SHALL support a Robust profile and a Standard profile with parameters defined in the design.
2. THE Modem library SHALL use the tones 1175, 1475, 1750 and 2350 Hz for the Robust profile.
3. THE Modem library SHALL use the tones 1500 + 100·k Hz, k = 0…15, for the Standard profile.
4. THE Encoder SHALL use only Robust tone frequencies and Robust symbol timing for the sync and header, with either payload profile.
5. THE Encoder SHALL begin the overture with the preamble chirp defined in Requirement 1, which is not a profile tone.
6. WHEN a header has been decoded, THE Decoder SHALL decode the payload with the profile the header names, with no user input.
7. WHEN a new entry is added to the Profile table, THE Encoder and THE Decoder SHALL round-trip a tape with the new profile with no source changes outside the Profile table.
8. THE Modem library SHALL use tones between 300 and 3200 Hz inclusive for every profile.

### Requirement 10: Real-world carriers — measurement deliverables

**User Story:** As someone without internet, I want to receive a message through a phone call or a loudspeaker broadcast, so that information reaches me when networks fail.

These are logged measurement deliverables, not system requirements. Results are recorded in `KIRO_LOG.md`. The former criterion "recommend Robust per carrier" has moved out of this spec: it belongs in the future `ghost-tape-ui` spec as a static per-carrier recommendation table built from these results.

#### Acceptance Criteria
1. THE Measurement log SHALL record phone → laptop trials (the Test phone plays, the Developer laptop receives) with the Standard profile in a quiet room and a noisy room, 10 trials per condition (20 trials), with a per-condition success count out of 10.
2. THE Measurement log SHALL record a live phone call with the Standard profile, 5 trials (one phone plays into the call; the other phone's call audio is played aloud to the Developer laptop), recording the two phone models, the distance from the call-receiving phone's speaker to the Developer laptop's microphone, and the success count out of 5.
3. THE Measurement log SHALL record a looping broadcast of a ghost received at 3 m from the speaker, 5 runs, recording the profile, speaker and receiving device, and passes needed = passes up to and including the first pass after which the decode succeeds.
4. WHERE the stretch measurements are performed, THE Measurement log SHALL record results against voice-message codecs (Opus 16–32 kbps, AAC 64 kbps) and compressed file uploads (Requirement 3), recording the codec and bitrate or file format and the producing app.
5. THE Measurement log SHALL record for every trial: id, date, criterion and cell, sender device, receiver device, profile, encoded size, noise condition with a one-line description, distance in m, passes played, passes needed or "not decoded", success, and clarity and RS-block fraction after the last pass; phone → laptop trials SHALL confirm both devices were in airplane mode.
6. THE Measurement log SHALL mark a trial as successful only when the decoded tape's serialized bytes equal the sent tape's serialized bytes.
7. THE Measurement log SHALL keep failed trials recorded with their outcome, without replacing them by reruns.

### Requirement 11: Testability

**User Story:** As the developer, I want the modem testable without speakers or a microphone, so that I can iterate fast and catch bugs with property-based tests.

#### Acceptance Criteria
1. THE Modem library SHALL load and run in Node with no browser APIs or globals.
2. THE Channel simulator SHALL be test-only code in `src/modem/channel.ts`, imported by no Modem library runtime code.
3. WHEN the Channel simulator is given the same input, parameters and seed, THE Channel simulator SHALL produce identical output.
4. THE Channel simulator SHALL provide these impairments, each usable alone or combined: gain; surrounding audio of 0–60 s before and/or after (silence, noise, music-like random chords, speech-like noise); white noise at a target SNR in dB; sample-rate mismatch; telephone-band band-pass; reverberation (direct path plus exponential tail); dropouts; and sample-rate conversion.
5. THE test suite SHALL include a seeded fast-check round-trip property test for every encode/decode stage listed in the design.
6. THE Decoder SHALL return from `push()` and `flush()` without throwing on any input, finite or not, treating non-finite samples (NaN, ±Infinity) as 0.
7. THE test suite SHALL include a property test of criterion 11.6 covering noise, silence, clipped audio (samples at ±1), non-finite samples, and every buffer length from 0 to 10.
8. WHEN `npm test` is run on the Developer laptop, THE test suite SHALL pass within 60 s wall-clock.
9. WHEN `npm run test:deep` is run on the Developer laptop, THE test suite SHALL pass within 10 min wall-clock.
10. THE `test:deep` suite SHALL use short tapes except where a criterion needs a maximum-size tape (1024 bytes Standard, 256 bytes Robust).
11. THE Modem library SHALL use no runtime randomness.
12. THE Channel simulator SHALL give each pass an independent noise seed in multi-pass tests.
