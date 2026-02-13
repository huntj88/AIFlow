/**
 * Contracts for `copilot-cli-prompt` input + strict result JSON.
 *
 * Task 11 — validation contracts and diagnostics shaping.
 *
 * @module
 */

import AjvModule, { type ErrorObject } from 'ajv';

import type { JsonSchema } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
const Ajv: typeof AjvModule.default =
  typeof (AjvModule as any).default === 'function'
    ? (AjvModule as any).default
    : (AjvModule as any);
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

const ajv = new Ajv({ allErrors: true });

export interface ValidationDiagnostic {
  readonly path: string;
  readonly message: string;
}

export interface CopilotContextFilePath {
  readonly workspace: 'workspace' | 'artifacts';
  readonly path: string;
}

export interface CopilotCliPromptInput {
  readonly prompt: string;
  readonly conversationId?: string;
  readonly contextFilePaths?: readonly CopilotContextFilePath[];
  readonly successState: string;
  readonly execErrorState: string;
}

export interface CopilotResultFilePath {
  readonly workspace: 'workspace' | 'artifacts';
  readonly path: string;
  readonly description?: string;
}

export interface CopilotActionResult {
  readonly schemaVersion: 'copilot-action-result.v1';
  readonly status: 'ok' | 'error';
  readonly summary: string;
  readonly data: Record<string, unknown>;
  readonly filePaths: readonly CopilotResultFilePath[];
  readonly diagnostics: {
    readonly exitCode: number;
    readonly durationMs?: number;
    readonly [key: string]: unknown;
  };
}

export const copilotCliPromptInputSchema: JsonSchema = {
  type: 'object',
  required: ['prompt', 'successState', 'execErrorState'],
  properties: {
    prompt: { type: 'string', minLength: 1 },
    conversationId: { type: 'string', minLength: 1 },
    contextFilePaths: {
      type: 'array',
      items: {
        type: 'object',
        required: ['workspace', 'path'],
        properties: {
          workspace: { type: 'string', enum: ['workspace', 'artifacts'] },
          path: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    successState: { type: 'string', minLength: 1 },
    execErrorState: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

export const copilotActionResultSchema: JsonSchema = {
  type: 'object',
  required: ['schemaVersion', 'status', 'summary', 'data', 'filePaths', 'diagnostics'],
  properties: {
    schemaVersion: { type: 'string', const: 'copilot-action-result.v1' },
    status: { type: 'string', enum: ['ok', 'error'] },
    summary: { type: 'string', minLength: 1 },
    data: { type: 'object' },
    filePaths: {
      type: 'array',
      items: {
        type: 'object',
        required: ['workspace', 'path'],
        properties: {
          workspace: { type: 'string', enum: ['workspace', 'artifacts'] },
          path: { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    diagnostics: {
      type: 'object',
      required: ['exitCode'],
      properties: {
        exitCode: { type: 'number' },
        durationMs: { type: 'number' },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
};

const validateInput = ajv.compile(copilotCliPromptInputSchema);
const validateResult = ajv.compile(copilotActionResultSchema);

const toDiagnostics = (errors: readonly ErrorObject[] | null | undefined): ValidationDiagnostic[] =>
  (errors ?? []).map((err) => ({
    path: err.instancePath.length > 0 ? err.instancePath : '/',
    message: err.message ?? 'validation error',
  }));

export const parseCopilotCliPromptInput = (
  stateData: unknown,
):
  | { readonly ok: true; readonly value: CopilotCliPromptInput }
  | { readonly ok: false; readonly errors: readonly ValidationDiagnostic[] } => {
  const isValid = validateInput(stateData);
  if (!isValid) {
    return {
      ok: false,
      errors: toDiagnostics(validateInput.errors),
    };
  }

  return {
    ok: true,
    value: stateData as CopilotCliPromptInput,
  };
};

export const parseAndValidateCopilotActionResult = (
  rawOutput: string,
):
  | { readonly ok: true; readonly value: CopilotActionResult }
  | { readonly ok: false; readonly errors: readonly ValidationDiagnostic[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return {
      ok: false,
      errors: [{ path: '/', message: 'invalid JSON: unable to parse output' }],
    };
  }

  const isValid = validateResult(parsed);
  if (!isValid) {
    return {
      ok: false,
      errors: toDiagnostics(validateResult.errors),
    };
  }

  return {
    ok: true,
    value: parsed as CopilotActionResult,
  };
};
