# Working Directory & Artifacts Refactor — Design Decisions

> Decisions gathered from tasks 01–17 and the feature specs.
> Each question is numbered. Answers will be recorded as decisions are made.

---

## Decision 1 — Artifact type removal strategy (Task 01, Step 6)

When removing `ArtifactStore`, `ArtifactRecord`, `ArtifactMetadata`, and `ArtifactTree`
from `server/src/machines/types.ts`:

1. **Immediate deletion** — Remove all artifact types right away in Task 01. If
   downstream files break (runner, routes, etc.), let them stay broken until their
   respective tasks fix them.
2. **Deprecation then deletion** — Mark them with `@deprecated` in Task 01, then
   fully delete in Task 07 after all consumers have been updated.

> **Answer:** **1 — Immediate deletion.** Remove all artifact types in Task 01. Downstream compile errors are expected and will be fixed in their respective tasks.

---

## Decision 2 — `ensureArtifactsDir` implementation style (Task 04, Step 3)

The utility that creates the artifacts workspace directory on disk:

1. **Plain async function** — `async function ensureArtifactsDir(path: string): Promise<void>`
2. **Effect wrapper** — `Effect.Effect<void>` using `Effect.promise()`

> **Answer:** **2 — Effect wrapper.** Use `Effect.Effect<void>` so it composes naturally into the runner's Effect pipeline without manual wrapping at the call site.

---

## Decision 3 — `workspaceRoot` validation location (Task 09, Step 2)

Validating that `workspaceRoot` is absolute, exists, and is a directory:

1. **In the route handler** — Plain Express-style validation with early `return res.status(400)`
2. **As an Effect function** — Compose a `validateWorkspaceRoot` Effect that fails
   with `ValidationError`, integrated into the route's Effect pipeline

> **Answer:** **2 — Effect function.** Use a composable `validateWorkspaceRoot` Effect consistent with how schema decoding and runner invocation already use Effect in the route pipeline.

---

## Decision 4 — Client `CliExecResult` type (Task 11, Step 1)

Whether to add `CliExecResult` to the client types:

1. **Add it** — If state data returned by CLI actions contains `CliExecResult` fields
   (`exitCode`, `stdout`, `stderr`, `durationMs`), having the type helps with client-side
   parsing of state data in the instance viewer.
2. **Skip it** — `CliExecResult` is server-side only; the client doesn't need a formal
   type for it. State data is `unknown` in the client anyway.

> **Answer:** **2 — Skip it.** `CliExecResult` is server-side only. State data is `unknown` on the client; no compile-time benefit. Can be added later if needed.

---

## Decision 5 — Artifacts browser approach (Task 13)

How the client accesses artifacts after the artifact API is removed:

1. **Option A — Server-side directory listing endpoint** — Add `GET /instances/:id/files?path=`
   and `GET /instances/:id/files/download?path=` endpoints. Enables a rich file-explorer
   UI in the browser.
2. **Option B — Display `artifactsPath` only** — Show the path string and let the user
   browse via their local filesystem. Minimal implementation.

> **Answer:** **2 — Display `artifactsPath` only.** Show the path string in the instance viewer. No new file-listing endpoints. Users browse artifacts via their local filesystem. The directory listing endpoint can be added later if needed.

---

## Decision 6 — File listing endpoint path traversal safety (Task 13, Step 1)

When serving directory listings from the artifacts workspace:

1. **Basic `startsWith` check** — Resolve the requested path and verify it starts with
   `instance.artifactsPath`. Simple but functional.
2. **No restriction** — Match the feature spec's "no path traversal enforcement"
   philosophy and allow listing any path.
3. **Strict allowlist** — Only serve files under the resolved `artifactsPath` using
   `path.resolve` + prefix check + symlink resolution.

> **Answer:** **N/A** — No file listing endpoint is being built (Decision 5 chose Option B). Revisit if a directory listing endpoint is added later.

---

## Decision 7 — `ARTIFACT_ROOT` configuration source (Task 05, Step 10)

How the runner gets the base artifacts directory:

1. **Environment variable with hardcoded default** —
   `const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT ?? './data/artifacts'`
2. **Configuration file / Effect Config** — Read from a structured config layer
   (e.g., `Config.string('ARTIFACT_ROOT').pipe(Config.withDefault('./data/artifacts'))`)
3. **Constructor parameter** — Pass `artifactRoot` into the runner factory explicitly

> **Answer:** **2 — Effect Config.** Use `Config.string('ARTIFACT_ROOT').pipe(Config.withDefault('./data/artifacts'))` for type-safe, composable configuration within the Effect layer. Consistent with Effect patterns and easy to override in tests.

---

## Decision 8 — Dashboard workspace root input UX (Task 12, Step 7 / Task 14, Step 7)

How the "Quick Start" launch form collects `workspaceRoot`:

1. **Free-text input** — A plain text field where the user types an absolute path.
   Add client-side validation (must start with `/`).
2. **Free-text with recent history** — Same as above but with a dropdown of recently
   used workspace roots (stored in localStorage).
3. **Pre-filled default** — Default to a known path (e.g., from env or config) that
   the user can override.

> **Answer:** **1 — Free-text input.** Plain text field with client-side validation (must start with `/`). Keep client changes minimal; focus is on the server side.

---

## Decision 9 — Existing E2E artifact tests (Task 16, Step 6)

What to do with `server/src/__e2e__/artifacts.e2e.test.ts`:

1. **Delete entirely** — Remove the file. New workspace/CLI E2E tests in
   `workspace.e2e.test.ts` replace it.
2. **Rename and rewrite** — Rename to `workspace.e2e.test.ts` and rewrite
   the test cases in place (preserves git history).

> **Answer:** **1 — Delete entirely.** Remove `artifacts.e2e.test.ts` and create a fresh `workspace.e2e.test.ts`. Clean break; git history for the old artifact tests isn't valuable.

---

## Decision 10 — Client E2E test workspace directory lifecycle (Task 17, Step 3)

How to manage the test workspace directory for Playwright E2E tests:

1. **Global setup/teardown** — Create `/tmp/aiflow-e2e-test` in `globalSetup`,
   delete in `globalTeardown`. Shared across all tests.
2. **Per-test temp directory** — Each test creates its own `mkdtemp` directory
   and cleans up after. Full isolation but slower.
3. **Static known path** — Use a fixed path (e.g., `/tmp/aiflow-e2e-test`)
   created once, never cleaned up between runs. Simplest.

> **Answer:** **1 — Global setup/teardown.** Create a temp dir in Playwright's `globalSetup`, delete in `globalTeardown`. Shared across all tests in the run, clean between runs.

---

## Decision 11 — Parallel task execution order (Overview)

Tasks 03 (CLI Helper) and 04 (Workspace Helpers) are independent of each other,
and Tasks 07–08 (artifact removal) are independent of 03–04. How to sequence:

1. **Sequential by task number** — 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → ...
2. **Parallelize independent tracks** — After 01, do 03+04+07 in parallel, then
   05 after 03+04, then 06 after 05, then 08 after 07, etc.
3. **Types/schemas first, then infra+cleanup in parallel** — 01 → 02, then
   {03, 04, 07, 11} in parallel, then {05, 08} when dependencies met, etc.

> **Answer:** **1 — Sequential by task number.** Execute tasks in order: 01 → 02 → 03 → 04 → 05 → ... No interleaving. Simpler to reason about, each task builds cleanly on the last.

---

## Decision 12 — `StartInstanceInput` type location (Task 11, Step 5)

Where to define the `StartInstanceInput` type on the client:

1. **In `client/src/types/machines.ts`** — Alongside all other machine types.
2. **In `client/src/utils/apiClient.ts`** — Co-located with the function that uses it.
3. **Both** — Export from types, import in apiClient.

> **Answer:** **1 — In `client/src/types/machines.ts`.** Keep all machine-related types in the single types file. Consistent with existing pattern.

---
