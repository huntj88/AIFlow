# Task 22 — Remove `artifactDirs` from Runtime Policy

> **Phase**: 5 (Post-rollout follow-up)
> **Depends on**: Task 21
> **Blocks**: nothing (follow-up task)

---

## Objective

Simplify runtime CLI directory policy by removing `runtimeOptions.cliDirectoryPolicy.artifactDirs` and always deriving the artifacts allow-dir from `ctx.artifactsWorkspace.root`.

---

## Scope

- Remove `artifactDirs` from runtime policy request/type/schema validation.
- Keep `runtimeOptions.cliDirectoryPolicy.workspaceDirs` required.
- Ensure Copilot CLI argument construction always includes `ctx.artifactsWorkspace.root` in `--add-dir`.
- Update server/client/test-harness fixtures and developer workflow script to the simplified contract.
- Update feature spec + behavior spec + overview traceability to reflect the new contract.

---

## Acceptance Checklist

- [x] `POST /api/machines/instances` no longer requires `runtimeOptions.cliDirectoryPolicy.artifactDirs`.
- [x] `runtimeOptions.cliDirectoryPolicy.workspaceDirs` remains required and absolute.
- [x] `copilot-cli-prompt` always includes artifacts allow-dir from `ctx.artifactsWorkspace.root`.
- [x] Unit/integration/e2e tests pass with the updated runtime policy shape.
- [x] Developer curl workflow script works without sending `artifactDirs`.
- [x] Spec/behavior/task overview docs are internally consistent with this cutover.

---

## Spec Coverage

- Feature spec: rollout decision 5 and migration/start-instance contract examples.
- Behavior spec: §4.5 runtime CLI options validation and §21.9 Copilot CLI prompt workflow.
