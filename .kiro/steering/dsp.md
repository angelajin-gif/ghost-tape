---
inclusion: fileMatch
fileMatchPattern: "src/modem/**"
---

# Signal-processing guidance for the modem

Read `.kiro/specs/acoustic-modem/design.md` for the authoritative protocol. These are the habits to follow while implementing it.

- **Explain the math in comments.** The author is learning DSP; every non-obvious formula gets a one-line plain-English explanation.
- **Tone detection uses Goertzel**, not a full FFT, because we only care about a fixed, small set of frequencies.
- **Skip the start of each symbol window** (the guard portion defined in the design) before measuring energy. Room echo from the previous symbol lingers there.
- **Continuous-phase tone generation.** Carry the oscillator phase across symbol boundaries so there are no clicks; clicks spread energy into neighbouring tones.
- **Gray code** maps bits to tone indices so that confusing two adjacent tones flips only one bit.
- **Normalize, don't trust gain.** Received amplitude is arbitrary. Decisions compare tone energies against each other, never against an absolute threshold, except for preamble detection which uses peak-to-median ratio.
- **Prefer clarity over micro-optimization** until a profiler says otherwise. Real-time budget: decoding must keep up with live audio on a mid-range phone.
- **When debugging, render a spectrogram.** Add a dev-only utility that turns samples into a spectrogram PNG/canvas; most modem bugs are obvious there.
