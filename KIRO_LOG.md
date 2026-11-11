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
