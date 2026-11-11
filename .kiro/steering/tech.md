---
inclusion: always
---

# Tech stack and engineering rules

## Stack
- TypeScript (strict mode), built with Vite. Static site, no backend.
- UI: plain TypeScript + DOM/Canvas (no heavy framework). Keep the bundle small.
- Tests: Vitest for unit tests, fast-check for property-based tests.
- Audio: Web Audio API. Microphone capture via `getUserMedia` + `AudioWorklet`. Heavy decoding runs off the main thread (Worklet or Web Worker).
- Deployment: Cloudflare Pages (HTTPS is required for microphone access).

## Architecture rules
- `src/modem/` is a **pure, framework-free library**: no DOM, no Web Audio, no globals. It takes and returns `Float32Array` samples and `Uint8Array` bytes. This is what makes it testable in Node and property-testable.
- All browser-specific code (mic, playback, worklets) lives in `src/audio/`. All UI lives in `src/ui/`.
- Every modem stage is a pair of inverse functions (`encodeX` / `decodeX`) so it can be round-trip tested.
- Decoders never throw on bad input. They return a discriminated union: `{ ok: true, value }` or `{ ok: false, reason }`.
- No randomness inside the modem. Tests that need randomness use seeded generators from fast-check.

## Microphone capture (critical)
Always request the mic with processing **disabled**, or the browser will erase the signal as "noise":
```ts
navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
});
```
Read the actual `AudioContext.sampleRate` (usually 44100 or 48000). Never assume one rate; the modem must work at both.

## Testing rules
- Every new modem function gets a round-trip property test before it is considered done.
- End-to-end tests run through the **channel simulator** (`src/modem/channel.ts`), never only through a perfect channel.
- A failing property test is a spec issue first: check whether the requirement or the code is wrong before "fixing" the test.

## Code style
- Small pure functions, explicit types at module boundaries, no `any`.
- Name units in identifiers: `durationMs`, `freqHz`, `sampleRate`.
- Comments explain *why* (signal-processing reasoning), not *what*.

## Shell usage
- Never write or edit files with shell heredocs or long echo/cat/printf commands; they hang or garble in this environment. Use the file editing tools instead. Keep shell commands short.
