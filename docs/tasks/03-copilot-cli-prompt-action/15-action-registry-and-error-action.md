# Task 15 — Action Registry & Error Action Wiring

> **Phase**: 3 (Copilot action implementation)
> **Depends on**: Task 14
> **Blocks**: Tasks 16, 17, 19

---

## Objective

Register rollout actions as discoverable built-ins and provide the `handle-copilot-exec-error` action path used by machine definitions.

---

## Scope

- Add `copilot-cli-prompt` and `handle-copilot-exec-error` action modules.
- Register both actions in `server/src/machines/actions/index.ts`.
- Update action metadata tests (`ActionRegistry.test.ts`, `routes/machines/actions.test.ts`).
- Update server e2e action-registry suite to assert new IDs are exposed.

---

## Acceptance Checklist

- [ ] Both rollout actions are registered on startup.
- [ ] Action list/get APIs return metadata for both actions.
- [ ] Non-existent action behavior remains unchanged.
- [ ] Canonical AI prompt-action path is `copilot-cli-prompt`.

---

## Spec Coverage

- Feature spec: migration item 5 and full setup registry example.
- Behavior spec: §3 and §21.9 action discoverability requirements.
