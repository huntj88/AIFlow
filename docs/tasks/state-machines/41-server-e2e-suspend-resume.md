# Task 41 — Server E2E: Suspend, Resume & Persistence Checkpoints

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure), Task 40 (cancellation)
> **Blocks**: None
> **Validates**: §12 Resumability & Graceful Shutdown, §13 Persistence Checkpoints

---

## Objective

Validate behaviors from §12 (Resumability & Graceful Shutdown) and §13
(Persistence Checkpoints) via HTTP requests and process management. Some §12
behaviors require stopping and restarting the server, which limits what can be
tested with in-process handlers. This task documents which behaviors are
testable and which require special handling.

---

## Testability Analysis

### Fully Testable (In-Process)

| Section | Behavior                         | How                                                              |
| ------- | -------------------------------- | ---------------------------------------------------------------- |
| §12.2   | Resume happy path                | Manually set instance to `suspended` in store, then POST /resume |
| §12.5   | Resume non-suspended → 409       | POST /resume on running/completed/cancelled/error                |
| §13.1   | Checkpoint 1 — instance creation | GET immediately after POST /instances                            |
| §13.3   | Checkpoint 3 — after transition  | Poll instance, verify history/stateData updated                  |
| §13.4   | Checkpoint 4 — terminal state    | Verify status/output/error on completed/error                    |

### Partially Testable

| Section | Behavior                          | Limitation                                                             |
| ------- | --------------------------------- | ---------------------------------------------------------------------- |
| §12.1   | Graceful shutdown → suspension    | Requires SIGTERM; in-process we can call runner's suspend API directly |
| §12.3   | Resume with single child          | Need pre-suspended parent+child state                                  |
| §12.4   | Resume with parallel children     | Need pre-suspended parent+parallel-children state                      |
| §12.6   | Startup recovery                  | Requires server restart with AUTO_RESUME_ON_STARTUP                    |
| §13.2   | Checkpoint 2 — before state entry | Hard to observe mid-action; verified by suspend/resume correctness     |
| §13.5   | Checkpoint 5 — suspension         | Requires shutdown or direct suspend                                    |

### Requires Real Server (Process-Level Tests)

For §12.1 (graceful shutdown) and §12.6 (startup recovery), we need a separate
test harness that starts a real server process, sends requests, sends SIGTERM,
restarts, and verifies. These are documented but may be best as manual smoke
tests or a dedicated CI job.

---

## Behavior Checklist → Test Mapping

### §12.2 Resume — Happy Path (6 behaviors)

| #   | Behavior                                                | Test                                      |
| --- | ------------------------------------------------------- | ----------------------------------------- |
| 1   | `POST /instances/:id/resume` on suspended → success     | `resume suspended → 200`                  |
| 2   | Status changes to `'running'` then terminal             | `resume → running → terminal`             |
| 3   | Runner re-enters `currentState` and re-executes action  | `resume re-executes current state action` |
| 4   | Completed transitions not re-executed                   | `resume skips completed transitions`      |
| 5   | `machine_resumed` event published (deferred to Task 44) | —                                         |
| 6   | Machine runs to completion from resumed state           | `resume → completes`                      |

### §12.3 Resume — With Single Child (3 behaviors)

| #   | Behavior                                                 | Test                                 |
| --- | -------------------------------------------------------- | ------------------------------------ |
| 1   | Resume parent with suspended child → child resumed first | `resume parent → child resumes`      |
| 2   | Child completes → parent continues                       | `child completes → parent continues` |
| 3   | Already-completed child not re-run                       | `completed child skipped`            |

### §12.4 Resume — With Parallel Children (3 behaviors)

| #   | Behavior                                           | Test                   |
| --- | -------------------------------------------------- | ---------------------- |
| 1   | Suspended children resumed, completed ones skipped | `mixed resume`         |
| 2   | Parent waits for all children terminal             | `parent waits for all` |
| 3   | `ParallelChildrenResult` correct                   | `correct results`      |

### §12.5 Resume — Rejection (3 behaviors)

| #   | Behavior                                                       | Test                              |
| --- | -------------------------------------------------------------- | --------------------------------- |
| 1   | Resume non-suspended (running/completed/cancelled/error) → 409 | `resume non-suspended → 409`      |
| 2   | Resume with changed definition version → `DefinitionError`     | `resume version mismatch → error` |
| 3   | Resume with deleted definition → `NotFoundError`               | `resume deleted def → error`      |

### §12.1 Graceful Shutdown (6 behaviors, partially testable)

| #   | Behavior                                            | Test                                            |
| --- | --------------------------------------------------- | ----------------------------------------------- |
| 1   | SIGTERM → running instances suspended               | `shutdown → instances suspended` (process test) |
| 2   | waiting_for_child instances also suspended          | `shutdown → waiting parents suspended`          |
| 3   | Children of suspended parents suspended recursively | `shutdown → children suspended`                 |
| 4   | Suspended ≠ cancelled                               | `status is suspended not cancelled`             |
| 5   | Server waits for finalizers (SHUTDOWN_TIMEOUT_MS)   | `server waits for finalizers`                   |
| 6   | GET /instances shows suspended instances            | `suspended visible after shutdown`              |

### §12.6 Startup Recovery (5 behaviors, partially testable)

| #   | Behavior                                                | Test                     |
| --- | ------------------------------------------------------- | ------------------------ |
| 1   | AUTO_RESUME_ON_STARTUP=true → auto-resume all suspended | `auto resume on startup` |
| 2   | Children resumed by parent protocol                     | `children via parent`    |
| 3   | Resumed in updatedAt order                              | `oldest first`           |
| 4   | Failed resume → error status                            | `failed resume → error`  |
| 5   | AUTO_RESUME_ON_STARTUP=false → stay suspended           | `no auto resume`         |

### §13 Persistence Checkpoints (5 behaviors)

| #   | Behavior                                                     | Test           |
| --- | ------------------------------------------------------------ | -------------- |
| CP1 | After start: running, currentState=initial, stateData=input  | `checkpoint 1` |
| CP2 | Before action: persisted state reflects unfinished           | `checkpoint 2` |
| CP3 | After transition: history appended, currentState advanced    | `checkpoint 3` |
| CP4 | Terminal: status set, output/error populated                 | `checkpoint 4` |
| CP5 | Suspension: status=suspended, currentState=interrupted state | `checkpoint 5` |

---

## Test Structure

```typescript
// server/src/__e2e__/07-suspend-resume.e2e.test.ts

describe('§12 — Resumability', () => {
  describe('§12.2 Resume — Happy Path', () => {
    it('POST /instances/:id/resume on suspended instance → 200');
    it('resumed instance changes to running then reaches terminal state');
    it('runner re-enters currentState and re-executes action');
    it('already-completed transitions are not re-executed');
    it('machine runs to completion from resumed state');
  });

  describe('§12.3 Resume — With Single Child', () => {
    it('resuming parent with suspended child → child resumed first');
    it('child completes then parent continues');
    it('already-completed child is not re-run');
  });

  describe('§12.4 Resume — With Parallel Children', () => {
    it('suspended children resumed, completed children skipped');
    it('parent waits for all children to reach terminal');
    it('ParallelChildrenResult mixes pre-completed and just-resumed');
  });

  describe('§12.5 Resume — Rejection', () => {
    it('resume running instance → 409');
    it('resume completed instance → 409');
    it('resume cancelled instance → 409');
    it('resume errored instance → 409');
    it('resume with changed definition version → DefinitionError');
    it('resume with deleted definition → NotFoundError');
  });
});

describe('§13 — Persistence Checkpoints', () => {
  it('CP1: immediately after start → running, currentState=initial');
  it('CP3: after transition → history appended, currentState advanced');
  it('CP4: terminal → status set, output or error populated');
  it('CP5: suspension → status=suspended, currentState=interrupted state');
});
```

---

## Testing Strategy

### Creating Suspended Instances (In-Process)

Since graceful shutdown is hard to simulate in-process, we can create suspended
instances by directly manipulating the store:

```typescript
// Option 1: Start a slow machine, then use the runner's internal suspend
// Option 2: Use the MachineStore service to set status to 'suspended' directly
// Option 3: Start a slow machine, cancel it, then manually update status

// Best approach: Start a delay machine, wait until running, then directly
// update the store to set status='suspended' and test the resume path.
```

Alternatively, if the runner exposes a `suspendAll()` method (used during
graceful shutdown), call it directly:

```typescript
const runner = yield * StateMachineRunner;
yield * runner.suspendAll(); // Sets all running instances to 'suspended'
```

### Process-Level Shutdown Tests

For the full §12.1 and §12.6 tests, create a separate test script:

```bash
# 1. Start server in background
# 2. Create definitions and start instances via curl
# 3. Send SIGTERM
# 4. Wait for server exit
# 5. Restart server
# 6. Verify instances are suspended / auto-resumed
```

This is documented as a manual verification or CI script, not a vitest test.

---

## Key Assertions

- **Resume 200**: Suspended instance resumes successfully
- **Resume 409**: Running/completed/cancelled/errored instances reject resume
- **Checkpoint 1**: `status==='running'`, `currentState===initialState` immediately after start
- **Checkpoint 3**: `history.length` increases, `currentState` advances
- **Checkpoint 4**: `status` is terminal, `output` or `error` populated
- **Checkpoint 5**: `status==='suspended'`, `currentState` reflects last active state

---

## Behavior Spec Coverage

- §12 Resumability & Graceful Shutdown (§12.1–§12.6) — 26 behaviors (subset testable in-process)
- §13 Persistence Checkpoints (CP1–CP5) — 5 behaviors

---

## Validation Checklist

- [ ] All 6 §12.2 resume happy path behaviors verified (event deferred)
- [ ] All 3 §12.3 resume-with-child behaviors verified
- [ ] All 3 §12.4 resume-with-parallel behaviors verified
- [ ] All 3 §12.5 resume rejection behaviors verified
- [ ] §12.1 graceful shutdown documented (process-level test)
- [ ] §12.6 startup recovery documented (process-level test)
- [ ] §13 checkpoints 1, 3, 4, 5 verified via API polling
- [ ] §13 checkpoint 2 documented as verified by suspend/resume correctness
- [ ] Test file: `server/src/__e2e__/07-suspend-resume.e2e.test.ts`
