# Task 03 — Runner Runtime Policy Context Wiring

> **Phase**: 2 (Runtime refactors)
> **Depends on**: Task 02
> **Blocks**: Tasks 04–05, 07, 09–11

---

## Objective

Make runtime CLI policy and capture policy first-class, required runner context for **every state action execution**. Remove fallback/default branches that assume policy may be absent.

---

## Scope

- Update [server/src/machines/StateMachineRunner.ts](../../../server/src/machines/StateMachineRunner.ts).
- Update relevant runtime types in [server/src/machines/types.ts](../../../server/src/machines/types.ts).

---

## Steps

1. Extend runner `RunOptions` with required `runtimeOptions`.
2. Persist runtime options on `MachineInstance` (if needed by resume) or make them retrievable from run context persisted state.
3. Ensure resumed executions load required runtime policy deterministically.
4. When building `ActionContext`, inject resolved directory policy and capture toggle into `ctx.cli` construction path.
5. Remove any `if (!runtimeOptions) { use defaults }` logic.
6. Keep `workspace` and `artifactsWorkspace` behavior unchanged except policy availability.

---

## Design Notes

- Directory-policy values are execution config for `copilot` CLI invocation; they are not filesystem sandbox enforcement.
- Runtime policy must be available to all actions using `ctx.cli.exec(...)`, not only `copilot-cli-prompt`.

---

## Behavior Spec Coverage

- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) migration steps 2–3.
- [behaviors.md](../../feature-specs/behaviors.md) section 16.7 (global capture behavior on all CLI usage).

---

## Validation Checklist

- [ ] Runner requires runtime policy for run/resume execution.
- [ ] Action execution path has deterministic runtime policy access.
- [ ] No fallback/default runtime-policy code remains.
- [ ] Existing non-copilot actions using `ctx.cli.exec` still function.
