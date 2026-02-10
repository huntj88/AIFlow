/**
 * HTTP helper functions for E2E tests (Task 34).
 *
 * Wraps all machine API endpoints so test code stays concise. Every helper
 * returns the raw `Response` — use the composite helpers (`createDef`,
 * `startInst`, `pollStatus`) for common patterns.
 *
 * @module
 */

type Handler = (req: Request) => Promise<Response>;

/**
 * Build a set of typed HTTP helpers bound to a given in-process handler.
 */
export function makeApiHelpers(handler: Handler) {
  const BASE = 'http://localhost/api/machines';

  return {
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
          body: JSON.stringify(body),
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

    getArtifacts: (id: string, query?: string) =>
      handler(new Request(`${BASE}/instances/${id}/artifacts${query ?? ''}`)),

    getArtifact: (id: string, name: string) =>
      handler(new Request(`${BASE}/instances/${id}/artifacts/${name}`)),

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
     */
    async startInst(
      defId: string,
      input: unknown = {},
    ): Promise<{ id: string; status: string; [k: string]: unknown }> {
      const res = await this.postInstance({ definitionId: defId, input });
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
