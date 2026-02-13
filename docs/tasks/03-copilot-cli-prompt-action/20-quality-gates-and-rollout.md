# Task 20 — Quality Gates & Rollout Verification

> **Phase**: 4 (Verification & tooling)
> **Depends on**: Tasks 17, 18, 19
> **Blocks**: nothing (final task)

---

## Objective

Run final quality gates and verify the rollout satisfies platform-first sequencing and behavior/spec traceability.

---

## Scope

- Run and record validation commands:
  - server typecheck/tests/e2e
  - client typecheck/tests/e2e
- Verify action registry exposure and start-instance hard cutover behavior in a final smoke pass.
- Verify task dependency DAG remains acyclic and platform tasks completed before feature tasks.
- Capture any follow-up risks as explicit post-rollout backlog items (not silent gaps).

---

## Acceptance Checklist

- [ ] All relevant validation commands pass.
- [ ] Copilot workflow works for create, retry, failure, and conversation chaining branches.
- [ ] Runtime contract hard cutover verified (no compatibility behavior).
- [ ] Final implementation is traceable to all required feature + behavior sections in this plan.

---

## Spec Coverage

- Feature spec: rollout sequencing and implementation notes.
- Behavior spec: cross-section verification across §3, §4.5, §16.7–16.8, §21.9–21.10, §22.1, §22.7.
