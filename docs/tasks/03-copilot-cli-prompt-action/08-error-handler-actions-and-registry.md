# Task 08 — Error-Handler Actions and Registry Wiring

> **Phase**: 3 (Copilot action stack)
> **Depends on**: Task 07
> **Blocks**: Tasks 10–11, 13

---

## Objective

Add and register companion actions for copilot result/exec failures, then wire all new actions into the action registry and actions API surface.

---

## Scope

- Update [server/src/machines/actions](../../../server/src/machines/actions) implementations.
- Update [server/src/machines/actions/index.ts](../../../server/src/machines/actions/index.ts).
- Ensure discoverability via actions routes:
  - [server/src/routes/machines/actions.ts](../../../server/src/routes/machines/actions.ts)

---

## Steps

1. Implement `handle-invalid-copilot-result` action.
2. Implement `handle-copilot-exec-error` action.
3. Keep handlers simple and deterministic:
   - log structured diagnostics

- return machine-safe continuation payloads
- preserve/pass-through `conversationId` when present so downstream states may resume

4. Register new actions in startup registry wiring.
5. Verify `GET /api/machines/actions` includes all three new IDs.
6. Add route-level tests for action discoverability.

---

## Behavior Spec Coverage

- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) action registry example and error branches.
- [behaviors.md](../../feature-specs/behaviors.md) section 3 (Action Registry).

---

## Validation Checklist

- [ ] `copilot-cli-prompt` registered.
- [ ] `handle-invalid-copilot-result` registered.
- [ ] `handle-copilot-exec-error` registered.
- [ ] Actions endpoints return new metadata.
- [ ] Error handler payload contracts preserve `conversationId` when available.
