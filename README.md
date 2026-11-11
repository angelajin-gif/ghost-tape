# Ghost Tape

**A letter hidden in sound.** Ghost Tape turns a mixtape J-card and a letter into a ghost track: a music-box overture followed by a fast stream of tones. Play it from any speaker, hold up a second device, and watch the letter develop on screen. No network in the loop.

Built for Kiroween 2026 (Resurrection). The modem descends from the 1975 Kansas City Standard, which stored data on cassette as tones.

## Status

Early development. The acoustic modem is specified in [`.kiro/specs/acoustic-modem/`](.kiro/specs/acoustic-modem/) and built task by task; see `tasks.md` for progress.

## Development

Requires Node 20.19 or later.

```sh
npm install
npm test            # type checks + unit and fast property tests (target < 60 s)
npm run test:deep   # full property and channel-simulator suite (target < 10 min)
npm run dev         # local dev server (microphone needs HTTPS or localhost)
npm run check:scramble  # design-time check of the payload permutation rule
```

## Layout

- `src/modem/` — pure TypeScript modem library (no DOM, no Web Audio); testable in Node.
- `src/audio/` — browser adapters: files, microphone, playback, worklets.
- `src/ui/` — user interface.
- `tests/unit/`, `tests/properties/` — Vitest unit tests and fast-check property tests.
- `.kiro/` — Kiro specs, steering and hooks. `KIRO_LOG.md` records how Kiro was used.

## License

MIT © 2026 Angela Jin
