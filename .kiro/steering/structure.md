---
inclusion: always
---

# Project structure

```
/
├── .kiro/                 # specs, steering, hooks — never gitignored
├── src/
│   ├── modem/             # pure TS library: bytes <-> samples (no DOM)
│   │   ├── types.ts       # public types: Payload, ProvisionalByte, DecoderEvent, Result
│   │   ├── bits.ts        # bytes <-> bits, Gray code
│   │   ├── crc32.ts
│   │   ├── reedSolomon.ts # GF(256) RS encode/decode
│   │   ├── interleave.ts  # pad/split, block interleave, whole-stream permutation
│   │   ├── tape.ts        # tape/ghost format: validate, serialize, deserialize
│   │   ├── frame.ts       # header, blocks, payload assembly
│   │   ├── accumulator.ts # multi-pass energy combining, keyed by tapeId
│   │   ├── profiles.ts    # tone tables and timing per profile
│   │   ├── modulate.ts    # symbols -> samples (MFSK, chirps)
│   │   ├── demodulate.ts  # samples -> symbols (Goertzel, timing)
│   │   ├── sync.ts        # preamble detection (matched filter), fine timing
│   │   ├── fft.ts         # radix-2 FFT shared by sync.ts and the channel simulator
│   │   ├── buffer.ts      # SampleBuffer: growing store addressed by absolute stream index
│   │   ├── decoder.ts     # streaming state machine: createDecoder, decodeFile
│   │   ├── channel.ts     # test-only channel simulator
│   │   └── index.ts       # encodePayload / createDecoder / decodeFile
│   ├── audio/             # mic capture, playback, worklets, WAV I/O (wav.ts is pure)
│   └── ui/                # recorder, receiver, manifestation animation; dev.ts harness
├── scripts/
│   ├── check-scramble.mjs # design-time check of the permutation rule (R8.11–8.16)
│   ├── make-demo-wav.mjs  # writes demo/ghost-tape-demo.wav (gitignored) to listen to
│   ├── measure.mjs        # npm run measure: single-pass success and symbol errors vs SNR, decoder speed
│   └── measure-passes.mjs # npm run measure:passes: R6.3/R6.4 success vs passes, writes docs/passes-results.*
├── docs/                  # measured results and charts for the write-up (committed)
├── demo/                  # generated audio, not committed
├── tests/
│   ├── unit/
│   ├── properties/        # fast-check property tests
│   └── support/           # shared test harness: runs.ts (seeded fast-check params), budget.ts (deep-suite audio cap), dsp.ts (FFT/Goertzel for measuring audio), profiles.ts (test-only 3-bit profile), arbitraries.ts (tape/ghost generators), tapes.ts (seeded tapes of an exact size), random.ts (seeded noise, re-exported from channel.ts), decode.ts (encode/decode/chunk helpers that count audio against the cap)
├── public/
├── KIRO_LOG.md            # running log of how Kiro was used (for the write-up)
├── LICENSE                # MIT
└── README.md
```

- Tests mirror source names: `src/modem/frame.ts` -> `tests/properties/frame.prop.test.ts`.
- New modem modules must be added to this tree.
