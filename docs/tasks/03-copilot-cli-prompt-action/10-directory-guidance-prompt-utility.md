# Task 10 — Directory Guidance Prompt Utility

> **Phase**: 3 (Copilot action implementation)
> **Depends on**: Task 07
> **Blocks**: Tasks 11, 12

---

## Objective

Add shared prompt-template utilities for directory guidance and result-capture system prompts used by `copilot-cli-prompt`.

---

## Scope

- Create prompt utility module under `server/src/machines/actions/` (or subfolder) that builds:
  - first-turn directory guidance prelude
  - strict JSON result prompt
  - JSON repair prompt
- Inject runtime values into prelude (`ctx.workspace.root`, `ctx.artifactsWorkspace.root`, lineage placement hints).
- Ensure prelude is omitted when `conversationId` is provided.

---

## Acceptance Checklist

- [ ] Utility emits first-turn prompt with both workspace descriptions.
- [ ] Utility emits strict JSON-only result and repair prompts.
- [ ] Conversation-resume path suppresses prelude.
- [ ] Prompt text aligns with artifacts placement recommendation rules.

---

## Spec Coverage

- Feature spec: system directory-guidance prompt section, required refactor #6.
- Behavior spec: §21.9 prelude/resume behavior.
