# Task 36 — Server E2E: Action Registry

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure)
> **Blocks**: None
> **Validates**: §3 Action Registry

---

## Objective

Validate all 4 behaviors from §3 (Action Registry) via HTTP requests, confirming
that the server exposes the built-in action registry correctly.

---

## Behavior Checklist → Test Mapping

| #   | Behavior                                                                                                 | Test                                         |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | `GET /actions` returns list with metadata (id, description)                                              | `list actions → array with id + description` |
| 2   | `GET /actions/:id` returns metadata for specific action                                                  | `get action by id → correct metadata`        |
| 3   | `GET /actions/:id` for non-existent → 404                                                                | `get non-existent action → 404`              |
| 4   | Built-in actions present: `http-request`, `delay`, `transform-data`, `log-message`, `conditional-branch` | `all 5 built-ins registered`                 |

---

## Test Structure

```typescript
// server/src/__e2e__/02-actions.e2e.test.ts

const BUILT_IN_IDS = [
  'http-request',
  'delay',
  'transform-data',
  'log-message',
  'conditional-branch',
];

describe('§3 — Action Registry', () => {
  it('GET /actions returns list of all registered actions with metadata', async () => {
    const res = await api.getActions();
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const action of list) {
      expect(action).toHaveProperty('id');
      expect(action).toHaveProperty('description');
    }
  });

  it('all 5 built-in actions are present on server startup', async () => {
    const res = await api.getActions();
    const list = await res.json();
    const ids = list.map((a: any) => a.id);
    for (const expected of BUILT_IN_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it.each(BUILT_IN_IDS)('GET /actions/%s returns metadata', async (actionId) => {
    const res = await api.getAction(actionId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(actionId);
    expect(body).toHaveProperty('description');
  });

  it('GET /actions/:id for non-existent action → 404', async () => {
    const res = await api.getAction('does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('message');
    expect(body.message).toContain('not found');
  });
});
```

---

## Key Assertions

- **200** for valid GET requests
- **404** with `{ message }` for non-existent action IDs
- List response is an array of `{ id: string, description: string }`
- Exactly 5 built-in actions registered (or more if custom test actions added)
- Each built-in action's metadata is retrievable individually

---

## Behavior Spec Coverage

- §3 Action Registry — 4 behaviors (list all, get by ID, 404 for non-existent, built-ins present)

---

## Validation Checklist

- [ ] All 4 §3 behaviors have passing tests
- [ ] Built-in action count matches expected (5)
- [ ] Each built-in action retrievable by ID
- [ ] 404 for non-existent action verified
- [ ] Test file: `server/src/__e2e__/02-actions.e2e.test.ts`
