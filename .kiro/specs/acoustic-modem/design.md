# Design: Acoustic Modem (Ghost Tape core)

## Overview

Ghost Tape uses **multiple frequency-shift keying (MFSK)**: each symbol is one pure tone chosen from a small set, and the tone's index carries a few bits. MFSK is chosen over faster schemes (PSK, OFDM) because it tolerates unknown gain and echo, needs no phase tracking, and is easy to reason about. It descends directly from the 1975 Kansas City Standard, which stored data on cassette as two tones.

Signal chain:

```
SENDER
tape ─serialize─▶ payload ─+CRC32─▶ split into blocks ─RS(+32 each)─▶ interleave ─▶ bits ─Gray─▶ tone indices
                                                                                                   │
header (12 B) ─RS(+8)─▶ bits ─Gray─▶ tone indices (Robust / music-box)                             │
                                                                                                   ▼
[up-chirp][gap][sync][header]  ←— overture —→  [payload symbols + pilots][down-chirp]  ─▶ samples ─▶ WAV / speaker
                                                                                  (loop mode: repeat N passes)

RECEIVER
mic/WAV ─▶ streaming buffer ─▶ chirp matched filter ─▶ fine timing (sync)
       ─▶ header (Robust) ─▶ tape ID ─▶ accumulator for that tape
       ─▶ payload symbols: Goertzel energies per tone ─▶ normalize ─▶ ADD into accumulator
       ─▶ decide from accumulated energies ─▶ Gray⁻¹ ─▶ bytes ─▶ de-interleave
       ─▶ RS decode per block ─▶ CRC32 ─▶ deserialize ─▶ tape   (or: keep developing)
```

## Tape format (`tape.ts`)

Serialized as a compact binary record. All strings are UTF-8 restricted to the allowed character set (printable ASCII plus `‘ ’ “ ” — …`), each prefixed with a 1-byte length.

| Field | Encoding | Limit |
|---|---|---|
| kind | 1 byte: 0 = tape (Side A), 1 = ghost (Side B) | — |
| title | len + bytes | 40 |
| from | len + bytes | 24 |
| to | len + bytes | 24 |
| date | 3 bytes: year−2000, month, day | — |
| trackCount | 1 byte | 0–10 |
| tracks[] | len + bytes each | 60 each |
| letter | 2-byte len + bytes | 800 |
| doodleFlag | 1 byte: 0 none, 1 present | — |
| doodle | 128 bytes (32×32, 1 bit/pixel, row-major) | stretch |

A ghost (`kind = 1`) carries only `message` (len + bytes, ≤ 140) after `kind`.

Typical sizes:
- Ghost, 100 chars ≈ 102 bytes.
- Tape with title, names, 5 tracks (~30 chars each), 350-char letter ≈ 560 bytes.
- Maximum ≈ 1024 bytes (enforced after serialization).

## Profiles (`profiles.ts`)

Tones are placed on a grid that is a multiple of `1 / analysisWindow`, so they are **orthogonal** over the window (no leakage between Goertzel bins).

| Parameter | Robust / music-box (id 0) | Standard (id 1) |
|---|---|---|
| Tones | 4: **1175, 1475, 1750, 2350 Hz** (≈ D6, F♯6, A6, D7 — a D-major arpeggio, rounded to the 25 Hz grid) | 16: 1500 + 100·k Hz, k = 0…15 |
| Bits per symbol | 2 | 4 |
| Symbol duration | 50 ms | 25 ms |
| Guard (skipped at symbol start) | 10 ms | 5 ms |
| Analysis window | 40 ms (25 Hz grid) | 20 ms (50 Hz grid) |
| Envelope | Bell-like: amplitude decays from 1.0 to 0.6 across the symbol (music-box timbre) | Flat |
| Raw bit rate | 40 bit/s | 160 bit/s |
| Used for | overture (always); noisy rooms; compressed channels | default payload |

**Experiment (week 2):** a third profile "Standard-musical" — 8 tones from a D-major pentatonic scale between 1175 and 3525 Hz, 3 bits/symbol, 25 ms. Adopt for the payload only if its simulator success rate is within 2 dB SNR of Standard. Profiles are data; code never hardcodes tone tables.

## Frame structure (one pass)

| Segment | Content | Duration |
|---|---|---|
| Preamble | Linear up-chirp 1000 → 3500 Hz, Hann-tapered | 400 ms |
| Gap | Silence | 50 ms |
| Sync | 8 Robust symbols, tone indices `[0,3,0,3,1,2,1,2]` (a recognizable four-note motif played twice) | 400 ms |
| Header | 20 bytes (12 data + 8 RS parity) in Robust = 80 symbols | 4.0 s |
| Payload | Encoded payload in the header's profile, with a pilot symbol every 32 data symbols | varies |
| Postamble | Linear down-chirp 3500 → 1000 Hz | 200 ms |

Overture total ≈ 4.85 s. Loop mode inserts 1 s of silence between passes.

### Header (12 data bytes, big-endian)

| Bytes | Field | Value |
|---|---|---|
| 0–1 | magic | `0x47 0x54` ("GT") |
| 2 | version | `0x01` |
| 3 | profileId | payload profile |
| 4 | payloadKind | 0 = tape, 1 = ghost |
| 5–6 | payloadLength | bytes before CRC, 1–1024 |
| 7 | flags | reserved, 0 in v1 |
| 8–11 | tapeId | CRC-32 of the serialized payload |

`tapeId` lets the receiver recognise repeated passes of the same tape without any randomness in the modem. RS with 8 parity bytes corrects up to 4 byte errors in the header.

### Payload encoding
1. `payload = serialize(tape)`; append CRC-32 (IEEE 802.3) → `M = len + 4` bytes.
2. Split into `B = ceil(M / 223)` near-equal blocks.
3. Reed–Solomon over GF(2⁸), primitive polynomial `0x11d`, 32 parity bytes per block (corrects 16 byte errors or 32 erasures per block).
4. **Byte interleaving** across blocks (byte 0 of every block, then byte 1 of every block…). Bursts spread across blocks. Interleaving also scatters arriving bytes across the whole message, which is exactly what the darkroom animation shows.
5. Bytes → bits (MSB first) → groups of `bitsPerSymbol` → **Gray code** → tone index; zero-pad the final group.
6. Insert a pilot (Standard: index 15; Robust: index 3) every 32 data symbols.

### Durations (Standard payload)
| Content | Payload bytes | Ghost-track length |
|---|---|---|
| Ghost, 100 chars | ~102 → 1 block → 138 B | ≈ 12 s |
| Typical tape | ~560 → 3 blocks → 660 B | ≈ 39 s |
| Maximum | 1024 → 5 blocks → 1188 B | ≈ 66 s |

## Modulation (`modulate.ts`)
- Continuous-phase synthesis: oscillator phase carries across symbols, so no clicks.
- Robust symbols use the bell envelope; Standard symbols are flat.
- 2 ms raised-cosine fade at the start and end of each pass; peak normalized to 0.8.
- Chirp phase: `φ(t) = 2π (f0·t + (f1 − f0)·t² / (2T))`.

## Demodulation

### 1. Preamble detection (`sync.ts`)
FFT-based cross-correlation of the incoming stream with the up-chirp template. Detection when the peak exceeds **8×** the median absolute correlation over the surrounding 1 s (gain-independent).

### 2. Fine timing
Search ±10 ms around the predicted sync start in 0.5 ms steps; pick the offset maximizing the summed energy of the expected sync tones.

### 3. Symbol energies (`demodulate.ts`)
- For each symbol: skip the guard, run **Goertzel** for every tone over the analysis window → energy vector `e[0..T-1]`.
- **Normalize per symbol**: `e / sum(e)`. This makes passes recorded at different volumes comparable before combining.
- **Timing tracking:** early–late gate (±1 ms, gain 0.1) plus re-anchoring at pilots (±3 ms). Handles ±0.2% sample-rate mismatch.

### 4. Accumulation across passes (`accumulator.ts`) — Requirement 6
- Keyed by `tapeId`. Holds, for every payload symbol position, a running sum of normalized energy vectors and a pass count.
- After each pass: add this pass's normalized vectors; decision per symbol = `argmax(sum)`; confidence = `1 − second/best` on the summed vector.
- Why it works: the true tone's energy adds up coherently pass after pass, while noise energy spreads randomly across tones, so the gap between the right tone and the rest grows with every pass (energy combining / "equal-gain combining").
- A pass whose header is valid but whose payload alignment fails (e.g. too few pilots matched) is **not** added.
- State expires after 10 minutes of inactivity or on `reset()`.

### 5. Bytes and error correction
- Gray-decode → bits → bytes → de-interleave → RS-decode each block.
- All blocks OK → concatenate, verify CRC-32, deserialize (strict: any invalid field = failure). Otherwise keep developing.
- *Stretch:* use low-confidence symbols as RS **erasures** (corrects `2·errors + erasures ≤ 32` per block).

### 6. Streaming decoder API

```ts
type ProfileId = 'robust' | 'standard';

interface Tape {
  kind: 'tape';
  title: string; from: string; to: string; date: string; // YYYY-MM-DD
  tracks: string[]; letter: string;
  doodle?: Uint8Array; // 128 bytes, stretch
}
interface Ghost { kind: 'ghost'; message: string }
type Payload = Tape | Ghost;

type DecoderEvent =
  | { type: 'signal-detected'; atSample: number }
  | { type: 'header'; tapeId: number; profile: ProfileId; payloadLength: number;
      pass: number; estimatedSecondsRemaining: number }
  | { type: 'progress'; tapeId: number;
      provisional: Array<{ index: number; byte: number; confidence: number }>; // positions in final payload
      fractionReceived: number }
  | { type: 'pass-complete'; tapeId: number; pass: number;
      blocksRecovered: number; blocksTotal: number; clarity: number }
  | { type: 'complete'; tapeId: number; payload: Payload; passesUsed: number }
  | { type: 'pass-discarded'; reason: 'header-invalid' | 'alignment-failed' | 'signal-lost' };

interface Decoder {
  push(samples: Float32Array): DecoderEvent[]; // any chunk size
  flush(): DecoderEvent[];
  reset(): void;
}

function createDecoder(opts: { sampleRate: number }): Decoder;
function encodePayload(p: Payload, opts: { profile: ProfileId; sampleRate: number; passes?: number }):
  { ok: true; samples: Float32Array; durationSec: number } | { ok: false; reason: string };
function decodeFile(samples: Float32Array, sampleRate: number):
  { ok: true; payload: Payload; passesUsed: number } | { ok: false; reason: string; clarity: number };
```

`clarity` = mean confidence over all payload symbols, in [0, 1].

## Channel simulator (`channel.ts`, tests only)

Deterministic given a seed; each impairment optional.

| Impairment | Range used in property tests |
|---|---|
| Gain | 0.05× – 2× |
| Surrounding audio | 0–3 s of noise or silence before/after |
| White noise | target SNR in dB relative to signal RMS |
| Sample-rate mismatch | 0.998 – 1.002 (linear-interpolation resample) |
| Band-pass | 300–4000 Hz, 2nd-order Butterworth |
| Reverberation | exponentially decaying noise impulse response, RT60 ≤ 300 ms |
| Dropout | one ≤ 150 ms segment zeroed or replaced with loud noise |
| Sample-rate conversion | encode at 48 kHz, decode at 44.1 kHz and vice versa |
| Independent noise per pass | for multi-pass tests, each pass gets a fresh noise seed |

Codec round-trips (Opus, AAC) are **not** part of the simulator; they are measured offline with `ffmpeg` fixtures (task 15).

## Correctness properties (fast-check)

| # | Property | Covers |
|---|---|---|
| P1 | `bitsToBytes(bytesToBits(b)) == b` | R1 |
| P2 | Gray code is a bijection; adjacent indices differ in exactly one bit | R5 |
| P3 | CRC-32 detects every single-bit flip | R7 |
| P4 | RS decode returns the original for any ≤ 16 corrupted bytes per block | R5, R7 |
| P5 | For > 16 corruptions RS returns original or failure; end to end, CRC guarantees no wrong payload | R7 |
| P6 | `deinterleave(interleave(blocks)) == blocks` | R5 |
| P7 | `deserialize(serialize(p)) == p` for any valid tape or ghost; invalid inputs are rejected, never truncated | R2 |
| P8 | `parseFrame(buildFrame(p)) == p` at symbol level, any profile | R1, R9 |
| P9 | **Perfect channel:** `decodeFile(encodePayload(p)) == p`, both profiles, both sample rates | R1, R3 |
| P10 | **Damaged channel:** P9 through the simulator within Requirement 5 limits | R5 |
| P11 | **Chunking invariance:** random chunk sizes into `push` give identical events | R4 |
| P12 | **Never throws:** any finite input yields no exception and never a `complete` | R3, R7, R11 |
| P13 | **Never wrong:** across all simulated runs, every `complete` payload equals the input exactly | R7 |
| P14 | **More passes never hurt:** over a fixed seed set, success count after N+1 passes ≥ after N passes, N = 1…4 | R6 |
| P15 | **Separate plays combine:** two passes separated by arbitrary unrelated audio combine the same as consecutive passes | R6 |
| P16 | **Different tapes don't mix:** interleaving passes of two different tapes yields each tape correctly (or not yet), never a blend | R4, R6 |

P10, P13–P16 run few cases in `npm test` and many in `npm run test:deep`.

## Error handling summary

| Situation | Behavior |
|---|---|
| Tape too large / invalid field | encoder returns `{ ok: false, reason }` naming the field |
| No chirp | nothing emitted |
| Header invalid | `pass-discarded: header-invalid`, keep listening |
| Payload misaligned | `pass-discarded: alignment-failed`, accumulator untouched |
| Blocks still uncorrectable | `pass-complete` with clarity < 1; keep developing |
| CRC mismatch after all blocks "recover" | treat as not yet developed; keep accumulating |

## Open questions (decide during weeks 1–2)
1. Hand-written Reed–Solomon (~200 lines, ideal for PBT) vs. a dependency that passes P4/P5.
2. Do 16 tones at 100 Hz spacing survive real phone speakers, or should Standard drop to 8 tones?
3. Does the musical payload profile cost more than 2 dB SNR vs. Standard?
4. Which voice-message codecs pass with Standard, Robust, or neither?
