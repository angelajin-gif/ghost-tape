---
inclusion: always
---

# Product: Ghost Tape

**A letter hidden in sound.** Ghost Tape resurrects the mixtape — and the forgotten fact that cassettes once stored *data*, not just music. A sender makes a "tape": a J-card (title, from, to, date, a short tracklist) plus a letter. Ghost Tape turns it into a ghost track: a music-box overture followed by a fast, whispering stream of tones. The recipient plays the track from any speaker, holds up a second device, and watches the J-card and letter develop on screen like a photograph in a darkroom.

## The two sides of the tape
- **Side A — Send a tape (primary).** Make a J-card + letter, send it as a tape-player link or as an audio file (voice message, video soundtrack, story background). Opened by playing it out loud to Ghost Tape.
- **Side B — Broadcast a ghost (impact proof).** A short message that loops from any speaker — a party, an exhibition, a community radio, a loudspeaker in a shelter. Anyone within earshot holds up a phone and receives the text: no data plan, no account, no pairing. Built from the same engine; looping + multi-pass reception make it work. Built after Side A, but **not on the cut list**: at minimum a working demo ships.

## Why sound (answer to "why not just text it?")
1. **Sound is the envelope, not the postal route.** The letter is sealed until someone listens with Ghost Tape. Opening it is a ritual: play, hold up a device, watch it develop.
2. **Sound can ride inside anything that plays audio.** A voice message, a video, a phone call, a radio broadcast, a loudspeaker.
3. **It works where the internet doesn't.** When networks are down, too expensive, or untrusted, information can still travel through whatever plays sound.

## Real problem, real precedent (Potential Impact)
Data-over-sound never died; it went quiet:
- The US Emergency Alert System still opens broadcasts with an FSK-encoded data header (1980s technology, same family as Ghost Tape).
- Amateur radio digital modes (e.g. FT8) move short messages across continents with no internet.
- Commercial uses: Chirp (acquired by Sonos), ultrasonic device pairing, sound-based payments for feature phones (ToneTag).

**Ghost Tape's claim:** any phone with a browser can receive verified text from any sound — a radio, a loudspeaker, a phone call — with no network. Target scenarios: disaster response when mobile networks fail (shelter locations, supply points); community radio in low-connectivity regions (market prices, health notices). The design choices serve this directly: multi-pass combining = repeated broadcasts; never-wrong-text = safe for critical information; 1.5–3 kHz band = fits inside a telephone call (300–3400 Hz).
We claim *potential* impact with real precedent and a working demo, not deployment.

## Pitch arc (3-minute video)
1. Hook: a mixtape letter develops on screen (both devices in airplane mode).
2. Turn: "This 1975 technology never died — emergency alerts still use it."
3. Impact: a looping broadcast in a room; strangers' phones receive the message; it gets clearer each pass.

## Story and tone
- Kiroween 2026, Resurrection category. Anchors: 1970s–80s mixtapes and tape trading; home computers that loaded programs from cassette; the 1975 Kansas City Standard; dial-up modem handshakes.
- Halloween hook: EVP — ghost hunters listening for voices in tape static. Here the static really does carry a message.
- Eerie and tender, never gory. Séance, darkroom, music box — not jump scares.
- **Language: English only** (UI and messages).

## Experience principles
1. **The constraint is the aesthetic.** Sound is slow; a tape takes ~30 s. Waiting is part of the ritual.
2. **Darkroom development, not typing.** The whole J-card and letter appear at once as flickering noise and sharpen everywhere simultaneously, because interleaved bytes really do arrive scattered across the message. Every flicker on screen is a real byte arriving — the animation never fakes data.
3. **Every séance makes the ghost clearer.** If one play isn't enough, play it again: the receiver combines passes and the message gets sharper each time. Failure is never a dead end.
4. **Never show a wrong word.** Final text is shown only when verified; otherwise it stays visibly "not yet developed."
5. **Anyone can try it with what they have:** two devices (QR hand-off), one device (laptop plays and listens to itself), or upload an audio file.
6. **No network in the loop.** The app is an installable PWA that works fully offline after the first visit. Demo proof: both devices in airplane mode.
7. **A recognizable voice.** Every tape opens with a music-box overture; the sound itself is part of the brand.

## Audience
- Primary: people who make mixtapes, playlists, zines and letters for friends.
- Secondary (judging): judges who must experience it in minutes on whatever devices they have.

## Out of scope
- Physical cassette hardware (cut for time; the UI keeps the cassette visual language).
- Hiding data inside music (steganography). The ghost track is its own track.
- Chinese/non-English messages. HTML payloads. Accounts or any server storing messages.

## Cut order if time runs short (first cut first)
1. Pixel doodle  2. Musical tones for the payload (keep the overture)  3. Voice-message codec support  4. Polish on the Side B page (keep a working broadcast + receive demo)
**Never cut:** multi-pass combining, the darkroom development animation, offline PWA, a working Side B demo.
