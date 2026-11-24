# Ghost Tape UI — Brief for the `ghost-tape-ui` spec

Input for Kiro's Spec workflow. Product decisions below were made by Angela; turn them into requirements, design and tasks. The modem library (`src/modem/`, spec `acoustic-modem`) is done or in progress and is consumed through its public API and decoder events. Follow all steering docs (no heavy framework, small bundle, English only).

## 1. Visual direction
- **Two worlds, one typographic system.**
  - **Sending = the cassette world:** a J-card, a cassette whose tape spins while recording, a big REC key.
  - **Receiving = the darkroom world:** dark room, red safelight, a sheet of photographic paper in a developer tray.
  - **Shared base: editorial / exhibition-catalogue typography** — generous whitespace, a refined serif for text, restrained colour. It should read as a crafted object, not a tech demo.
- The darkroom is the first impression (see §2), so it gets the most polish.
- Tone: eerie and tender, never gory.

## 2. Landing page: experience receiving first
- The home page opens on the darkroom with a **demo tape** ready: "A tape from the other side."
- One tap: the same device plays the demo ghost track and listens to itself (single-device loop), and the demo letter develops on screen.
- Demo tape total length **≤ 15 s** (small J-card + a 1–2 sentence letter about tapes and ghosts). Angela writes the final text.
- After it develops: a clear call to action — **"Now send a tape to someone."**
- If microphone permission is denied or unavailable: offer "decode the demo file instead" (file path), so the magic still happens.

## 3. The darkroom (receive page) — development states
Every visual change must correspond to real decoder state. Nothing is faked.

| Decoder state | Visual |
|---|---|
| Listening, no signal | Dark room, red safelight, empty developer tray |
| `signal-detected` (chirp) | The safelight flickers once: something is coming |
| Overture + `header` | A blank sheet of photographic paper slides into the tray. Once the header is read, the **outline** of the J-card and letter appears at the right size (length is known) |
| `progress` | Characters develop **everywhere at once**: each glyph's opacity/sharpness = its confidence; low-confidence positions occasionally flicker to other glyphs, like unfixed grain |
| `complete` | **Fixing moment:** all glyphs snap sharp at once, the red safelight goes out, warm white light comes up |
| `pass-complete` without completion | The paper stays as it is; copy says the ghost is still faint — play it again. The next pass continues from that state and the image gets clearer |

- Show pass number and clarity subtly (for the "every séance makes the ghost clearer" story).
- Provisional bytes are never presented as final text.

## 4. After the tape develops
- **Save as image:** export the developed J-card + letter as a beautiful PNG (a darkroom print), sized for social sharing.
- **Reply with a tape:** opens the composer with from/to swapped.
- **Listen to the tracks:** each track title has a small button that opens a search for that title (Spotify / YouTube search URL). No platform APIs.
- The letter and track list are real, selectable text (accessibility), not only pixels.
- No "replay the ghost track" button.

## 5. Composer (send page): write directly on the J-card
- The centre of the screen is a **life-size cassette J-card**. The user clicks and types directly on it:
  - Front: title, from, to, date, tracklist (0–10 tracks).
  - Flip to the back: the letter.
- Beside it, a cassette whose **tape length grows with the content**, with a live duration ("this tape is 24 seconds long").
- Validation from the modem spec (charset, field limits, 1024-byte cap) appears inline on the card, in plain language. Unsupported characters are highlighted with a hint, not silently removed; curly quotes etc. are auto-converted where the charset allows.
- A big **REC** key: the cassette spins and the music-box overture plays as the track is generated.
- The J-card the sender writes is the same object the recipient sees develop.

### Sending options (after REC)
1. **Send a link (tape-player page):** a page that plays the ghost track, with a QR code so the recipient can hand off between devices (play on one, listen on the other). The payload travels in the URL fragment (never sent to a server).
2. **Download audio:** for voice messages, video soundtracks, stories.
3. **Make it a broadcast:** go to Side B with this message (if it fits Side B's limit).
- Profiles are never named in the UI. Default Standard; when the user picks voice message or broadcast, automatically use the more robust profile if the modem measurements recommend it.

## 6. Side B — broadcast a ghost
**Broadcaster screen (a tiny radio station):**
- Message field (≤ 140 chars) and an **ON AIR** button; loops the ghost track continuously.
- Pulsing ON AIR light, pass counter.
- A large **QR code on screen** linking to the receive page, so anyone nearby can open it.
- Three one-tap examples:
  1. Party secret — e.g. "Happy birthday — look under your pillow."
  2. Exhibition label — a short wall text for an artwork.
  3. Public notice — e.g. "Shelter open at Sayles Hall. Water and blankets until 10 pm."

**Receiver:** the same darkroom page in single-line mode (no J-card); pass number and clarity visible.

## 7. Defaults (not discussed in detail; use sensible standard practice)
- **Routes:** home/demo receive, receive (listen / upload file), compose, tape-player link, broadcast.
- **Mobile-first** receive and broadcast pages; composer works on phone and desktop.
- **Microphone:** explain why before asking; request with echo cancellation, noise suppression and AGC off (per steering); clear recovery if denied.
- **Upload path:** any audio format the browser can decode.
- **Offline PWA:** installable; fully works offline after first visit (required for the impact story and the airplane-mode demo).
- **Accessibility:** `prefers-reduced-motion` respected (develop without flicker); sufficient contrast even in the darkroom; screen-reader announcements for state changes and the final text; keyboard operable.
- **Performance:** decoding in the Worker/AudioWorklet path from the modem spec; animation must not stall decoding on a mid-range phone.
- **No accounts, no servers storing messages, no analytics.**
- **Deployment:** Cloudflare Pages (HTTPS).

## 8. Schedule constraints
- UI implementation happens in week 3 (Nov 24–30); polish + video in Dec 1–3.
- Priority if time runs short (cut first → last): track search buttons → save-as-image polish → composer flip animation → Side B examples polish.
- **Never cut:** demo-first landing, darkroom development (§3), REC + send link/QR, download audio, a working Side B broadcast + receive, offline PWA.
