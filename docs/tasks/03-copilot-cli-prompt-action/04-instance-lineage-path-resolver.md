# Task 04 — Instance Lineage Transcript Path Resolver

> **Phase**: 2 (Runtime refactors)
> **Depends on**: Task 03
> **Blocks**: Tasks 05, 07, 09–11

---

## Objective

Implement one shared resolver for lineage-aware transcript paths so root, child, and nested-child commands are written under consistent artifacts locations.

---

## Scope

- Add helper module under [server/src/machines/workspace](../../../server/src/machines/workspace) (or dedicated runtime utils folder).
- Integrate with runner/CLI helper path generation call sites.

---

## Required Path Rules

- Root instance: `<stateName>/<visitIndex>-<label>.txt`
- Child instance: `children/<childInstanceId>/<stateName>/<visitIndex>-<label>.txt`
- Nested children: continue `children/<instanceId>/...` nesting per lineage.
- `visitIndex` is 1-based and zero-padded (e.g., `001`).

---

## Steps

1. Add lineage input model (`instanceId`, `parentInstanceId` chain, `stateName`, `visitIndex`, `label`).
2. Implement deterministic relative path builder.
3. Add helper to return normalized file reference payload:
   - `workspace: 'artifacts'`
   - `path`
   - `resolvedPath`
4. Replace ad hoc path builders with this resolver.
5. Add unit tests for root/child/deep-child and repeated state visits.

---

## Behavior Spec Coverage

- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) “Artifact path convention” and migration step 4.
- [behaviors.md](../../feature-specs/behaviors.md) section 16.8.

---

## Validation Checklist

- [ ] Single resolver used by transcript-writing flow.
- [ ] Root/child/nested paths match spec convention.
- [ ] `visitIndex` padding and increment behavior covered by tests.
- [ ] Returned artifact references are chaining-safe.
