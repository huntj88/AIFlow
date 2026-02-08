# Task 22 — REST API Test Suite

> **Phase**: 2 (REST API)
> **Depends on**: Tasks 18–21 (all API routes and wiring)
> **Blocks**: Phase 3 (WebSocket), Phase 4 (Client)

---

## Objective

Write integration tests for all machine REST API endpoints. Tests should make real HTTP requests to the server (using the Effect test client or a test harness) with the `InMemoryMachineStore`. These tests verify the full request → route → service → response cycle.

---

## Test Files

### 1. `server/src/routes/machines/definitions.test.ts`

#### CRUD Operations (§1)

- [ ] POST with valid body → 201, response has `id`, `version: 1`, `createdAt`, `updatedAt`
- [ ] Created definition appears in GET list
- [ ] Creating with same name succeeds (names not unique)
- [ ] GET by id returns full definition JSON
- [ ] GET non-existent id → 404
- [ ] GET list returns array of all definitions
- [ ] PUT with valid body → updated definition; `version` incremented; `updatedAt` refreshed
- [ ] PUT non-existent id → 404
- [ ] DELETE → success (204)
- [ ] Deleted definition → 404 on GET and not in list
- [ ] DELETE non-existent → 404

#### Validation (§2)

- [ ] POST with invalid definition (Rule 1: bad `initialState`) → 400 with `DefinitionError`
- [ ] POST with missing terminal states → 400
- [ ] PUT with invalid definition → 400
- [ ] Validation response has `message` and `details[]`
- [ ] Multiple validation violations reported together

### 2. `server/src/routes/machines/actions.test.ts`

- [ ] GET list returns all 5 built-in actions with metadata
- [ ] GET by id returns specific action metadata
- [ ] GET non-existent action → 404

### 3. `server/src/routes/machines/instances.test.ts`

#### Start & Query (§4, §21)

- [ ] POST with valid definition ID and input → 201 with instance ID
- [ ] POST with missing `definitionId` → 400
- [ ] POST with missing `input` → 400
- [ ] POST with non-existent definition ID → 404
- [ ] POST with input violating `inputSchema` → 400
- [ ] GET list returns instances; supports status/definitionId filters
- [ ] GET by id returns full instance
- [ ] GET non-existent instance → 404

#### History & Logs (§4.4, §4.5)

- [ ] GET `/instances/:id/history` returns ordered transition records
- [ ] GET `/instances/:id/logs` returns all log entries
- [ ] GET `/instances/:id/logs?state=X` filters correctly

#### Cancel (§11)

- [ ] POST cancel on running instance → success
- [ ] POST cancel on completed → 409
- [ ] POST cancel on cancelled → 409
- [ ] POST cancel on errored → 409
- [ ] POST cancel on non-existent → 404

#### Resume (§12)

- [ ] POST resume on suspended instance → success
- [ ] POST resume on running → 409
- [ ] POST resume on completed → 409
- [ ] POST resume on non-existent → 404

#### Artifacts (§15)

- [ ] GET `/instances/:id/artifacts` returns artifact list
- [ ] GET `/instances/:id/artifacts?tree=true` returns recursive tree
- [ ] GET `/instances/:id/artifacts/:name` downloads file content
- [ ] GET `/instances/:id/artifacts/:name` for non-existent → 404

#### Concurrent Operations (§21.2)

- [ ] Starting multiple instances concurrently → no data corruption
- [ ] Two concurrent GETs on same instance return consistent data

#### Definition Mutation During Execution (§21.3)

- [ ] Updating a definition while instance is running → running instance unaffected
- [ ] Deleting a definition while instance is running → instance still completes
- [ ] Completed instance viewable after definition deleted

---

## Behavior Spec Coverage

- §1 (Definition CRUD) — full coverage
- §2 (Definition Validation via API) — validation error responses
- §3 (Action Registry) — list and get actions
- §4.1, §4.3, §4.4, §4.5 — instance start, query, history, logs
- §11.5 — cancel conflict responses
- §12.5 — resume conflict responses
- §15.4 — artifact API endpoints
- §21.1 — error responses for missing fields, non-existent resources
- §21.2 — concurrent operations
- §21.3 — definition mutation during execution

---

## Validation Checklist

- [ ] All test files compile and pass
- [ ] Definition CRUD fully tested
- [ ] Validation error responses include `message` and `details[]`
- [ ] Instance lifecycle tested (start, query, cancel, resume)
- [ ] History and log endpoints tested with filtering
- [ ] Artifact endpoints tested (list, tree, download)
- [ ] Error responses (400, 404, 409, 500) tested for each case
- [ ] Concurrent operations tested
- [ ] `pnpm --filter @aiflow/server run test` passes
