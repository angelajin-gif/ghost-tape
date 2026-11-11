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
│   │   ├── sync.ts        # preamble detection, fine timing
│   │   ├── decoder.ts     # streaming state machine: createDecoder, decodeFile
│   │   ├── channel.ts     # test-only channel simulator
│   │   └── index.ts       # encodePayload / createDecoder / decodeFile
│   ├── audio/             # mic capture, playback, worklets, WAV I/O (wav.ts is pure)
│   └── ui/                # recorder, receiver, manifestation animation; dev.ts harness
├── scripts/
│   └── check-scramble.mjs # design-time check of the permutation rule (R8.11–8.16)
├── tests/
│   ├── unit/
│   ├── properties/        # fast-check property tests
│   └── support/           # shared test harness (budget.ts: deep-suite audio cap)
├── public/
├── KIRO_LOG.md            # running log of how Kiro was used (for the write-up)
├── LICENSE                # MIT
└── README.md
```

- Tests mirror source names: `src/modem/frame.ts` -> `tests/properties/frame.prop.test.ts`.
- New modem modules must be added to this tree.
