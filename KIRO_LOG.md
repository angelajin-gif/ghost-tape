# Kiro Log — Ghost Tape

A running record of how Kiro was used. One entry per notable moment; attach a screenshot when possible. This becomes the "How Kiro was used" write-up.

## Template
```
### YYYY-MM-DD — <short title>
Feature: spec | steering | hook | PBT | MCP | custom agent | Crew | power | CLI/Web
What I did:
What Kiro did:
What changed / what I learned:
Screenshot: docs/kiro/<file>.png
```

## Highlights to collect (checklist)
- [ ] Spec: how requirements → design → tasks shaped the protocol before any code
- [ ] Spec vs vibe: one moment where vibe coding went wrong and the spec fixed it
- [ ] Steering: a before/after where steering changed Kiro's output (e.g. mic constraints, pure modem library)
- [ ] Hooks: each hook, what it automates, one time it caught something
- [ ] PBT: a bug a property test found that unit tests missed (with the shrunk counterexample)
- [ ] MCP: any tool connected and what it unlocked
- [ ] Real-world measurement table (task 13)

## Entries

### 2026-11-10 — Requirements review before any code
Feature: spec
What I did: Asked Kiro to review the draft acoustic-modem spec critically and ask questions one at a time, with no code until I approved.
What Kiro did: Found 7 contradictions, 11 underspecified items and 5 scope risks in requirements.md; asked 16 questions; rewrote the requirements in testable EARS form.
What changed / what I learned: Several tapes kept by tapeId; fixed whole-stream byte scramble; 1-byte charset; in-band SNR with a 95% success definition; telephone band 300–3400 Hz; Robust cap 256 B; fewer manual trials; reverb kept as a target.
Screenshot: TODO

### 2026-11-10 — Steering rule: no heredocs in shell
Feature: steering
What I did: Asked Kiro to add a shell-usage rule to .kiro/steering/tech.md.
What Kiro did: Added "Never write or edit files with shell heredocs or long echo/cat commands" plus "keep shell commands short" under a new Shell usage section.
What changed / what I learned: Earlier this session a heredoc garbled a KIRO_LOG entry and a long python heredoc hung for 120 s while creating the hook.
Screenshot: TODO

### 2026-11-10 — Scramble-rule check finds a spec conflict
Feature: spec
What I did: Asked Kiro to rerun the scramble-rule check before regenerating the design.
What Kiro did: Wrote scripts/check-scramble.mjs and checked every payload length for both profiles (1,280 cases). R8.12 and R8.13 pass; R8.16 fails in 16 cases. Smallest: P = 202, L = 238, B = 1, a = 149, tenth 2 empty after the first 10% of symbols.
What changed / what I learned: Moving the trigger to 12/15/20% still fails. Choosing the nearest a that passes 8.13 and 8.16 ("Fix A") passes all cases. Recorded as open issue S1 in design.md (needs an R8.11 wording change).
Screenshot: TODO

### 2026-11-10 — design.md and tasks.md regenerated from approved requirements
Feature: spec
What I did: Asked Kiro to rebuild design.md and tasks.md to match the approved requirements.md.
What Kiro did: Rewrote design.md (open issues S1–S4, header/payload pipeline, decoder state machine, accumulator rules, event grammar, simulator constants, P1–P24) and tasks.md (tasks 0–21, task 0 resolves spec issues first). Added types.ts, decoder.ts and scripts/ to structure.md.
What changed / what I learned: The check also found a charset count mismatch (six marks listed, seven codes) and an R5.9/R11.10 tape-size conflict. Both are left for the developer to decide.
Screenshot: TODO

### 2026-11-10 — Steering rule extended to printf
Feature: steering
What I did: Asked Kiro to make sure tech.md has the shell-usage rule.
What Kiro did: Rule existed; added printf to the banned heredoc/echo/cat list. All files this session were written with file tools.
What changed / what I learned: none recorded.
Screenshot: TODO

### 2026-11-10 — Spec updated after the scramble-check finding
Feature: spec
What I did: Approved the design with four decisions: Kiro's scramble fix, en dash (–) at 0x86, the 560 B tape in the deep suite, and a ≈ 15,000 s deep-suite audio cap.
What Kiro did: Reworded R8.11 (nearest a to 0.618·L that also passes 8.13 and 8.16); updated glossary, R5.7, R5.9, R5.10, R6.3, R6.4, R11.10; added R11.13 (cap) and R11.14 (FFT reverb). Replanned the deep suite at ≈ 13,300 s.
What changed / what I learned: The scramble check (16 failing lengths, smallest P = 202) turned a formula into a search rule. Claims are now stated as n/n with 95% lower bounds (Standard pooled 60 trials → 95%, one cell of 10 → 74%), not "95% per condition".
Screenshot: TODO

### 2026-11-10 - Task 0: Lock in the approved permutation rule (design S1)
Feature: spec
What I did: Completed task 0 of the acoustic-modem spec.
What Kiro did: what was built = scripts/check-scramble.mjs (default mode = approved R8.11 rule, exits 1 on failure; `old` mode keeps the pre-review rule).
What changed / what I learned: tests covering it = none found under tests/; no property IDs named in the task. Script output: a valid a exists for all 1,280 cases; 8.12, 8.13, 8.16 failures 0. a changed for P = 202, 220, 231, 232, 237, 238, 268, 281, 282, 305 (Standard; the first 6 also Robust); max |a/L − 0.618| = 0.0147. Notable problem = none recorded.
Screenshot: TODO

### 2026-11-10 - Task 1: Project scaffold
Feature: spec
What I did: Completed task 1 of the acoustic-modem spec.
What Kiro did: what was built = package.json, tsconfig.json, tsconfig.modem.json (ES2022 lib only, no DOM/Node types), vite/vitest/vitest.deep configs, index.html, src/main.ts, src/modem/types.ts, src/modem/index.ts, tests/support/{runs,budget,budgetSetup}.ts, README.md.
What changed / what I learned: tests covering it = tests/unit/node-only.test.ts, tests/unit/budget.test.ts; no property IDs named in the task. Notable problem = the user npm cache had root-owned files; installed with a temporary cache in /tmp instead of changing ownership.
Screenshot: TODO

### 2026-11-10 - Task 2: Bits and Gray code (`bits.ts`)
Feature: spec
What I did: Completed task 2 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/bits.ts (bytes↔bits↔symbols for 1–8 bits/symbol, Gray encode/decode, tone↔value maps).
What changed / what I learned: tests covering it = tests/properties/bits.prop.test.ts, tests/unit/bits.test.ts; properties P1, P2. Notable problem = none recorded.
Screenshot: TODO

### 2026-11-10 - Task 3: CRC-32 (`crc32.ts`)
Feature: spec
What I did: Completed task 3 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/crc32.ts (table CRC-32 IEEE 802.3, appendCrc32 / stripCrc32 big-endian trailer).
What changed / what I learned: tests covering it = tests/properties/crc32.prop.test.ts; property P3 (known answer 0xCBF43926, single-bit flips, cross-check against Node zlib.crc32). Notable problem = none recorded.
Screenshot: TODO

### 2026-11-10 - Task 4: Reed–Solomon over GF(2⁸) (`reedSolomon.ts`)
Feature: spec
What I did: Completed task 4 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/reedSolomon.ts (hand-written; GF(256) 0x11D, systematic encode, syndromes, Berlekamp–Massey, Chien search, Forney, final syndrome check).
What changed / what I learned: tests covering it = tests/properties/reedSolomon.prop.test.ts; properties P4, P5 plus QR-code known answer. Notable problem = design P5 says "returns the original or a failure", which no bounded-distance decoder can guarantee beyond capacity; the test checks the provable version (failure, or a genuine codeword within 16 bytes of the input) and leaves wrong-payload rejection to CRC/P18.
Screenshot: TODO

### 2026-11-10 - Task 5: Pad, interleave and permute (`interleave.ts`)
Feature: spec
What I did: Completed task 5 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/interleave.ts (geometry, padAndSplit/joinAndTrim, interleave/deinterleave, permute/unpermute, chooseMultiplier with the approved R8.11 search).
What changed / what I learned: tests covering it = tests/properties/interleave.prop.test.ts; properties P6, P7, P8, P9 (P7–P9 exhaustive over all 1,280 lengths). Mutation check: with the 8.16 check removed from chooseMultiplier, P9 failed at standard P=202 a=149 "tenth 2 empty", the same counterexample as the scramble check. Notable problem = none recorded.
Screenshot: TODO

### 2026-11-10 - Task 6: Tape format (`tape.ts`)
Feature: spec
What I did: Completed task 6 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/tape.ts (charset with en dash at 0x86, field validation with named reasons, dates, cap check, serialize, strict deserialize).
What changed / what I learned: tests covering it = tests/properties/tape.prop.test.ts, tests/unit/tape.test.ts; properties P10, P11 (date validity checked against a JS Date oracle; random and one-byte-mutated inputs only decode when canonical). Notable problem = one hand-written unit-test byte vector had an extra byte; the code was right and the vector was fixed. No property test failed.
Screenshot: TODO

### 2026-11-10 - Task 7: Profiles and frame (`profiles.ts`, `frame.ts`)
Feature: spec
What I did: Completed task 7 of the acoustic-modem spec.
What Kiro did: what was built = src/modem/profiles.ts (Robust/Standard as data, table validation), src/modem/frame.ts (header build/parse, payload symbol pipeline with pilots, frame timeline, sample-exact start times).
What changed / what I learned: tests covering it = tests/unit/profiles.test.ts, tests/properties/frame.prop.test.ts, tests/support/profiles.ts (made-up 3-bit profile); property P12. Notable problem = the task 1 purity scan flagged the word "window" inside an error-message string in profiles.ts; the scan now ignores string text (and still flags `window` inside `${}`, checked with a temporary probe file).
Screenshot: TODO
