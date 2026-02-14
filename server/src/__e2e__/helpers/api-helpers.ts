/**
 * HTTP helper functions for E2E tests (Task 34).
 *
 * Wraps all machine API endpoints so test code stays concise. Every helper
 * returns the raw `Response` — use the composite helpers (`createDef`,
 * `startInst`, `pollStatus`) for common patterns.
 *
 * @module
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

type Handler = (req: Request) => Promise<Response>;

/**
 * Create a temporary workspace directory for E2E tests.
 * Returns the absolute path. Caller must clean up via `fs.rm(path, { recursive: true })`.
 */
export async function createTestWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'aiflow-e2e-'));
}

/**
 * Remove a temporary workspace directory created by `createTestWorkspace`.
 */
export async function removeTestWorkspace(workspaceRoot: string): Promise<void> {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}

/**
 * Build a set of typed HTTP helpers bound to a given in-process handler.
 * If `defaultWorkspaceRoot` is provided, it is automatically injected into
 * every `startInst` and `postInstance` call (unless the caller explicitly
 * provides one).
 */
export function makeApiHelpers(handler: Handler, defaultWorkspaceRoot?: string) {
  const BASE = 'http://localhost/api/machines';

  const makeRuntimeOptions = (workspaceRoot: string) => ({
    cliDirectoryPolicy: {
      workspaceDirs: [workspaceRoot],
    },
    cliOutputCapture: {
      enabled: false,
    },
  });

  const withRuntimeOptions = (body: unknown) => {
    if (typeof body !== 'object' || body === null) {
      return body;
    }

    const payload = body as {
      workspaceRoot?: string;
      runtimeOptions?: unknown;
      [k: string]: unknown;
    };

    const workspaceRoot =
      typeof payload.workspaceRoot === 'string' ? payload.workspaceRoot : defaultWorkspaceRoot;

    return {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(workspaceRoot ? { runtimeOptions: makeRuntimeOptions(workspaceRoot) } : {}),
      ...payload,
    };
  };

  return {
    /** The default workspace root used for instance creation, if set. */
    defaultWorkspaceRoot,

    // ── Definition CRUD ──────────────────────────────────────────────────

    postDefinition: (body: unknown) =>
      handler(
        new Request(`${BASE}/definitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),

    getDefinition: (id: string) => handler(new Request(`${BASE}/definitions/${id}`)),

    getDefinitions: () => handler(new Request(`${BASE}/definitions`)),

    putDefinition: (id: string, body: unknown) =>
      handler(
        new Request(`${BASE}/definitions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),

    deleteDefinition: (id: string) =>
      handler(new Request(`${BASE}/definitions/${id}`, { method: 'DELETE' })),

    // ── Actions ──────────────────────────────────────────────────────────

    getActions: () => handler(new Request(`${BASE}/actions`)),

    getAction: (id: string) => handler(new Request(`${BASE}/actions/${id}`)),

    // ── Instances ────────────────────────────────────────────────────────

    postInstance: (body: unknown) =>
      handler(
        new Request(`${BASE}/instances`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withRuntimeOptions(body)),
        }),
      ),

    getInstance: (id: string) => handler(new Request(`${BASE}/instances/${id}`)),

    getInstances: (query?: string) => handler(new Request(`${BASE}/instances${query ?? ''}`)),

    getHistory: (id: string) => handler(new Request(`${BASE}/instances/${id}/history`)),

    getLogs: (id: string, query?: string) =>
      handler(new Request(`${BASE}/instances/${id}/logs${query ?? ''}`)),

    postCancel: (id: string) =>
      handler(new Request(`${BASE}/instances/${id}/cancel`, { method: 'POST' })),

    postResume: (id: string) =>
      handler(new Request(`${BASE}/instances/${id}/resume`, { method: 'POST' })),

    // ── Composite helpers ────────────────────────────────────────────────

    /**
     * Create a definition and return its parsed body.
     * Throws if the response is not 201.
     */
    async createDef(body: unknown): Promise<{ id: string; version: number; [k: string]: unknown }> {
      const res = await this.postDefinition(body);
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`createDef failed (${String(res.status)}): ${text}`);
      }
      return res.json() as Promise<{ id: string; version: number; [k: string]: unknown }>;
    },

    /**
     * Start an instance and return its parsed body.
     * Throws if the response is not 201.
     * Uses `defaultWorkspaceRoot` unless an explicit `workspaceRoot` is given.
     */
    async startInst(
      defId: string,
      input: unknown = {},
      workspaceRoot?: string,
    ): Promise<{ id: string; status: string; [k: string]: unknown }> {
      const wsRoot = workspaceRoot ?? defaultWorkspaceRoot;
      const res = await this.postInstance({
        definitionId: defId,
        input,
        ...(wsRoot
          ? {
              workspaceRoot: wsRoot,
              runtimeOptions: makeRuntimeOptions(wsRoot),
            }
          : {}),
      });
      if (res.status !== 201) {
        const text = await res.text();
        throw new Error(`startInst failed (${String(res.status)}): ${text}`);
      }
      return res.json() as Promise<{ id: string; status: string; [k: string]: unknown }>;
    },

    /**
     * Poll until the instance reaches one of `targets` statuses.
     * Returns the full instance body. Throws on timeout.
     */
    async pollStatus(instId: string, targets: string[], timeoutMs = 15_000, intervalMs = 100) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const res = await this.getInstance(instId);
        const inst = (await res.json()) as { status: string; [k: string]: unknown };
        if (targets.includes(inst.status)) return inst;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(
        `Instance ${instId} did not reach [${targets.join(', ')}] within ${String(timeoutMs)}ms`,
      );
    },
  };
}

/** Convenience type for the object returned by `makeApiHelpers`. */
export type ApiHelpers = ReturnType<typeof makeApiHelpers>;
