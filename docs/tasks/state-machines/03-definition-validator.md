# Task 03 — Definition Validation Engine

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 01 (types), Task 02 (schemas)
> **Blocks**: Task 09 (runner core), Task 18 (API definitions)

---

## Objective

Implement all 14 definition validation rules from the feature spec §1 "Definition Validation". The validator runs at two points: **save time** (POST/PUT via API) and **run time** (before the runner executes a definition). It collects **all** violations (not just the first) and returns them in a `DefinitionError` with `details[]`.

**New server dependency**: `ajv` (for JSON Schema structural validation in Rules 13).

---

## Steps

### 1. Install `ajv`

```bash
cd server && pnpm add ajv
```

### 2. Create `server/src/machines/DefinitionValidator.ts`

Implement a `validateDefinition` function:

```typescript
type ValidationMode = 'save' | 'runtime';

const validateDefinition = (
  def: StateMachineDefinition,
  mode: ValidationMode,
  actionRegistry?: ActionRegistry, // Only needed for mode === 'runtime' (Rule 8)
): Effect.Effect<void, DefinitionError>
```

#### Rule Implementations

| Rule | Description                                                                          | Implementation                                                              |
| ---- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1    | `initialState` must reference existing state key                                     | Check `def.states[def.initialState]` exists                                 |
| 2    | Required terminal states (`completed`, `cancelled`, `error`) with `type: 'terminal'` | Check all three keys exist and have correct type                            |
| 3    | No transitions from terminal states                                                  | Filter `transitions` where `from` is a terminal state                       |
| 4    | All `from`/`to` in transitions reference existing states                             | Check each against `states` keys                                            |
| 5    | Every non-terminal state has ≥1 outgoing transition                                  | Build outgoing map, check non-terminal states                               |
| 6    | No orphan non-terminal states (reachable from `initialState`)                        | BFS/DFS from `initialState` via transitions; terminal states exempt         |
| 7    | `StateDefinition.name` matches its key                                               | Check `states[key].name === key` for all entries                            |
| 8    | `action` states have valid `actionId`                                                | At save: advisory warning. At runtime: check `actionRegistry.get(actionId)` |
| 9    | `child_machine` states require `actionId`, `childMachineDefId`, `childInputMapping`  | Check all three fields present                                              |
| 10   | `parallel_children` states require `actionId` and non-empty `children[]`             | Check both fields                                                           |
| 11   | `terminal` states must NOT have `actionId`, `childMachineDefId`, or `children`       | Check absence                                                               |
| 12   | No cycles in `childMachineDefId` / `children[].machineDefId` references              | Build reference graph, detect cycles (DFS with visited set)                 |
| 13   | `inputSchema`, `outputSchema`, all `dataSchema` are valid JSON Schema                | `ajv.validateSchema()` for each                                             |
| 14   | Unique `key` values in `parallel_children` state's `children[]`                      | Check for duplicates per state                                              |

### 3. Collect all violations

The validator should NOT short-circuit on the first error. Instead, run all applicable rules and collect violations into an array:

```typescript
interface ValidationViolation {
  rule: number;
  message: string;
  context?: string; // e.g., state name, transition
}
```

If violations are non-empty, return `DefinitionError({ message: 'Definition validation failed', details: violations.map(v => v.message) })`.

### 4. Handle Rule 8 mode distinction

- At save time (`mode: 'save'`): Rule 8 produces a **warning** (logged but not a rejection)
- At run time (`mode: 'runtime'`): Rule 8 produces an **error** (rejection)

### 5. Handle Rule 12 — Cycle Detection

For save-time validation, cycle detection requires resolving `childMachineDefId` and `children[].machineDefId` references. Accept an optional `resolveDefinition` callback or the store:

```typescript
// Cycle detection needs to load referenced definitions
type DefinitionResolver = (id: string) => Effect.Effect<StateMachineDefinition, NotFoundError>;
```

Build a directed graph of definition → child definition references and use DFS to detect cycles.

### 6. Unit tests — `server/src/machines/DefinitionValidator.test.ts`

Test each of the 14 rules individually:

- Valid definition passes
- Rule 1: `initialState` references non-existent state → error
- Rule 2: Missing `completed` terminal → error; missing `error` terminal → error; terminal with wrong type → error
- Rule 3: Transition from terminal state → error
- Rule 4: Transition referencing non-existent state → error
- Rule 5: Non-terminal state with zero outgoing transitions → error
- Rule 6: Orphan non-terminal state → error; orphan terminal state → OK (exempt)
- Rule 7: `name` doesn't match key → error
- Rule 8 save mode: unknown `actionId` → warning only (passes)
- Rule 8 runtime mode: unknown `actionId` → error
- Rule 9: `child_machine` missing required fields → error
- Rule 10: `parallel_children` with empty `children[]` → error
- Rule 11: `terminal` with `actionId` → error
- Rule 12: Cyclic child references → error
- Rule 13: Invalid JSON Schema → error
- Rule 14: Duplicate keys in `children[]` → error
- Multiple violations reported together (not just first)

---

## Behavior Spec Coverage

- §2.1 Rules 1–7 (Structural Rules)
- §2.2 Rules 8–11 (State Type Rules)
- §2.3 Rules 12–14 (Referential Integrity)
- §2.4 Validation Error Response — `DefinitionError` with `message` and `details[]`; multiple violations reported together

---

## Validation Checklist

- [ ] `server/src/machines/DefinitionValidator.ts` exists and compiles
- [ ] `ajv` is added to `server/package.json` dependencies
- [ ] All 14 rules are implemented
- [ ] Rule 8 distinguishes save-time (advisory) vs. run-time (mandatory)
- [ ] Multiple violations are collected and returned together
- [ ] Cycle detection (Rule 12) works for direct and transitive cycles
- [ ] Unit tests pass for all 14 rules individually and in combination
- [ ] `pnpm --filter @aiflow/server run test` passes
