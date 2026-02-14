import { Effect } from 'effect';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionRegistry } from '@/machines/ActionRegistry.js';
import type { ActionContext } from '@/machines/types.js';

import {
  type ApiHelpers,
  createTestWorkspace,
  makeApiHelpers,
  removeTestWorkspace,
} from './helpers/api-helpers.js';
import { makeTestHandler } from './helpers/test-handler.js';

const makeRuntimeOptions = (workspaceRoot: string, captureEnabled: boolean) => ({
  cliDirectoryPolicy: {
    workspaceDirs: [workspaceRoot],
  },
  cliOutputCapture: {
    enabled: captureEnabled,
  },
});

const buildSingleCopilotDefinition = (name: string) => ({
  name,
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'runCopilot',
  states: {
    runCopilot: { name: 'runCopilot', type: 'action' as const, actionId: 'copilot-cli-prompt' },
    handleExecError: {
      name: 'handleExecError',
      type: 'action' as const,
      actionId: 'handle-copilot-exec-error',
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'runCopilot', to: 'completed' },
    { from: 'runCopilot', to: 'handleExecError' },
    { from: 'runCopilot', to: 'error' },
    { from: 'handleExecError', to: 'completed' },
    { from: 'handleExecError', to: 'error' },
  ],
  metadata: { description: 'Copilot prompt e2e', tags: ['e2e', 'copilot'] },
});

const buildChainedCopilotDefinition = (name: string) => ({
  name,
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'runInitial',
  states: {
    runInitial: { name: 'runInitial', type: 'action' as const, actionId: 'copilot-cli-prompt' },
    buildFollowup: {
      name: 'buildFollowup',
      type: 'action' as const,
      actionId: 'build-followup-input',
    },
    runFollowup: {
      name: 'runFollowup',
      type: 'action' as const,
      actionId: 'copilot-cli-prompt',
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'runInitial', to: 'buildFollowup' },
    { from: 'runInitial', to: 'error' },
    { from: 'buildFollowup', to: 'runFollowup' },
    { from: 'buildFollowup', to: 'error' },
    { from: 'runFollowup', to: 'completed' },
    { from: 'runFollowup', to: 'error' },
  ],
  metadata: { description: 'Copilot chained conversation e2e', tags: ['e2e', 'copilot'] },
});

function registerCopilotWorkflowTestActions(registry: ActionRegistry): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* registry.register(
      'build-followup-input',
      (ctx: ActionContext) => {
        const previous = (ctx.stateData ?? {}) as { conversationId?: unknown };
        const conversationId =
          typeof previous.conversationId === 'string' ? previous.conversationId : undefined;

        return Effect.succeed({
          nextState: 'runFollowup',
          data: {
            prompt: 'SCENARIO:CHAIN follow-up task',
            conversationId,
            successState: 'completed',
            execErrorState: 'error',
          },
        });
      },
      { description: 'Build follow-up copilot input from previous conversationId' },
    );
  });
}

const FAKE_COPILOT_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const argv = process.argv.slice(2);

const valueAfter = (flag) => {
  const idx = argv.indexOf(flag);
  if (idx < 0) return undefined;
  return argv[idx + 1];
};

const prompt = valueAfter('--prompt') || '';
const model = valueAfter('--model') || '';
const conversationIdArg = valueAfter('--resume') || valueAfter('--conversation-id');

const dbPath = process.env.COPILOT_FAKE_DB || path.join(os.tmpdir(), 'aiflow-fake-copilot-db.json');

const readDb = () => {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return { nextId: 1, conversations: {} };
  }
};

const writeDb = (db) => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db), 'utf8');
};

const extractScenario = (text) => {
  const m = /SCENARIO:([A-Z_]+)/.exec(text);
  return m ? m[1] : 'DEFAULT_OK';
};

const strictJsonPrompt = prompt.includes('Return STRICT JSON only');
const repairPrompt = prompt.includes('Reformat ONLY the previous response as STRICT JSON');

const expectModel = strictJsonPrompt || repairPrompt ? 'gpt-5.1-codex-mini' : 'gpt-5.3-codex';
if (model !== expectModel) {
  process.stderr.write('unexpected model: expected ' + expectModel + ', got ' + model);
  process.exit(64);
}

const printResultJson = (json) => {
  process.stdout.write(JSON.stringify(json));
};

const db = readDb();

if (!conversationIdArg) {
  const scenario = extractScenario(prompt);
  const conversationId = 'conv-' + String(db.nextId++);
  db.conversations[conversationId] = { scenario, resultCalls: 0 };
  writeDb(db);
  process.stdout.write('Conversation ID: ' + conversationId);
  process.exit(0);
}

if (!db.conversations[conversationIdArg]) {
  db.conversations[conversationIdArg] = {
    scenario: strictJsonPrompt || repairPrompt ? 'DEFAULT_OK' : extractScenario(prompt),
    resultCalls: 0,
  };
}
const conv = db.conversations[conversationIdArg];

if (strictJsonPrompt || repairPrompt) {
  conv.resultCalls += 1;
  db.conversations[conversationIdArg] = conv;
  writeDb(db);

  if (conv.scenario === 'INVALID_FINAL') {
    process.stdout.write('not-json-' + String(conv.resultCalls));
    process.exit(0);
  }

  if (conv.scenario === 'RETRY_THEN_SUCCESS' && conv.resultCalls === 1) {
    process.stdout.write('{ invalid-json');
    process.exit(0);
  }

  if (conv.scenario === 'STATUS_ERROR') {
    printResultJson({
      schemaVersion: 'copilot-action-result.v1',
      status: 'error',
      summary: 'structured error payload',
      data: { detail: 'schema-valid' },
      filePaths: [
        { workspace: 'workspace', path: 'helloWorld.md' },
        { workspace: 'workspace', path: '../outside.md' }
      ],
      diagnostics: { exitCode: 2, durationMs: 12 }
    });
    process.exit(0);
  }

  if (conv.scenario === 'CHAIN') {
    const phase = conv.resultCalls === 1 ? 'initial' : 'followup';
    printResultJson({
      schemaVersion: 'copilot-action-result.v1',
      status: 'ok',
      summary: 'chain-' + phase,
      data: { phase },
      filePaths: [],
      diagnostics: { exitCode: 0, durationMs: 8 }
    });
    process.exit(0);
  }

  printResultJson({
    schemaVersion: 'copilot-action-result.v1',
    status: 'ok',
    summary: 'ok',
    data: { resultCalls: conv.resultCalls },
    filePaths: [],
    diagnostics: { exitCode: 0, durationMs: 6 }
  });
  process.exit(0);
}

process.stdout.write('Resumed conversation ' + conversationIdArg);
writeDb(db);
process.exit(0);
`;

describe('copilot-cli-prompt workflow e2e', () => {
  let api: ApiHelpers;
  let cleanup: () => Promise<void>;
  let testWorkspaceRoot: string;
  let fakeBinDir: string;
  let originalPath: string | undefined;
  let originalFakeDb: string | undefined;

  beforeAll(async () => {
    testWorkspaceRoot = await createTestWorkspace();
    fakeBinDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aiflow-fake-copilot-bin-'));
    const fakeCopilotPath = path.join(fakeBinDir, 'copilot');

    await fsp.writeFile(fakeCopilotPath, FAKE_COPILOT_SCRIPT, 'utf-8');
    await fsp.chmod(fakeCopilotPath, 0o755);

    originalPath = process.env.PATH;
    originalFakeDb = process.env.COPILOT_FAKE_DB;
    process.env.PATH = `${fakeBinDir}:${process.env.PATH ?? ''}`;
    process.env.COPILOT_FAKE_DB = path.join(fakeBinDir, 'copilot-db.json');

    const { handler, runtime } = await makeTestHandler({
      registerActions: (registry) =>
        Effect.gen(function* () {
          yield* registerCopilotWorkflowTestActions(registry);
        }),
    });

    api = makeApiHelpers(handler, testWorkspaceRoot);
    cleanup = () => runtime.dispose().then(() => undefined);
  });

  afterAll(async () => {
    await cleanup();
    await removeTestWorkspace(testWorkspaceRoot);
    await fsp.rm(fakeBinDir, { recursive: true, force: true });

    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }

    if (originalFakeDb === undefined) {
      delete process.env.COPILOT_FAKE_DB;
    } else {
      process.env.COPILOT_FAKE_DB = originalFakeDb;
    }
  });

  it('routes schema-valid status:error to success and returns capture metadata references', async () => {
    const def = await api.createDef(buildSingleCopilotDefinition('copilot-status-error-e2e'));

    const startRes = await api.postInstance({
      definitionId: def.id,
      input: {
        prompt: 'SCENARIO:STATUS_ERROR create helloWorld.md',
        successState: 'completed',
        execErrorState: 'error',
      },
      workspaceRoot: testWorkspaceRoot,
      runtimeOptions: makeRuntimeOptions(testWorkspaceRoot, true),
    });

    expect(startRes.status).toBe(201);
    const startBody = (await startRes.json()) as { id: string };

    const final = await api.pollStatus(startBody.id, ['completed', 'error'], 15_000);
    expect(final.status).toBe('completed');

    const instanceRes = await api.getInstance(startBody.id);
    const instance = (await instanceRes.json()) as {
      stateData: {
        copilotResult: { status: 'ok' | 'error' };
        commandOutputFiles: { path: string; resolvedPath: string; label: string }[];
        filePathWarnings: { path: string; message: string }[];
      };
    };

    expect(instance.stateData.copilotResult.status).toBe('error');
    expect(instance.stateData.filePathWarnings).toHaveLength(1);
    expect(instance.stateData.filePathWarnings[0]?.path).toBe('../outside.md');

    expect(instance.stateData.commandOutputFiles).toHaveLength(2);
    for (const ref of instance.stateData.commandOutputFiles) {
      expect(ref.label).toBe('copilot');
      expect(ref.path.startsWith('runCopilot/001-copilot')).toBe(true);
      expect(fs.existsSync(ref.resolvedPath)).toBe(true);
    }
  });

  it('recovers from one invalid JSON result and completes via repair retry', async () => {
    const def = await api.createDef(buildSingleCopilotDefinition('copilot-retry-success-e2e'));

    const start = await api.startInst(def.id, {
      prompt: 'SCENARIO:RETRY_THEN_SUCCESS write summary',
      successState: 'completed',
      execErrorState: 'error',
    });

    const final = await api.pollStatus(start.id, ['completed', 'error'], 15_000);
    expect(final.status).toBe('completed');

    const instanceRes = await api.getInstance(start.id);
    const instance = (await instanceRes.json()) as {
      stateData: {
        copilotResult: { status: 'ok' | 'error' };
      };
    };

    expect(instance.stateData.copilotResult.status).toBe('ok');
  });

  it('returns invalid_result_json after bounded retries', async () => {
    const def = await api.createDef(buildSingleCopilotDefinition('copilot-invalid-json-e2e'));

    const start = await api.startInst(def.id, {
      prompt: 'SCENARIO:INVALID_FINAL return malformed output',
      successState: 'completed',
      execErrorState: 'error',
    });

    const final = await api.pollStatus(start.id, ['completed', 'error'], 15_000);
    expect(final.status).toBe('error');

    const instanceRes = await api.getInstance(start.id);
    const instance = (await instanceRes.json()) as {
      stateData: {
        reason: string;
        attemptCount: number;
        conversationId?: string;
      };
    };

    expect(instance.stateData.reason).toBe('invalid_result_json');
    expect(instance.stateData.attemptCount).toBe(3);
    expect(instance.stateData.conversationId).toMatch(/\S+/);
  });

  it('propagates conversationId through chained follow-up state', async () => {
    const def = await api.createDef(buildChainedCopilotDefinition('copilot-chaining-e2e'));

    const start = await api.startInst(def.id, {
      prompt: 'SCENARIO:CHAIN initial task',
      successState: 'buildFollowup',
      execErrorState: 'error',
    });

    const final = await api.pollStatus(start.id, ['completed', 'error'], 20_000);
    expect(final.status).toBe('completed');

    const instanceRes = await api.getInstance(start.id);
    const instance = (await instanceRes.json()) as {
      history: { fromState: string; data?: { conversationId?: string } }[];
      stateData: {
        conversationId: string;
        copilotResult: {
          data: { phase: string };
        };
      };
    };

    const firstRun = instance.history.find((h) => h.fromState === 'runInitial');
    const followupRun = instance.history.find((h) => h.fromState === 'runFollowup');

    expect(firstRun?.data?.conversationId).toMatch(/\S+/);
    expect(followupRun?.data?.conversationId).toBe(firstRun?.data?.conversationId);
    expect(instance.stateData.conversationId).toBe(firstRun?.data?.conversationId);
    expect(instance.stateData.copilotResult.data.phase).toBe('followup');
  });
});
