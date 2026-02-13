# Task 12 — Copilot CLI Execution Flow

> **Phase**: 3 (Copilot action implementation)
> **Depends on**: Task 11
> **Blocks**: Task 13

---

## Objective

Implement command orchestration for `copilot-cli-prompt` (new conversation + resume flow) using runtime policy directory inputs and optional context paths.

---

## Scope

- Add `copilot-cli-prompt` action module under `server/src/machines/actions/`.
- Build command execution flow:
  - `copilot chat --yolo`
  - `--allow-dir` from runtime policy (resolved)
  - optional `--context` from `contextFilePaths`
  - `--conversation-id` when provided
  - prompt composition using utility from Task 10
- Resolve context paths against `workspace`/`artifactsWorkspace` resolvers.

---

## Acceptance Checklist

- [ ] New conversation path includes directory prelude and user prompt.
- [ ] Resume path includes conversation ID and omits prelude.
- [ ] Context file paths are transformed into CLI context args.
- [ ] Runtime policy directories are passed through as allow-dir args.

---

## Spec Coverage

- Feature spec: CLI execution contract, action input notes, rollout decision 5.
- Behavior spec: §21.9 command-shape and context forwarding behaviors.
