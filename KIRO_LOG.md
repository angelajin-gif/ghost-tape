# Kiro Log — Ghost Tape

A running record of how Kiro was used. One entry per notable moment; attach a screenshot when possible. This becomes the "How Kiro was used" write-up.

## Template
```
### YYYY-MM-DD — <short title>
Feature: spec | steering | hook | PBT | MCP | custom agent | Crew | power | CLI/Web
What I did:
What Kiro did:
What changed / what I learned:
Screenshot: docs/kiro/<file>.png
```

## Highlights to collect (checklist)
- [ ] Spec: how requirements → design → tasks shaped the protocol before any code
- [ ] Spec vs vibe: one moment where vibe coding went wrong and the spec fixed it
- [ ] Steering: a before/after where steering changed Kiro's output (e.g. mic constraints, pure modem library)
- [ ] Hooks: each hook, what it automates, one time it caught something
- [ ] PBT: a bug a property test found that unit tests missed (with the shrunk counterexample)
- [ ] MCP: any tool connected and what it unlocked
- [ ] Real-world measurement table (task 13)

## Entries

### 2026-11-10 — Requirements review before any code
Feature: spec
What I did: Asked Kiro to review the draft acoustic-modem spec critically and ask questions one at a time, with no code until I approved.
What Kiro did: Found 7 contradictions, 11 underspecified items and 5 scope risks in requirements.md; asked 16 questions; rewrote the requirements in testable EARS form.
What changed / what I learned: Several tapes kept by tapeId; fixed whole-stream byte scramble; 1-byte charset; in-band SNR with a 95% success definition; telephone band 300–3400 Hz; Robust cap 256 B; fewer manual trials; reverb kept as a target.
Screenshot: TODO

### 2026-11-10 — Steering rule: no heredocs in shell
Feature: steering
What I did: Asked Kiro to add a shell-usage rule to .kiro/steering/tech.md.
What Kiro did: Added "Never write or edit files with shell heredocs or long echo/cat commands" plus "keep shell commands short" under a new Shell usage section.
What changed / what I learned: Earlier this session a heredoc garbled a KIRO_LOG entry and a long python heredoc hung for 120 s while creating the hook.
Screenshot: TODO

### 2026-11-10 — Scramble-rule check finds a spec conflict
Feature: spec
What I did: Asked Kiro to rerun the scramble-rule check before regenerating the design.
What Kiro did: Wrote scripts/check-scramble.mjs and checked every payload length for both profiles (1,280 cases). R8.12 and R8.13 pass; R8.16 fails in 16 cases. Smallest: P = 202, L = 238, B = 1, a = 149, tenth 2 empty after the first 10% of symbols.
What changed / what I learned: Moving the trigger to 12/15/20% still fails. Choosing the nearest a that passes 8.13 and 8.16 ("Fix A") passes all cases. Recorded as open issue S1 in design.md (needs an R8.11 wording change).
Screenshot: TODO

### 2026-11-10 — design.md and tasks.md regenerated from approved requirements
Feature: spec
What I did: Asked Kiro to rebuild design.md and tasks.md to match the approved requirements.md.
What Kiro did: Rewrote design.md (open issues S1–S4, header/payload pipeline, decoder state machine, accumulator rules, event grammar, simulator constants, P1–P24) and tasks.md (tasks 0–21, task 0 resolves spec issues first). Added types.ts, decoder.ts and scripts/ to structure.md.
What changed / what I learned: The check also found a charset count mismatch (six marks listed, seven codes) and an R5.9/R11.10 tape-size conflict. Both are left for the developer to decide.
Screenshot: TODO

### 2026-11-10 — Steering rule extended to printf
Feature: steering
What I did: Asked Kiro to make sure tech.md has the shell-usage rule.
What Kiro did: Rule existed; added printf to the banned heredoc/echo/cat list. All files this session were written with file tools.
What changed / what I learned: none recorded.
Screenshot: TODO

### 2026-11-10 — Spec updated after the scramble-check finding
Feature: spec
What I did: Approved the design with four decisions: Kiro's scramble fix, en dash (–) at 0x86, the 560 B tape in the deep suite, and a ≈ 15,000 s deep-suite audio cap.
What Kiro did: Reworded R8.11 (nearest a to 0.618·L that also passes 8.13 and 8.16); updated glossary, R5.7, R5.9, R5.10, R6.3, R6.4, R11.10; added R11.13 (cap) and R11.14 (FFT reverb). Replanned the deep suite at ≈ 13,300 s.
What changed / what I learned: The scramble check (16 failing lengths, smallest P = 202) turned a formula into a search rule. Claims are now stated as n/n with 95% lower bounds (Standard pooled 60 trials → 95%, one cell of 10 → 74%), not "95% per condition".
Screenshot: TODO

### 2026-11-10 - Task 0: Lock in the approved permutation rule (design S1)
Feature: spec
What I did: Completed task 0 of the acoustic-modem spec.
What Kiro did: what was built = scripts/check-scramble.mjs (default mode = approved R8.11 rule, exits 1 on failure; `old` mode keeps the pre-review rule).
What changed / what I learned: tests covering it = none found under tests/; no property IDs named in the task. Script output: a valid a exists for all 1,280 cases; 8.12, 8.13, 8.16 failures 0. a changed for P = 202, 220, 231, 232, 237, 238, 268, 281, 282, 305 (Standard; the first 6 also Robust); max |a/L − 0.618| = 0.0147. Notable problem = none recorded.
Screenshot: TODO

### 2026-11-10 - Task 1: Project scaffold
Feature: spec
What I did: Completed task 1 of the acoustic-modem spec.
What Kiro did: what was built = package.json, tsconfig.json, tsconfig.modem.json (ES2022 lib only, no DOM/Node types), vite/vitest/vitest.deep configs, index.html, src/main.ts, src/modem/types.ts, src/modem/index.ts, tests/support/{runs,budget,budgetSetup}.ts, README.md.
What changed / what I learned: tests covering it = tests/unit/node-only.test.ts, tests/unit/budget.test.ts; no property IDs named in the task. Notable problem = the user npm cache had root-owned files; installed with a temporary cache in /tmp instead of changing ownership.
Screenshot: TODO

### 2026-11-10 - Task 2: Bits and Gray code (`bits.ts`)
Feature: spec
What I did: Completed task 2 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/bits.ts (bytes↔bits↔symbols for 1–8 bits/symbol, Gray encode/decode, tone↔value maps).
What changed / what I learned: tests covering it = tests/properties/bits.prop.test.ts, tests/unit/bits.test.ts; properties P1, P2. Notable problem = none recorded.
Screenshot: TODO

### 2026-11-10 - Task 3: CRC-32 (`crc32.ts`)
Feature: spec
What I did: Completed task 3 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/crc32.ts (table CRC-32 IEEE 802.3, appendCrc32 / stripCrc32 big-endian trailer).
What changed / what I learned: tests covering it = tests/properties/crc32.prop.test.ts; property P3 (known answer 0xCBF43926, single-bit flips, cross-check against Node zlib.crc32). Notable problem = none recorded.
Screenshot: TODO

### 2026-11-10 - Task 4: Reed–Solomon over GF(2⁸) (`reedSolomon.ts`)
Feature: spec
What I did: Completed task 4 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/reedSolomon.ts (hand-written; GF(256) 0x11D, systematic encode, syndromes, Berlekamp–Massey, Chien search, Forney, final syndrome check).
What changed / what I learned: tests covering it = tests/properties/reedSolomon.prop.test.ts; properties P4, P5 plus QR-code known answer. Notable problem = design P5 says "returns the original or a failure", which no bounded-distance decoder can guarantee beyond capacity; the test checks the provable version (failure, or a genuine codeword within 16 bytes of the input) and leaves wrong-payload rejection to CRC/P18.
Screenshot: TODO

### 2026-11-10 - Task 5: Pad, interleave and permute (`interleave.ts`)
Feature: spec
What I did: Completed task 5 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/interleave.ts (geometry, padAndSplit/joinAndTrim, interleave/deinterleave, permute/unpermute, chooseMultiplier with the approved R8.11 search).
What changed / what I learned: tests covering it = tests/properties/interleave.prop.test.ts; properties P6, P7, P8, P9 (P7–P9 exhaustive over all 1,280 lengths). Mutation check: with the 8.16 check removed from chooseMultiplier, P9 failed at standard P=202 a=149 "tenth 2 empty", the same counterexample as the scramble check. Notable problem = none recorded.
Screenshot: TODO

### 2026-11-10 - Task 6: Tape format (`tape.ts`)
Feature: spec
What I did: Completed task 6 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/tape.ts (charset with en dash at 0x86, field validation with named reasons, dates, cap check, serialize, strict deserialize).
What changed / what I learned: tests covering it = tests/properties/tape.prop.test.ts, tests/unit/tape.test.ts; properties P10, P11 (date validity checked against a JS Date oracle; random and one-byte-mutated inputs only decode when canonical). Notable problem = one hand-written unit-test byte vector had an extra byte; the code was right and the vector was fixed. No property test failed.
Screenshot: TODO

### 2026-11-10 - Task 7: Profiles and frame (`profiles.ts`, `frame.ts`)
Feature: spec
What I did: Completed task 7 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/profiles.ts (Robust/Standard as data, table validation), src/modem/frame.ts (header build/parse, payload symbol pipeline with pilots, frame timeline, sample-exact start times).
What changed / what I learned: tests covering it = tests/unit/profiles.test.ts, tests/properties/frame.prop.test.ts, tests/support/profiles.ts (made-up 3-bit profile); property P12. Notable problem = the task 1 purity scan flagged the word "window" inside an error-message string in profiles.ts; the scan now ignores string text (and still flags `window` inside `${}`, checked with a temporary probe file).
Screenshot: TODO

### 2026-11-12 - Task 8: Modulator (`modulate.ts`)
Feature: spec
What I did: Listened to demo/ghost-tape-demo.wav (Standard profile, 36.45 s, 48 kHz). The overture sounds good, keep it. The Standard payload sounds too high-pitched and a bit harsh over 30 seconds.
What Kiro did: Built src/modem/modulate.ts and src/audio/wav.ts (tests/unit/modulate.test.ts, tests/properties/wav.prop.test.ts, tests/support/dsp.ts). The R1.7 splatter test measured 34.3 dB (limit 40); a 2 ms frequency glide plus level easing at the Robust-to-Standard hand-over raised the worst boundary to 54 dB (Standard) and 73 dB (Robust).
What changed / what I learned: The sound was not changed. Softening the payload is an open question in design.md for week 2: (a) payload level below the overture, (b) Standard band shifted down, (c) musical payload profile (task 18).
Screenshot: TODO

### 2026-11-12 - Task 9: Single-pass decoder (`sync.ts`, `demodulate.ts`, `decoder.ts`)
Feature: spec
What I did: Completed task 9 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/sync.ts (complex-template chirp matched filter, fine timing), demodulate.ts, decoder.ts (createDecoder, decodeFile), plus fft.ts, buffer.ts and the resampler in channel.ts.
What changed / what I learned: tests covering it = tests/properties/decoder.prop.test.ts, fft.prop.test.ts and tests/unit/{decoder,sync,demodulate,buffer,resample}.test.ts; properties P13, P14, P24; all 261 tests pass in npm test and test:deep. Mutation checks: disabling the NCC guard failed the new noise-burst test; a click in silence had not needed it. Fine timing now scores a tone share, not summed energy, and its centre preference was cut from 0.002 to 0.0005 ms after a probe showed windows settling 2 ms late.
Screenshot: TODO

### 2026-11-12 - Task 10: Channel simulator (`channel.ts`) and damaged-channel tests
Feature: spec
What I did: Completed task 10 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/channel.ts (seeded noise, in-band SNR, band-pass, FFT reverb, dropouts, rate mismatch, resampler, surrounding audio, applyChannel, damagePasses), scripts/measure.mjs, a diagnostics hook on the decoder.
What changed / what I learned: tests covering it = tests/unit/channel.test.ts, tests/properties/channel.prop.test.ts; P15 (R5.1, R5.3–R5.6), R3.2 (4 surround kinds, 60 s each side), R5.7 table, P18; 316 tests pass, test:deep 103 s with 7,453 s of audio. Measured (12 trials/level): Standard decodes 12/12 down to −4 dB and 3/12 at −7; Robust 12/12 down to −11 dB and 4/12 at −12; offline decode about 120x real time.
Notable problem: Standard fails from RT60 150 ms at DRR 0 dB (symbol errors 14%) while Robust decodes to 300 ms; the R5.4/R5.5 placeholders (15 and 6 dB) are 19 and 17 dB above the measured edge. Both are recorded in design.md for the week-2 decision.
Screenshot: TODO

### 2026-11-12 - Spec decisions after the week-1 measurements
Feature: spec
What I did: Reviewed Kiro's measurements (noise thresholds, reverb table) and decided: noise levels −1 dB (Standard) and −8 dB (Robust); R6.3 levels −5, −6, −7 dB; no Standard profile change for reverb yet.
What Kiro did: Updated R5.4, R5.5, R5.7 (150 ms target scoped to Robust, Standard pending) and R6.3/R6.4 in requirements.md; added decisions S5–S7 to design.md; added a guard/symbol-length simulator comparison to task 14 and the reverb decision to task 17; moved the noise cells to the new levels (10/10 Standard, 6/6 Robust pass).
What changed / what I learned: The old 15 dB and 6 dB targets could not fail (19 and 17 dB above the edge). The −5/−6/−7 dB levels were measured on 560 B tapes, so R6.3 now uses 560 B tapes; at about 199 s of audio per seed the 50 seeds (about 9,950 s) do not fit the 15,000 s cap, so the full experiment becomes `npm run measure:passes` outside the cap with a small regression cell inside it.
Screenshot: TODO

### 2026-11-12 - Task 11: Timing tracking (`demodulate.ts`: early/late gate and `ClockTracker`)
Feature: spec
What I did: Completed task 11 of the acoustic-modem spec.
What Kiro did: what was built = calibrateGate and ClockTracker in src/modem/demodulate.ts, renderSymbolRun in modulate.ts, tracking through header, payload and the resume position in decoder.ts. The gate learns each profile's energy-versus-shift curve by rendering reference symbols.
What changed / what I learned: tests covering it = tests/unit/demodulate.test.ts, tests/unit/decoder.test.ts, tests/properties/channel.prop.test.ts (P15 cells for R5.2: Standard 10/10, Robust 6/6, Standard 1024 B 4/4); 342 tests pass. Without tracking decoding failed from ±0.05%; with it ±0.5% decodes. Disabling the tracker or flipping the gate sign failed the tests.
Notable problem: positive clock error plus noise failed only when the file began exactly at the chirp (its best-matching position lies before sample 0); my first test files had no lead-in. R5.2 cells now sit in 1 s of silence and the edge is recorded in design.md.
Screenshot: TODO

### 2026-11-13 — ghost-tape-ui requirements created
Feature: spec
What I did: Asked Kiro for a new requirements-first spec from my UI brief and a set of decisions on layout hints, flicker and profiles.
What Kiro did: Saved the brief to docs/ghost-tape-ui-brief.md; wrote .kiro/specs/ghost-tape-ui/requirements.md (37 requirements, priority tiers, prerequisites from acoustic-modem tasks 12, 13, 15, 16, 17). No design.md or tasks.md yet.
What changed / what I learned: Requirements follow the decoder events in types.ts exactly; `progress` is not yet emitted by decoder.ts, so tests use a synthesized feed until modem task 13.
Screenshot: TODO
### 2026-11-19 - Task 12: Multi-pass accumulator (`accumulator.ts`)
Feature: spec
What I did: Completed task 12 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/accumulator.ts (AccumulatorStore, isAligned, decideFromSums), pass handling in src/modem/decoder.ts (pending buffer, alignment discard, `already-received`, retained completed tapes), scripts/measure-passes.mjs writing docs/passes-results.csv/.json and docs/passes-chart.svg.
What changed / what I learned: tests covering it = tests/unit/accumulator.test.ts, tests/properties/accumulator.prop.test.ts (P15b, P19, P20, P22, R6.3 regression cell at −9 dB), tests/unit/decoder.test.ts; 378 fast / 380 deep tests pass, deep audio 10,430 s of 15,000 s. Mutations caught: replacing sums instead of adding (5 failures), skipping alignment (2), evicting newest (5). measure:passes, Standard 560 B, decoded by pass 1/2/3: −10 dB 0/29/30 of 30, −9 dB 0/10/10 of 10, −8 dB 7/10/10 of 10; no wrong texts.
Notable problem: at the old R6.3 levels (−5/−6/−7 dB) one pass already decoded 30/30, 10/10, 10/10, because task 11's tracking moved Standard's 12-trial all-decode level from −4 to −7 dB (quick sweep with the tracker's correction removed: −2 dB). Decision S8: R5.4 −4 dB, R6.3 levels −8/−9/−10 dB. A 16-trial reverb probe also found Robust losing 1–4 headers per cell at RT60 100–200 ms, which the 2-trial table hid; left for task 14.
Screenshot: TODO

### 2026-11-19 - ghost-tape-ui requirements
Feature: spec
What I did: Had Kiro write the ghost-tape-ui requirements from the brief, after it read the steering docs and the acoustic-modem spec. Answered four questions: layout hint with generic fallback; real-history flicker only; broadcast=Robust and others Standard until measured; modem tasks 12, 13, 15 done by Nov 23.
What Kiro did: Reviewed the code and found `progress` is declared but not yet emitted by decoder.ts, and the `header` event carries no payload kind. Then refined each requirement for testability.
Screenshot: TODO
### 2026-11-19 - Task 13: Streaming decoder events (`createDecoder`)
Feature: spec
What I did: Completed task 13 of the acoustic-modem spec.
What Kiro did: what was built = `progress` every 200 ms of payload with provisional bytes from accumulator + current pass (src/modem/decoder.ts), `provisionalBytes` in src/modem/frame.ts, signal-lost detection (tone level over 400 ms, 30 dB below the header).
What changed / what I learned: tests covering it = tests/properties/decoder.prop.test.ts (P16, P17, P21, P23, R8.16 through the decoder, R4.4 benchmark), tests/properties/frame.prop.test.ts (provisionalBytes round trip), tests/unit/types.test.ts (R7.8 via @ts-expect-error), tests/unit/decoder.test.ts; 398 fast and 405 deep tests passed. R4.4: 66.4 s of audio in 0.26 s with 128-sample chunks (0.004×). Mutations caught: 300 ms cadence, provisional ignoring the accumulator, signal-lost off, progress in repeats.
Notable problem: P16 found a chunking bug from task 11, shrunk counterexample [[1001]]: the buffer dropped audio the clock tracker's early probe needed, so chunked runs skipped readings and confidences differed. Fixed by keeping one more symbol; measure:passes counts unchanged. Also: ≥ 400 ms of silence now discards a pass whole, so combining tests use noise for lost parts.
Screenshot: TODO
### 2026-11-23 - Spec: task 14 measurements (reverb, header, alignment rule)
Feature: spec
What I did: Reordered work (task 15 before 14) and asked for a 40-trial Robust reverb table, a header-failure investigation with stronger header protection, and a check of the alignment rule's false accepts.
What Kiro did: Added `npm run measure:reverb` and `npm run measure:alignment`, a read-only header diagnostic hook in decoder.ts, and the results to design.md "Task 14 measurements"; tasks.md notes what is done and what is pending.
What changed / what I learned: At DRR 0 dB Robust 256 B decoded 36/29/20 of 40 at RT60 100/200/300 ms, so R5.7's Robust target is not met there. Header failures come from one faded tone (74–88% of errors on one tone); 16 parity bytes cost 1.6 s per pass for 96/84/70 → 95/88/77 valid headers in 100. The current alignment rule accepted 56–67% of speech-like noise payloads; one such pass cut two-pass decodes at −11 dB from 10/30 to 2/30. A proposed adaptive rule accepted at most 1/300 and rejected no real pass at −10/−11 dB.
Screenshot: TODO
### 2026-11-24 - ghost-tape-ui task 1.1: AudioPort gate against the task-15 adapters
Feature: spec
What I did: Ran task 1.1 (read mic.ts, capture.worklet.ts, decoder.worker.ts, protocol.ts, file.ts, playback.ts, wav.ts, dev.ts against the design's "Assumed from task 15" table).
What Kiro did: Found 13 mismatches, all absorbed in the port or `src/audio/` additions; none reported. Table is at the top of src/ui/audioPort.ts. (3) worker also posts empty-events heartbeats once per second: impl drops them from `onBatch`, port adds `onActivity`. (4) no `encode` message: added `encode`/`encoded` to protocol.ts and decoder.worker.ts, `encodeInWorker` with timeout in workerClient.ts. (5) no flush ack: added `flushed`. (6) mic.ts owns its own AudioContext: `ListenSession.sampleRate` is the mic context's rate. (7) mic failures are free text: `classifyMicFailure` in micFailure.ts. (8) `stop()` is async: port returns Promise. (10) feeds get `onError`. (11) play has no start time: impl reads `currentTime`. (12, 13) added passScheduler.ts, wakeLock.ts. (14) `fetchAsset` via fetch. The worklet posts every 128-sample quantum (not batched to 1024), which only loads the worker. Constraints, file decode (48000 Hz, mono) and sample-rate handling matched.
What changed / what I learned: tests/unit/audioPort.test.ts runs the real worker core behind a fake Worker: batches equal a direct decoder's push results, none empty, one flush; typecheck passes. The microphone path and Wake Lock were not run in a browser.
Screenshot: TODO
### 2026-11-24 - ghost-tape-ui task 1.2: design tokens, palettes and contrast table
Feature: spec
What I did: Ran task 1.2 (tokens.css, tokens.ts, CONTRAST_PAIRS, reduced-motion store, P31 test, style scan).
What Kiro did: Wrote src/ui/tokens.css and tokens.ts (22 pairs, ratios recomputed by the WCAG formula and matched to the design within 0.01, including the #E3C3B0 blend), tests/unit/ui/tokens.test.ts and styleScan.test.ts. 38 tests pass; no palette change was needed.
What changed / what I learned: typescript is 7.0.2 and has no JS compiler API, so the design's "TypeScript compiler API" scan became a small string-literal lexer in styleScan.test.ts. dev.ts and spectrogram.ts are exempt from the scan (dev harness has literal styles).
Screenshot: TODO

### 2026-11-24 - ghost-tape-ui task 1.3: copy.ts and copy scan
Feature: spec
What I did: Asked Kiro to execute task 1.3 of the ghost-tape-ui spec.
What Kiro did: Added src/ui/copy.ts (20 draft groups, demo tape, three examples), tests/unit/ui/copyScan.test.ts and tests/support/lexer.ts (lexer moved out of styleScan.test.ts, which now imports it). Scan is a lexer scan, not the TypeScript compiler API, because typescript 7.0.2 has none.
What changed / what I learned: `vitest run tests/unit/ui/` passed 3 files, 55 tests, including the demo tape at most 15.0 s at 44100 and 48000 Hz. design.md still says "compiler API" and should say "lexer scan".
Screenshot: TODO
### 2026-11-24 - ghost-tape-ui task 1.5: UI test harness
Feature: spec
What I did: Asked Kiro to execute task 1.5 of the ghost-tape-ui spec.
What Kiro did: Added tests/support/uiRuns.ts (`fcUi`, seed from runs.ts, at least 100 runs), fakeAudioPort.ts (`implements AudioPort`, auto or manual settling, injectable clock), synthFeed.ts (real `serializePayload` and `crc32`, seeded), tests/unit/ui/harness.test.ts and networkScan.test.ts (allow-list: `fetchAsset` in audioPortImpl.ts). vitest.config.ts includes tests/**/ui/**; dev deps jsdom, axe-core, jsqr added.
What changed / what I learned: `npm test` (typecheck plus vitest) passed 32 files, 484 tests, 1 skipped. The jsdom, axe-core and jsqr packages are installed but no test uses them yet. The demo asset fetch has no allow-list entry yet because no such call exists.
Screenshot: TODO
### 2026-11-24 - ghost-tape-ui task 1.4: router, shell, announcer and boot
Feature: spec
What I did: Asked Kiro to execute task 1.4 of the ghost-tape-ui spec.
What Kiro did: Added src/ui/routes.ts, router.ts, shell.ts, shell.css, announcer.ts, app.ts, five stub pages in src/ui/pages/; rewired main.ts (dev harness only at `/?dev` in dev builds) and index.html; added copy strings. Tests: router.prop (P25), announcer.prop (P26), shell.test and router.test (jsdom).
What changed / what I learned: `npm test` passed 36 files, 506 tests, 1 skipped. `/index.html` maps to home (design text), so P25's "every other path is notFound" excludes it. Not run in a browser.
Screenshot: TODO
### 2026-11-25 - ghost-tape-ui task 2.1: layout hint parser
Feature: spec
What I did: Asked Kiro to execute task 2.1 of the ghost-tape-ui spec.
What Kiro did: Added src/ui/darkroom/layoutHint.ts (`parseLayoutHint`, `layoutFromPayload`, limits from `LIMITS`, `LAYOUT_CONFIDENCE_MIN` from tokens.ts), tests/properties/ui/layoutHint.prop.test.ts (P1, P2 with fcUi) and tests/unit/ui/layoutHint.test.ts (reject rules).
What changed / what I learned: The two layoutHint files passed 14 tests; `tests/unit/ui` passed 8 files, 91 tests; `npm run typecheck` is clean. No spec issue found. Full `npm test` not run.
Screenshot: TODO

### 2026-11-25 - ghost-tape-ui task 2.2: glyph model and Symbol history
Feature: spec, PBT
What I did: Asked Kiro to execute task 2.2 of the ghost-tape-ui spec (glyphs.ts, history.ts, glyphs.prop.test.ts).
What changed / what I learned: P4 and the pure part of P5 pass (10 tests, fcUi, seeded); `npm run typecheck` and `vitest run tests/unit/ui` (8 files, 91 tests) pass. The reducer part of P5 (history unchanged across `pass-complete`) is not covered yet. The `update_pbt_status` tool did not find task "2.2" in tasks.md, so no status was recorded.
Screenshot: TODO
### 2026-11-25 - ghost-tape-ui task 2.3: kind detection and darkroom reducer
Feature: spec, PBT
What I did: Asked Kiro to execute task 2.3 (state.ts, kind.ts, reduce.ts, darkroom.prop.test.ts, unit/ui/darkroom.test.ts).
What changed / what I learned: P3, P5, P6, P7, P8, P9, P11 and 6 unit cases pass (25 tests); `npm run typecheck` clean; `vitest run tests/unit/ui` 9 files, 97 tests. Design deviations: (1) P8/R10.9 conflict: a discard restores glyphs, history, hint, sheet, clarity and parts, but keeps the pass number and stops the countdown; (2) `already-received` acts only for the developed tapeId (R9.8); (3) `nextWakeMs` returns a delay, not a time. Countdown display math is a stub in the test until task 2.4.
Screenshot: TODO
### 2026-11-24 - Spec: alignment rule S9 (adaptive pass check + run gating)
Feature: spec
What I did: Chose option B for the alignment rule (pass-level 1-in-1000 check plus per-run gating), with option C (1 in 100) as the fallback if B was not green this session.
What Kiro did: Built alignmentReading/keptSymbols/dropUnkept in src/modem/accumulator.ts, gating and level-gated timing tracking in decoder.ts; unit tests, 9 combining tests moved to 140-character ghosts; mutations caught: gating off (1 test), both-pilots rule (37), no confidence filter (2), 1/100 bound (5), tracking gate off (2 of 3 seeds).
What changed / what I learned: Noise payloads accepted 0–1/300 (was 9–67%). Partly drowned plays now combine: 140 B and 560 B 30/30, 30 B ghost 1/30 (pass check needs all 4 pilots). measure:passes at −10 dB: 0/25/30 by pass 1/2/3 (was 0/29/30). Two findings on the way: repeated characters put 34% of data symbols on the pilot tone (chance is now estimated from unclear decisions only), and 17 s of drowned audio walked the clock tracker away (560 B noise-first play accepted 2/6 before the fix).
Screenshot: TODO
### 2026-11-25 - ghost-tape-ui task 2.4: timeline, view model, sheet geometry
Feature: spec, PBT
What I did: Asked Kiro to execute task 2.4 (timeline.ts, viewModel.ts, sheet.ts, jcard/jcardLayout.ts, darkroomTimeline.prop.test.ts).
What changed / what I learned: `shownRemainingSec` moved from reduce.ts to timeline.ts. P11 (countdown), P12, P32, P34 pass (15 tests, fcUi); `npm run typecheck` clean; `vitest run tests/unit/ui tests/properties/ui` 15 files, 153 tests. Spec gap: the reducer has no reduced-motion input, so `developedView(state, { reducedMotion })` reveals in the `fixing` phase. New geometry constants are in tokens.ts. Task not ticked; `update_pbt_status` not used.
Screenshot: TODO
### 2026-11-25 - ghost-tape-ui task 2.5: carrier table, demo audio, Receive URL
Feature: spec, PBT
What I did: Asked Kiro to execute task 2.5 (carriers.ts, receiveUrl.ts, scripts/make-ui-demo.mjs, package.json scripts, 3 test files).
What changed / what I learned: P29 and P30 pass (carriers, demo, examples: 25 tests, ~0.6 s); demo is 13.90 s at 48000 Hz. `demo:ui` hashes its inputs (copy.ts, carriers.ts, wav.ts, src/modem) and takes 0.15 s when up to date, 0.9 s when it regenerates. `npm test`: 45 files, 601 passed, 1 skipped, 21 s wall. R27.1 scan checks literals and identifiers; computed strings are not seen. Task not ticked.
Screenshot: TODO
### 2026-11-25 - ghost-tape-ui task 2.6: tape link fragment codec and link cap
Feature: spec, PBT
What I did: Asked Kiro to execute task 2.6 (src/ui/fragment.ts, tests/properties/ui/fragment.prop.test.ts).
What changed / what I learned: P17 and P18 pass (8 tests, fcUi); `npm run typecheck` clean; `vitest run tests/unit/ui tests/properties/ui` 19 files, 186 tests. Hand-rolled strict base64url (canonical trailing bits). Measured: a tape at every field limit serializes to 1509 bytes, a 2047-character link at https://ghost-tape.pages.dev, so the cap fires (design D-text says 1024 bytes / 1401 characters). Task not ticked.
Screenshot: TODO
