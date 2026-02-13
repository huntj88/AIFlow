# Copilot CLI Prompt Action — Implementation Plan Overview

> **Feature spec**: [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md)
> **Behavior spec**: [behaviors.md](../../feature-specs/behaviors.md)
> **Guardrail**: Platform refactors (Tasks 01–09) must land before feature tasks (Tasks 10–20).

---

## Summary

This plan delivers the `copilot-cli-prompt` rollout as a hard-cut migration:

1. Break start-instance contract to require `runtimeOptions` (no compatibility mode).
2. Refactor runner + `CliHelper` for system-wide, toggleable transcript capture with lineage paths.
3. Implement `copilot-cli-prompt` + `handle-copilot-exec-error` with strict JSON recovery, reset behavior, and structured output shaping.
4. Ship full verification (unit/integration/e2e/client) and required developer curl workflow tooling.

---

## Phase Summary

| Phase | Tasks | Description                                                                   |
| ----- | ----- | ----------------------------------------------------------------------------- |
| 1     | 01–04 | Platform contract cutover (`runtimeOptions`, schema/API, runner pass-through) |
| 2     | 05–09 | Capture infrastructure + lineage + client/test harness cutover                |
| 3     | 10–15 | Copilot action implementation and registry wiring                             |
| 4     | 16–20 | Verification, e2e workflows, developer script, rollout gates                  |

## Simplified execution slices (draft)

To reduce handoff overhead, implement as larger slices while preserving the same task IDs and acceptance criteria:

1. **Slice A — Runtime hard-cut platform contract**
   - Bundle Tasks **01–04** as one PR train.
   - Outcome: `runtimeOptions` required end-to-end (types, schema, API validation, runner context pass-through).

2. **Slice B — CLI capture foundation**
   - Bundle Tasks **05–07** as one PR train.
   - Outcome: lineage-aware transcript capture centralized in `CliHelper` with capture metadata + blocker tests.

3. **Slice C — Entry-point call-site cutovers**
   - Bundle Tasks **08–09**.
   - Outcome: client and test harness fully on required `runtimeOptions` contract.

4. **Slice D — Copilot action vertical path**
   - Bundle Tasks **10–15**.
   - Outcome: one end-to-end action implementation path (prelude/resume, exec, JSON recovery, normalization, registry wiring).

5. **Slice E — Verification + tooling**
   - Bundle Tasks **16–20**.
   - Outcome: coverage gates, e2e confirmation, and required `scripts/dev/` curl workflow.

### Simplification guardrails

- Do not alter rollout decisions or behavior-spec expectations.
- Keep `ctx.cli.exec(...)` as the only capture boundary (no action-level capture forks).
- Prefer one result-processing pipeline in `copilot-cli-prompt` (parse/repair/validate/normalize/shape), even if internally split into small functions.
- Preserve strict sequencing guardrail: complete platform dependencies before feature behavior rollout.

---

## Dependency Graph (Acyclic)

```
01 Runtime Policy Types
  └──→ 02 Runtime Policy Schema Cutover
        └──→ 03 Start-Instance API Runtime Validation
              ├──→ 04 Runner Runtime Policy Pass-Through
              │      └──→ 05 CLI Transcript Lineage Resolver
              │             └──→ 06 CLI Helper Global Capture
              │                    └──→ 07 Platform Capture Tests
              └──→ 08 Client RuntimeOptions Cutover
                     └──→ 09 Test Harness RuntimeOptions Cutover

07 ──→ 10 Directory Guidance Prompt Utility
10 ──→ 11 Copilot Action Contract Schemas
11 ──→ 12 Copilot CLI Execution Flow
12 ──→ 13 JSON Recovery + Conversation Reset
13 ──→ 14 Result Normalization + Transition Shaping
14 ──→ 15 Action Registry + Error Action Wiring

15 ──→ 16 Server Unit/Integration Copilot Tests
16 + 09 ──→ 17 Server E2E Copilot Workflow
17 + 08 ──→ 18 Client Flow & E2E Updates
15 + 09 ──→ 19 Developer Curl Workflow Script
17 + 18 + 19 ──→ 20 Quality Gates & Rollout
```

No task points back to an upstream dependency, so the graph has no circular edges.

---

## Feature Spec Traceability

| Feature spec area                                                           | Implementing tasks |
| --------------------------------------------------------------------------- | ------------------ |
| Rollout decisions 1/4 (hard cutover + immediate client update)              | 02, 03, 08, 09     |
| Rollout decision 2 (runner pass-through; no persistence on instance)        | 04, 16             |
| Rollout decision 3 (rich CLI capture metadata)                              | 06, 07, 14         |
| Rollout decision 5 (`artifactDirs` are base dirs, runtime appends lineage)  | 02, 03, 05, 12     |
| Rollout decision 6 (`maxFormatRetries = 2`)                                 | 13, 17             |
| Rollout decision 7 (schema-valid `status:error` still goes to successState) | 14, 16, 17         |
| Rollout decision 8 (helper-derived transcript labels)                       | 06, 07             |
| Rollout decision 9 (reset failure -> `execErrorState`)                      | 13, 17             |
| Rollout decision 10 (`filePaths` warn + pass-through)                       | 14, 17             |
| Required system refactors section                                           | 01–07              |
| Action input/CLI execution/prelude contracts                                | 10–12              |
| JSON recovery + required result schema                                      | 11, 13             |
| Transition behavior and output shape                                        | 14, 16, 17         |
| Developer curl workflow script requirement                                  | 19                 |

---

## Behavior Spec Traceability

| Behavior section                                            | Implementing tasks |
| ----------------------------------------------------------- | ------------------ |
| §3 Action Registry (copilot actions discoverable)           | 15, 17             |
| §4.1 Start & Complete (runtimeOptions on start payload)     | 02, 03, 08, 09, 17 |
| §4.5 Runtime CLI Options Validation                         | 02, 03, 09, 17     |
| §16.7 Global Transcript Capture (runtime toggle)            | 06, 07, 17         |
| §16.8 Transcript Lineage Paths                              | 05, 06, 07, 17     |
| §21.9 Copilot CLI Prompt Action Workflow                    | 10–18              |
| §21.10 Developer Curl Workflow Script                       | 19                 |
| §22.1 API Error Responses (missing runtimeOptions branches) | 03, 09, 17         |
| §22.7 `copilot-cli-prompt` Edge Cases                       | 11, 13, 14, 17     |

---

## Notes

- Tasks 01–09 are platform dependencies and must be completed before introducing `copilot-cli-prompt` behavior.
- This plan intentionally omits compatibility shims for legacy start payloads.
- Tests for transcript capture and lineage are treated as rollout blockers, not follow-up cleanup.
