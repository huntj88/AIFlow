/**
 * E2E: Workspace Root, Instance Payload, Inheritance & Artifact Removal (Task 16).
 *
 * Validates behaviors from:
 * - §4.4  — Workspace root validation
 * - §15.5 — Instance payload includes workspace fields
 * - §8.5  — Child workspace inheritance
 * - §9.6  — Parallel children workspace inheritance
 * - §15.6 — Removed artifact endpoints return 404
 * - §16   — CLI Helper via action context
 *
 * @module
 */

import { Effect } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionRegistry } from '@/machines/ActionRegistry.js';
import type { ActionContext, MachineResult } from '@/machines/types.js';
import {
  type ApiHelpers,
  createTestWorkspace,
  makeApiHelpers,
  removeTestWorkspace,
} from './helpers/api-helpers.js';
import { SIMPLE_DEFINITION, SIMPLE_INPUT } from './helpers/fixtures.js';
import { makeTestHandler } from './helpers/test-handler.js';

// ────────────────────────────────────────────────────────────────────────────
// Custom Test Actions
// ────────────────────────────────────────────────────────────────────────────

/** Routes child/parallel results to completed/error */
const registerForwardAction = (registry: ActionRegistry) =>
  Effect.gen(function* () {
    yield* registry.register(
      'test-forward-result',
      (ctx: ActionContext) => {
        const stateData = ctx.stateData as Record<string, unknown> | undefined;

        // For parallel children results
        if (stateData && 'results' in stateData) {
          const results = stateData.results as Record<string, MachineResult>;
          const allCompleted = Object.values(results).every((r) => r.status === 'completed');
          return Effect.succeed({
            nextState: allCompleted ? 'completed' : 'error',
            data: stateData,
          });
        }

        // For single child result
        if (stateData && 'status' in stateData) {
          return Effect.succeed({
            nextState: stateData.status === 'completed' ? 'completed' : 'error',
            data: stateData,
          });
        }

        return Effect.succeed({ nextState: 'completed', data: stateData });
      },
      { description: 'Forwards child/parallel result to next state' },
    );
  });

/** CLI test actions */
const registerCliTestActions = (registry: ActionRegistry) =>
  Effect.gen(function* () {
    /** Runs a CLI command and returns the result as stateData */
    yield* registry.register(
      'cli-exec-echo',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({ command: 'echo', args: ['hello-from-cli'] });
          return {
            nextState: 'completed',
            data: {
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              transcript: result.transcript,
            },
          };
        }),
      { description: 'E2E: exec echo via CLI helper' },
    );

    /** Runs `pwd` via CLI to verify cwd is workspace root */
    yield* registry.register(
      'cli-exec-pwd',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({ command: 'pwd' });
          return {
            nextState: 'completed',
            data: {
              exitCode: result.exitCode,
              stdout: result.stdout.trim(),
            },
          };
        }),
      { description: 'E2E: exec pwd via CLI helper' },
    );

    /** Reads WORKSPACE_ROOT env var */
    yield* registry.register(
      'cli-exec-workspace-env',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({
            command: 'bash',
            args: ['-c', 'echo $WORKSPACE_ROOT'],
          });
          return {
            nextState: 'completed',
            data: {
              exitCode: result.exitCode,
              stdout: result.stdout.trim(),
            },
          };
        }),
      { description: 'E2E: read WORKSPACE_ROOT env via CLI helper' },
    );

    /** Reads ARTIFACTS_ROOT env var */
    yield* registry.register(
      'cli-exec-artifacts-env',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({
            command: 'bash',
            args: ['-c', 'echo $ARTIFACTS_ROOT'],
          });
          return {
            nextState: 'completed',
            data: {
              exitCode: result.exitCode,
              stdout: result.stdout.trim(),
            },
          };
        }),
      { description: 'E2E: read ARTIFACTS_ROOT env via CLI helper' },
    );

    /** Runs a failing command and branches on exit code */
    yield* registry.register(
      'cli-exec-failing',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({ command: 'bash', args: ['-c', 'exit 42'] });
          return {
            nextState: result.exitCode === 0 ? 'completed' : 'error',
            data: {
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            },
          };
        }),
      { description: 'E2E: exec failing command via CLI helper' },
    );
  });

// ────────────────────────────────────────────────────────────────────────────
// Local Fixtures
// ────────────────────────────────────────────────────────────────────────────

/** Machine using the cli-exec-echo action */
const makeCliDefinition = (actionId: string) => ({
  name: `E2E CLI Machine (${actionId})`,
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'run_cli',
  states: {
    run_cli: { name: 'run_cli', type: 'action' as const, actionId },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'run_cli', to: 'completed' },
    { from: 'run_cli', to: 'error' },
  ],
  metadata: { description: `CLI test machine (${actionId})`, tags: ['e2e'] },
});

/** Simple child definition: log → completed */
const WS_CHILD_DEFINITION = {
  name: 'E2E WS Child',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'child_start',
  states: {
    child_start: { name: 'child_start', type: 'action' as const, actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'child_start', to: 'completed' }],
  metadata: { description: 'Simple child for workspace tests', tags: ['e2e'] },
};

/** Parent definition: spawn child → forward result → completed */
const makeWsParentDefinition = (childDefId: string) => ({
  name: 'E2E WS Parent',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_child',
  states: {
    spawn_child: {
      name: 'spawn_child',
      type: 'child_machine' as const,
      actionId: 'test-forward-result',
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
  metadata: { description: 'Parent for workspace inheritance tests', tags: ['e2e'] },
});

/** Parallel parent: spawn two children → forward result → completed */
const makeWsParallelDefinition = (childDefId1: string, childDefId2: string) => ({
  name: 'E2E WS Parallel Parent',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_parallel',
  states: {
    spawn_parallel: {
      name: 'spawn_parallel',
      type: 'parallel_children' as const,
      actionId: 'test-forward-result',
      children: [
        { key: 'child_a', machineDefId: childDefId1, inputMapping: '$.machineInput' },
        { key: 'child_b', machineDefId: childDefId2, inputMapping: '$.machineInput' },
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
  metadata: { description: 'Parallel parent for workspace inheritance tests', tags: ['e2e'] },
});

// ════════════════════════════════════════════════════════════════════════════
// §4.4 — Workspace Root Validation
// ════════════════════════════════════════════════════════════════════════════

describe('§4.4 — Workspace Root Validation', () => {
  let api: ApiHelpers;
  let cleanup: () => Promise<void>;
  let defId: string;
  let testWorkspaceRoot: string;

  beforeAll(async () => {
    testWorkspaceRoot = await createTestWorkspace();
    const { handler, runtime } = await makeTestHandler();
    // Deliberately NOT passing defaultWorkspaceRoot so we can control it per request
    api = makeApiHelpers(handler);
    cleanup = () => runtime.dispose().then(() => undefined);

    const def = await api.createDef(SIMPLE_DEFINITION);
    defId = def.id;
  });

  afterAll(async () => {
    await cleanup();
    await removeTestWorkspace(testWorkspaceRoot);
  });

  it('returns 400 when workspaceRoot is missing', async () => {
    const res = await api.postInstance({
      definitionId: defId,
      input: SIMPLE_INPUT,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for relative workspaceRoot', async () => {
    const res = await api.postInstance({
      definitionId: defId,
      input: SIMPLE_INPUT,
      workspaceRoot: './relative/path',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-existent workspaceRoot', async () => {
    const res = await api.postInstance({
      definitionId: defId,
      input: SIMPLE_INPUT,
      workspaceRoot: '/nonexistent/path/abc123',
    });
    expect(res.status).toBe(400);
  });

  it('succeeds with valid absolute workspaceRoot', async () => {
    const res = await api.postInstance({
      definitionId: defId,
      input: SIMPLE_INPUT,
      workspaceRoot: testWorkspaceRoot,
    });
    expect(res.status).toBe(201);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §15.5 — Instance Payload
// ════════════════════════════════════════════════════════════════════════════

describe('§15.5 — Instance Payload', () => {
  let api: ApiHelpers;
  let cleanup: () => Promise<void>;
  let defId: string;
  let testWorkspaceRoot: string;

  beforeAll(async () => {
    testWorkspaceRoot = await createTestWorkspace();
    const { handler, runtime } = await makeTestHandler();
    api = makeApiHelpers(handler, testWorkspaceRoot);
    cleanup = () => runtime.dispose().then(() => undefined);

    const def = await api.createDef(SIMPLE_DEFINITION);
    defId = def.id;
  });

  afterAll(async () => {
    await cleanup();
    await removeTestWorkspace(testWorkspaceRoot);
  });

  it('includes workspaceRoot in instance response', async () => {
    const inst = await api.startInst(defId, SIMPLE_INPUT);
    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as { workspaceRoot: string };
    expect(data.workspaceRoot).toBe(testWorkspaceRoot);
  });

  it('includes familyRootInstanceId equal to own id for root instance', async () => {
    const inst = await api.startInst(defId, SIMPLE_INPUT);
    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as { id: string; familyRootInstanceId: string };
    expect(data.familyRootInstanceId).toBe(data.id);
  });

  it('includes artifactsPath pointing to family root', async () => {
    const inst = await api.startInst(defId, SIMPLE_INPUT);
    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as { familyRootInstanceId: string; artifactsPath: string };
    expect(data.artifactsPath).toContain(data.familyRootInstanceId);
  });

  it('does NOT include artifacts array', async () => {
    const inst = await api.startInst(defId, SIMPLE_INPUT);
    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).not.toHaveProperty('artifacts');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §8.5 — Child Workspace Inheritance
// ════════════════════════════════════════════════════════════════════════════

describe('§8.5 — Child Workspace Inheritance', () => {
  let api: ApiHelpers;
  let cleanup: () => Promise<void>;
  let parentDefId: string;
  let testWorkspaceRoot: string;

  beforeAll(async () => {
    testWorkspaceRoot = await createTestWorkspace();
    const { handler, runtime } = await makeTestHandler({
      registerActions: registerForwardAction,
    });
    api = makeApiHelpers(handler, testWorkspaceRoot);
    cleanup = () => runtime.dispose().then(() => undefined);

    const childDef = await api.createDef(WS_CHILD_DEFINITION);
    const parentDef = await api.createDef(makeWsParentDefinition(childDef.id));
    parentDefId = parentDef.id;
  });

  afterAll(async () => {
    await cleanup();
    await removeTestWorkspace(testWorkspaceRoot);
  });

  it('child inherits parent workspaceRoot', async () => {
    const parent = await api.startInst(parentDefId, {
      message: 'child inherit test',
      nextState: 'completed',
    });
    await api.pollStatus(parent.id, ['completed', 'waiting_for_child'], 10_000);

    // Find child
    const childrenRes = await api.getInstances(`?parentInstanceId=${parent.id}`);
    const children = (await childrenRes.json()) as { id: string }[];
    expect(children.length).toBeGreaterThanOrEqual(1);
    const childId = children[0].id;

    const childRes = await api.getInstance(childId);
    const child = (await childRes.json()) as { workspaceRoot: string };
    expect(child.workspaceRoot).toBe(testWorkspaceRoot);
  });

  it('child inherits familyRootInstanceId from root parent', async () => {
    const parent = await api.startInst(parentDefId, {
      message: 'family root test',
      nextState: 'completed',
    });
    await api.pollStatus(parent.id, ['completed', 'waiting_for_child'], 10_000);

    const childrenRes = await api.getInstances(`?parentInstanceId=${parent.id}`);
    const children = (await childrenRes.json()) as { id: string }[];
    expect(children.length).toBeGreaterThanOrEqual(1);
    const childId = children[0].id;

    const childRes = await api.getInstance(childId);
    const child = (await childRes.json()) as { familyRootInstanceId: string };
    expect(child.familyRootInstanceId).toBe(parent.id);
  });

  it('child artifactsPath matches parent', async () => {
    const parent = await api.startInst(parentDefId, {
      message: 'artifacts path test',
      nextState: 'completed',
    });
    await api.pollStatus(parent.id, ['completed', 'waiting_for_child'], 10_000);

    const parentRes = await api.getInstance(parent.id);
    const parentData = (await parentRes.json()) as { artifactsPath: string };

    const childrenRes = await api.getInstances(`?parentInstanceId=${parent.id}`);
    const children = (await childrenRes.json()) as { id: string }[];
    const childId = children[0].id;

    const childRes = await api.getInstance(childId);
    const childData = (await childRes.json()) as { artifactsPath: string };
    expect(childData.artifactsPath).toBe(parentData.artifactsPath);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §9.6 — Parallel Children Workspace Inheritance
// ════════════════════════════════════════════════════════════════════════════

describe('§9.6 — Parallel Children Workspace Inheritance', () => {
  let api: ApiHelpers;
  let cleanup: () => Promise<void>;
  let parallelParentDefId: string;
  let testWorkspaceRoot: string;

  beforeAll(async () => {
    testWorkspaceRoot = await createTestWorkspace();
    const { handler, runtime } = await makeTestHandler({
      registerActions: registerForwardAction,
    });
    api = makeApiHelpers(handler, testWorkspaceRoot);
    cleanup = () => runtime.dispose().then(() => undefined);

    const child1 = await api.createDef(WS_CHILD_DEFINITION);
    const child2 = await api.createDef(WS_CHILD_DEFINITION);
    const parallelDef = await api.createDef(makeWsParallelDefinition(child1.id, child2.id));
    parallelParentDefId = parallelDef.id;
  });

  afterAll(async () => {
    await cleanup();
    await removeTestWorkspace(testWorkspaceRoot);
  });

  it('all parallel children inherit workspaceRoot and familyRootInstanceId', async () => {
    const parent = await api.startInst(parallelParentDefId, {
      message: 'parallel inherit test',
      nextState: 'completed',
    });
    await api.pollStatus(parent.id, ['completed', 'waiting_for_child'], 10_000);

    const childrenRes = await api.getInstances(`?parentInstanceId=${parent.id}`);
    const children = (await childrenRes.json()) as {
      id: string;
      workspaceRoot: string;
      familyRootInstanceId: string;
      artifactsPath: string;
    }[];
    expect(children.length).toBe(2);

    const parentRes = await api.getInstance(parent.id);
    const parentData = (await parentRes.json()) as { artifactsPath: string };

    for (const child of children) {
      expect(child.workspaceRoot).toBe(testWorkspaceRoot);
      expect(child.familyRootInstanceId).toBe(parent.id);
      expect(child.artifactsPath).toBe(parentData.artifactsPath);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §15.6 — Removed Artifact Endpoints
// ════════════════════════════════════════════════════════════════════════════

describe('§15.6 — Removed Artifact Endpoints', () => {
  let api: ApiHelpers;
  let cleanup: () => Promise<void>;
  let instanceId: string;
  let testWorkspaceRoot: string;

  beforeAll(async () => {
    testWorkspaceRoot = await createTestWorkspace();
    const { handler, runtime } = await makeTestHandler();
    api = makeApiHelpers(handler, testWorkspaceRoot);
    cleanup = () => runtime.dispose().then(() => undefined);

    const def = await api.createDef(SIMPLE_DEFINITION);
    const inst = await api.startInst(def.id, SIMPLE_INPUT);
    await api.pollStatus(inst.id, ['completed'], 5_000);
    instanceId = inst.id;
  });

  afterAll(async () => {
    await cleanup();
    await removeTestWorkspace(testWorkspaceRoot);
  });

  it('GET /instances/:id/artifacts returns 404', async () => {
    const res = await api.getInstance(`${instanceId}/artifacts`);
    expect(res.status).toBe(404);
  });

  it('GET /instances/:id/artifacts/:name returns 404', async () => {
    const res = await api.getInstance(`${instanceId}/artifacts/test.txt`);
    expect(res.status).toBe(404);
  });

  it('GET /instances/:id/artifacts?tree=true returns 404', async () => {
    const res = await api.getInstance(`${instanceId}/artifacts?tree=true`);
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §16 — CLI Helper via Action Context
// ════════════════════════════════════════════════════════════════════════════

describe('§16 — CLI Helper via Action', () => {
  let api: ApiHelpers;
  let cleanup: () => Promise<void>;
  let testWorkspaceRoot: string;

  beforeAll(async () => {
    testWorkspaceRoot = await createTestWorkspace();
    const { handler, runtime } = await makeTestHandler({
      registerActions: (registry) =>
        Effect.gen(function* () {
          yield* registerForwardAction(registry);
          yield* registerCliTestActions(registry);
        }),
    });
    api = makeApiHelpers(handler, testWorkspaceRoot);
    cleanup = () => runtime.dispose().then(() => undefined);
  });

  afterAll(async () => {
    await cleanup();
    await removeTestWorkspace(testWorkspaceRoot);
  });

  it('action can exec a command and return stdout', async () => {
    const def = await api.createDef(makeCliDefinition('cli-exec-echo'));
    const inst = await api.startInst(def.id, {});
    const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);

    expect(final.status).toBe('completed');

    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as { stateData: { stdout: string; exitCode: number } };
    expect(data.stateData.exitCode).toBe(0);
    expect(data.stateData.stdout).toContain('hello-from-cli');
  });

  it('action can branch on exit code', async () => {
    const def = await api.createDef(makeCliDefinition('cli-exec-failing'));
    const inst = await api.startInst(def.id, {});
    const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);

    // The action returns 'error' nextState when exitCode !== 0
    expect(final.status).toBe('error');
    expect(final.currentState).toBe('error');
  });

  it('CLI default cwd is workspace root', async () => {
    const def = await api.createDef(makeCliDefinition('cli-exec-pwd'));
    const inst = await api.startInst(def.id, {});
    const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);

    expect(final.status).toBe('completed');

    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as { stateData: { stdout: string } };
    expect(data.stateData.stdout).toBe(testWorkspaceRoot);
  });

  it('WORKSPACE_ROOT env var is set', async () => {
    const def = await api.createDef(makeCliDefinition('cli-exec-workspace-env'));
    const inst = await api.startInst(def.id, {});
    const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);

    expect(final.status).toBe('completed');

    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as { stateData: { stdout: string } };
    expect(data.stateData.stdout).toBe(testWorkspaceRoot);
  });

  it('ARTIFACTS_ROOT env var is set', async () => {
    const def = await api.createDef(makeCliDefinition('cli-exec-artifacts-env'));
    const inst = await api.startInst(def.id, {});
    const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);

    expect(final.status).toBe('completed');

    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as {
      stateData: { stdout: string };
      artifactsPath: string;
    };
    // ARTIFACTS_ROOT should match the instance's artifactsPath
    expect(data.stateData.stdout).toBe(data.artifactsPath);
  });

  it('capture enabled writes transcript and returns metadata', async () => {
    const def = await api.createDef(makeCliDefinition('cli-exec-echo'));
    const res = await api.postInstance({
      definitionId: def.id,
      input: {},
      workspaceRoot: testWorkspaceRoot,
      runtimeOptions: {
        cliDirectoryPolicy: {
          workspaceDirs: [testWorkspaceRoot],
        },
        cliOutputCapture: {
          enabled: true,
        },
      },
    });
    expect(res.status).toBe(201);
    const inst = (await res.json()) as { id: string };

    const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);
    expect(final.status).toBe('completed');

    const instanceRes = await api.getInstance(inst.id);
    const data = (await instanceRes.json()) as {
      artifactsPath: string;
      stateData: {
        transcript?: { path: string; resolvedPath: string; label: string };
      };
    };

    expect(data.stateData.transcript?.path).toBe('run_cli/001-echo.txt');
    expect(data.stateData.transcript?.label).toBe('echo');
    expect(data.stateData.transcript?.resolvedPath).toBe(
      path.join(data.artifactsPath, 'run_cli/001-echo.txt'),
    );
    expect(fs.existsSync(path.join(data.artifactsPath, 'run_cli/001-echo.txt'))).toBe(true);
  });

  it('child instance transcript path includes children/<childInstanceId> lineage', async () => {
    const childDef = await api.createDef(makeCliDefinition('cli-exec-echo'));
    const parentDef = await api.createDef(makeWsParentDefinition(childDef.id));

    const res = await api.postInstance({
      definitionId: parentDef.id,
      input: {},
      workspaceRoot: testWorkspaceRoot,
      runtimeOptions: {
        cliDirectoryPolicy: {
          workspaceDirs: [testWorkspaceRoot],
        },
        cliOutputCapture: {
          enabled: true,
        },
      },
    });
    expect(res.status).toBe(201);
    const parentStart = (await res.json()) as { id: string };

    const parent = await api.pollStatus(parentStart.id, ['completed', 'error'], 15_000);
    expect(parent.status).toBe('completed');

    const parentRes = await api.getInstance(parentStart.id);
    const parentData = (await parentRes.json()) as { id: string; artifactsPath: string };

    const childrenRes = await api.getInstances(`?parentInstanceId=${parentData.id}`);
    const children = (await childrenRes.json()) as { id: string }[];
    expect(children.length).toBeGreaterThanOrEqual(1);

    const childTranscript = path.join(
      parentData.artifactsPath,
      `children/${children[0].id}/run_cli/001-echo.txt`,
    );
    expect(fs.existsSync(childTranscript)).toBe(true);
  });
});
