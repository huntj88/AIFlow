# Working Directory & Artifacts Refactor — Implementation Plan Overview

> **Feature spec**: [01-state-machine-working-directory.md](../../feature-specs/01-state-machine-working-directory.md)
> **Behavior spec**: [01-state-machine-behaviors.md](../../feature-specs/01-state-machine-behaviors.md)
> **Prerequisite**: All tasks in [00-state-machine](../00-state-machine/) are complete.

---

## Summary

This plan migrates the state machine system from a managed artifact record/API model
to a filesystem-based working directory model. It introduces a CLI helper for command
execution, replaces `ArtifactStore` with workspace path helpers, adds `workspaceRoot`
to instance creation, and removes the artifact API surface. The migration touches
server types, schemas, runner, API routes, WebSocket events, client types, client
hooks, and client UI components.

---

## Phase Summary

| Phase | Tasks   | Description                                                          |
| ----- | ------- | -------------------------------------------------------------------- |
| 1     | 01 – 02 | Data Model — types, schemas, error constructors                      |
| 2     | 03 – 04 | Infrastructure — CLI helper, workspace helpers                       |
| 3     | 05 – 06 | Runner — ActionContext wiring, child inheritance                     |
| 4     | 07 – 08 | Cleanup — remove artifact infrastructure, remove artifact API/events |
| 5     | 09 – 10 | API — start-instance changes, instance payload updates               |
| 6     | 11 – 12 | Client — type updates, API client & hooks migration                  |
| 7     | 13 – 14 | Client UI — artifacts browser rework, instance page updates          |
| 8     | 15 – 17 | Tests — server unit/integration, server E2E, client E2E updates      |

---

## Dependency Graph

```
01 Type Updates (server + client)
 ├──→ 02 Schema Updates
 ├──→ 03 CLI Helper
 ├──→ 04 Workspace Helpers
 └──→ 11 Client Type Updates

 03 + 04
 └──→ 05 Runner ActionContext Wiring
       └──→ 06 Runner Child Inheritance & Family Root

 01
 └──→ 07 Remove Artifact Infrastructure (server)
       └──→ 08 Remove Artifact API & Events

 02 + 06
 └──→ 09 Start-Instance API Changes (workspaceRoot required)
       └──→ 10 Instance Payload Updates

 08 + 10 + 11
 └──→ 12 Client API Client & Hooks Migration

 12
 └──→ 13 Client Artifacts Browser Rework
 └──→ 14 Client Instance Page Updates

 06 + 09
 └──→ 15 Server Unit & Integration Tests

 10 + 14
 └──→ 16 Server E2E Test Updates

 16
 └──→ 17 Client E2E Test Updates
```

---

## Key Decisions & Constraints

1. **Sequential execution (Decision 11).** Tasks are executed in numeric order
   (01 → 02 → 03 → …). Although artifact removal (07–08) has no data dependency
   on workspace helpers (03–04), they are not interleaved. Each task builds
   cleanly on the last.

2. **Types first.** Task 01 updates types on both server and client simultaneously
   to keep the type definitions in sync. Client type updates (Task 11) can also
   start as soon as Task 01 is done.

3. **Runner changes are isolated.** Tasks 05–06 modify the runner but do not
   remove artifacts — removal happens in Tasks 07–08. This allows the runner
   to temporarily support both old and new context fields during migration.

4. **API changes after runner.** Tasks 09–10 depend on the runner being updated
   (Task 06) and schemas being updated (Task 02) so that `workspaceRoot` flows
   through properly.

5. **Client last.** Tasks 11–14 are the final migration layer — once the server
   API contract is stable.

6. **Tests at the end.** Tasks 15–17 validate everything. They depend on all
   preceding work being complete.

---

## Files Affected (Summary)

### Server

- `server/src/machines/types.ts` — ActionContext, MachineInstance, MachineEvent, remove artifact types
- `server/src/machines/schemas.ts` — StartInstanceRequestSchema, MachineInstanceSchema
- `server/src/machines/StateMachineRunner.ts` — ActionContext construction, child spawning, workspace helpers
- `server/src/machines/artifacts/*` — **DELETE** entire directory
- `server/src/machines/cli/*` — **NEW** CliHelper implementation
- `server/src/routes/machines/instances.ts` — Remove artifact routes, add workspaceRoot, update payloads
- `server/src/machines/live/events.ts` — Remove artifact_created event type reference
- `server/src/machines/EventPubSub.ts` — Remove artifact_created publishing
- `server/src/machines/middleware/*` — May reference artifacts (audit trail)

### Client

- `client/src/types/machines.ts` — Mirror server type changes
- `client/src/utils/apiClient.ts` — Remove artifact API calls, add workspaceRoot to start
- `client/src/hooks/useMachineArtifacts.ts` — **DELETE** or repurpose for filesystem browser
- `client/src/hooks/useMachineSocket.ts` — Remove artifact_created handling
- `client/src/components/machines/ArtifactViewer.tsx` — Rework to filesystem browser
- `client/src/pages/MachineInstancePage.tsx` — Update artifact tab, remove artifact store usage
