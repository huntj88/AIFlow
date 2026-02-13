# Task 05 — Global CLI Transcript Capture in `CliHelper`

> **Phase**: 2 (Runtime refactors)
> **Depends on**: Tasks 03–04
> **Blocks**: Tasks 07, 09–11

---

## Objective

Centralize transcript capture inside `ctx.cli.exec(...)` so every action benefits uniformly when runtime capture is enabled.

---

## Scope

- Update [server/src/machines/cli/CliHelper.ts](../../../server/src/machines/cli/CliHelper.ts).
- Update [server/src/machines/cli/index.ts](../../../server/src/machines/cli/index.ts) exports.
- Integrate with lineage resolver from Task 04.

---

## Capture Requirements

When `runtimeOptions.cliOutputCapture.enabled = true`, each CLI execution writes a `.txt` transcript containing:

- command + args
- cwd
- exit code
- stdout
- stderr
- duration

When disabled, no transcript file is written.

---

## Steps

1. Extend `CliHelper` construction options to include capture policy and transcript path resolver callback.
2. Add optional `captureLabel` input on `cli.exec(...)` for stable filenames (`main-prompt`, `result-json`, `repair-json`, `reset-conversation`, etc.).
3. After command completion, write transcript text file when capture is enabled.
4. Return capture metadata in exec result (`commandOutputFile` or `commandOutputFiles` record).
5. Preserve existing execution semantics (no Effect-channel failure, spawn behavior unchanged).
6. Add unit tests for capture enabled/disabled and metadata return.

---

## Behavior Spec Coverage

- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) “System-wide toggleable CLI output capture”.
- [behaviors.md](../../feature-specs/behaviors.md) section 16.7.

---

## Validation Checklist

- [ ] Capture logic exists only in `CliHelper`.
- [ ] Any action using `ctx.cli.exec(...)` can emit transcript files.
- [ ] Capture toggle controls file creation.
- [ ] Exec result includes transcript file reference metadata.
- [ ] Lineage path resolver is used for transcript target path.
