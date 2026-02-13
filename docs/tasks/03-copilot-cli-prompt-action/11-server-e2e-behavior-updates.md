# Task 11 — Server E2E Behavior Updates

> **Phase**: 4 (Tests)
> **Depends on**: Tasks 08–10
> **Blocks**: Task 13

---

## Objective

Update and add server e2e coverage to validate spec-03 behavior through public APIs and machine execution outcomes.

---

## Scope

- Update e2e suite under [server/src/**e2e**](../../../server/src/__e2e__).
- Add e2e cases for runtime-options requirement and copilot action transition routing.

---

## E2E Scenarios

1. Start-instance without runtime options returns 400.
2. Start-instance with runtime options launches successfully.
3. Definition with `copilot-cli-prompt` executes success branch with schema-valid result.
4. Chained action run forwards `conversationId` and resumes existing conversation on second state.
5. Invalid JSON result routes to `handleInvalidCopilotResult` after one repair attempt.
6. CLI exec failure routes to `handleCopilotExecError`.
7. Child-machine execution still captures transcript paths under child lineage folders.

---

## Notes

- Mock or fake CLI command output for deterministic CI behavior.
- Avoid dependence on live external model responses in automated tests.

---

## Behavior Spec Coverage

- [behaviors.md](../../feature-specs/behaviors.md) sections 3, 4.5, 16.7, 16.8 and copilot rollout items.

---

## Validation Checklist

- [ ] E2E scenarios execute deterministically.
- [ ] Runtime options and transition behavior are externally observable via API responses.
- [ ] Transcript lineage assertions are stable.
- [ ] Conversation resume behavior is externally observable (`conversationId` handoff between states).
