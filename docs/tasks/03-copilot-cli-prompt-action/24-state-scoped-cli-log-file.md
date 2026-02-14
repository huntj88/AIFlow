# Task 24 — State-Scoped CLI Log File Consolidation

> **Phase**: 6 (Post-rollout follow-up)
> **Depends on**: Task 23
> **Blocks**: nothing (follow-up task)

---

## Objective

Improve transcript readability by writing all `ctx.cli.exec(...)` activity for a single state visit into one shared log file, using clear per-invocation delimiters, and adopting `-log` filename suffix conventions.

---

## Scope

- Change transcript filename convention to include `-log` suffix (for example `001-log.txt` or equivalent finalized format).
- Stop creating separate transcript files per CLI invocation inside the same state visit.
- Keep one state-scoped log file open/appending for the current state visit; start a new file only after transition to a different state visit.
- Write a clear delimiter block between CLI invocations in the shared state log, including:
  - invocation index within the state visit,
  - command/args/cwd,
  - start timestamp.
- Keep streamed stdout/stderr behavior as-is (append while command runs, in arrival order with stream markers).
- Keep warning behavior unchanged: stream-write failures surface diagnostics and do not independently force `execErrorState`.
- Update unit/integration/e2e coverage and docs to lock behavior.

---

## Acceptance Checklist

- [ ] Transcript filename convention includes `-log` suffix.
- [ ] Repeated `ctx.cli.exec(...)` calls in one state visit append to the same transcript file.
- [ ] Transcript output includes clear delimiter messages between distinct CLI invocations.
- [ ] New transcript file begins when execution moves to a different state visit.
- [ ] Streamed append behavior is preserved (no end-of-command/end-of-action-only flush behavior).
- [ ] Stream-write failures remain non-fatal and are surfaced as warnings.
- [ ] Spec + behavior docs and tests are updated for the consolidated log-file policy.

---

## Spec Coverage

- Feature spec: system-wide streamed CLI transcript behavior and artifact path convention updates.
- Behavior spec: §16.7/§16.8 CLI capture expectations and Copilot workflow capture references.
