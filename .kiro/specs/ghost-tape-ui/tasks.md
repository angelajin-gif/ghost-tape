# Implementation Plan: Ghost Tape UI

Matches `requirements.md` and `design.md` (both approved). One developer plus Kiro, Nov 24 to Nov 30 (7 days). Polish and the video are Dec 1 to Dec 3 and are not in this plan.

## Overview

Build order: foundation and the AudioPort gate, then pure logic with property tests, then replay feeds and the darkroom, then the composer, then link, QR, player and Side B, then the PWA and accessibility, with the four cut-list items last. Every never-cut flow is built against the `AudioPort` fake.

## Schedule

| Day | Theme | Tasks |
|---|---|---|
| Nov 24 | Gate and foundation: AudioPort check, tokens, copy, router, test harness | 1.1 to 1.5 |
| Nov 25 | Pure darkroom logic and shared data, all property-tested | 2.1 to 2.6 |
| Nov 26 | Replay feeds, file feeder, darkroom views, home/demo, receive | 3.1 to 3.6 |
| Nov 27 | Composer: validation, duration, J-card, REC, send options, download audio | 5.1 to 5.5 |
| Nov 28 | QR, Tape-player, Side B broadcaster, broadcast hand-off, service worker | 6.1 to 6.5 |
| Nov 29 | PWA assets, bundle checks, offline check, accessibility, then the first optional items | 8.1 to 8.6 |
| Nov 30 | Buffer and manual device checks, final gates, then the last optional items | 9.1 to 9.4 |

Day labels are in each task title. The dependency graph at the end gives the order for parallel scheduling; it follows the day order.

## Ground rules

- **Prerequisite:** modem task 15 (browser adapters) is due Nov 23 and is assumed done. Task 1.1 is the first thing on Nov 24: it checks the real adapters in `src/audio/` against the `AudioPort` assumptions in `design.md` and adapts the port. Everything else is built against the `AudioPort` fake (task 1.5), so no day waits on hardware.
- **Done means:** the named property tests pass with `fcUi()` (fixed seed, at least 100 runs, R37.2), every new pure function with an inverse has a round-trip test, every end-to-end Darkroom test runs on feeds recorded through `src/modem/channel.ts` (never a perfect channel only), `npm run typecheck` is clean, and a `KIRO_LOG.md` entry is appended under `## Entries` using the template in that file (steering rule `kiro-log`; facts only, under 8 lines, `Screenshot: TODO`). The agent writes the entry after finishing the task. Never record a result that was not run.
- **Tests belong to their task.** The test work is part of each task's definition of done, not a separate optional item. Only the cut-list items are marked `*`.
- **Cut order if time runs short (first cut first):** track search buttons (R17, task 9.4) then save-as-image polish (R15, task 9.3) then composer flip animation (R18.4, task 8.6) then Side B examples polish (R29, task 8.5). These four are the only optional tasks. They sit on Nov 29 and Nov 30, after every never-cut task and after the offline verification.
- **Never-cut list, in build order:** demo-first landing and darkroom development (R1 to R12), REC plus send link and QR (R21 to R24), download audio (R25), a working Side B broadcast and receive (R13, R28), offline PWA (R31).
- **Do not touch `src/modem/`** (R37.7). If a change there is needed, stop and ask the developer.
- **Git:** the developer asked for implement, test, tick, commit and push after each task. Each commit adds only the files that task created or changed (explicit paths, never `git add -A`), plus `KIRO_LOG.md` and `tasks.md`. Files under `src/modem/` and the other session's changes (for example `src/modem/accumulator.ts` and `tests/unit/accumulator.test.ts`) are never staged.
- **Steering:** `.kiro/steering/structure.md` was updated directly on Nov 24 per the developer (UI and audio additions). No other steering file is touched by this plan.
- **Developer confirmations:** the R7.10 exemption for provisional Glyphs below confidence 1 from the text-contrast ratios (design I4) is confirmed. Skip on the demo file also stops the speaker (design decision D9) is confirmed.
- **Copy is draft.** Every string is a placeholder in `src/ui/copy.ts` until the developer replaces it before Nov 28 (R38.4). No task waits for the final copy.

## Tasks

- [x] 1. Nov 24: Gate and foundation
  - [x] 1.1 (Nov 24) Gate: verify the task-15 adapters against the `AudioPort` assumptions and adapt the port
    - Do this first. Read `src/audio/mic.ts`, `capture.worklet.ts`, `decoder.worker.ts`, `protocol.ts`, `file.ts`, `playback.ts`, `wav.ts` and `src/ui/dev.ts`. Compare each row of the design's "Assumed from task 15" table and each method of `AudioPort`: constraints all `false`; one worker message per `push()` or `flush()` result; empty results post nothing; file decode rate and mono mixing; whether the worker can run `encodePayload` with a timeout; playback and loop; Wake Lock; sample-rate handling.
    - Write `src/ui/audioPort.ts` (types, `MicFailure`, `ListenSession`, `PlayHandle`, `FeedSession`, `AudioPort`) adapted to what the adapters really expose. Write `src/audio/audioPortImpl.ts` that implements it over the existing files, adding only what is missing (`encode` message, `workerClient.ts`, `passScheduler.ts`, `wakeLock.ts`, offline 48000 Hz file decode) as small additions. Do not change `src/modem/`.
    - For every mismatch, change the port (not the plan), list it in a table at the top of `src/ui/audioPort.ts`, and append a `KIRO_LOG.md` entry that names the mismatch and the change. A mismatch that cannot be absorbed in `audioPortImpl.ts` (for example batches split across messages) is reported to the developer and covered by the 120 ms grace (I7).
    - Done: `npm run typecheck` passes; `audioPort.ts` compiles against the real adapters; a unit test with a fake `Worker` shows the batch grouping the real worker core produces (one array per `push()`); `KIRO_LOG.md` has one entry listing every mismatch, or one entry saying none were found.
    - _Requirements: 3.2, 3.4, 12.3, 33.1, 37.1; design I6, I7, K3, K4_

  - [x] 1.2 (Nov 24) Design tokens, palettes and contrast table
    - `src/ui/tokens.css` and `src/ui/tokens.ts` with identical names and values: both palettes (six colours each), type scale, spacing, motion durations, `KIND_CONFIDENCE_MIN` 0.6, `LAYOUT_CONFIDENCE_MIN` 0.6, `FLICKER_BELOW` 0.75, `FIX_TOTAL_MS` 1300 and the other "values fixed in design". `CONTRAST_PAIRS` with the 22 pairs from the design. Effective motion tokens under `prefers-reduced-motion` (0 or at most 200 ms) and a reduced-motion store.
    - `tests/unit/ui/tokens.test.ts`: P31 (contrast ratios by the WCAG formula, at most six colours per palette, CSS and TS values equal, reduced-motion values, body size at least 16 px, Glyph pair at confidence 1 declared). `tests/unit/ui/styleScan.test.ts`: no literal colour, font family, font size, spacing or duration outside the token files (R36.4; `@media` lines exempt).
    - The R7.10 exemption for provisional Glyphs below confidence 1 is confirmed by the developer (design I4); the contrast table covers a Glyph at confidence 1 only.
    - Done: P31 and the style scan pass.
    - _Requirements: 7.10, 32.2, 32.9, 36.1, 36.3, 36.4, 36.6, 36.9, 36.10; Property 31_

  - [x] 1.3 (Nov 24) `src/ui/copy.ts` with draft strings and the scan test
    - One module, header comment marking every string as a draft (R38.4). Groups as in the design (`app`, `nav`, `home`, `demoTape`, `permission`, `micErrors`, `darkroom`, `notices`, `actions`, `compose`, `cassette`, `rec`, `validation`, `send`, `player`, `broadcast`, `examples`, `print`, `a11y`, `errors`). Strings with numbers are functions of the number (R38.3). Include the quoted drafts from `requirements.md` and the placeholder demo tape (title "A tape from the other side", from "A ghost", to "You", date 2026-10-31, tracks "Static Lullaby" and "Hiss and Hum", letter "Tapes remember what we forget. This one kept a voice for you.") and the three examples with a placeholder exhibition label. No profile name or id in any string (R27.6).
    - `tests/unit/ui/copyScan.test.ts`: TypeScript compiler API scan of `src/ui/**/*.ts` (not `copy.ts`, not `tokens.ts`) for user-visible literals and visible-text assignments, with a documented allow-list for URLs and selectors (R38.5). The scan must run clean on the code written later in this plan.
    - Done: scan test passes on the files that exist; a deliberately bad fixture string makes it fail.
    - _Requirements: 3.1, 9.1, 27.6, 29.1, 36.5, 38.1 to 38.6_

  - [x] 1.4 (Nov 24) Router, shell, announcer and boot
    - `src/ui/routes.ts`, `router.ts` (`matchRoute` total and pure; History API, `popstate`, unmount hooks), `shell.ts` (nav with Receive and Compose on every route, one `h1`, `main`, not-found notice, update and offline-ready slots), `announcer.ts` (polite live-region queue with keyed de-duplication), `app.ts`. Rewire `src/main.ts` and `index.html` to boot `app.ts`; keep `src/ui/dev.ts` reachable in dev builds only. Route modules are lazy `import()` boundaries (`receive`, `compose`, `player`, `broadcast`); stubs that render the route heading are enough today.
    - Leaving a Darkroom route calls the route's `unmount` (stop mic, stop playback) on link, back and forward (R30.7). Every error state has a next-action control (R30.6).
    - `tests/properties/ui/router.prop.test.ts` (P25) and `announcer.prop.test.ts` (P26); jsdom example tests for the nav and the not-found notice.
    - Done: P25 and P26 pass; all five paths render a heading and nav in jsdom; typecheck clean.
    - _Requirements: 14.4, 30.1 to 30.7, 32.4, 32.7, 32.10; Properties 25, 26_

  - [x] 1.5 (Nov 24) UI test harness
    - `tests/support/uiRuns.ts` (`fcUi(numRuns = 100)`, fixed seed from `runs.ts`, at least 100 runs). `vitest.config.ts`: include `tests/**/ui/**` and jsdom for files marked `// @vitest-environment jsdom`. Add dev dependencies `jsdom`, `axe-core`, `jsqr` (test only).
    - `tests/support/fakeAudioPort.ts` (`FakeAudioPort`: records `ensureContext`, `listen`, `encode`, `play`, `schedule`, lets a test push batches and resolve or reject calls, injectable clock). `tests/support/synthFeed.ts` (unit-test fixture only: `header`, `progress` snapshots, `pass-complete`, `complete` built from the real `serializePayload` and `crc32`, seeded). `tests/unit/ui/networkScan.test.ts`: fails if any `src/` file calls `fetch`, `XMLHttpRequest` or `navigator.sendBeacon` with tape, payload or recording data (the demo asset fetch is on a documented allow-list) (R34.5).
    - Done: a sample property test using `fcUi()` runs 100 cases with the fixed seed; the fake port and synth feed have their own small unit tests; `npm test` still passes.
    - _Requirements: 34.5, 37.2, 37.4, 37.10_

- [ ] 2. Nov 25: Pure darkroom logic and shared data
  - [x] 2.1 (Nov 25) Layout hint parser
    - `src/ui/darkroom/layoutHint.ts`: `parseLayoutHint(bytes, conf, has, payloadLength)` as in the design (seven steps, exact-sum rule, never throws, reads only prefix bytes) and `layoutFromPayload(payload)` through `serializePayload` and the same parser. Limits come from `LIMITS` in `src/modem/tape` (deep import).
    - `tests/properties/ui/layoutHint.prop.test.ts`: P1 (round trip with the `arbitraries.ts` tape generator), P2 (corruption: random bytes, confidences, `has`, `payloadLength`, plus mutations of valid serializations).
    - Done: P1 and P2 pass; unit cases for each reject rule (limits, all-zero trio, track count over 10, unknown prefix, doodle flag not 0, sum mismatch, `payloadLength` 0 or unknown).
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.7, 6.9, 6.10, 6.11, 6.12; Properties 1, 2_

  - [x] 2.2 (Nov 25) Glyph model and Symbol history
    - `src/ui/darkroom/glyphs.ts` (`glyphOpacity`, `glyphBlurPx`, `glyphChar`, `flickerStep`, `displayedByte` with fixed integer hash, no `Math.random`) and `history.ts` (`SymbolHistory` with depth 8, `recordValue`, ring replacement, copy-on-write helper).
    - `tests/properties/ui/glyphs.prop.test.ts`: P4 (monotone opacity and blur, endpoints, all 256 byte values exhaustive) and the pure part of P5 (membership, fewer than two values steady, reduced motion steady, same arguments same result, at most 8 values per position).
    - Done: P4 and the pure part of P5 pass.
    - _Requirements: 7.1 to 7.9; Properties 4, 5_

  - [x] 2.3 (Nov 25) Kind detection and the darkroom state machine with batch handling
    - `src/ui/darkroom/state.ts`, `kind.ts` (`detectKind`), `reduce.ts` (`reduceDarkroom`, `reduceBatches`, `nextWakeMs`) with the transition table from the design: checkpoint at `header` and restore at `pass-discarded`, `pendingFaint` armed only when the batch holds no `complete` for the same `tapeId`, notice keys (never English text), `already-received`, Single-line switch in the same reduce call, `complete` choosing the layout from `payload.kind`, second `complete` ignored, `reset`. The reducer takes `nowMs` as an argument and has no clock or randomness.
    - Tests: `tests/properties/ui/darkroom.prop.test.ts` with P3 (kind detection), P5 (history membership across the reducer, history unchanged by `pass-complete`), P6 (no Fixing without `complete`; only `reset` leaves Fixing), P7 (progress application and coalescing), P8 (discarded pass restores the checkpoint), P9 (still-faint batch rule and 120 ms grace), P11 (pass, clarity and countdown rules; countdown anchor math can use a stub until 2.4). Generators use `synthFeed` event constructors.
    - Done: P3, P5, P6, P7, P8, P9, P11 pass; unit cases for a batch holding `pass-complete` then `complete`.
    - _Requirements: 4.1 to 4.11, 5.1 to 5.11, 7.7, 8.6, 9.1 to 9.10, 10.1 to 10.9, 13.1, 13.9, 37.5; Properties 3, 5, 6, 7, 8, 9, 11_

  - [-] 2.4 (Nov 25) Timeline, view model and sheet geometry
    - `darkroom/timeline.ts` (`fixProgress`, Safelight state, countdown from the anchor), `viewModel.ts` (`developedView`: `text` set iff phase is `fixing` or `developed`, `revealed` iff `developed`, `controlsEnabled`), `sheet.ts` (Generic, J-card and Single-line geometry from lengths and width), `jcard/jcardLayout.ts` (slot rectangles shared by the Darkroom and the Composer).
    - `tests/properties/ui/darkroomTimeline.prop.test.ts`: P12 (fixing timeline, glyph bytes equal `serializePayload(payload)`), P34 (hidden then revealed, `FIX_TOTAL_MS` at most 1500, reduced motion within one frame), P32 (sheet geometry; slots inside the sheet and not overlapping), and the countdown part of P11.
    - Done: P11, P12, P32, P34 pass.
    - _Requirements: 4.3, 6.4, 8.1 to 8.7, 10.2, 10.3, 13.1, 13.2, 14.1; Properties 11, 12, 32, 34_

  - [ ] 2.5 (Nov 25) Carrier table, demo tape, demo audio script, examples and Receive URL
    - `src/ui/carriers.ts` (one table: `link`, `file`, `demo` to `standard`, `broadcast` to `robust`; `capBytes`), `receiveUrl.ts` (`origin + '/receive'`, no mode hint). `scripts/make-ui-demo.mjs` writes `src/ui/assets/ghost-tape-demo.wav` from the demo text in `copy.ts` (`npm run demo:ui`); add `demo:ui`, `predev`, `prebuild`, `pretest` scripts to `package.json`; add `src/ui/assets/*.wav` to `.gitignore`.
    - `tests/unit/ui/carriers.test.ts`, `demo.test.ts`, `examples.test.ts`: P29 (demo `serializePayload` ok; `durationSec` at most 15.0 at 44100 and 48000, expected 13.9 s; the shipped WAV decodes to the demo tape field by field; a changed letter with an unchanged WAV fails and names the demo audio file as stale) and P30 (exact four keys, mappings, no profile name or id in any string, every example 1 to 140 characters, no newline, passes `encodeText`, encodes with the `broadcast` profile at both rates, every encoded `copy.ts` string passes the charset check).
    - Done: P29 and P30 pass; the added test time is measured and logged.
    - _Requirements: 2.1 to 2.7, 27.1 to 27.7, 29.3 to 29.6, 38.6; Properties 29, 30_

  - [ ] 2.6 (Nov 25) Tape link fragment codec and link cap
    - `src/ui/fragment.ts`: `encodeFragment`, `decodeFragment` (version prefix `1`, unpadded base64url, strict `deserializePayload`, never throws), `buildTapeLink(origin, payload)` with the 2000-character cap as a pure length check.
    - `tests/properties/ui/fragment.prop.test.ts`: P17 (round trip; alphabet; rejection of empty, unknown version, bad characters, length 1 mod 4, random base64url, mutated fragments), P18 (link cap with injected long origins; payload only after `#`).
    - Done: P17 and P18 pass.
    - _Requirements: 22.1 to 22.5, 22.9, 23.1, 23.2; Properties 17, 18_

- [ ] 3. Nov 26: Replay feeds, darkroom views, home, receive
  - [ ] 3.1 (Nov 26) Replay-feed recorder and darkroom replay tests
    - `tests/support/replay.ts` `recordFeed({ payload, profile, rate, channel, seed, passes })`: `encodePayload`, `damagePasses` from `src/modem/channel.ts` with derived seeds, 1024-sample chunks into the real `createDecoder`, one array per `push()` result, plus the `flush()` batch. The nine feeds from the design (`clean`, `noisy-ok`, `noisy-fail`, `noisy-three-pass`, `reverb`, `phone-band`, `dropout`, `noise-only`, `robust-ghost`), generated once and cached; at least one ends with `complete` and at least one does not.
    - `tests/unit/ui/darkroomReplay.test.ts`: the reducer over every feed (batch grammar: `pass-complete` then `complete` in one array; clarity rises over `noisy-three-pass`; `dropout` shows the signal-lost notice and keeps the Paper; `noise-only` leaves the room empty). `tests/properties/ui/provisional.prop.test.ts` pure half of P10 (`developedView.text` defined iff a `complete` was reduced, for every prefix of every feed and for generated sequences; both controls enabled iff the same).
    - Done: replay tests pass; recording time per file is measured (target under 3 s) and logged; if over budget, move recording to a Vitest `globalSetup`.
    - _Requirements: 4.9, 11.2, 11.3, 11.7, 11.8, 37.3, 37.4, 37.5, 37.6; Property 10_

  - [ ] 3.2 (Nov 26) File feeder with pacing and Skip
    - `src/ui/feeder.ts`: `createFeeder({ samples, rate, chunkSec, paceX, clock })` with fixed chunk boundaries by index (at most 1 s, default 0.5 s), release by the audio clock, `skip()` (idempotent, ignored after `finish`), exactly one `flush()`, no `reset()`, yield between chunks by a message-channel turn.
    - `tests/properties/ui/feed.prop.test.ts`: P24 (chunks at most 1 s, concatenation equals input, one `flush()` after the last chunk, no `reset()`, chunking invariance on a recorded feed) and P33 (any chunk size, any skip point or none or twice: same batches, same `flush()` result and same final `DarkroomState` as `paceX = Infinity`, over the `clean` and `robust-ghost` feeds).
    - Skip on the demo file also stops the speaker: the feeder's `skip()` is the signal the demo flow uses to stop the `PlayHandle` (confirmed by the developer, design decision D9).
    - Done: P24 and P33 pass.
    - _Requirements: 12.3, 12.4, 12.7, 12.9, 12.10; Properties 24, 33_

  - [ ] 3.3 (Nov 26) Darkroom views: canvas, developed text, J-card sheet, single-line mode
    - `darkroom/glyphCanvas.ts` (sprite cache keyed by character, blur level, cell size and device pixel ratio; dirty cells; one draw per animation frame; clears the cache on font load), `darkroomView.ts` (Safelight with text label, tray, status line "Not yet developed", pass number, countdown, clarity and parts recovered, notices, "played N times", Developed text written hidden at `complete` then revealed, controls `disabled` until `complete`), `controller.ts` (port batches to a queue, one `reduceBatches` per frame, `nextWakeMs` timer, announcements from `a11y` copy, calls `stop()` on `complete`), `jcard/jcardView.ts` in `develop` mode, Single-line paragraph for ghosts ("Save as image" and "Start over" only; no "Reply"). The view exposes callbacks `onStartOver`, `onReply`, `onSaveImage`. The Glyph layer is `aria-hidden` with no text nodes. "Save as image" renders only if `loadPrint` exists, so the control is simply absent if task 9.3 is cut (note this in `KIRO_LOG.md`).
    - jsdom tests with `FakeAudioPort` and recorded feeds: DOM half of P10 (letter text in `textContent` iff `complete`; Glyph layer adds 0 characters; both controls enabled iff `complete`; feeds ending in failure, stall or cancel never enable them); an announcement within 1000 ms for each event kind; the `robust-ghost` feed ends as a single paragraph and the `clean` feed ends as a J-card.
    - Done: P10 passes on all feeds; jsdom flow tests pass.
    - _Requirements: 4.1 to 4.11, 5.4, 7.1 to 7.10, 8.1 to 8.7, 9.1 to 9.10, 10.1 to 10.9, 11.1 to 11.8, 13.1 to 13.9, 14.1, 14.2, 14.4, 14.5, 32.4, 32.5, 32.8; Properties 10, 34_

  - [ ] 3.4 (Nov 26) Home page, demo loop, microphone permission flow
    - `pages/home.ts`: Darkroom with Safelight on, empty tray and demo card within 1000 ms; demo control; pre-permission panel (no `getUserMedia` before confirm; dismiss returns and shows again next time); `ensureContext` and `listen` in the click handler; `fetchAsset(demoUrl)` and `play`; mic errors (denied with "Try again" that skips the panel, no microphone, insecure context, rate outside 16000 to 48000) all offering the file path; "Play it again" (no `reset()`), "Decode the demo file instead" (feeder at 1x, plays aloud, with Skip), "no signal heard" hint, call to action after `complete`, controls disabled while a run is active, no replay control after `complete`, demo file load or decode error.
    - jsdom tests with `FakeAudioPort`: constraints object has all three flags `false`, microphone tracks stopped within 1 s of completion or error, unmount stops capture and playback within 500 ms.
    - Done: the demo flows pass on the `clean` feed through the fake port; typecheck clean.
    - _Requirements: 1.1 to 1.11, 3.1 to 3.9, 30.7_

  - [ ] 3.5 (Nov 26) Receive page: Listen, Upload, Start over
    - `pages/receive.ts` (lazy chunk): exactly two options "Listen" and "Upload an audio file"; Listen follows 3.4's permission flow; Upload uses `decodeFile` (48000 Hz offline decode, mono mixing), the feeder at 1x with Skip, one `flush()`, "could not be read as audio" and "No ghost track found in that file" messages, "Start over" calling `reset()` once and clearing Paper, history and messages; one `pass-complete` indication per pass in a multi-pass file.
    - jsdom flow tests with recorded feeds, including a file with three passes and a non-audio file.
    - Done: upload and listen flows pass with the fake port; messages come from `copy.ts` only.
    - _Requirements: 12.1 to 12.10, 3.5 to 3.8, 30.7_

  - [ ] 3.6 (Nov 26) Dev-only tooling: spectrogram, perf overlay, worker counters
    - `src/ui/spectrogram.ts` (dev builds only; renders a `Float32Array` at a sample rate on a canvas; tree-shaken from production), a `?perf=1` overlay (frame times ring buffer, median fps, longest frame; dev builds only), `createWorkerCore()` in the worker file if 1.1 shows it is missing, and worklet and worker sample counters.
    - `tests/unit/ui/workerCore.test.ts`: 60 s of synthetic frames through the worker core; samples delivered equal samples captured (R33.2). A Node benchmark of the reducer over 100 progress events of a 1024-byte tape (median under 1 ms per event).
    - Done: counters test and benchmark pass; a production build test shows the spectrogram is absent.
    - _Requirements: 33.2, 33.5, 33.9, 37.8_

- [ ] 4. Checkpoint (Nov 26) - Receiving works against the fake port
  - Ensure all tests pass, ask the user if questions arise. Confirm the demo, receive and darkroom flows pass on recorded feeds, the added `npm test` time so far is within budget, and `KIRO_LOG.md` has an entry for each finished task.

- [ ] 5. Nov 27: Composer, REC, send options, download audio
  - [ ] 5.1 (Nov 27) Character conversion, validation, plain-language mapping and broadcast suggestion
    - `composer/convert.ts` (`convertChars` with the fixed table, CR LF handling for the letter only, idempotent, returns `{ text, converted }`), `draft.ts` (`Draft`, `draftToPayload`), `validate.ts` (pre-checks in the design order, all field errors at once, counters "N of limit", unsupported-character highlight ranges, newline outside the letter, date range 2000-01-01 to 2255-12-31, trio empty, size cap through the Carrier table), `messages.ts` (`messageForReason` over every reason pattern, generic fallback, `fieldLabel`), `broadcastSuggest.ts` (`suggestBroadcast(letter, title)`).
    - Tests: `convert.prop.test.ts` (P13), `validate.prop.test.ts` (P14: errors empty iff `serializePayload` succeeds within the cap; no modem reason text, `U+`, `tracks[`, profile name or byte count of internals in any message; REC disabled iff errors), `broadcast.prop.test.ts` P20 part (length, no newline, word boundary, empty on non-charset, passes `encodeText`).
    - Done: P13, P14, P20 pass.
    - _Requirements: 19.1 to 19.15, 26.2 to 26.4, 27.4, 27.6; Properties 13, 14, 20_

  - [ ] 5.2 (Nov 27) Closed-form duration, cassette length and throttle
    - `composer/duration.ts` (`estimateDurationSec` from `geometry`, `payloadSymbolCount`, `frameLayout`, `sampleAtMs`, `profileByName` by read-only deep imports), `cassette.ts` (`takeUpRadius`, `TAPE_MIN_SEC` 7.525, `TAPE_MAX_SEC` 66.4), `throttle.ts` (leading edge plus trailing call, injectable clock).
    - `tests/properties/ui/duration.prop.test.ts`: P15 against `encodePayload` for both profiles and both rates (100 small payloads, plus fixed 560 B and 1024 B Standard and 142 B Robust cases; difference under 0.1 s, non-decreasing in size, `{ ok: false }` over cap or invalid, non-decreasing radius) and P16 (at most one run per 400 ms window; last keystroke reflected within 400 ms).
    - Done: P15 and P16 pass; time of the duration test is logged against the 3 s estimate, and trimmed to the 50 random plus fixed cases if over.
    - _Requirements: 20.1 to 20.7; Properties 15, 16_

  - [ ] 5.3 (Nov 27) Composer page: J-card edit mode, tracks, draft store, reply prefill
    - `jcard/jcardView.ts` `edit` mode sharing `jcardLayout` with the Darkroom; `pages/compose.ts` (lazy chunk) and `composer/composerView.ts`: a real input or textarea with a label for every field (card art `aria-hidden`), `aria-describedby` messages, polite announcer, mirror-element highlight of unsupported characters, counters, conversion notices, REC key disabled while errors exist, tracks add and remove with the focus rules, "Add track" disabled at 10, Flip as an instant face swap (animation is task 8.6), live duration text and cassette, outdated-duration marking. `composer/draftStore.ts`: memory by default, `localStorage` only after the consent checkbox, deletion and confirmation within 1 s on withdrawal, blocked storage notice. Reply: `appState.prefill` (swapped `from` and `to`, nothing else carried), consumed once on mount; wire the Darkroom's `onReply` to navigate within 300 ms.
    - Tests: P28 in `tests/properties/ui/reply.prop.test.ts`; jsdom tests for focus order, label association, 44 px targets declared in tokens, consent flow, blocked storage, 360 px layout classes.
    - Done: P28 passes; the composer flows pass against `FakeAudioPort`; copy scan stays clean.
    - _Requirements: 14.3, 16.1 to 16.5, 18.1 to 18.3, 18.5 to 18.13, 19.11 to 19.13, 20.2, 20.5, 20.6, 32.6, 34.6, 34.7; Property 28_

  - [ ] 5.4 (Nov 27) REC key, generation and Download audio
    - `composer/recorder.ts`: one `encode` call per press through the port with the `link` Carrier profile and the context rate (48000 when the rate is neither 44100 nor 48000), presses ignored while generating, cassette spin within 500 ms (CSS transform), playback from the start within 500 ms, cassette stop within 200 ms, failure through `messageForReason`, content unchanged, static cassette with "recording" and "done" under reduced motion, 56 px key operable with Enter and Space. `composer/fileName.ts` (`wavFileName`), Download audio (`encodeWav`, re-encode only if the `file` profile differs, length in seconds and size in MB shown before the download, 44-byte header, retry after failure without regenerating).
    - Tests: P23 WAV half in `tests/properties/ui/fileName.prop.test.ts`; jsdom tests: `encode` called once per press, second press ignored, failure keeps the text.
    - Done: P23 (WAV) passes; REC and download flows pass with the fake port; the downloaded WAV decodes with the real decoder to the original tape in a test.
    - _Requirements: 21.1 to 21.9, 25.1 to 25.7, 27.3; Property 23_

  - [ ] 5.5 (Nov 27) Send a link: copy, share, too-long and clipboard failure
    - `composer/sendOptions.ts`: "Send a link" through `buildTapeLink` with the page origin, "Copy link" with confirmation within 500 ms through the polite region, selectable link text and message on clipboard failure, "Share" only where `navigator.share` exists, too-long link message that points to "Download audio" and keeps track and audio, options shown as soon as generation succeeds.
    - Done: jsdom tests with a fake clipboard (success, failure, share present and absent) and a long injected origin pass.
    - _Requirements: 21.4, 22.1, 22.4 to 22.8_

- [ ] 6. Nov 28: QR, Tape-player, Side B, service worker
  - [ ] 6.1 (Nov 28) QR generator and view
    - `src/ui/qr.ts` (`encodeQr`, byte mode, level M, versions 1 to 6, RS parity from `rsEncode` in `src/modem/reedSolomon.ts`, eight masks scored, format bits; failure result for empty or over 100 characters, never throws) and `qrView.ts` (canvas, whole-pixel modules from `modulePx = min(10, floor(width / (N + 8)))`, quiet zone 4, black on white, URL shown as text on failure). Both in the `qr` lazy chunk.
    - `tests/properties/ui/qr.prop.test.ts`: P19 with `jsqr` over 20 fixed URLs (lengths including 14, 26, 42, 62, 84, 100) plus seeded random ones, the 100, 101 and 0 length cases, smallest version chosen, module size at least 6 px and symbol at least 200 px at 328 px width.
    - Done: P19 passes; the 36-character Receive URL is version 3.
    - _Requirements: 24.1 to 24.9; Property 19_

  - [ ] 6.2 (Nov 28) Tape-player page
    - `pages/player.ts` (lazy chunk): decode the fragment, validate with `deserializePayload`, `history.replaceState` to drop the fragment, closed envelope with title and from only (letter and tracks not in the DOM), encode through the port with the `link` profile and the 10 s timeout, "Play the tape" and "Open it here" disabled until ready, "damaged or incomplete" state with a Receive link and no play controls, "could not be prepared" state, QR of the Receive URL with the copy line, "Open it here" runs the demo-loop controller from 3.4 in the Darkroom and shows the payload only after `complete`.
    - jsdom tests: valid link, bad links (empty, unknown version, bad characters, truncated), encode failure and timeout, reload after `replaceState`.
    - Done: flows pass with the fake port; the sealed envelope shows no letter text before `complete`.
    - _Requirements: 23.1 to 23.10, 24.1, 24.2, 24.7_

  - [ ] 6.3 (Nov 28) Side B broadcaster: pass scheduler, pass counter, wake lock
    - `passClock.ts` (`passIndexAt`), `src/audio/passScheduler.ts` and `wakeLock.ts` if not added in 1.1, `pages/broadcast.ts` (lazy chunk): message field 1 to 140 characters validated with the ghost rules, ON AIR disabled with a plain message when invalid, one pass encoded with the `broadcast` profile and scheduled on the audio clock with 1 s gaps, pulsing light (steady under reduced motion), pass counter from the audio clock, edit-while-on-air (valid: next pass boundary, counter reset, notice; invalid: keep looping, show error), Stop within 200 ms, playback-failed state, wake lock with unsupported note, QR of the Receive URL at least 200 px wide at 360 px, no horizontal scroll at 360 px.
    - `tests/properties/ui/passClock.prop.test.ts`: P21. jsdom tests with `FakeAudioPort.schedule` for the on-air, edit and stop flows.
    - Done: P21 passes; the broadcaster flows pass with the fake port.
    - _Requirements: 19.14, 24.1, 24.6, 28.1 to 28.13; Property 21_

  - [ ] 6.4 (Nov 28) "Make it a broadcast" hand-off and Side B end-to-end test
    - Wire the Composer option to `/broadcast` with `appState.broadcastSeed` (memory only), the "only the beginning fits" message before building, Composer title and letter kept on return. End-to-end test: the `robust-ghost` replay feed, and a looped two-pass Robust broadcast through `channel.ts`, drive the receiver to a single paragraph with passes combining and the clarity display updating.
    - Done: hand-off tests pass (empty or non-charset suggestion opens an empty field with the hint); the end-to-end test passes through the channel simulator.
    - _Requirements: 13.1 to 13.8, 26.1 to 26.6_

  - [ ] 6.5 (Nov 28) Service worker template, Vite plugin and update flow
    - `scripts/sw-template.js` (cache name with version hash, atomic `addAll` install, delete earlier `ghost-tape-` caches on activate, same-origin GET only, navigation falls back to cached `/index.html`, `SKIP_WAITING` message, no `skipWaiting()` on install), `scripts/vite-sw-plugin.mjs` writing `dist/sw.js` with the precache list, registration after the landing screen is interactive in production only, update notice within 5 s, apply on next load only when idle, never during a reception, playback or broadcast, "Ready to work offline" chip from real cache state.
    - `tests/unit/ui/serviceWorker.test.ts` with fake `caches`: install rejects when `addAll` rejects; after activate exactly one app cache remains; the update flow does not post `SKIP_WAITING` while a session is active.
    - Done: service worker unit tests pass; `npm run build` emits `dist/sw.js`.
    - _Requirements: 31.1, 31.5, 31.6, 31.7, 31.9_

- [ ] 7. Checkpoint (Nov 28) - Every never-cut flow works against the fake port
  - Ensure all tests pass, ask the user if questions arise. Confirm demo, receive, composer, REC, link, QR, player, download and Side B all pass in jsdom and replay tests; measure the `npm test` time added so far (limit 20 s); `KIRO_LOG.md` has an entry per finished task.

- [ ] 8. Nov 29: PWA, bundle, offline, accessibility, first optional items
  - [ ] 8.1 (Nov 29) Manifest, icons, `_headers`, fonts and README deploy steps
    - `public/manifest.webmanifest`, `public/icons/` (180, 192, 512, maskable 512), `public/_headers` exactly as in the design (CSP with `'self'` for `script-src` and `connect-src`, `Referrer-Policy: no-referrer`, one-year immutable cache for `/assets/*`, `no-cache` for `/`, `/index.html`, `/sw.js`, manifest), `index.html` links (manifest, apple-touch-icon, theme colour), `src/ui/fonts/` (EB Garamond Regular and Italic subset woff2, `OFL.txt`, `README.md` with the `pyftsubset` command, `font-display: swap`, system serif fallback). `README.md`: deploy steps for Cloudflare Pages in at most 10 lines, including the `curl -I http://<host>/` redirect check.
    - Tests: a unit test that parses `_headers` for each required header and the cache rules; a test that every character in `copy.ts` is in the font subset list; a scan that finds no `setAttribute('style'`.
    - Done: header, subset and style tests pass; the README deploy section is 10 lines or fewer.
    - _Requirements: 31.1, 34.3, 35.1 to 35.5, 35.8, 36.2, 36.8_

  - [ ] 8.2 (Nov 29) Build checks: bundle budget, dist completeness, lazy chunks
    - `vite.config.ts`: lazy chunks (`receive`, `compose`, `player`, `broadcast`, `qr`, `print`), worker and worklet outputs, the service worker plugin. `scripts/check-bundle.mjs`: gzip the first-load JS (module script plus `modulepreload` links), fail above 60000 bytes with the measured size and the budget in the message, report the `qr` chunk both ways (own code, budgeted at 6000 bytes; whole chunk with `reedSolomon`). `scripts/check-dist.mjs`: fail naming each missing file among the worker, worklet, demo WAV, `_headers`, manifest and `sw.js`, and fail if any `dist/` file other than `sw.js` and `_headers` is missing from the precache list. `package.json`: `build` runs typecheck, `vite build`, `check:dist`, `check:bundle`.
    - Done: `npm run build` passes; the measured first-load size and both QR figures are recorded in `KIRO_LOG.md` (measured, replacing the design estimates); a fixture with a deleted worker file makes `check-dist` fail with its name.
    - _Requirements: 24.3, 31.2, 33.6, 33.8, 35.1, 35.6, 35.7_

  - [ ] 8.3 (Nov 29) Offline verification on the production build (automated half)
    - `scripts/offline-smoke.mjs` (`npm run smoke:offline`), modelled on `scripts/browser-smoke.mjs`: serve `dist/` with `vite preview`, load once, wait for the service worker to activate, go offline through the browser protocol, reload each of the five routes, assert zero failed requests and that each route renders its primary content within 2 s; also asserts the demo audio, worklet and worker load from the cache.
    - Done: the script passes on the built app; failures name the route and the failed URL. The airplane-mode run on the Test phone is the manual script in task 9.1.
    - _Requirements: 30.3, 31.2, 31.3, 31.8_

  - [ ] 8.4 (Nov 29) Accessibility, contrast and reduced-motion pass
    - jsdom plus `axe-core` scan of every route in its main states (home before and after `complete`, receive with error, compose with errors, player valid and damaged, broadcast on air), `color-contrast` rule off (P31 covers contrast); asserts zero serious or critical violations. Checks: one `h1` and one `main` per route, no skipped heading levels, focus order and visible focus declared, targets at least 44 px (56 px for REC), live-region announcements for every listed event, Safelight state text label, no provisional text in any live region or accessible name, and a reduced-motion matrix (no flicker, spinning, pulsing or sliding; same states by static change).
    - Done: the scan and checks pass; every finding is fixed in the owning module, not suppressed.
    - _Requirements: 7.10, 21.6, 28.12, 32.1 to 32.10, 36.9_

  - [ ]* 8.5 (Nov 29) Side B examples buttons (cut-list item 4, cut last)
    - Three one-tap buttons "party secret", "exhibition label", "public notice" in `pages/broadcast.ts`: replace the whole field within 100 ms, update the counter, never start the broadcast; a failing example leaves the field unchanged and shows the "could not be loaded" error. Texts come from `copy.ts` (validity already covered by P30).
    - Done: jsdom tests for the three buttons and the failure path; copy scan clean; re-run the axe scan for the broadcast route.
    - _Requirements: 29.1, 29.2, 29.7_

  - [ ]* 8.6 (Nov 29) Composer flip animation (cut-list item 3)
    - Rotate the J-card faces over `--dur-flip` (500 ms) with all inputs kept mounted; reduced motion keeps the instant swap within 100 ms. Faces swap instantly if this task is cut.
    - Done: jsdom test that values persist across flips and that reduced motion applies no animation class; style scan clean.
    - _Requirements: 18.3, 18.4_

- [ ] 9. Nov 30: Buffer, manual device checks, final gates, last optional items
  - [ ] 9.1 (Nov 30) Buffer block: integration fixes and manual device checks (reserved)
    - First half of the day. Fix whatever broke in integration (failing tests, adapter mismatches, `check:bundle` or offline-smoke failures, task 1.1 mismatches still open). Then the developer runs the manual scripts on real devices, and the agent appends each result to `KIRO_LOG.md` with device, browser and date: (1) airplane mode on both devices, five routes reload offline, demo plays and decodes (R31.3, R31.8); (2) iOS Safari same-device demo loop, then the file fallback (design K1); (3) phone-to-phone Side B receive at 3 m; (4) 4x CPU-throttled desktop run and the Test phone run of a 1024 B Standard tape with `?perf=1`: median fps, longest frame, decoded bytes equal with and without animation, wall-clock decode at most 0.2x audio, worklet and worker counts equal over 60 s (R33.2, R33.5, R33.9), results in `docs/ui-perf.md`; (5) `curl -I http://<host>/` redirects and headers present on `/` and an asset (R34.3, R35.3). Thresholds `KIND_CONFIDENCE_MIN`, `LAYOUT_CONFIDENCE_MIN`, `FLICKER_BELOW` are tuned from real feeds if needed (design Q7), in `tokens.ts` only.
    - Done: every manual result is logged, including failures; no never-cut flow is left failing. Nothing is invented: a check that was not run is logged as not run.
    - **Slip order inside this block:** if the buffer runs out, the manual checks run in the order 1, 2, 4, 3, 5, and 9.3 and 9.4 are dropped without starting.
    - _Requirements: 31.3, 31.8, 33.2, 33.5, 33.9, 35.3, 34.3_

  - [ ] 9.2 (Nov 30) Final gates and handoff notes
    - `npm test` run on the Developer laptop: record the total and the time added by the UI tests (limit 20 s on the 60 s modem limit, total at most 80 s); trim per the design's fallback if over. `npm run build` including `check:dist` and `check:bundle`. Confirm `KIRO_LOG.md` has an entry for every finished task and that open items (copy still draft, Q4 origin, unrun manual checks) are listed.
    - If 9.3 or 9.4 lands, re-run `npm test`, `check:bundle` and the axe scan.
    - Done: test time, build and bundle figures logged; `KIRO_LOG.md` entries confirmed and open items listed.
    - _Requirements: 33.6, 33.8, 35.7, 35.8, 37.9_

  - [ ]* 9.3 (Nov 30) Save as image (cut-list item 2, cut second)
    - `print/layout.ts` (`planPrint`: sizes 36, 32, 28, greedy wrap, up to 4 pages, continuation marker, pure with an injected `measure`), `print/render.ts` (1080 by 1350 canvas, tokens only, seeded grain from `mulberry32`, fonts awaited, ghost print), `print/share.ts` (Web Share with files, else download; cancel is silent; failure shows an error and allows retry), `pngFileNames`, wired to the Darkroom's `onSaveImage` as a lazy `print` chunk. No payload bytes or identifiers in the PNG.
    - `tests/properties/ui/print.prop.test.ts`: P22 (1 to 4 pages, letter size rules, concatenation equals wrapped lines unless truncated, every line fits) and P23 PNG half (`-01.png`, `-02.png`, reading order).
    - Done: P22 and P23 pass; a jsdom test with a fake canvas covers render, share cancel and failure; first-load budget re-checked. If cut, the "Save as image" control stays absent (see task 3.3) and this is logged.
    - _Requirements: 13.7, 14.6, 15.1 to 15.10; Properties 22, 23_

  - [ ]* 9.4 (Nov 30) Track search buttons (cut-list item 1, cut first)
    - `trackSearchUrl(title)` (`https://www.youtube.com/results?search_query=` plus `encodeURIComponent`), one `<a target="_blank" rel="noopener noreferrer">` per track in the developed tape view, accessible name containing the full title, none for a tape with no tracks, none before `complete`, no request until activated.
    - `tests/properties/ui/trackSearch.prop.test.ts`: P27.
    - Done: P27 passes; jsdom test for one button per track and keyboard activation; first-load budget re-checked.
    - _Requirements: 14.6, 17.1 to 17.7; Property 27_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise. Report which optional tasks landed and which were cut.

## Notes

- Tasks marked `*` are the four cut-list items from `requirements.md` (Priority tiers) and are the only optional tasks.
- **What slips first** if the schedule is tight, in this order: 9.4 (track search), 9.3 (save as image), 8.6 (flip animation), 8.5 (Side B examples buttons). After those, the manual checks in 9.1 shrink in the order given there. Never-cut tasks (1.x to 3.x, 5.x, 6.x, 8.1 to 8.4, 9.1, 9.2) do not slip.
- Cutting 8.5 leaves the example texts in `copy.ts` and their P30 validity test in place. Cutting 8.6 leaves the instant face swap from 5.3. Cutting 9.3 leaves the control absent. Cutting 9.4 leaves no search buttons.
- Spec-level reminders for `KIRO_LOG.md`: a failing property is a spec question first (steering `tech.md`); a bug found by a property test is logged with its shrunk counterexample.
- Time budget: the design estimates about 18 s of added `npm test` time; the measured number is logged in 2.5, 3.1, 5.2 and 9.2.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "1.5"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.5", "2.6", "6.1"] },
    { "id": 3, "tasks": ["2.3", "5.1", "5.2", "6.5"] },
    { "id": 4, "tasks": ["2.4", "3.1", "6.3"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.6"] },
    { "id": 6, "tasks": ["3.4", "5.3"] },
    { "id": 7, "tasks": ["3.5", "5.4", "6.2"] },
    { "id": 8, "tasks": ["5.5", "8.1"] },
    { "id": 9, "tasks": ["6.4"] },
    { "id": 10, "tasks": ["8.2"] },
    { "id": 11, "tasks": ["8.3", "8.4"] },
    { "id": 12, "tasks": ["8.5", "8.6"] },
    { "id": 13, "tasks": ["9.1"] },
    { "id": 14, "tasks": ["9.2"] },
    { "id": 15, "tasks": ["9.3"] },
    { "id": 16, "tasks": ["9.4"] }
  ]
}
```
