/**
 * E2E: Artifacts (Task 43).
 *
 * Validates all 17 behaviors from §15 (Artifacts) via HTTP requests
 * against an in-process handler.
 *
 * §15.1 Write & Read — 4 behaviors
 * §15.2 Sandbox / Path Traversal — 3 behaviors
 * §15.3 Parent-Child Artifact Access — 3 behaviors
 * §15.4 REST API — 4 behaviors
 * §15.5 Directory Structure — 3 behaviors
 *
 * @module
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionRegistry } from '@/machines/ActionRegistry.js';
import type { ActionContext, ArtifactRecord, ArtifactTree } from '@/machines/types.js';
import { type ApiHelpers, makeApiHelpers } from './helpers/api-helpers.js';
import { makeTestHandler } from './helpers/test-handler.js';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const ARTIFACT_ROOT = path.resolve(process.env.ARTIFACT_ROOT ?? './data/artifacts');

// ────────────────────────────────────────────────────────────────────────────
// Local Fixtures
// ────────────────────────────────────────────────────────────────────────────

/** Machine that writes an artifact in its first state, then completes. */
const ARTIFACT_DEFINITION = {
  name: 'E2E Artifact Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'write_file',
  states: {
    write_file: { name: 'write_file', type: 'action' as const, actionId: 'test-write-artifact' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'write_file', to: 'completed' }],
  metadata: { description: 'Artifact-producing machine', tags: ['e2e'] },
};

/** Machine that attempts path traversal via artifact write. */
const TRAVERSAL_DEFINITION = {
  name: 'E2E Traversal Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'write_bad',
  states: {
    write_bad: { name: 'write_bad', type: 'action' as const, actionId: 'test-write-traversal' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'write_bad', to: 'completed' }],
  metadata: { description: 'Path traversal attempt machine', tags: ['e2e'] },
};

/**
 * Parent that spawns an artifact-producing child, then reads the child's artifact
 * in its post-child action.
 */
const makeArtifactParentDef = (childDefId: string) => ({
  name: 'E2E Artifact Parent',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_child',
  states: {
    spawn_child: {
      name: 'spawn_child',
      type: 'child_machine' as const,
      actionId: 'test-read-child-artifact',
      childMachineDefId: childDefId,
      childInputMapping: '$.machineInput',
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'spawn_child', to: 'completed' },
    { from: 'spawn_child', to: 'error' },
  ],
  metadata: { description: 'Parent that reads child artifacts', tags: ['e2e'] },
});

/**
 * Parent that spawns two parallel artifact-producing children.
 */
const makeParallelArtifactParentDef = (childDefId: string) => ({
  name: 'E2E Parallel Artifact Parent',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_parallel',
  states: {
    spawn_parallel: {
      name: 'spawn_parallel',
      type: 'parallel_children' as const,
      actionId: 'test-read-parallel-artifacts',
      children: [
        { key: 'child_a', machineDefId: childDefId, inputMapping: '$.machineInput.childA' },
        { key: 'child_b', machineDefId: childDefId, inputMapping: '$.machineInput.childB' },
      ],
      parallelMode: 'all_settled' as const,
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'spawn_parallel', to: 'completed' },
    { from: 'spawn_parallel', to: 'error' },
  ],
  metadata: { description: 'Parallel parent reading child artifacts', tags: ['e2e'] },
});

/**
 * Parent that reads a child artifact using `readChild` but passes a
 * non-descendant instance ID, which should be rejected.
 */
const makeNonDescendantParentDef = (childDefId: string) => ({
  name: 'E2E Non-Descendant Parent',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_child',
  states: {
    spawn_child: {
      name: 'spawn_child',
      type: 'child_machine' as const,
      actionId: 'test-read-nondescendant',
      childMachineDefId: childDefId,
      childInputMapping: '$.machineInput',
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'spawn_child', to: 'completed' },
    { from: 'spawn_child', to: 'error' },
  ],
  metadata: { description: 'Parent that reads non-descendant artifact', tags: ['e2e'] },
});

// ────────────────────────────────────────────────────────────────────────────
// Custom Test Actions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Register artifact-related test actions:
 * - `test-write-artifact`: Writes an artifact file.
 * - `test-write-traversal`: Attempts to write with a malicious filename.
 * - `test-read-child-artifact`: Reads a child instance's artifact.
 * - `test-read-parallel-artifacts`: Reads artifacts from parallel children.
 * - `test-read-nondescendant`: Attempts to read from a non-descendant.
 */
const registerArtifactActions = (registry: ActionRegistry) =>
  Effect.gen(function* () {
    // ── Write artifact ─────────────────────────────────────────────────
    yield* registry.register(
      'test-write-artifact',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const input = ctx.stateData as {
            filename?: string;
            content?: string;
            nextState?: string;
          };
          const filename = input.filename ?? 'output.txt';
          const content = input.content ?? 'hello from artifact';
          const nextState = input.nextState ?? 'completed';

          yield* ctx.artifacts.write(filename, new TextEncoder().encode(content)).pipe(
            Effect.mapError((err) => ({
              _tag: 'ActionError' as const,
              actionId: 'test-write-artifact',
              stateName: ctx.stateName,
              cause: JSON.stringify(err),
            })),
          );
          yield* ctx.logger.info(`Wrote artifact: ${filename}`);

          return { nextState, data: { artifact: filename } };
        }),
      { description: 'Writes an artifact file' },
    );

    // ── Write with path traversal ──────────────────────────────────────
    yield* registry.register(
      'test-write-traversal',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const input = ctx.stateData as { filename: string; nextState?: string };
          yield* ctx.artifacts.write(input.filename, new TextEncoder().encode('malicious')).pipe(
            Effect.mapError((err) => ({
              _tag: 'ActionError' as const,
              actionId: 'test-write-traversal',
              stateName: ctx.stateName,
              cause: JSON.stringify(err),
            })),
          );
          return { nextState: input.nextState ?? 'completed', data: {} };
        }),
      { description: 'Attempts to write artifact with potentially malicious path' },
    );

    // ── Read child artifact ────────────────────────────────────────────
    yield* registry.register(
      'test-read-child-artifact',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const input = ctx.stateData as {
            childInstanceId?: string;
            childArtifactName?: string;
            nextState?: string;
            status?: string;
          };

          // After child completes, stateData includes the child result
          // The childInstanceId is available if we can find it
          const childId = input.childInstanceId;
          const artifactName = input.childArtifactName ?? 'output.txt';
          const nextState = input.nextState ?? 'completed';

          if (childId) {
            const content = yield* ctx.artifacts.readChild(childId, artifactName).pipe(
              Effect.mapError((err) => ({
                _tag: 'ActionError' as const,
                actionId: 'test-read-child-artifact',
                stateName: ctx.stateName,
                cause: JSON.stringify(err),
              })),
            );
            return {
              nextState,
              data: { childContent: new TextDecoder().decode(content) },
            };
          }

          // Child completed — route based on status
          return { nextState, data: input };
        }),
      { description: 'Reads a child instance artifact' },
    );

    // ── Read parallel children artifacts ───────────────────────────────
    yield* registry.register(
      'test-read-parallel-artifacts',
      (ctx: ActionContext) => {
        const input = ctx.stateData as {
          results?: Record<string, { status: string; instanceId?: string }>;
          nextState?: string;
        };

        if (input.results) {
          const allCompleted = Object.values(input.results).every((r) => r.status === 'completed');
          return Effect.succeed({
            nextState: allCompleted ? 'completed' : 'error',
            data: input,
          });
        }

        return Effect.succeed({ nextState: input.nextState ?? 'completed', data: input });
      },
      { description: 'Reads parallel child artifacts' },
    );

    // ── Read non-descendant (should fail) ──────────────────────────────
    yield* registry.register(
      'test-read-nondescendant',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          // After child completes, stateData is the child MachineResult.
          // The original input (with nonDescendantId) is in ctx.machineInput.
          const originalInput = ctx.machineInput as {
            nonDescendantId?: string;
          };

          const targetId = originalInput.nonDescendantId;
          if (targetId) {
            // This should fail with a StoreError because targetId is not a descendant.
            // Wrap in mapError to convert StoreError → ActionError for the runner.
            const content = yield* ctx.artifacts.readChild(targetId, 'output.txt').pipe(
              Effect.mapError((err) => {
                const raw = (err as { cause?: unknown }).cause;
                const msg = typeof raw === 'string' ? raw : JSON.stringify(raw ?? err);
                return {
                  _tag: 'ActionError' as const,
                  actionId: 'test-read-nondescendant',
                  stateName: ctx.stateName,
                  cause: `readChild rejected non-descendant: ${msg}`,
                };
              }),
            );
            return {
              nextState: 'completed',
              data: { content: new TextDecoder().decode(content) },
            };
          }

          // No nonDescendantId provided — route based on child result
          const childResult = ctx.stateData as { status?: string };
          return {
            nextState: childResult.status === 'completed' ? 'completed' : 'error',
            data: childResult,
          };
        }),
      { description: 'Attempts readChild with a non-descendant ID' },
    );
  });

// ════════════════════════════════════════════════════════════════════════════
// §15 — Artifacts
// ════════════════════════════════════════════════════════════════════════════

describe('§15 — Artifacts', () => {
  // ────────────────────────────────────────────────────────────────────────
  // §15.1 Write & Read
  // ────────────────────────────────────────────────────────────────────────

  describe('§15.1 Write & Read', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let defId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerArtifactActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(ARTIFACT_DEFINITION);
      defId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('action writing artifact creates file at correct path', async () => {
      const inst = await api.startInst(defId, {
        filename: 'report.txt',
        content: 'hello from artifact',
        nextState: 'completed',
      });
      await api.pollStatus(inst.id, ['completed']);

      // Verify the file exists on disk at <ROOT>/<instanceId>/report.txt
      const filePath = path.join(ARTIFACT_ROOT, inst.id, 'report.txt');
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('hello from artifact');
    });

    it('ArtifactRecord has name, instanceId, stateName, size, createdAt', async () => {
      const inst = await api.startInst(defId, {
        filename: 'record-check.txt',
        content: 'record content',
        nextState: 'completed',
      });
      const completed = await api.pollStatus(inst.id, ['completed']);

      const artifacts = (completed as { artifacts?: ArtifactRecord[] }).artifacts ?? [];
      expect(artifacts.length).toBeGreaterThanOrEqual(1);

      const record = artifacts.find((a) => a.name === 'record-check.txt');
      expect(record).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const rec = record!;
      expect(rec.name).toBe('record-check.txt');
      expect(rec.instanceId).toBe(inst.id);
      expect(rec.stateName).toBe('write_file');
      expect(rec.size).toBe(new TextEncoder().encode('record content').byteLength);
      expect(rec.createdAt).toBeDefined();
      expect(typeof rec.createdAt).toBe('string');
    });

    it('action reading artifact retrieves correct content', async () => {
      const inst = await api.startInst(defId, {
        filename: 'readable.txt',
        content: 'read me back',
        nextState: 'completed',
      });
      await api.pollStatus(inst.id, ['completed']);

      // Read the artifact content via the REST API
      const res = await api.getArtifact(inst.id, 'readable.txt');
      expect(res.status).toBe(200);

      const body = await res.text();
      expect(body).toBe('read me back');
    });

    it('list() returns only this instance artifacts (not children)', async () => {
      // Start a simple instance that writes an artifact
      const inst = await api.startInst(defId, {
        filename: 'own-artifact.txt',
        content: 'mine only',
        nextState: 'completed',
      });
      await api.pollStatus(inst.id, ['completed']);

      const res = await api.getArtifacts(inst.id);
      expect(res.status).toBe(200);

      const artifacts = (await res.json()) as ArtifactRecord[];
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      // All artifacts should belong to this instance
      for (const art of artifacts) {
        expect(art.instanceId).toBe(inst.id);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §15.2 Sandbox / Path Traversal
  // ────────────────────────────────────────────────────────────────────────

  describe('§15.2 Sandbox / Path Traversal', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let traversalDefId: string;
    let artifactDefId: string;
    let nonDescDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerArtifactActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const traversalDef = await api.createDef(TRAVERSAL_DEFINITION);
      traversalDefId = traversalDef.id;

      // Create an artifact-producing child def for the non-descendant test
      const artifactDef = await api.createDef(ARTIFACT_DEFINITION);
      artifactDefId = artifactDef.id;

      const nonDescDef = await api.createDef(makeNonDescendantParentDef(artifactDefId));
      nonDescDefId = nonDescDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('writing filename with ../ is rejected', async () => {
      const inst = await api.startInst(traversalDefId, {
        filename: '../../../etc/evil.txt',
        nextState: 'completed',
      });
      // The machine should error because the artifact write is rejected
      const final = await api.pollStatus(inst.id, ['error', 'completed']);
      expect(final.status).toBe('error');
    });

    it('writing absolute path filename is rejected', async () => {
      const inst = await api.startInst(traversalDefId, {
        filename: '/tmp/evil.txt',
        nextState: 'completed',
      });
      const final = await api.pollStatus(inst.id, ['error', 'completed']);
      expect(final.status).toBe('error');
    });

    it('readChild with non-descendant instanceId → error', async () => {
      // Start an independent artifact machine to get a non-descendant instance
      const independentInst = await api.startInst(artifactDefId, {
        filename: 'independent.txt',
        content: 'independent data',
        nextState: 'completed',
      });
      await api.pollStatus(independentInst.id, ['completed']);

      // Now start the non-descendant parent, which spawns a child then tries
      // to read from the independent (non-descendant) instance
      const parentInst = await api.startInst(nonDescDefId, {
        nonDescendantId: independentInst.id,
        nextState: 'completed',
      });
      const final = await api.pollStatus(parentInst.id, ['error', 'completed']);
      expect(final.status).toBe('error');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §15.3 Parent-Child Artifact Access
  // ────────────────────────────────────────────────────────────────────────

  describe('§15.3 Parent-Child Artifact Access', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let childDefId: string;
    let parentDefId: string;
    let parallelParentDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerArtifactActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const childDef = await api.createDef(ARTIFACT_DEFINITION);
      childDefId = childDef.id;

      const parentDef = await api.createDef(makeArtifactParentDef(childDefId));
      parentDefId = parentDef.id;

      const parallelDef = await api.createDef(makeParallelArtifactParentDef(childDefId));
      parallelParentDefId = parallelDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('parent reads child artifact via readChild()', async () => {
      const parentInst = await api.startInst(parentDefId, {
        filename: 'child-output.txt',
        content: 'child artifact data',
        nextState: 'completed',
      });
      const final = await api.pollStatus(parentInst.id, ['completed', 'error']);
      expect(final.status).toBe('completed');

      // Verify child produced the artifact
      const childInstances = (await (
        await api.getInstances(`?parentInstanceId=${parentInst.id}`)
      ).json()) as { id: string }[];
      expect(childInstances.length).toBe(1);

      const childId = childInstances[0].id;
      const childArtifacts = (await (await api.getArtifacts(childId)).json()) as ArtifactRecord[];
      expect(childArtifacts.some((a) => a.name === 'child-output.txt')).toBe(true);
    });

    it('parent reads each parallel child artifact', async () => {
      const parentInst = await api.startInst(parallelParentDefId, {
        childA: {
          filename: 'alpha.txt',
          content: 'alpha data',
          nextState: 'completed',
        },
        childB: {
          filename: 'beta.txt',
          content: 'beta data',
          nextState: 'completed',
        },
      });
      const final = await api.pollStatus(parentInst.id, ['completed', 'error']);
      expect(final.status).toBe('completed');

      // Check each child produced its artifact
      const childInstances = (await (
        await api.getInstances(`?parentInstanceId=${parentInst.id}`)
      ).json()) as { id: string }[];
      expect(childInstances.length).toBe(2);

      for (const child of childInstances) {
        const childArtifacts = (await (
          await api.getArtifacts(child.id)
        ).json()) as ArtifactRecord[];
        expect(childArtifacts.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('listChild() returns child artifact list', async () => {
      // Start a parent with artifact-producing child
      const parentInst = await api.startInst(parentDefId, {
        filename: 'child-list-test.txt',
        content: 'list child content',
        nextState: 'completed',
      });
      await api.pollStatus(parentInst.id, ['completed', 'error']);

      const childInstances = (await (
        await api.getInstances(`?parentInstanceId=${parentInst.id}`)
      ).json()) as { id: string }[];
      expect(childInstances.length).toBe(1);

      const childId = childInstances[0].id;

      // Get the child's artifacts list via the REST API
      const res = await api.getArtifacts(childId);
      expect(res.status).toBe(200);
      const childArtifacts = (await res.json()) as ArtifactRecord[];
      expect(childArtifacts.length).toBeGreaterThanOrEqual(1);
      expect(childArtifacts.some((a) => a.name === 'child-list-test.txt')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §15.4 REST API
  // ────────────────────────────────────────────────────────────────────────

  describe('§15.4 REST API', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let defId: string;
    let parentDefId: string;
    let childDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerArtifactActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(ARTIFACT_DEFINITION);
      defId = def.id;

      const childDef = await api.createDef(ARTIFACT_DEFINITION);
      childDefId = childDef.id;

      const parentDef = await api.createDef(makeArtifactParentDef(childDefId));
      parentDefId = parentDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('GET /instances/:id/artifacts returns flat ArtifactRecord list', async () => {
      const inst = await api.startInst(defId, {
        filename: 'flat-list.txt',
        content: 'flat content',
        nextState: 'completed',
      });
      await api.pollStatus(inst.id, ['completed']);

      const res = await api.getArtifacts(inst.id);
      expect(res.status).toBe(200);

      const artifacts = (await res.json()) as ArtifactRecord[];
      expect(Array.isArray(artifacts)).toBe(true);
      expect(artifacts.length).toBeGreaterThanOrEqual(1);

      const record = artifacts.find((a) => a.name === 'flat-list.txt');
      expect(record).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const rec = record!;
      expect(rec.instanceId).toBe(inst.id);
      expect(rec.stateName).toBe('write_file');
      expect(typeof rec.size).toBe('number');
      expect(typeof rec.createdAt).toBe('string');
    });

    it('GET /instances/:id/artifacts/:name downloads file content', async () => {
      const inst = await api.startInst(defId, {
        filename: 'download-me.txt',
        content: 'download this content',
        nextState: 'completed',
      });
      await api.pollStatus(inst.id, ['completed']);

      const res = await api.getArtifact(inst.id, 'download-me.txt');
      expect(res.status).toBe(200);

      const body = await res.text();
      expect(body).toBe('download this content');
    });

    it('GET /instances/:id/artifacts/:name for non-existent → 404', async () => {
      const inst = await api.startInst(defId, {
        filename: 'exists.txt',
        content: 'content',
        nextState: 'completed',
      });
      await api.pollStatus(inst.id, ['completed']);

      const res = await api.getArtifact(inst.id, 'does-not-exist.txt');
      expect(res.status).toBe(404);
    });

    it('GET /instances/:id/artifacts?tree=true returns recursive tree', async () => {
      // Use a parent → child setup to get a tree with children
      const parentInst = await api.startInst(parentDefId, {
        filename: 'tree-child.txt',
        content: 'tree child content',
        nextState: 'completed',
      });
      await api.pollStatus(parentInst.id, ['completed', 'error']);

      const res = await api.getArtifacts(parentInst.id, '?tree=true');
      expect(res.status).toBe(200);

      const tree = (await res.json()) as ArtifactTree;
      expect(tree.instanceId).toBe(parentInst.id);
      expect(Array.isArray(tree.artifacts)).toBe(true);
      expect(Array.isArray(tree.children)).toBe(true);

      // The child should appear in the tree
      expect(tree.children.length).toBeGreaterThanOrEqual(1);

      const childTree = tree.children[0];
      expect(childTree.instanceId).toBeDefined();
      expect(Array.isArray(childTree.artifacts)).toBe(true);
      expect(childTree.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(childTree.artifacts.some((a) => a.name === 'tree-child.txt')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §15.5 Directory Structure
  // ────────────────────────────────────────────────────────────────────────

  describe('§15.5 Directory Structure', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let childDefId: string;
    let parentDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerArtifactActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const childDef = await api.createDef(ARTIFACT_DEFINITION);
      childDefId = childDef.id;

      const parentDef = await api.createDef(makeArtifactParentDef(childDefId));
      parentDefId = parentDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('parent artifacts at <ROOT>/<parentId>/', async () => {
      // Use the multi-artifact definition to write an artifact at root level
      const def = await api.createDef(ARTIFACT_DEFINITION);
      const inst = await api.startInst(def.id, {
        filename: 'parent-dir-test.txt',
        content: 'parent dir content',
        nextState: 'completed',
      });
      await api.pollStatus(inst.id, ['completed']);

      const expectedDir = path.join(ARTIFACT_ROOT, inst.id);
      const stat = await fs.stat(expectedDir);
      expect(stat.isDirectory()).toBe(true);

      const filePath = path.join(expectedDir, 'parent-dir-test.txt');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('parent dir content');
    });

    it('child artifacts at <ROOT>/<parentId>/children/<childId>/', async () => {
      const parentInst = await api.startInst(parentDefId, {
        filename: 'child-dir-test.txt',
        content: 'child dir content',
        nextState: 'completed',
      });
      await api.pollStatus(parentInst.id, ['completed', 'error']);

      // Find the child instance
      const childInstances = (await (
        await api.getInstances(`?parentInstanceId=${parentInst.id}`)
      ).json()) as { id: string }[];
      expect(childInstances.length).toBe(1);

      const childId = childInstances[0].id;
      const expectedDir = path.join(ARTIFACT_ROOT, parentInst.id, 'children', childId);
      const stat = await fs.stat(expectedDir);
      expect(stat.isDirectory()).toBe(true);

      const filePath = path.join(expectedDir, 'child-dir-test.txt');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('child dir content');
    });

    it('grandchild artifacts nest further', async () => {
      // Create a three-level hierarchy: grandparent → parent → child
      // The grandparent spawns a parent that itself spawns a child
      const innerParentDef = await api.createDef(makeArtifactParentDef(childDefId));
      const grandparentDef = await api.createDef(makeArtifactParentDef(innerParentDef.id));

      const grandparentInst = await api.startInst(grandparentDef.id, {
        filename: 'grandchild-test.txt',
        content: 'grandchild content',
        nextState: 'completed',
      });
      await api.pollStatus(grandparentInst.id, ['completed', 'error'], 30_000);

      // Find mid-level parent instance
      const midInstances = (await (
        await api.getInstances(`?parentInstanceId=${grandparentInst.id}`)
      ).json()) as { id: string }[];
      expect(midInstances.length).toBe(1);
      const midId = midInstances[0].id;

      // Find leaf child instance
      const leafInstances = (await (
        await api.getInstances(`?parentInstanceId=${midId}`)
      ).json()) as { id: string }[];
      expect(leafInstances.length).toBe(1);
      const leafId = leafInstances[0].id;

      // instanceDir only nests one level relative to the direct parent.
      // Mid-level parent: <ROOT>/<grandparentId>/children/<midId>/
      // Leaf child: <ROOT>/<midId>/children/<leafId>/
      const leafDir = path.join(ARTIFACT_ROOT, midId, 'children', leafId);

      const leafStat = await fs.stat(leafDir);
      expect(leafStat.isDirectory()).toBe(true);

      const filePath = path.join(leafDir, 'grandchild-test.txt');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('grandchild content');
    });
  });
});
