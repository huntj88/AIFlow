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

const parseJsonCandidate = (
  candidate: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    return { ok: false };
  }
};

const looksLikeJsonStart = (ch: string): boolean => ch === '{' || ch === '[';

const extractBalancedJsonFragment = (rawOutput: string): string | undefined => {
  const source = rawOutput.trim();
  if (source.length === 0) {
    return undefined;
  }

  for (let i = 0; i < source.length; i += 1) {
    const start = source[i];
    if (!start || !looksLikeJsonStart(start)) {
      continue;
    }

    const stack: string[] = [start];
    let inString = false;
    let escaped = false;

    for (let j = i + 1; j < source.length; j += 1) {
      const ch = source[j];
      if (!ch) {
        continue;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{' || ch === '[') {
        stack.push(ch);
        continue;
      }

      if (ch === '}' || ch === ']') {
        const open = stack.at(-1);
        const isMatch = (open === '{' && ch === '}') || (open === '[' && ch === ']');
        if (!isMatch) {
          break;
        }

        stack.pop();
        if (stack.length === 0) {
          return source.slice(i, j + 1);
        }
      }
    }
  }

  return undefined;
};

const parseCopilotResultJson = (
  rawOutput: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    return { ok: false };
  }

  const direct = parseJsonCandidate(trimmed);
  if (direct.ok) {
    return direct;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (!looksLikeJsonStart(line[0])) {
      continue;
    }

    const parsedLine = parseJsonCandidate(line);
    if (parsedLine.ok) {
      return parsedLine;
    }
  }

  const fragment = extractBalancedJsonFragment(trimmed);
  if (!fragment) {
    return { ok: false };
  }

  return parseJsonCandidate(fragment);
};

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
  const parsed = parseCopilotResultJson(rawOutput);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: [{ path: '/', message: 'invalid JSON: unable to parse output' }],
    };
  }

  const isValid = validateResult(parsed.value);
  if (!isValid) {
    return {
      ok: false,
      errors: toDiagnostics(validateResult.errors),
    };
  }

  return {
    ok: true,
    value: parsed.value as CopilotActionResult,
  };
};
