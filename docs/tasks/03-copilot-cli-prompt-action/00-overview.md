# Copilot CLI Prompt Action — Implementation Plan Overview

> **Feature specs**:
>
> - [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md)
> - [02-state-machine-source-of-truth.md](../../feature-specs/02-state-machine-source-of-truth.md)
> - [behaviors.md](../../feature-specs/behaviors.md)
>   **Prerequisite**: Tasks under [01-state-machine-working-dir](../01-state-machine-working-dir/) are complete.

---

## Summary

This plan delivers spec 03 as a **breaking migration** with strict runtime CLI policy, centralized transcript capture, lineage-scoped artifact paths, and a new reusable action (`copilot-cli-prompt`) that returns schema-validated JSON for downstream chaining.

It also adopts conversation-aware behavior: directory-guidance prelude only on first conversation turn, then resume via `conversationId` with `conversationId` forwarded to downstream states.

The work is intentionally sequenced to land platform refactors first, then the action and developer tooling on top.

---

## Phase Summary

| Phase | Tasks | Description                                                                   |
| ----- | ----- | ----------------------------------------------------------------------------- |
| 1     | 01–02 | Contract changes: runtime options + API/schema validation                     |
| 2     | 03–05 | Runtime refactors: runner context, lineage resolver, global CLI capture       |
| 3     | 06–08 | Copilot action stack: prompt utilities, main action, error handlers, registry |
| 4     | 09–11 | Tests: unit/integration/e2e for capture + action behavior                     |
| 5     | 12–13 | Client + developer workflow tooling and cutover docs                          |

---

## Task Index

1. [01-runtime-options-types-and-schemas.md](01-runtime-options-types-and-schemas.md)
2. [02-start-instance-api-runtime-options.md](02-start-instance-api-runtime-options.md)
3. [03-runner-runtime-policy-context.md](03-runner-runtime-policy-context.md)
4. [04-instance-lineage-path-resolver.md](04-instance-lineage-path-resolver.md)
5. [05-cli-helper-global-transcript-capture.md](05-cli-helper-global-transcript-capture.md)
6. [06-copilot-prompt-and-json-utilities.md](06-copilot-prompt-and-json-utilities.md)
7. [07-copilot-cli-prompt-action.md](07-copilot-cli-prompt-action.md)
8. [08-error-handler-actions-and-registry.md](08-error-handler-actions-and-registry.md)
9. [09-server-tests-runtime-capture.md](09-server-tests-runtime-capture.md)
10. [10-server-tests-copilot-action-flow.md](10-server-tests-copilot-action-flow.md)
11. [11-server-e2e-behavior-updates.md](11-server-e2e-behavior-updates.md)
12. [12-client-runtime-options-and-launch.md](12-client-runtime-options-and-launch.md)
13. [13-developer-curl-workflow-script.md](13-developer-curl-workflow-script.md)

---

## Dependency Graph

```text
01 Runtime options types/schemas
 └──→ 02 Start-instance API validation
      └──→ 03 Runner runtime context wiring
           ├──→ 04 Lineage path resolver
           │    └──→ 05 CLI helper global capture
           │         ├──→ 07 Copilot CLI prompt action
           │         └──→ 09 Runtime capture tests
           └──→ 12 Client launch contract updates

06 Prompt + JSON utilities
 └──→ 07 Copilot CLI prompt action
      └──→ 08 Error handlers + registry wiring
           ├──→ 10 Copilot action tests
           └──→ 11 Server e2e behavior updates

07 + 08 + 12
 └──→ 13 Developer curl workflow script
```

---

## Cutover Strategy (from spec 03)

1. Land API/schema breaking changes first.
2. Land runner + `CliHelper` runtime refactor second.
3. Land `copilot-cli-prompt` action and registry wiring third.
4. Land developer curl workflow script last.

No legacy compatibility path is preserved in this plan.

---

## Validation Gates

- Server build/lint/tests green after each phase.
- Runtime options required on instance start.
- CLI capture toggle verified globally for all `ctx.cli.exec(...)` calls.
- Transcript path lineage verified across root/child/nested-child runs.
- `copilot-cli-prompt` validates strict JSON with one repair reprompt and routes as specified.
- System prelude is sent only when starting a new conversation (not on resume).
- `conversationId` is returned and passed forward for chained states.
- Developer curl workflow can create/update a definition, start a run, poll status, and print progress until terminal completion.
