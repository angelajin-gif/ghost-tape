# Requirements Document

Ghost Tape UI (screens, darkroom, composer, Side B)

## Introduction

This spec covers everything a person sees and touches in Ghost Tape: the demo-first landing page, the darkroom (receiving), the composer (sending), the tape-player link page, Side B (broadcasting), and the offline PWA shell. It consumes the finished modem library (`src/modem/`, spec `acoustic-modem`) and its browser adapters through their public API and decoder events, exactly as they exist. It does not change the modem. The source of the product decisions is `docs/ghost-tape-ui-brief.md`.

Visual direction: two worlds on one typographic system. Sending is the cassette world (J-card, spinning cassette, REC key). Receiving is the darkroom world (red safelight, a sheet of photographic paper in a developer tray). Both share editorial, exhibition-catalogue typography: generous whitespace, a refined serif, restrained colour. Tone is eerie and tender.

Every visual change in the darkroom corresponds to real decoder state. Nothing is faked.

### Prerequisites from acoustic-modem

| Modem task | Needed for | When |
|---|---|---|
| 12 Multi-pass accumulator | Passes combine, so "play it again" gets clearer | Done by Nov 23, before UI work starts |
| 15 Browser adapters | Mic AudioWorklet → Worker → decoder, playback including loop, file decode via `decodeAudioData`, WAV export | Due Nov 23; the only prerequisite still open from the modem side |
| 16, 17 Measurements and design update | Only the content of the Carrier profile table (Requirement 27) | Run in parallel; no UI work waits for them |

Task 13 (streaming decoder events) is done: `decoder.ts` emits `progress` events. This spec treats tasks 12 and 13 as done and task 15 as a prerequisite, and does not re-specify them. Replay feeds are recorded from the real Decoder through the Channel simulator (Requirement 37). A synthesized `progress` feed remains only as a unit-test fixture for exact event sequences, for example a batch holding `pass-complete` and `complete`.

### Accepted numbers

The following values are final decisions, not proposals: First-load JS budget 60 KB gzipped (Requirement 33.6); QR generator under 6 KB gzipped (Requirement 24.3); PNG size 1080 × 1350 pixels with up to 4 images (Requirement 15); Tape links capped at 2000 characters (Requirement 22.5); demo Ghost track at most 15.0 s at 44100 and 48000 Hz (Requirement 2.2); home route visible within 1000 ms (Requirement 1.1).

### Priority tiers

Each requirement is tagged with a tier from brief section 8. Design and tasks order work by tier, and cut from the highest number first.

- **Tier 0 (never cut):** demo-first landing, darkroom development, REC plus send link and QR, download audio, a working Side B broadcast and receive, offline PWA.
- **Tier 1 (cut last):** polish of Side B examples.
- **Tier 2:** composer flip animation.
- **Tier 3:** save-as-image polish.
- **Tier 4 (cut first):** track search buttons.

Requirements not named in the brief's cut order (accessibility, privacy, performance, routes, visual system) are Tier 0 because the never-cut features depend on them.

## Glossary

- **UI**: the browser application in `src/ui/`, with its browser adapters in `src/audio/`.
- **Modem**: the library in `src/modem/`, consumed through `src/modem/index.ts` and, for the tape format, a deep import from `src/modem/tape`.
- **Decoder**: the streaming decoder created by createDecoder in src/modem (push/flush/reset).
- **Decoder events**: the `DecoderEvent` union in `src/modem/types.ts`: `signal-detected`, `header`, `progress`, `pass-complete`, `complete`, `already-received`, `pass-discarded`.
- **Provisional byte**: a `ProvisionalByte` (`position`, `byte`, `confidence` in 0..1) from a `progress` event. It is not verified.
- **Verified payload**: the `Payload` carried by a `complete` event, or returned by `decodeFile`.
- **Darkroom**: the receiving screen: dark room, red safelight, a developer tray holding a sheet of photographic paper.
- **Safelight**: the red light element of the Darkroom. Its state is on, flicker or off.
- **Paper**: the sheet of photographic paper drawn in the tray. The Paper shows either the Generic sheet or the J-card sheet.
- **Generic sheet**: a Paper layout sized from `payloadLength` that has no field boundaries.
- **J-card sheet**: a Paper layout with slots for title, from, to, date, tracks and letter.
- **Glyph**: one provisional byte drawn on the Paper as a character, or as unexposed grain when no value is known.
- **Glyph layer**: the canvas (or aria-hidden) layer on which Glyphs are drawn. It holds no selectable text.
- **Developed text**: real, selectable DOM text for the letter, track list and fields. It exists only after a `complete` event.
- **Fixing moment**: the transition at `complete` in which all Glyphs snap sharp, the Safelight goes out and warm white light comes up.
- **Kind byte**: the first serialized payload byte (position 0): 0 for a tape, 1 for a ghost. The `header` event does not carry it.
- **Kind confidence threshold**: the minimum confidence of position 0 at which the Darkroom treats the Kind byte as known. A tunable value fixed in design.
- **Layout hint**: a best-effort J-card sheet layout derived from provisional bytes by the Layout hint parser. It is a layout only and never shows verified text.
- **Layout hint parser**: a pure function in `src/ui/` that reads field-length prefixes from provisional bytes, following the serialized layout in `src/modem/tape.ts`.
- **Accepted parse**: a Layout hint parser result in which every length is within the field limits of `LIMITS` and the lengths sum exactly to `payloadLength` (Requirement 6).
- **Symbol history**: for each position, the list of byte values reported for that position in earlier `progress` events of the same tapeId, plus the current one.
- **Real-history flicker**: Glyph flicker that alternates only among values in the position's Symbol history.
- **Reduced motion**: the state in which `prefers-reduced-motion: reduce` matches.
- **Composer**: the sending page with the life-size J-card.
- **J-card**: the life-size cassette inlay shown in the Composer, with a front (title, from, to, date, tracklist) and a back (letter). Each field is backed by a real input element.
- **Cassette**: the cassette graphic beside the J-card whose tape length grows with the content.
- **REC key**: the large button that generates the ghost track.
- **Ghost track**: the audio produced by `encodePayload`.
- **Tape-player page**: the page opened from a shared link that plays the Ghost track.
- **Tape link**: a URL to the Tape-player page whose fragment carries the serialized tape.
- **Receive URL**: the short URL of the Darkroom route with no payload. It is the target of every QR code.
- **QR generator**: the small self-contained module in `src/ui/` that renders a QR code from a string.
- **Side B**: broadcasting a short message that loops from a speaker.
- **Broadcaster**: the Side B screen with message field, ON AIR button, pass counter and QR code.
- **ON AIR light**: the pulsing light of the Broadcaster.
- **Single-line mode**: the Darkroom layout for ghost payloads: one paragraph of text (wrapping allowed), sized from `payloadLength`, no J-card.
- **Carrier**: how a Ghost track travels: `link`, `file` (audio file, voice message, video soundtrack) or `broadcast`.
- **Carrier profile table**: the single table in `src/ui/` that maps each Carrier to a modem profile name (Requirement 27).
- **Plain-language message**: a sentence for a non-technical reader that names the problem and the fix. It contains no profile names, byte counts of internals or field identifiers such as `tracks[3]`.
- **Design tokens**: colour, type and motion values defined in one place (Requirement 36).
- **Replay feed**: a test-only recorded sequence of `DecoderEvent` objects fed into the UI state machine.
- **Mid-range phone**: a phone from the last four years in the middle price tier. The developer's Test phone (iPhone 17 Pro) is faster than a Mid-range phone, so the performance check is also run with 4× CPU throttling in a desktop browser.
- **First-load JS**: gzipped JavaScript the browser downloads for the landing route, excluding the worker and worklet bundles.
- **Developer laptop** and **Test phone**: as defined in the acoustic-modem spec.

## Requirements

### Requirement 1: Demo-first landing page (Tier 0)

**User Story:** As a first-time visitor, I want to see a letter develop within one tap, so that I understand Ghost Tape by experiencing it.

#### Acceptance Criteria

1. WHEN the home route opens, THE UI SHALL show, within 1000 ms of the route becoming visible, the Darkroom with the Safelight on, an empty developer tray and a demo tape card titled "A tape from the other side".
2. WHEN the visitor taps the demo control, THE UI SHALL request microphone access (Requirement 3), then play the demo Ghost track through the speaker while the Decoder listens to the microphone of the same device.
3. WHILE the demo Ghost track is playing and listening, THE Darkroom SHALL follow Decoder events as defined in Requirements 4 to 11.
4. WHEN a `complete` event arrives for the demo tape, THE UI SHALL show the call to action "Now send a tape to someone." linking to the Composer route.
5. WHEN the demo Ghost track has finished playing and no `complete` event has arrived, THE UI SHALL offer "Play it again" and "Decode the demo file instead", and SHALL keep the Paper and Decoder state so that the next pass combines with the earlier one.
6. WHEN the visitor chooses "Play it again", THE UI SHALL play the demo Ghost track once more into the same Decoder without calling `reset()`.
7. WHEN the visitor chooses "Decode the demo file instead", THE UI SHALL decode the bundled demo audio file through the same paced file-decoding path as Requirement 12 (including its "Skip" control), and SHALL play the file aloud through the speaker while it decodes, so that the Darkroom develops the demo through real Decoder events.
8. IF microphone access is denied or unavailable, THEN THE UI SHALL show "Decode the demo file instead" as the primary action in place of the demo control, and SHALL keep the Darkroom, Safelight and demo tape card visible.
9. IF the bundled demo audio file cannot be loaded or decoded, THEN THE UI SHALL show an error message stating that the demo file could not be read, SHALL keep the Paper and Decoder state unchanged, and SHALL leave the other available demo action enabled.
10. WHILE the demo Ghost track is playing or being decoded from file, THE UI SHALL disable the demo control, "Play it again" and "Decode the demo file instead", so that only one demo run feeds the Decoder at a time.
11. THE UI SHALL contain no "replay the ghost track" control on any Darkroom state after `complete` (Requirement 14.5).

### Requirement 2: Demo tape content and length (Tier 0)

**User Story:** As a first-time visitor, I want the demo to finish quickly, so that I see the magic before I lose interest.

#### Acceptance Criteria

1. THE UI SHALL bundle a demo tape consisting of a J-card with a title, a from field, a to field, a date, and 1 to 3 tracks, plus a letter of 1 to 2 sentences about tapes and ghosts.
2. THE UI SHALL encode the demo tape with a Carrier profile table entry for the demo, whose `durationSec` from `encodePayload` is at most 15.0 s at both 44100 Hz and 48000 Hz.
3. THE UI SHALL contain only demo text that passes `serializePayload` validation, meaning `serializePayload` returns `{ ok: true }` for the demo tape.
4. IF the developer has not yet supplied the final demo text, THEN THE UI SHALL use placeholder demo text that meets criteria 1 to 3. The demo text lives in `src/ui/copy.ts` (Requirement 38).
5. THE test suite SHALL assert criteria 2 and 3 for the bundled demo tape at both 44100 Hz and 48000 Hz, and SHALL fail if `durationSec` exceeds 15.0 s or if validation returns `{ ok: false }`.
6. THE UI SHALL ship the demo audio file as a static asset generated from the demo tape by a script, so that decoding the shipped file and decoding the live-encoded audio each produce a payload equal, field by field, to the demo tape.
7. IF the demo tape text is changed and the demo audio file was not regenerated from it, THEN THE test suite SHALL fail, with a failure that names the demo audio file as stale.

### Requirement 3: Microphone permission flow and recovery (Tier 0)

**User Story:** As a recipient, I want to know why the app wants my microphone before it asks, so that I can decide with confidence.

#### Acceptance Criteria

1. WHEN the visitor starts listening for the first time in a session, THE UI SHALL show a pre-permission explanation in plain language stating that the microphone is used only to hear the tape, that nothing is recorded or sent anywhere, and that audio stays on the device, and SHALL NOT call `getUserMedia` until the visitor confirms the explanation.
2. WHEN the visitor confirms the explanation, THE UI SHALL call `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl` each set to false [acoustic-modem R4.1].
3. WHEN the visitor dismisses the explanation without confirming, THE UI SHALL return to the state it was in before the visitor started listening, SHALL NOT call `getUserMedia`, and SHALL show the explanation again the next time the visitor starts listening.
4. WHEN the microphone stream is granted, THE UI SHALL read the actual `AudioContext.sampleRate` and pass that value to `createDecoder`, without assuming 44100 or 48000.
5. IF the browser reports permission denied, THEN THE UI SHALL show a plain-language message with browser-specific steps to re-enable the microphone and a "Try again" action, SHALL offer the file path (Requirement 12), and SHALL keep any tape data already received in the session.
6. WHEN the visitor activates "Try again", THE UI SHALL call `getUserMedia` again with the same audio constraints as criterion 2, without showing the pre-permission explanation again in the same session.
7. IF the browser reports no microphone, or reports an insecure context (a page not served over HTTPS or from localhost), THEN THE UI SHALL show a plain-language message naming which of the two conditions occurred, SHALL offer the file path (Requirement 12), and SHALL NOT start a decoder.
8. IF the sample rate of the audio context is outside 16000–48000 Hz inclusive, THEN THE UI SHALL stop every microphone track, show a plain-language message stating that this device's audio rate is not supported, and SHALL offer the file path (Requirement 12).
9. WHEN listening stops for any reason (visitor action, completion, or an error), THE UI SHALL stop every microphone track within 1 second, so that the browser's microphone-in-use indicator turns off.

### Requirement 4: Darkroom states follow decoder events (Tier 0)

**User Story:** As a recipient, I want each change on screen to mean something real, so that the development feels true.

#### Acceptance Criteria

1. WHILE the Decoder has emitted no event since the last reset or the last completed reception, THE Darkroom SHALL show the Safelight on, an empty developer tray and no Paper.
2. WHEN a `signal-detected` event arrives, THE Darkroom SHALL flicker the Safelight exactly once, with a flicker duration between 150 ms and 400 ms.
3. WHEN a `header` event arrives for a tapeId with no Paper in the tray, THE Darkroom SHALL slide one blank Paper into the tray, SHALL size it from `payloadLength` as a Generic sheet, and SHALL show every Glyph position from 0 to `payloadLength` - 1 as undeveloped.
4. WHEN a `header` event arrives for a tapeId whose Paper is already in the tray, THE Darkroom SHALL keep that Paper and its Glyph state and SHALL NOT slide in a new sheet.
5. WHEN a `progress` event arrives for a tapeId whose Paper is in the tray, THE Darkroom SHALL update the Glyph of every position listed in `provisional` within a single rendered frame, so that characters develop everywhere at once, and SHALL leave the Glyph of every position not listed unchanged.
6. IF a `progress` event arrives for a tapeId that has no Paper in the tray, THEN THE Darkroom SHALL ignore the event, SHALL NOT create a Paper, and SHALL NOT show an error to the user.
7. WHEN a `pass-complete` event arrives for a tapeId whose Paper is in the tray, THE Darkroom SHALL keep the Paper and its Glyph state unchanged, and SHALL hand `pass`, `blocksRecovered`, `blocksTotal` and `clarity` to the displays defined in Requirements 9 and 10 without starting any development animation of its own.
8. WHEN a `complete` event arrives, THE Darkroom SHALL run the Fixing moment (Requirement 8).
9. THE Darkroom SHALL show a character from `provisional` only as a Glyph marked as unverified, and SHALL show verified text only from the `payload` of a `complete` event.
10. THE Darkroom SHALL derive its visual state only from Decoder events, the Symbol history and the user's explicit actions, and SHALL NOT start any development animation from a timer alone.
11. WHEN an `already-received` or `pass-discarded` event arrives, THE Darkroom SHALL keep the Safelight on and the Paper and its Glyph state unchanged, except as defined in Requirement 9.

### Requirement 5: Payload kind detection (Tier 0)

**User Story:** As a recipient, I want the screen to choose the right shape for the message, so that the print looks like what was sent.

#### Acceptance Criteria

1. WHEN a `header` event arrives, THE Darkroom SHALL show the Generic sheet and SHALL NOT choose between J-card sheet and Single-line mode, because the `header` event carries no payload kind.
2. WHEN a `progress` event contains a provisional byte at position 0 whose `confidence` is at or above the Kind confidence threshold, THE Darkroom SHALL read that byte's `byte` value as the Kind byte, treating value 0 as tape and value 1 as ghost.
3. WHILE no provisional byte at position 0 has `confidence` at or above the Kind confidence threshold, THE Darkroom SHALL keep the Generic sheet.
4. WHEN the Kind byte is first known as ghost, THE Darkroom SHALL switch the Paper to Single-line mode within the same render update that processes the `progress` event.
5. WHEN the Kind byte is first known as tape, THE Darkroom SHALL allow the Layout hint parser to run (Requirement 6).
6. IF a later `progress` event reports a Kind byte value that differs from the current one and has `confidence` at or above the Kind confidence threshold, THEN THE Darkroom SHALL change the Paper to the matching layout, discard the earlier Layout hint, and keep all other received provisional bytes.
7. IF a provisional byte at position 0 has `confidence` at or above the Kind confidence threshold and its value is neither 0 nor 1, THEN THE Darkroom SHALL keep the Generic sheet and SHALL NOT run the Layout hint parser.
8. WHEN a `complete` event arrives, THE Darkroom SHALL choose the layout from `payload.kind` (`tape` gives J-card sheet, `ghost` gives Single-line mode), whatever the earlier guess was.
9. WHEN a `pass-discarded` event arrives before any `complete` event, THE Darkroom SHALL leave the current layout unchanged until a later `header` event for a new tapeId arrives, at which point criterion 1 applies.
10. THE UI SHALL define the Kind confidence threshold as one named constant in the Design tokens, with its numeric value in the range 0 to 1 fixed in design.
11. THE Darkroom SHALL apply criteria 1 to 9 to every `header` event whether or not the Receive URL carried a mode hint (Requirement 28.7).

### Requirement 6: Layout hint with generic fallback (Tier 0)

**User Story:** As a recipient, I want the shape of the J-card to appear before the words do, so that I can see the letter forming.

#### Acceptance Criteria

1. WHEN the Kind byte is known as tape, THE Layout hint parser SHALL read the provisional bytes in this order from position 0: the Kind byte, the title length prefix (1 byte), the from length prefix (1 byte) and the to length prefix (1 byte). The field bytes of each are skipped by their stated length. Next come the 3 date bytes, the track count (1 byte), each track length prefix (1 byte per track), the letter length prefix (2 bytes, high byte first), and the trailing doodle flag byte. The positions follow the serialized layout in `src/modem/tape.ts`. THE Layout hint parser SHALL NOT validate the content of the date bytes or of any field bytes.
2. THE Layout hint parser SHALL return an Accepted parse only IF all of the following hold:
   - The title length is at most 40, the from length at most 24, the to length at most 24, each track length at most 60, and the letter length at most 800 (the `LIMITS` values).
   - The track count is at most 10.
   - The title, from and to lengths are not all 0.
   - Every length prefix and the track count are present and not unknown.
   - The sum of 1 (Kind byte), 3 (the three length prefixes), 3 (date), 1 (track count), the track count (one length prefix per track), 2 (letter length prefix), 1 (doodle flag) and all field lengths equals `payloadLength` exactly.
   - The doodle flag byte, if present and not unknown, is 0.
3. IF the parse is not accepted, THEN THE Darkroom SHALL keep Glyphs on the Generic sheet.
4. WHEN a parse becomes accepted, THE Darkroom SHALL move Glyphs into their J-card slots and SHALL draw the outline of the J-card and letter at the size the lengths define.
5. WHEN a later `progress` event changes the evidence so that the parse differs or is no longer accepted, THE Darkroom SHALL apply the changed Layout hint before the next render of the Darkroom. This includes withdrawing the hint and returning Glyphs to the Generic sheet.
6. THE Layout hint parser SHALL treat a provisional byte whose confidence is below the minimum confidence fixed in design as unknown. THE Layout hint parser SHALL return no hint when any prefix byte it needs to locate the next field is unknown.
7. WHEN a `complete` event arrives, THE Darkroom SHALL replace any Layout hint with the layout of the verified payload, and the slots of the Fixing moment SHALL come from the verified payload only.
8. THE Layout hint SHALL be a layout only: THE Darkroom SHALL NOT use it to show text as final (Requirement 11).
9. FOR ALL valid tapes, serializing the tape and feeding all bytes at confidence 1 as provisional bytes SHALL yield a Layout hint equal to the true layout (round-trip property).
10. FOR ALL byte sequences with any confidences, THE Layout hint parser SHALL return either no hint or a hint consistent with `payloadLength` per criterion 2, and SHALL NOT throw.
11. IF the Kind byte is unknown or is not tape, THEN THE Layout hint parser SHALL return no hint and THE Darkroom SHALL keep Glyphs on the Generic sheet.
12. IF `payloadLength` is not yet known, THEN THE Layout hint parser SHALL return no hint and THE Darkroom SHALL keep Glyphs on the Generic sheet.

### Requirement 7: Glyph rendering and real-history flicker (Tier 0)

**User Story:** As a recipient, I want unfixed positions to shimmer like grain, so that the image feels like it is developing, without ever showing made-up letters.

#### Acceptance Criteria

1. THE Darkroom SHALL draw each Glyph with an opacity that increases monotonically (non-decreasing) with the `confidence` of its provisional byte, from a minimum opacity of 0.1 at `confidence` 0 to an opacity of 1.0 at `confidence` 1, and with a blur radius that decreases monotonically from a maximum fixed in design at `confidence` 0 to 0 px at `confidence` 1.
2. THE Darkroom SHALL draw the character for a byte value using the Ghost Tape charset mapping from `src/modem/tape`, and SHALL draw a neutral mark (a single fixed non-letter symbol, identical for every such position) for a byte value outside the charset.
3. WHILE a position has no provisional byte yet, THE Darkroom SHALL draw unexposed grain with no character at that position.
4. WHERE Reduced motion is not active, THE Darkroom SHALL flicker each position whose provisional byte has `confidence` below a threshold (fixed in design) by cycling only among the byte values in that position's Symbol history, and SHALL stop flickering that position within one frame after its `confidence` reaches or exceeds the threshold.
5. IF a position's Symbol history contains fewer than 2 distinct byte values, THEN THE Darkroom SHALL draw that position steady with its current provisional byte (or unexposed grain if it has none) and SHALL NOT draw any other character there.
6. THE Darkroom SHALL NOT draw any character at a position that does not appear in the position's Symbol history (no random charset glyphs).
7. THE UI SHALL keep, per tapeId and position, the list of distinct byte values reported in `progress` events, and SHALL NOT clear it on `pass-complete`.
8. WHERE Reduced motion is active, THE Darkroom SHALL show each position's current provisional byte with its confidence-based opacity and no flicker.
9. FOR ALL replayed event sequences, every character shown in a flicker frame SHALL be a member of the Symbol history of its position at that time (property).
10. THE Darkroom SHALL treat every provisional Glyph below confidence 1 as decorative: it is `aria-hidden` (Requirement 11.1), is never the only carrier of information because the same state is also given by text labels (pass number, clarity and "Not yet developed"), and is therefore exempt from the contrast thresholds of Requirements 32.2 and 36.10, which still apply to a Glyph at confidence 1.

### Requirement 8: The fixing moment (Tier 0)

**User Story:** As a recipient, I want the moment a message becomes real to feel like a photograph being fixed, so that the ritual lands.

#### Acceptance Criteria

1. WHEN a `complete` event arrives, THE Darkroom SHALL, in one transition, make all Glyphs sharp at the same time, turn the Safelight off and bring up warm white light.
2. WHEN a `complete` event arrives, THE Darkroom SHALL write the Developed text built from the `payload` into the DOM within 500 ms of the event, visually hidden until the Fixing moment ends, and WHEN the Fixing moment ends (at most 1.5 s after the event, criterion 4), THE Darkroom SHALL reveal the Developed text and replace the Glyph layer content with it. Screen-reader announcement of the final text follows Requirement 32.4.
3. WHERE Reduced motion is active, THE Darkroom SHALL apply the same end state without animation, within 100 ms after the `complete` event reaches the UI.
4. THE Darkroom SHALL leave the Fixing moment at most 1.5 s after the `complete` event reaches the UI.
5. WHILE the Fixing moment is running, THE Darkroom SHALL keep every Glyph visible and show no Glyph with a character other than its final character from the `payload`.
6. IF a second `complete` event arrives while the Fixing moment is running or after the Developed text is shown, THEN THE Darkroom SHALL ignore it, keep the current display unchanged, and not restart the Fixing moment.
7. IF the `payload` of the `complete` event cannot be turned into Developed text, THEN THE Darkroom SHALL skip the Fixing moment, leave the Safelight on, keep the Glyphs unsharpened, and show a "not yet developed" state.

### Requirement 9: Pass results without completion, discarded passes, repeats (Tier 0)

**User Story:** As a recipient, I want honest feedback when a play did not finish the job, so that I know to play it again.

#### Acceptance Criteria

1. WHEN a `pass-complete` event arrives, THE Darkroom SHALL wait until every event returned by the same `push()` or `flush()` call has been processed (the modem emits `complete` immediately after `pass-complete` in the same batch), and IF that batch holds no `complete` event for the same tapeId, THEN THE Darkroom SHALL keep the Paper as it is and SHALL show the copy "The ghost is still faint. Play it again to bring it closer." within 200 ms of the batch being processed. This copy and every message of criteria 3 to 5 and 8 live in `src/ui/copy.ts` (Requirement 38).
2. WHEN a `header` event arrives with the same tapeId as an earlier pass and a `pass` value greater than 1, THE Darkroom SHALL start from the Paper state left by the previous pass and SHALL update Glyphs from the `progress` events of the new pass.
3. WHEN a `pass-discarded` event arrives with reason `header-invalid`, THE Darkroom SHALL show "That sound was not a Ghost Tape", SHALL keep the Safelight on and SHALL keep the Paper unchanged.
4. WHEN a `pass-discarded` event arrives with reason `alignment-failed`, THE Darkroom SHALL show "The sound slipped out of step. Hold the devices still and play it again." and SHALL keep the Paper unchanged.
5. WHEN a `pass-discarded` event arrives with reason `signal-lost`, THE Darkroom SHALL show "The sound faded before the end. Move closer and play it again." and SHALL keep the Paper unchanged.
6. WHEN a `pass-discarded` event arrives, THE UI SHALL leave the Symbol history, the Layout hint and every Glyph with the values they had immediately before that pass began, because a discarded pass leaves the accumulator unchanged [acoustic-modem R6.5, R6.6]. The `progress` events of the discarded pass SHALL NOT contribute to any of them.
7. WHEN a `pass-discarded` event arrives after a `header` event of the same pass, THE Darkroom SHALL remove only the in-progress marker of that pass and SHALL NOT clear the Paper.
8. WHEN an `already-received` event arrives for a tapeId whose `complete` event has already been shown, THE Darkroom SHALL keep the developed print, SHALL show "You already have this tape" and SHALL leave the Developed text unchanged.
9. WHEN a `signal-detected` event is followed by a `pass-discarded` event with no `header` event in between, THE Darkroom SHALL return the Safelight to the steady state it had immediately before the `signal-detected` event.
10. WHEN the UI shows the guidance of criterion 1, 3, 4 or 5, THE UI SHALL include the words "Play it again" in the guidance, and SHALL make a "Play it again" action available in every mode in which the UI can replay the sound itself (Requirement 1.6 and the Tape-player page). In the remaining modes the guidance SHALL be shown without the action.

### Requirement 10: Pass number and clarity (Tier 0)

**User Story:** As a recipient, I want to see that each play makes the ghost clearer, so that waiting feels worthwhile.

#### Acceptance Criteria

1. WHEN a `header` event arrives, THE Darkroom SHALL show the event's `pass` field as a whole number of at least 1, in a position that does not overlap the J-card text or the letter text.
2. WHEN a `header` event arrives, THE Darkroom SHALL show the event's `estimatedSecondsRemaining` as a countdown in whole seconds, rounded up, that decrements once per second and never shows a value below 0.
3. WHEN a `progress` event arrives while the countdown is showing, THE Darkroom SHALL correct the countdown within 1 second, using the event's `fractionReceived` (a value from 0 to 1).
4. WHEN a `pass-complete` event arrives, THE Darkroom SHALL show the event's `clarity` as the percentage `round(clarity × 100)`, from 0 to 100, followed by a percent sign.
5. WHEN a `pass-complete` event arrives, THE Darkroom SHALL show the event's `blocksRecovered` and `blocksTotal` as a "parts recovered" count in the form "`blocksRecovered` of `blocksTotal`".
6. THE Darkroom SHALL take every displayed clarity value only from the `clarity` field of `pass-complete` events, and SHALL NOT display or update any clarity value between the `header` event of a pass and its `pass-complete` event.
7. WHEN a `header` event arrives for a tape that already has a clarity value from an earlier `pass-complete` event, THE Darkroom SHALL keep showing that earlier clarity value, labeled as the result of the previous pass, until the next `pass-complete` event replaces it.
8. WHEN a `complete` event arrives, THE Darkroom SHALL show the event's `passesUsed` as "played N times", with the singular "once" when `passesUsed` is 1.
9. IF a `pass-discarded` event arrives, THEN THE Darkroom SHALL leave the displayed pass number, countdown value, clarity value, and parts-recovered count unchanged, and SHALL stop the countdown.

### Requirement 11: Provisional bytes are never presented as final (Tier 0)

**User Story:** As a recipient, I want to see either the true tape or an honest "not yet developed", so that I never read something my friend did not write.

#### Acceptance Criteria

1. THE UI SHALL draw provisional bytes only on the Glyph layer, which has `aria-hidden="true"` and contains no selectable text, so that the Glyph layer contributes 0 characters to the document's text content and to the accessibility tree.
2. WHEN the decoder emits a `complete` event, or `decodeFile` returns a successful result, THE UI SHALL write Developed text into the DOM from the `payload` of that event or result and from no other source.
3. THE UI SHALL type provisional bytes with `ProvisionalByte` and SHALL NOT convert them to `Payload`, `Tape` or `Ghost` values.
4. WHILE the Darkroom has not received a `complete` event for the tapeId, THE Darkroom SHALL show the label "Not yet developed" on the Paper and SHALL keep the letter text and J-card field text absent from the DOM.
5. WHILE the Darkroom has not received a `complete` event for the tapeId, THE UI SHALL disable "Save as image" and "Reply with a tape", SHALL NOT copy, save or share any content derived from provisional bytes, and SHALL NOT enable either control in response to any other event.
6. WHEN a `complete` event arrives for the tapeId, THE UI SHALL remove the "Not yet developed" label and enable "Save as image" and "Reply with a tape" within 500 ms.
7. IF a decode attempt ends with a failure result (`ok: false`) or a stalled or cancelled session and no `complete` event has arrived, THEN THE UI SHALL keep the "Not yet developed" label, keep both controls disabled, and keep the DOM free of any letter text derived from provisional bytes.
8. THE test suite SHALL assert, over Replay feeds that include a `complete` event and feeds that do not (including feeds ending in failure, stall or cancellation), that the document contains the letter text if and only if a `complete` event was processed, and that both controls are enabled if and only if a `complete` event was processed.

### Requirement 12: Receive modes: listen and upload (Tier 0)

**User Story:** As a recipient, I want to open a tape by listening or by uploading a file, so that I can use whatever I have.

#### Acceptance Criteria

1. THE Receive route SHALL offer exactly two ways to receive, labelled "Listen" and "Upload an audio file", and SHALL show both labels at the same time while no reception is in progress.
2. WHEN the recipient chooses "Listen", THE UI SHALL follow Requirement 3 and then stream microphone audio to the Decoder through the AudioWorklet and Worker path of the Modem's browser adapters.
3. WHEN the recipient chooses a file, THE UI SHALL decode it with the browser's `decodeAudioData` through the audio adapter, mix all channels to mono by averaging them, and feed the samples to a Decoder created at the decoding context's sample rate, so that Decoder events drive the Darkroom exactly as in live listening.
4. WHILE a file is being decoded, THE UI SHALL pace the feed by the audio clock so that the file develops at real-time speed, feeding the samples to the Decoder in chunks of at most 1 second of audio and no faster than real time, and SHALL yield to the browser between chunks, so that the Darkroom animation continues without any single main-thread task exceeding 50 ms.
5. IF the browser cannot decode the file, THEN THE UI SHALL show "That file could not be read as audio. Try a WAV, MP3 or M4A file." with no stack trace, SHALL create no Decoder events, and SHALL leave the Receive route ready for the recipient to choose another file or "Listen".
6. IF the Decoder has been flushed at the end of a file and has emitted no `header` event, THEN THE UI SHALL show "No ghost track found in that file." and SHALL leave the Paper in its "not yet developed" state.
7. WHEN the last chunk of a file has been fed to the Decoder, THE UI SHALL call `flush()` exactly once and SHALL show every event that `flush()` returns, in the order emitted, before showing any message under criterion 6.
8. WHEN a file contains two or more passes of one tape, THE Darkroom SHALL show one `pass-complete` indication for each pass the Decoder reports, in the same way as in live listening.
9. WHEN the recipient starts a new reception (a different file, or "Start over"), THE UI SHALL call `reset()` once, clear the Paper and the Symbol history, and discard any message shown under criterion 5 or 6, before feeding any new samples to the Decoder.
10. WHILE a file is being fed under criterion 4, THE UI SHALL show a "Skip" control, and WHEN the recipient activates "Skip", THE UI SHALL feed the rest of the file at full speed, still in chunks of at most 1 second of audio with no main-thread task exceeding 50 ms, so that the Decoder events and the final result are identical to those of unpaced decoding of the same file.

### Requirement 13: Single-line receive mode (Tier 0)

**User Story:** As a bystander receiving a broadcast, I want the message to appear as one clear line, so that I can read it at a glance.

#### Acceptance Criteria

1. WHEN the Kind byte is known as ghost (Requirement 5.4), THE Darkroom SHALL show the Paper as a single paragraph of text (wrapping allowed) with no J-card, sized for `payloadLength − 2` message bytes, within 500 ms of the Kind byte becoming known.
2. IF `payloadLength` is less than 2, THEN THE Darkroom SHALL show an empty single line of one character width and SHALL NOT show any Developed text.
3. WHILE in Single-line mode, THE Darkroom SHALL show the current pass number, starting at 1.
4. WHEN a `pass-complete` event arrives in Single-line mode, THE Darkroom SHALL update the displayed clarity to the value reported by that event, as a percentage from 0 to 100, within 500 ms.
5. WHEN a `complete` event arrives with `payload.kind` equal to `ghost`, THE Darkroom SHALL run the Fixing moment and then show `payload.message` as Developed text.
6. WHILE the message is not Developed, THE Darkroom SHALL show only provisional Glyphs and SHALL NOT show any character as Developed text.
7. WHEN the message is Developed in Single-line mode, THE Darkroom SHALL offer "Save as image" and "Start over".
8. THE Darkroom SHALL NOT offer "Reply with a tape" in Single-line mode.
9. IF `payload.kind` is `ghost` and the Darkroom was in J-card mode, THEN THE Darkroom SHALL switch to Single-line mode before the Fixing moment (Requirement 5.8), discarding the J-card Paper and keeping the current pass number.

### Requirement 14: After the tape develops (Tier 0, with sub-items by tier)

**User Story:** As a recipient, I want to keep, answer and follow up on a tape, so that it becomes part of a conversation.

#### Acceptance Criteria

1. WHEN a `complete` event with a tape payload arrives, THE UI SHALL write Developed text for the title, from, to, date, tracks and letter into the DOM within 500 ms of the event (visually hidden until the Fixing moment ends and the text is revealed, Requirement 8.2), replacing every remaining not-yet-developed placeholder, and SHALL preserve each line break in the letter and in each track.
2. THE UI SHALL render the Developed text as real DOM text that the recipient can select and that screen readers can read.
3. WHEN the recipient chooses "Reply with a tape", THE UI SHALL open the Composer with the received `from` value placed in `to`, the received `to` value placed in `from`, and the date, title, tracks and letter fields empty.
4. WHEN a `complete` event arrives, THE UI SHALL announce the final text through a live region (Requirement 32.4) exactly once for that event.
5. THE UI SHALL NOT offer a control that replays the ghost track after development.
6. WHERE the received `payload.kind` is `tape`, THE UI SHALL offer "Save as image" (Requirement 15), "Reply with a tape" and track search buttons (Requirement 17), and SHALL show all three from the moment the Developed text is shown until the recipient leaves the receiver view.
7. IF a `complete` event arrives with a payload whose `kind` is not `tape`, THEN THE UI SHALL NOT show "Reply with a tape" or track search buttons, SHALL offer "Save as image" for a ghost (Requirements 13.7 and 15.10), and SHALL still show the payload text as Developed text, selectable and readable by screen readers.

### Requirement 15: Save as image (Tier 3)

**User Story:** As a recipient, I want to save my tape as a beautiful print, so that I can share it.

#### Acceptance Criteria

1. WHEN the recipient chooses "Save as image" after a `complete` event, THE UI SHALL render the developed J-card and letter to a PNG on a canvas, in the style of a darkroom print, and SHALL finish rendering within 3 seconds on the device in use.
2. THE UI SHALL render each PNG at 1080 × 1350 pixels (portrait, suitable for social sharing).
3. THE UI SHALL render each PNG from the verified payload only, using the Design tokens of the UI.
4. IF the letter does not fit on one image at a letter type size of 28 px, THEN THE UI SHALL reduce the letter's type size in steps down to a minimum of 28 px, SHALL then continue the remaining letter text on additional images (at most 4 images in total), and SHALL name the files in reading order with a two-digit sequence number (for example, `-01` and `-02`).
5. IF the letter does not fit within 4 images at the minimum type size, THEN THE UI SHALL end the last image with a visible marker that the letter continues on screen, and SHALL leave the on-screen letter unchanged.
6. WHERE the browser supports the Web Share API with files, THE UI SHALL offer sharing the PNG files; otherwise THE UI SHALL download the PNG files.
7. IF sharing is cancelled by the recipient, THEN THE UI SHALL return to the developed tape view without downloading any file and without showing an error.
8. IF PNG rendering or sharing fails for a reason other than cancellation, THEN THE UI SHALL show an error message indicating that the image could not be saved, SHALL keep the developed tape on screen, and SHALL allow the recipient to retry.
9. THE PNG SHALL NOT embed the payload bytes or any identifier of the recipient or device.
10. WHERE the payload kind is `ghost`, THE UI SHALL render the message as a single-line print at the same 1080 × 1350 pixel size.

### Requirement 16: Reply with a tape (Tier 0)

**User Story:** As a recipient, I want to answer a tape in one tap, so that a conversation can start.

#### Acceptance Criteria

1. WHEN the recipient chooses "Reply with a tape" on a received tape whose verification succeeded, THE UI SHALL navigate to the Composer route within 300 ms, with the received tape's `to` value in the `from` field and the received tape's `from` value in the `to` field, each copied exactly as received with no changes to case, spacing, or characters.
2. THE UI SHALL pass the swapped names to the Composer in memory or in the URL fragment, and SHALL NOT send them to any server.
3. IF the swapped `from` value or the swapped `to` value exceeds 24 characters, THEN THE UI SHALL leave both values unchanged, SHALL open the Composer with both fields populated, and SHALL show the Requirement 19 validation message on the card next to each field that exceeds 24 characters.
4. IF the received tape's `from` or `to` value is empty, THEN THE UI SHALL leave the corresponding Composer field empty and SHALL show the Requirement 19 validation message for that field.
5. WHEN the Composer opens from "Reply with a tape", THE UI SHALL start with an empty letter, an empty tracklist, and an empty title, so that no content from the received tape other than the swapped names is carried over.

### Requirement 17: Track search buttons (Tier 4)

**User Story:** As a recipient, I want to hear the songs on the tape, so that the mixtape feels complete.

#### Acceptance Criteria

1. WHERE a developed tape has one or more tracks, THE UI SHALL show exactly one search button beside each track title, and SHALL show no search button for a tape with zero tracks.
2. WHEN the recipient activates a track's search button, THE UI SHALL open exactly one new browser tab whose address is a Spotify search URL or a YouTube search URL containing the track title encoded as a URL query component, and the link SHALL carry `rel="noopener noreferrer"`.
3. THE UI SHALL make no request to Spotify or YouTube, and SHALL load no script, key or platform API from them, until the recipient activates a search button.
4. THE UI SHALL give each search button an accessible name that includes the full text of its track title, and SHALL make the button reachable and activatable by keyboard (Tab to focus, Enter or Space to activate).
5. WHEN a track title contains characters reserved in URLs (for example `&`, `#`, `?`, `/`, `%`, a space or a non-ASCII character), THE UI SHALL encode them so that the search page receives the original title unchanged.
6. IF the recipient's device has no network connection, THEN THE UI SHALL still show every search button and open the new tab on activation, leaving the failure to load the search page to the browser, and SHALL leave the developed tape on screen unchanged.
7. WHILE the tape is not yet developed (final text not verified), THE UI SHALL show no track search buttons.

### Requirement 18: Composer: write on the J-card (Tier 0)

**User Story:** As a sender, I want to write directly on a life-size J-card, so that what I make is what my friend sees develop.

#### Acceptance Criteria

1. THE Composer SHALL show at the centre of the screen a life-size J-card with editable title, from, to, date and 0 to 10 track fields on the front.
2. THE Composer SHALL back every visual field with a real input or textarea element that has an associated accessible name, so that keyboards, screen readers and autofill work.
3. WHEN the sender activates "Flip", THE Composer SHALL show the back of the J-card with the letter field and SHALL preserve all values already entered on the front.
4. WHERE Reduced motion is not active, THE Composer SHALL animate the flip (Tier 2) with a duration of 300 to 800 ms; otherwise THE Composer SHALL switch sides within 100 ms and without animation.
5. WHEN the sender activates "Add track" while fewer than 10 tracks exist, THE Composer SHALL add one empty track field and move focus to it.
6. IF the sender activates "Add track" while 10 tracks exist, THEN THE Composer SHALL add no track field and SHALL indicate that the maximum of 10 tracks is reached, with the "Add track" control disabled.
7. WHEN the sender activates "Remove" on a track, THE Composer SHALL remove that track, keep the order of the remaining tracks, and move focus to the next remaining track field, or to "Add track" if none remains.
8. THE Composer SHALL keep the draft in memory and SHALL send it to no network destination.
9. WHERE the sender has allowed saving, THE Composer SHALL also store the draft in `localStorage`, and WHEN the Composer opens with a stored draft, THE Composer SHALL restore the title, from, to, date, tracks and letter fields from it.
10. IF writing to `localStorage` fails or is blocked, THEN THE Composer SHALL keep the draft in memory, continue to work, and show a message that the draft will not be saved after the page closes.
11. THE Composer SHALL be fully operable by touch and by keyboard alone, with no horizontal scrolling and no control smaller than 44 by 44 CSS px, on a 360 px wide screen, and SHALL lay out correctly on a desktop screen of 1280 px width or more.
12. THE Composer SHALL use the same layout component and Design tokens for the J-card as the Darkroom's J-card sheet, so that the sent card and the developed card look like the same object.
13. WHEN the sender withdraws permission to save the draft, THE Composer SHALL delete the stored draft from `localStorage` within 1 second and confirm the deletion to the sender.

### Requirement 19: Inline validation in plain language (Tier 0)

**User Story:** As a sender, I want to be told in plain words what to fix, so that I never meet a technical error.

#### Acceptance Criteria

1. WHEN a field's content changes, THE Composer SHALL validate it with the Modem's rules (`LIMITS`, charset, newline placement, date, title/from/to not all empty, size cap) within 200 ms and SHALL show a Plain-language message beside that field. The message SHALL name the field and the rule it breaks, and SHALL NOT show Modem reason text, character codes or byte values.
2. WHEN a field's length exceeds its `LIMITS` value (title 40, from 24, to 24, track 60, letter 800, ghost message 140 characters, or more than 10 tracks), THE Composer SHALL show a counter in the form "N of limit" and a message such as "Title can have up to 40 characters; this one has 43". Newline characters in the letter count as one character each.
3. WHEN a field contains a character outside the Ghost Tape charset (printable ASCII U+0020 to U+007E, the seven marks ‘ ’ “ ” — … –, and a newline in the letter only) and the character has no conversion under criterion 5 (a newline outside the letter is excluded here and handled by criterion 15), THE Composer SHALL highlight every such character on the card, SHALL show a hint beside the field that quotes the first such character and states how many there are, and SHALL keep all of them in the field, so that nothing is silently removed.
4. WHEN the sender types or pastes a curly quote, dash or ellipsis that the charset contains (‘ ’ “ ” — … –), THE Composer SHALL keep it unchanged and SHALL NOT show a conversion notice.
5. WHEN the sender types or pastes a character that has a close equivalent in the charset, THE Composer SHALL replace it with that equivalent and SHALL show a notice beside the field stating how many characters were converted. The conversion table SHALL be fixed and SHALL contain: U+00A0 non-breaking space to space; U+201A and U+2032 to ’ ; U+201E and U+2033 to ” ; U+2012 and U+2015 to — ; U+2010 and U+2011 to hyphen-minus; and, in the letter field only, CR LF and lone CR to a single newline. The notice SHALL remain visible until the field next changes.
6. THE Composer SHALL apply the conversion table of criterion 5 as one pure function with a round-trip test that any string made only of charset characters (including newlines in the letter) passes through unchanged.
7. WHEN `title`, `from` and `to` are all empty, THE Composer SHALL show "Add a title, or who it is from, or who it is to" beside the title field.
8. IF the date field is non-empty and is not a real calendar date from 2000-01-01 to 2255-12-31 in year-month-day form, THEN THE Composer SHALL show "That is not a real date. Use year-month-day, between 2000 and 2255". An empty date SHALL NOT produce a message.
9. WHEN the encoded size exceeds the cap of the Carrier profile table for the chosen Carrier, THE Composer SHALL follow Requirement 27.4.
10. THE Composer SHALL derive every message from the Modem's `{ ok: false, reason }` reasons or from `LIMITS` through one pure mapping function, so that the mapping is testable. IF the mapping receives a reason it does not know, THEN THE Composer SHALL show the generic message "Something in this field cannot be sent. Please check it." beside the affected field, or beside the REC key when no field is identifiable.
11. WHILE any validation message is an error (criteria 1, 2, 3, 7, 8, 9, 10, 14 or 15), THE Composer SHALL keep the REC key disabled. Conversion notices from criterion 5 are not errors and SHALL NOT disable REC.
12. WHEN a validation message appears or changes, THE Composer SHALL link it to its field with `aria-describedby` and announce it once through a polite live region. A message that is unchanged after a later edit SHALL NOT be announced again.
13. WHEN the condition behind a validation message no longer holds, THE Composer SHALL remove that message within 200 ms, and SHALL re-enable the REC key if no error message remains.
14. IF the ghost message is empty, THEN THE Broadcaster SHALL show a message that a broadcast needs 1 to 140 characters, and SHALL keep the ON AIR control disabled.
15. IF a newline appears in any field other than the letter, THEN THE Composer SHALL show a message that line breaks are only allowed in the letter, SHALL keep the newline in the field, and SHALL highlight it on the card.

### Requirement 20: Live duration on the cassette (Tier 0)

**User Story:** As a sender, I want to see how long my tape is while I write, so that I know what I am asking my friend to wait through.

#### Acceptance Criteria

1. THE Composer SHALL show, beside the J-card, a Cassette whose visible tape length is a non-decreasing function of the Ghost track duration, and the text "this tape is N seconds long", where N is the duration in seconds rounded to the nearest whole second.
2. WHEN the sender edits any field, THE Composer SHALL replace the shown duration with the duration of the edited Ghost track within 400 ms after the last keystroke, and SHALL update the Cassette tape length in the same update.
3. THE Composer SHALL compute the shown duration in closed form from read-only helpers deep-imported from `src/modem/tape`, `src/modem/interleave`, `src/modem/frame` and `src/modem/profiles` (Requirement 37.7), so that it equals `durationSec` of `encodePayload` for the same payload, profile and sample rate within 0.1 s [acoustic-modem R1.4, R1.5]. A property test SHALL guard this equality against `encodePayload`.
4. WHILE the sender is typing, THE Composer SHALL debounce duration recomputation so that at most one recomputation starts per 400 ms window, and SHALL NOT render Ghost track audio samples for the purpose of computing the duration (no per-keystroke audio rendering and no call to `encodePayload`).
5. IF the content is invalid (a field exceeds its limit, the payload exceeds the cap size, or the payload cannot be encoded), THEN THE Composer SHALL either show the last valid duration visibly marked as outdated or show no duration, SHALL NOT show a duration computed for the invalid content, and SHALL keep the sender's entered text unchanged.
6. WHEN the sender restores valid content after invalid content, THE Composer SHALL remove the outdated marking and show the duration of the restored content within 400 ms after the last keystroke.
7. FOR ALL valid payloads, THE shown duration SHALL equal the produced Ghost track length within 0.1 s at both 44100 Hz and 48000 Hz (property test).

### Requirement 21: REC key and generation (Tier 0)

**User Story:** As a sender, I want pressing REC to feel like recording a tape, so that the ritual matches the sound.

#### Acceptance Criteria

1. WHEN the sender presses the REC key with valid content, THE Composer SHALL call `encodePayload` exactly once with the profile from the Carrier profile table for the chosen Carrier and the `AudioContext` sample rate (44100 or 48000).
2. WHEN the sender presses the REC key, THE Composer SHALL start spinning the Cassette within 500 ms of the press, and SHALL start playing the finished track from its start, music-box overture first, within 500 ms of the press (or, when generation takes longer than 500 ms, within 500 ms of generation finishing).
3. IF the `AudioContext` sample rate is neither 44100 nor 48000, THEN THE Composer SHALL generate the track at 48000 Hz and play it through a context that resamples.
4. WHEN playback of the track ends or the sender stops it, THE Composer SHALL stop the Cassette within 200 ms. THE Composer SHALL show the sending options (Requirement 22 to 26) as soon as generation has succeeded, without waiting for playback to end.
5. IF `encodePayload` returns `{ ok: false }`, THEN THE Composer SHALL stop the Cassette within 200 ms, show a Plain-language message through the mapping of Requirement 19.10, and return to editing with all entered J-card and letter content unchanged.
6. WHERE Reduced motion is active, THE Composer SHALL replace the spinning Cassette with a static Cassette and a text progress state that shows "recording" while the track is playing and "done" afterwards.
7. THE REC key SHALL be at least 56 CSS px in its smaller dimension and operable by keyboard with both the Enter key and the Space key.
8. WHILE generation is running, THE Composer SHALL ignore further presses of the REC key so that `encodePayload` is not called a second time.
9. IF generation takes longer than 2 s, THEN THE Composer SHALL keep showing the spinning Cassette and a "recording" state until generation finishes.

### Requirement 22: Send a link (Tier 0)

**User Story:** As a sender, I want to send a link, so that my friend can play the tape without installing anything.

#### Acceptance Criteria

1. WHEN generation finishes, THE Composer SHALL offer "Send a link", which creates a Tape link whose fragment carries the serialized payload.
2. THE UI SHALL encode the fragment as base64url (unpadded, using only the characters A–Z, a–z, 0–9, "-" and "_") of the serialized payload bytes, preceded by a one-character version prefix, and SHALL decode it with the inverse function.
3. FOR ALL valid payloads, decoding then encoding the fragment SHALL return the same payload (round-trip property).
4. THE UI SHALL place the payload only in the URL fragment, so that no request carries it.
5. IF the Tape link would exceed 2000 characters, THEN THE Composer SHALL NOT create the link, SHALL show a Plain-language message that the tape is too long for a link, and SHALL point to "Download audio", while keeping the generated tape and audio available.
6. WHEN the sender chooses "Copy link", THE Composer SHALL copy the Tape link to the clipboard and, within 500 ms, confirm with a message announced politely.
7. IF copying to the clipboard fails or is not permitted, THEN THE Composer SHALL show the full Tape link as selectable text and a Plain-language message saying the copy did not work.
8. WHERE the browser supports the Web Share API, THE Composer SHALL offer sharing the Tape link.
9. IF the fragment has an unknown version prefix, is empty, contains characters outside the base64url set, or does not decode to a valid payload, THEN THE UI SHALL NOT show any tape content and SHALL show a Plain-language message that the link could not be opened, without throwing an error.

### Requirement 23: The Tape-player page (Tier 0)

**User Story:** As a recipient who opened a link, I want the tape to play from my device or another, so that I can open it the way that suits me.

#### Acceptance Criteria

1. WHEN the Tape-player route opens with a non-empty fragment, THE UI SHALL decode the fragment, validate the decoded bytes with `deserializePayload`, and, only if validation returns `ok: true`, show a closed envelope displaying the tape's title and "from" fields within 1 second of route open.
2. IF the fragment is empty, malformed, of an unknown version, or fails `deserializePayload`, THEN THE UI SHALL show the text "This link is damaged or incomplete", SHALL show a control that navigates to the Receive route, SHALL NOT show the "Play the tape" control or the "Open it here" control, and SHALL NOT play audio.
3. WHEN the fragment is valid, THE UI SHALL encode the Ghost track locally with `encodePayload` using the Carrier profile table's `link` entry, without issuing any network request.
4. WHILE the Ghost track is being encoded, THE UI SHALL show the "Play the tape" control and the "Open it here" control in a disabled state, and WHEN encoding completes, THE UI SHALL enable both controls.
5. IF encoding the Ghost track fails or does not complete within 10 seconds, THEN THE UI SHALL show an error message stating that the tape could not be prepared, SHALL keep both play controls disabled, and SHALL offer the Receive route.
6. WHEN the user activates "Play the tape", THE UI SHALL play the Ghost track once through this device's audio output, and SHALL NOT start microphone capture.
7. THE UI SHALL show a QR code encoding the Receive URL (Requirement 24) together with the text "Open this on another device to listen".
8. WHEN the user activates "Open it here", THE UI SHALL play the Ghost track and listen on the same device in the Darkroom, following Requirements 3 to 11.
9. WHILE the Darkroom has not emitted a `complete` event, THE UI SHALL NOT display any character of the payload's letter text or tracklist, and SHALL show only the title and "from" fields (the envelope is sealed); WHEN the Darkroom emits a `complete` event, THE UI SHALL show the payload as Developed text.
10. WHERE the browser supports `history.replaceState`, THE UI SHALL call it to remove the fragment from the address bar and history entry once the payload has been decoded and held in memory, and the Tape-player page SHALL remain functional after the removal.

### Requirement 24: QR codes (Tier 0)

**User Story:** As a person with two devices, I want to hand off with a QR code, so that I do not have to type a link.

#### Acceptance Criteria

1. WHEN the Tape-player page or the Broadcaster screen is displayed, THE QR generator SHALL render a QR code of the Receive URL on that page or screen within 500 ms.
2. THE QR code SHALL encode the Receive URL only, and SHALL NOT encode any payload bytes.
3. THE QR generator SHALL be a self-contained module with no third-party runtime dependency, whose own code is under 6 KB gzipped. The budget counts the QR generator's own code and excludes modem modules it imports that are already in the bundle (for example `src/modem/reedSolomon.ts`). The build check SHALL report the measured figure both ways: with and without those imported modem modules.
4. THE QR generator SHALL encode any Receive URL of 1 to 100 characters at error correction level M or higher.
5. IF the Receive URL is empty or longer than 100 characters, THEN THE QR generator SHALL return a failure result with a reason, SHALL NOT throw, and THE page or screen SHALL show no QR code and SHALL show the Receive URL as text instead.
6. THE QR code SHALL render with a quiet zone of at least 4 modules, in black modules on a white background, and on the Broadcaster screen at a 360 px wide viewport SHALL use at least 6 CSS px per module and be at least 200 CSS px wide, which constrains the Receive URL to a length whose QR version fits that width (the design SHALL fix the URL and verify the figure).
7. THE QR code SHALL render with a quiet zone of at least 4 modules and at least 4 CSS px per module on the Tape-player page, in black modules on a white background.
8. THE test suite SHALL decode generated QR matrices with an independent reference decoder in a test-only dependency (or a documented known-answer set) for at least 20 URLs, and every decoded string SHALL equal the input URL exactly.
9. THE test suite SHALL include a test with a 100-character URL, a test with a 101-character URL, and a test with an empty URL, to check the limits in criteria 4 and 5.

### Requirement 25: Download audio (Tier 0)

**User Story:** As a sender, I want an audio file, so that I can send it as a voice message, a video soundtrack or a story background.

#### Acceptance Criteria

1. WHEN generation finishes, THE Composer SHALL offer "Download audio", which saves the Ghost track as a mono 16-bit PCM WAV file through `encodeWav` at the track's sample rate.
2. WHEN the sender chooses "Download audio" for a voice message, THE Composer SHALL use the `file` Carrier of the Carrier profile table.
3. WHEN the sender chooses "Download audio", THE Composer SHALL name the file from the title with `.wav` appended. The name keeps only letters (A–Z, a–z), digits and hyphens, replaces each other character (including spaces) with a hyphen, and has a base name of at most 40 characters, not counting `.wav`.
4. IF the title is empty or the base name has no letters or digits after replacement, THEN THE Composer SHALL use the default file name `ghost-tape.wav`.
5. WHEN generation finishes, THE Composer SHALL show the file length in seconds, rounded to 1 decimal place, and the file size in megabytes, rounded to 1 decimal place, before the download starts. The size is the exact byte length of the WAV file divided by 1,000,000.
6. THE Composer SHALL give the downloaded file no metadata other than the WAV format fields, meaning the file is a 44-byte header followed by the PCM samples, with no extra chunks.
7. IF `encodeWav` fails or the browser blocks the save, THEN THE Composer SHALL show an error message saying the download failed, keep the generated Ghost track in memory, and keep "Download audio" available so the sender can retry without regenerating.

### Requirement 26: Make it a broadcast from the Composer (Tier 0)

**User Story:** As a sender, I want to turn my message into a broadcast, so that many people nearby can receive it.

#### Acceptance Criteria

1. WHEN the sender chooses "Make it a broadcast", THE UI SHALL open the Broadcaster with the message field prefilled with the suggested message, and the sender SHALL be able to edit the field before building the broadcast.
2. THE UI SHALL build the suggested message from the start of the letter, or from the title when the letter is empty, SHALL replace each newline with one space, and SHALL cut the result at the last word boundary that keeps the length at or below 140 characters. IF the first word alone is longer than 140 characters, THEN THE UI SHALL cut it at exactly 140 characters.
3. IF the suggested message is empty, or contains any character outside the Ghost Tape charset, THEN THE Broadcaster SHALL open with the message field empty and SHALL show the Requirement 19 hint.
4. IF the letter text, or the title text when the letter is empty, is longer than 140 characters, THEN THE UI SHALL show a Plain-language message stating that only the beginning fits, SHALL show it before the sender can build the broadcast, and SHALL keep the message field editable.
5. WHEN the Composer passes the suggested message to the Broadcaster, THE UI SHALL pass it only through in-memory state or the URL fragment, and SHALL NOT send it over the network to any server.
6. WHEN the sender returns from the Broadcaster to the Composer, THE UI SHALL keep the Composer's title and letter unchanged.

### Requirement 27: Carrier profile table and caps (Tier 0)

**User Story:** As a developer, I want one table mapping carriers to profiles, so that measurement results change one place.

#### Acceptance Criteria

1. THE UI SHALL contain exactly one Carrier profile table in `src/ui/`, mapping each Carrier (`link`, `file`, `broadcast`, `demo`) to exactly one modem profile name, with no Carrier left unmapped and no second table or inline Carrier-to-profile mapping elsewhere in `src/ui/`.
2. THE Carrier profile table SHALL map `broadcast` to `robust`, because a message of at most 140 characters always fits the 256-byte Robust cap.
3. THE Carrier profile table SHALL map `link`, `file` and `demo` to `standard` until acoustic-modem tasks 16 and 17 produce measurements, and a change from those measurements SHALL require editing only this table.
4. IF the serialized size of a tape exceeds the cap in bytes of the profile that the table gives for its Carrier (256 bytes for `robust`, 1024 bytes for `standard`), THEN THE UI SHALL refuse to encode the tape, keep the profile unchanged, keep the tape contents unchanged and editable, and show a Plain-language message stating by how many characters or tracks the tape must be shortened, naming no profile.
5. WHERE a tape does not fit the cap of a more robust profile that a measurement would recommend, THE UI SHALL keep `standard` for that tape and show a Plain-language message that the tape is long and works best over a close, quiet speaker, naming no profile.
6. THE UI SHALL contain no user-visible string that names a profile ("Robust", "Standard", or a numeric profile id), in any Carrier flow or in any error message.
7. THE test suite SHALL assert criteria 1 to 3 and 6, including that the table has exactly the four Carrier keys, that `broadcast` maps to `robust`, that `link`, `file` and `demo` map to `standard`, and that no user-visible string in `src/ui/` contains a profile name or id.

### Requirement 28: Side B broadcaster (Tier 0)

**User Story:** As a broadcaster, I want to loop a short message from a speaker, so that anyone near me can receive it with no network.

#### Acceptance Criteria

1. THE Broadcaster SHALL provide a message field accepting 1 to 140 characters with no newline, validated with the Requirement 19 rules for a ghost.
2. IF the message field is empty, longer than 140 characters, contains a newline, or fails the Requirement 19 rules, THEN THE Broadcaster SHALL disable the ON AIR control, show an error message indicating which rule failed, and keep the text the broadcaster typed.
3. WHEN the broadcaster presses ON AIR with a valid message, THE Broadcaster SHALL encode the message with the `broadcast` Carrier profile and loop the Ghost track continuously, with no gap of more than 1.1 s between the end of one pass's audio and the start of the next (the modem inserts exactly 1 s of silence plus chirp tapers), until the broadcaster stops it.
4. IF audio playback cannot start or stops without the broadcaster pressing the stop control, THEN THE Broadcaster SHALL turn the ON AIR light dark, show an error message indicating that playback failed, and keep the message text in the field.
5. WHILE the Broadcaster is on air, THE Broadcaster SHALL pulse the ON AIR light, and the pulse SHALL start when audio playback starts and stop when playback stops.
6. WHILE the Broadcaster is on air, THE Broadcaster SHALL show a pass counter that starts at 1 when playback starts and increases by 1 at the start of each pass, taken from the playback position of the audio and not from a timer.
7. THE Broadcaster SHALL show a QR code of the Receive URL at least 200 px wide on a 360 px wide screen, and WHERE a mode hint is supported, the Receive URL MAY carry `?mode=line`; the Darkroom SHALL work whether or not the hint is present.
8. WHEN the broadcaster edits the message to another valid message while on air, THE Broadcaster SHALL finish the current pass, start the new message at the next pass boundary, reset the pass counter to 1 at that boundary, and show a notice that the change takes effect at the next pass.
9. IF the broadcaster edits the message while on air to an invalid message, THEN THE Broadcaster SHALL keep looping the last valid message and show the error message from criterion 2.
10. WHILE the Broadcaster is on air, THE Broadcaster SHALL keep the screen awake WHERE the browser supports the Screen Wake Lock API.
11. THE Broadcaster SHALL be fully usable, with no horizontal scrolling and all controls reachable, on a screen 360 px wide, and the layout SHALL be designed for that width first.
12. WHILE the Broadcaster is on air with Reduced motion active, THE Broadcaster SHALL show the ON AIR light as steady with the pass counter, and no pulse.
13. WHEN the broadcaster presses the stop control, THE Broadcaster SHALL stop playback within 200 ms, turn the ON AIR light dark, stop the pass counter, and release the screen wake lock if one is held.

### Requirement 29: Side B examples (Tier 1)

**User Story:** As a first-time broadcaster, I want ready-made examples, so that I can try a broadcast in one tap.

#### Acceptance Criteria

1. THE Broadcaster SHALL offer exactly three one-tap examples, labelled "party secret", "exhibition label" and "public notice", each as a separate tappable control.
2. WHEN the broadcaster taps an example, THE Broadcaster SHALL replace the full contents of the message field with that example's text within 100 ms, update the character count to match, and SHALL NOT start the broadcast.
3. THE party secret example SHALL use the text "Happy birthday — look under your pillow."
4. THE public notice example SHALL use the text "Shelter open at Sayles Hall. Water and blankets until 10 pm."
5. UNTIL the developer supplies the exhibition label text, THE UI SHALL use a placeholder exhibition label that is 1 to 140 characters long, contains no newline, and passes `encodeText`.
6. THE test suite SHALL assert that every example, read from `src/ui/copy.ts` (Requirement 38), is 1 to 140 characters, contains no newline, passes `encodeText` and encodes with the `broadcast` Carrier profile.
7. IF an example's text fails `encodeText` or the `broadcast` Carrier profile encoding when tapped, THEN THE Broadcaster SHALL leave the message field unchanged, SHALL NOT start the broadcast, and SHALL show an error message indicating that the example could not be loaded.

### Requirement 30: Routes and navigation (Tier 0)

**User Story:** As a visitor, I want clear places to go, so that I can find sending and receiving.

#### Acceptance Criteria

1. THE UI SHALL provide exactly five routes: home (demo Darkroom), Receive (listen and upload), Compose, Tape-player and Broadcast.
2. THE UI SHALL implement routing without a framework, and each route SHALL load with the History API or hash routes that work on Cloudflare Pages without server rewrites that carry the fragment to a server.
3. WHEN the visitor opens a route directly by URL, including by reload while offline after the first visit, THE UI SHALL render that route's primary content within 2 seconds, without a network request and without first redirecting through another route.
4. THE UI SHALL show, on every route, a navigation control with one link to the receiving side (Receive) and one link to the sending side (Compose), and WHEN the visitor activates a link, THE UI SHALL render the target route within 1 second.
5. IF the visitor opens a URL that matches none of the five routes, THEN THE UI SHALL render the home route, show a message that the page was not found, and keep the navigation control visible.
6. IF a route shows an error state, THEN THE UI SHALL show at least one control in that state that leads to a next action (retry, another route, or upload), and SHALL NOT leave the visitor on a screen with no actionable control.
7. WHEN the visitor leaves a Darkroom route (home or Receive) by any navigation, including the browser back and forward buttons, THE UI SHALL stop microphone capture, release the microphone stream so the browser's recording indicator turns off, and stop audio playback within 500 milliseconds.

### Requirement 31: Offline PWA (Tier 0)

**User Story:** As a person without a network, I want the app to work offline after one visit, so that airplane-mode reception works.

#### Acceptance Criteria

1. THE UI SHALL provide a web app manifest and a service worker that meet the browser's installability criteria, so that the browser offers installation on a device with a supported browser over HTTPS.
2. WHEN the app has loaded once over HTTPS and the service worker has finished installing, THE service worker SHALL have cached every asset that any route requires, including the AudioWorklet and Worker bundles, fonts, icons and the demo audio file, so that a reload with the network disabled loads every route with zero failed asset loads.
3. WHILE the device is offline, THE UI SHALL run every route, including the demo, listening, file upload, the Composer, the Tape-player page and the Broadcaster, and each route SHALL complete its primary function (the demo plays and decodes, a recording or uploaded file decodes, the Composer produces a tape, the Tape-player plays, the Broadcaster loops) with no error caused by a failed network request.
4. THE UI SHALL make no network request at runtime for any message, tape or analytics (Requirement 34).
5. WHEN a new version is available, THE UI SHALL show a notice to the visitor within 5 seconds of detecting it and SHALL apply the new version on the next page load.
6. WHILE a reception or a broadcast is running, THE UI SHALL NOT reload the page, replace the running worker or worklet bundles, or hide the progress display because of a new version.
7. IF the first visit ends before the service worker has cached every required asset (for example because the network drops during installation), THEN THE service worker SHALL NOT report the install as complete and SHALL retry caching on the next online visit, and THE UI SHALL continue to work online during that time.
8. THE test suite or a documented manual script SHALL verify criterion 3 in a browser with the network disabled, and the developer SHALL record the airplane-mode demo result on the Test phone in `KIRO_LOG.md`.
9. WHEN the service worker activates, THE service worker SHALL write its assets to a cache name that includes a version identifier and SHALL delete every cache created by earlier versions of this app, so that exactly one app cache remains after activation.

### Requirement 32: Accessibility (Tier 0)

**User Story:** As a person with different abilities, I want to use Ghost Tape, so that the ritual is for everyone.

#### Acceptance Criteria

1. WHERE Reduced motion is active, THE UI SHALL show no flicker, no spinning Cassette, no pulsing ON AIR light and no sliding Paper, and SHALL show the same states by static change, with no element changing opacity, position or colour more than once per second.
2. THE UI SHALL meet WCAG 2.2 AA text contrast (4.5:1 for text under 24 CSS px, or 18.66 CSS px if bold, and 3:1 for larger text and for UI component boundaries and state indicators) in every Darkroom state, including the red Safelight palette. These thresholds apply to Developed text, labels, controls and focus indicators, and to a Glyph at confidence 1. Provisional Glyphs below confidence 1 are exempt as stated in Requirement 7.10.
3. THE UI SHALL be fully operable by keyboard alone, SHALL show a visible focus indicator with at least 3:1 contrast against adjacent colours on every focusable element, and SHALL make every interactive target at least 44 × 44 CSS px.
4. WHEN listening starts, a signal is detected, a tape header is received, a `pass-complete` event occurs, a discard message is shown (Requirement 9), or `complete` occurs, THE UI SHALL post one `aria-live="polite"` announcement within 1000 ms. The announcement SHALL contain: for the tape header, the expected length; for `pass-complete`, the pass number and clarity; and for `complete`, the final text.
5. THE UI SHALL NOT include provisional bytes, or any text derived from them, in any `aria-live` region or in any accessible name or description.
6. THE Composer SHALL give every field a programmatically associated visible label or accessible name, and the cards' visuals SHALL be decoration over the inputs, hidden from assistive technology (`aria-hidden`) so that no field content is read twice.
7. THE UI SHALL provide on every route exactly one level-1 heading, no skipped heading levels, and a `main` landmark.
8. THE UI SHALL NOT rely on colour alone to convey state: each Safelight state SHALL also have a visible text label, and the label SHALL be exposed to assistive technology.
9. THE test suite SHALL check the contrast ratios of the Design tokens' colour pairs against the thresholds in criterion 2, and an automated accessibility scan SHALL report zero violations of serious or critical impact on each route.
10. IF a state change is announced while a previous announcement is still pending, THEN THE UI SHALL queue it politely and SHALL NOT interrupt or drop it, so that no announcement from criterion 4 is lost.

### Requirement 33: Performance (Tier 0)

**User Story:** As a recipient on an ordinary phone, I want the animation to be smooth without losing the message, so that the ritual works on my device.

#### Acceptance Criteria

1. THE UI SHALL run the Decoder in a Worker fed by an AudioWorklet [acoustic-modem design, Audio adapters], and SHALL NOT call `push` on the main thread for live listening.
2. WHILE the Darkroom animates, THE Decoder SHALL receive every microphone sample, with the AudioWorklet to Worker queue never dropping a frame. A test SHALL verify this by comparing the count of samples delivered to the Decoder with the count captured by the AudioWorklet over a listening session of at least 60 seconds, and the two counts SHALL be equal.
3. THE Darkroom SHALL render the Glyph layer on a canvas and SHALL update it at most once per animation frame.
4. THE Darkroom SHALL coalesce `progress` events that arrive faster than one per animation frame, applying the latest provisional bytes and merging Symbol history from every event, so that no Symbol history entry from any coalesced event is lost.
5. WHEN the Test phone or a 4× CPU-throttled desktop browser receives a maximum-size Standard tape (1024 bytes) with the Darkroom animating, THE UI SHALL decode it with output bytes identical to those decoded without animation, and the Worker's wall-clock decode time SHALL stay at or below 0.2× the audio duration [acoustic-modem R4.4].
6. THE UI SHALL keep First-load JS at or below a budget of 60 KB gzipped (measured as the sum of gzip-compressed JavaScript bytes fetched before the first interactive screen), and SHALL lazy-load the Composer and the PNG export code so that neither is fetched until the user first opens the Composer or first requests a PNG export.
7. THE UI SHALL use plain TypeScript with DOM and canvas, and no UI framework.
8. IF First-load JS exceeds the budget, THEN THE build SHALL fail with a non-zero exit status and an error message that names the measured size and the budget.
9. WHILE the Darkroom animates on the Test phone, THE Darkroom SHALL sustain a median frame rate of at least 30 frames per second over a 30-second window, with no single frame longer than 100 ms.

### Requirement 34: Privacy (Tier 0)

**User Story:** As a user, I want my letters to stay between me and my friend, so that I can trust the app.

#### Acceptance Criteria

1. THE UI SHALL contain no user accounts, no server-side storage of messages, and no analytics or tracking script.
2. THE UI SHALL place payload data only in the URL fragment of a Tape link, so that no HTTP request, referrer or server log carries it.
3. THE UI SHALL send the response header `Referrer-Policy: no-referrer` on every page and asset response, and a Content-Security-Policy whose `script-src` and `connect-src` directives allow only the same origin (`'self'`).
4. THE UI SHALL make no network request except for loading its own same-origin assets and the update check of its service worker.
5. WHEN the test suite runs, THE test suite SHALL fail if any source file under `src/` contains a call to `fetch`, `XMLHttpRequest` or `navigator.sendBeacon` that sends payload data, tape content, or data derived from a recording.
6. WHILE the sender has not granted permission (Requirement 18.9), THE UI SHALL write no draft content to `localStorage`.
7. IF the sender withdraws the permission (Requirement 18.13), THEN THE UI SHALL delete the stored draft from `localStorage` within 1 second and confirm the deletion to the sender.
8. IF a loaded page requests a resource from a different origin, THEN THE UI SHALL block the request through the Content-Security-Policy and SHALL NOT transmit any payload data with it.

### Requirement 35: Deployment (Tier 0)

**User Story:** As the developer, I want a simple static deployment, so that the app is available over HTTPS.

#### Acceptance Criteria

1. WHEN the production build completes, THE build SHALL produce only static files deployable to Cloudflare Pages, with no server function.
2. THE deployment SHALL serve every route over HTTPS, so that microphone access works.
3. IF a request arrives over plain HTTP, THEN THE deployment SHALL redirect it to the HTTPS URL of the same path.
4. THE deployment SHALL serve a `_headers` file that sets the policies of Requirement 34.3 and sets a cache lifetime of at least 31,536,000 seconds (1 year) for hashed assets.
5. THE deployment SHALL serve the service worker file and the HTML entry file with revalidation on every request, so that an updated app version is detected on the next online visit.
6. WHEN the production build completes, THE build SHALL include the worklet, the Worker and the demo audio in the output.
7. IF the build output is missing the worklet, the Worker or the demo audio, THEN THE build SHALL exit with a non-zero status and name each missing file.
8. THE `README.md` SHALL state the deployment steps in at most 10 lines.

### Requirement 36: Visual and typographic system (Tier 0)

**User Story:** As a visitor, I want the app to look like a crafted object, so that it feels like a gift and not a tech demo.

#### Acceptance Criteria

1. THE UI SHALL define colours, type scale, spacing and motion durations as Design tokens in one place (one CSS custom-properties file with a matching TypeScript export for canvas code), and every Design token in the TypeScript export SHALL have the same name and value as its CSS custom property.
2. THE UI SHALL set body and letter text in a serif typeface, with a fallback stack of system serifs, and SHALL bundle any web font it uses so that every glyph of the English text renders in that font with the network disabled.
3. THE Darkroom SHALL use the darkroom palette (dark ground, red Safelight, warm white after fixing) and the Composer SHALL use the cassette palette, and both palettes SHALL use the same type scale.
4. THE UI SHALL use no colour, font-family, font-size, spacing or duration value in a component that is not a Design token. A search of component styles and canvas code for literal colour, font-family, font-size, spacing and duration values SHALL find none outside the Design token files.
5. THE UI SHALL write all user-visible text in English, and SHALL keep it in `src/ui/copy.ts` (Requirement 38).
6. THE UI SHALL use at most 6 named colours per world (the Darkroom palette and the cassette palette each count as one world).
7. THE UI copy SHALL keep an eerie and tender tone with no gore and no jump scares. THE UI SHALL NOT play any sound other than the Ghost track and the Ghost track's own overture. THE UI SHALL NOT start any sound without a user gesture, and no UI-generated sound SHALL exceed the peak level of the Ghost track.
8. IF a web font fails to load or is missing, THEN THE UI SHALL render text in the system serif fallback stack, SHALL keep all text visible (no blank text while the font loads), and SHALL show no error to the user.
9. WHEN the user has requested reduced motion in the operating system, THE UI SHALL replace each motion Design token duration with 0 ms or a cross-fade of at most 200 ms, and SHALL still show all content.
10. THE UI SHALL render body and letter text at a size of at least 16 px and with a contrast ratio of at least 4.5:1 against its background, in both the Darkroom and Composer palettes. This applies to Developed text, labels and controls, and to a Glyph at confidence 1; provisional Glyphs below confidence 1 are exempt (Requirement 7.10).

### Requirement 37: Testability (Tier 0)

**User Story:** As the developer, I want the UI logic testable in Node, so that I can iterate fast and trust the darkroom.

#### Acceptance Criteria

1. THE UI SHALL implement as pure functions in `src/ui/`, with no DOM access, these units: the Layout hint parser, the provisional-byte-to-Glyph state reducer (including Symbol history), the validation-to-plain-language mapping, the character conversion function, the Carrier profile table, the fragment encoder and decoder, the demo-length check, the Side B example validity check, the suggested broadcast message builder and the darkroom state machine.
2. THE test suite SHALL include a seeded fast-check property test for every unit of criterion 1 that has an inverse or an invariant, including: fragment round trip (Requirement 22.3), layout round trip (Requirement 6.9), layout consistency under corruption (Requirement 6.10), Symbol history membership (Requirement 7.9), and character conversion identity on valid text (Requirement 19.6). Each such property test SHALL use a fixed seed and run at least 100 generated cases, and a failing case SHALL be reproducible by re-running with the same seed.
3. THE test suite SHALL run the darkroom state machine over Replay feeds recorded from the real Decoder, with the Channel simulator applied (noise, band-pass, reverb), and not only over a perfect channel. The suite SHALL include at least one Replay feed that ends with `complete` and at least one that ends without `complete`.
4. THE test suite SHALL use a test-only synthesized `progress` feed, built from the `ProvisionalByte` type and the real serializer, only as a unit-test fixture for exact event sequences (for example one batch holding `pass-complete` and `complete`), and SHALL use feeds recorded from the real Decoder for every end-to-end Darkroom test (criterion 3).
5. THE test suite SHALL assert, for every Replay feed and for generated event sequences (seeded, at least 100 sequences), that the darkroom state machine never reaches the Fixing state without a prior `complete` event, and never leaves the Fixing state except on `reset` or a user action.
6. THE test suite SHALL assert Requirement 11.8 over Replay feeds with and without `complete`.
7. THE UI SHALL import limits, charset and validation from `src/modem/tape` by deep import, MAY deep-import read-only helpers from `src/modem/tape`, `src/modem/interleave`, `src/modem/frame` and `src/modem/profiles` (Requirement 20.3), and SHALL NOT modify `src/modem/`. IF a change to `src/modem/` (including an additive re-export) is needed, THEN THE UI SHALL leave `src/modem/` unchanged until the developer approves it.
8. WHERE the build is a development build, THE UI SHALL provide a utility that renders a given `Float32Array` of samples at a given sample rate as a spectrogram on a canvas, and THE production build SHALL NOT include this utility.
9. WHEN `npm test` is run on the Developer laptop, THE UI tests SHALL add at most 20 s to the 60 s limit of acoustic-modem R11.8, so that the combined run completes within 80 s.
10. THE UI SHALL contain no source of randomness in `src/ui/` logic (including `Math.random` and time-seeded values) that a test cannot replace with a seeded or injected value, and any clock the logic reads SHALL be injectable.

### Requirement 38: User-facing copy in one file (Tier 0)

**User Story:** As the developer, I want every user-visible string in one module, so that I can replace the draft copy with the final copy in one place and the tests keep checking it.

#### Acceptance Criteria

1. THE UI SHALL define every user-visible string in the single module `src/ui/copy.ts`: labels, button text, status and error messages, discard messages and the "still faint" message (Requirement 9), the demo tape text (Requirement 2), the example broadcast texts including the exhibition label (Requirement 29), the call to action (Requirement 1.4), ARIA announcements (Requirement 32.4) and the pre-permission explanation (Requirement 3.1).
2. THE UI SHALL contain no user-visible string literal in `src/ui/` outside `src/ui/copy.ts`.
3. THE module `src/ui/copy.ts` SHALL define each string that contains a number as a function that takes the number as a parameter.
4. UNTIL the developer replaces the copy, every string in `src/ui/copy.ts` SHALL be a draft placeholder, and the module SHALL state this in a header comment. The strings quoted in these requirements are the initial drafts. The developer will replace the drafts with final copy before Nov 28, and the replacement SHALL require editing only `src/ui/copy.ts`.
5. THE test suite SHALL fail if its scan of `src/ui/` finds a user-visible string literal outside `src/ui/copy.ts`. The scan SHALL use an allow-list, documented in the test, for non-user strings such as CSS class names, event names and URLs.
6. THE test suite SHALL run every copy-dependent assertion against the strings read from `src/ui/copy.ts`: the length of the demo tape (Requirement 2.5), the validity of every example (Requirement 29.6), and the validity against the Ghost Tape charset of every string in `src/ui/copy.ts` that the UI ever encodes.
