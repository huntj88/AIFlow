# State Machine Feature — Implementation Plan Overview

> **Feature spec**: [state-machines.md](../../feature-specs/state-machines.md)
> **Behavior spec**: [state-machine-behaviors.md](../../feature-specs/state-machine-behaviors.md)

---

## Phase Summary

| Phase | Tasks   | Description                                            |
| ----- | ------- | ------------------------------------------------------ |
| 1     | 01 – 17 | Core Engine (Server) — types, store, registry, runner  |
| 2     | 18 – 22 | REST API — CRUD, instance management, artifacts        |
| 3     | 23      | WebSocket — live event streaming                       |
| 4     | 24 – 29 | Client Viewer — API client, dashboard, instance viewer |
| 5     | 30      | Client Editor — visual definition editor               |
| 6     | 31 – 33 | Polish — observability, integration, E2E tests         |

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
       └──→ 16 Runner Events (PubSub)

 09–16 ──→ 17 Core Engine Tests

 17 ──→ 18 API Definitions
      ──→ 19 API Actions
      ──→ 20 API Instances
      ──→ 21 API Wiring
      ──→ 22 API Tests

 21 ──→ 23 WebSocket Server

 22 + 23
  ├──→ 24 Client API Client
  ├──→ 25 Client WebSocket Client
  ├──→ 26 Client State Management
  ├──→ 27 Client Dashboard
  ├──→ 28 Client Instance Viewer
  └──→ 29 Client Routing

 27 + 28 + 29 ──→ 30 Definition Editor

 30 ──→ 31 Observability
    ──→ 32 Integration & Polish
    ──→ 33 E2E Tests
```

---

## Behavior Spec Traceability

| Behavior Spec Section                | Implementing Task(s)        |
| ------------------------------------ | --------------------------- |
| §1 Definition CRUD                   | 04, 18, 22                  |
| §2 Definition Validation             | 03, 17, 18                  |
| §3 Action Registry                   | 05, 19                      |
| §4 Linear Flow                       | 09, 17                      |
| §5 Branching                         | 05 (conditional-branch), 09 |
| §6 Error Handling                    | 10, 17                      |
| §7 Timeouts & Safety Limits          | 10, 17                      |
| §8 Single Child Machine              | 11, 17                      |
| §9 Parallel Children                 | 12, 17                      |
| §10 Concurrency & Semaphore          | 13, 17                      |
| §11 Cancellation                     | 14, 17, 20                  |
| §12 Resumability & Graceful Shutdown | 15, 17, 20                  |
| §13 Persistence Checkpoints          | 09, 15, 17                  |
| §14 Middleware                       | 07, 17                      |
| §15 Artifacts                        | 08, 17, 20                  |
| §16 WebSocket — Live Updates         | 23, 25                      |
| §17 Dashboard                        | 27                          |
| §18 Instance Viewer                  | 28                          |
| §19 Definition Editor                | 30                          |
| §20 E2E Workflows                    | 33                          |
| §21 Negative / Edge Cases            | 17, 22, 33                  |

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
