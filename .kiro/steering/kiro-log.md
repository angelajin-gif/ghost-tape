---
inclusion: always
---

# Keep KIRO_LOG.md up to date

After you finish any of the following, append an entry to `KIRO_LOG.md` under `## Entries`, using the template in that file:

- completing a task from `tasks.md`
- changing `requirements.md`, `design.md` or `tasks.md` after a discussion with the developer
- a property-based test finding a bug (include the shrunk counterexample)
- a hook catching a problem
- a steering rule visibly changing what you produced

Rules for entries:
- Keep each entry under 8 lines.
- Write facts only: what happened, which Kiro feature was involved, what changed.
- Never invent results. If something was not run or measured, do not report it.
- Leave the Screenshot line as `Screenshot: TODO` for the developer to fill in.
