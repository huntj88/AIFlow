# State Machine Feature — Implementation Plan Overview

> **Feature spec**: [state-machines.md](../../feature-specs/state-machines.md)
> **Behavior spec**: [state-machine-behaviors.md](../../feature-specs/state-machine-behaviors.md)

---

## Phase Summary

| Phase | Tasks     | Description                                             |
| ----- | --------- | ------------------------------------------------------- |
| 1     | 01 – 17   | Core Engine (Server) — types, store, registry, runner   |
| 2     | 18 – 22.1 | REST API — CRUD, instance management, artifacts         |
| 3     | 23        | WebSocket — live event streaming                        |
| 4     | 24 – 29   | Client Viewer — API client, dashboard, instance viewer  |
| 5     | 30        | Client Editor — visual definition editor                |
| 6     | 31 – 33   | Polish — observability, integration, E2E tests          |
| 7     | 34 – 45   | Server E2E — HTTP/WS validation of all server behaviors |

---

## Dependency Graph

```
01 Types & Errors
 ├──→ 02 Schema Validators
 │     └──→ 03 Definition Validator ──→ 18 API Definitions
 ├──→ 04 Machine Store
 ├──→ 05 Action Registry & Built-in Actions
 ├──→ 06 State Logger
 ├──→ 07 Middleware System
 └──→ 08 Artifact Store

 03 + 04 + 05 + 06 + 07 + 08
 └──→ 09 Runner Core (Linear)
       ├──→ 10 Runner Errors & Timeouts
       ├──→ 11 Runner Single Child
       │     └──→ 12 Runner Parallel Children
       ├──→ 13 Runner Semaphore
       ├──→ 14 Runner Cancellation
       ├──→ 15 Runner Suspend & Resume
       └──→ 16 Runner Events (PubSub)  ⚠️ NOT DONE — blocks Task 23

 09–16 ──→ 17 Core Engine Tests
 17   ──→ 17.1 Runner Refactor (dedup)

 17.1 ──→ 18 API Definitions
      ──→ 19 API Actions
      ──→ 20 API Instances
      ──→ 21 API Wiring
      ──→ 22 API Tests
           └──→ 22.1 Remaining API Tests (cancel running, artifact download)

 16 + 21 ──→ 23 WebSocket Server    ⚠️ Requires Task 16 (PubSub)

 22.1 + 23
  ├──→ 24 Client API Client
  ├──→ 25 Client WebSocket Client
  ├──→ 26 Client State Management
  ├──→ 27 Client Dashboard
  ├──→ 28 Client Instance Viewer
  └──→ 29 Client Routing

 27 + 28 + 29 ──→ 30 Definition Editor

 30 ──→ 31 Observability
    ──→ 32 Integration & Polish
    ──→ 33 E2E Tests (Playwright / Client)

 22.1 + 23
  └──→ 34 Server E2E Infrastructure
        ├──→ 35 Server E2E — Definitions & Validation (§1, §2)
        ├──→ 36 Server E2E — Actions (§3)
        ├──→ 37 Server E2E — Linear Execution & Branching (§4, §5)
        ├──→ 38 Server E2E — Errors & Timeouts (§6, §7)
        ├──→ 39 Server E2E — Child & Parallel Machines (§8, §9)
        ├──→ 40 Server E2E — Concurrency & Cancellation (§10, §11)
        ├──→ 41 Server E2E — Suspend & Resume (§12, §13)
        ├──→ 42 Server E2E — Middleware (§14)
        ├──→ 43 Server E2E — Artifacts (§15)
        ├──→ 44 Server E2E — WebSocket (§16)
        └──→ 45 Server E2E — Edge Cases (§21)
```

---

## Behavior Spec Traceability

| Behavior Spec Section                | Implementing Task(s)        | Server E2E Task |
| ------------------------------------ | --------------------------- | --------------- |
| §1 Definition CRUD                   | 04, 18, 22                  | 35              |
| §2 Definition Validation             | 03, 17, 18                  | 35              |
| §3 Action Registry                   | 05, 19                      | 36              |
| §4 Linear Flow                       | 09, 17                      | 37              |
| §5 Branching                         | 05 (conditional-branch), 09 | 37              |
| §6 Error Handling                    | 10, 17                      | 38              |
| §7 Timeouts & Safety Limits          | 10, 17                      | 38              |
| §8 Single Child Machine              | 11, 17                      | 39              |
| §9 Parallel Children                 | 12, 17                      | 39              |
| §10 Concurrency & Semaphore          | 13, 17                      | 40              |
| §11 Cancellation                     | 14, 17, 20, 22.1            | 40              |
| §12 Resumability & Graceful Shutdown | 15, 17, 20                  | 41              |
| §13 Persistence Checkpoints          | 09, 15, 17                  | 41              |
| §14 Middleware                       | 07, 17                      | 42              |
| §15 Artifacts                        | 08, 17, 20, 22.1            | 43              |
| §16 WebSocket — Live Updates         | 23, 25                      | 44              |
| §17 Dashboard                        | 27                          | — (UI only)     |
| §18 Instance Viewer                  | 28                          | — (UI only)     |
| §19 Definition Editor                | 30                          | — (UI only)     |
| §20 E2E Workflows                    | 33                          | — (UI only)     |
| §21 Negative / Edge Cases            | 17, 22, 33                  | 45              |

---

## New Dependencies (to be added per-phase)

### Server (`@aiflow/server`)

| Dependency                                  | Phase | Purpose                           |
| ------------------------------------------- | ----- | --------------------------------- |
| `ajv`                                       | 1     | JSON Schema validation            |
| `jsonpath-plus`                             | 1     | Child input mapping extraction    |
| `uuid`                                      | 1     | Instance/definition ID generation |
| `ws` + `@types/ws`                          | 3     | WebSocket server                  |
| `@opentelemetry/api`                        | 6     | OTel tracing API                  |
| `@opentelemetry/sdk-node`                   | 6     | OTel SDK                          |
| `@opentelemetry/exporter-trace-otlp-http`   | 6     | OTel trace export                 |
| `@opentelemetry/exporter-metrics-otlp-http` | 6     | OTel metrics export               |
| `@effect/opentelemetry`                     | 6     | Effect ↔ OTel bridge              |

### Client (`@aiflow/client`)

| Dependency         | Phase | Purpose                       |
| ------------------ | ----- | ----------------------------- |
| `@xyflow/react`    | 4     | React Flow for state diagrams |
| `dagre` or `elkjs` | 4     | Automatic graph layout        |
| `@types/dagre`     | 4     | Type definitions              |
