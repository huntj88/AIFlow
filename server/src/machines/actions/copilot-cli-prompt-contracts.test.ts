import { describe, expect, it } from 'vitest';

import {
  parseAndValidateCopilotActionResult,
  parseCopilotCliPromptInput,
} from './copilot-cli-prompt-contracts.js';

describe('copilot-cli-prompt contracts', () => {
  it('fails input validation for empty prompt', () => {
    const parsed = parseCopilotCliPromptInput({
      prompt: '',
      successState: 'done',
      execErrorState: 'error',
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.length).toBeGreaterThan(0);
      expect(parsed.errors.some((e) => e.path === '/prompt')).toBe(true);
    }
  });

  it('fails input validation for unexpected top-level property', () => {
    const parsed = parseCopilotCliPromptInput({
      prompt: 'hello',
      successState: 'done',
      execErrorState: 'error',
      extra: true,
    });

    expect(parsed.ok).toBe(false);
  });

  it('fails result validation when top-level additionalProperties are present', () => {
    const parsed = parseAndValidateCopilotActionResult(
      JSON.stringify({
        schemaVersion: 'copilot-action-result.v1',
        status: 'ok',
        summary: 'done',
        data: {},
        filePaths: [],
        diagnostics: { exitCode: 0 },
        extra: 'nope',
      }),
    );

    expect(parsed.ok).toBe(false);
  });

  it('includes validation diagnostics for missing required keys', () => {
    const parsed = parseAndValidateCopilotActionResult(
      JSON.stringify({
        schemaVersion: 'copilot-action-result.v1',
        status: 'ok',
        data: {},
        filePaths: [],
        diagnostics: { exitCode: 0 },
      }),
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.length).toBeGreaterThan(0);
      expect(parsed.errors.some((e) => e.path === '/')).toBe(true);
    }
  });

  it('parses JSON when stdout has trailing assistant chatter', () => {
    const parsed = parseAndValidateCopilotActionResult(
      [
        JSON.stringify({
          schemaVersion: 'copilot-action-result.v1',
          status: 'ok',
          summary: 'done',
          data: {},
          filePaths: [],
          diagnostics: { exitCode: 0 },
        }),
        '',
        '● Continuing autonomously (1 premium request)',
        'Completed: marked task complete.',
      ].join('\n'),
    );

    expect(parsed.ok).toBe(true);
  });

  it('parses first balanced JSON object from mixed output', () => {
    const parsed = parseAndValidateCopilotActionResult(
      [
        'non-json prefix',
        '{"schemaVersion":"copilot-action-result.v1","status":"ok","summary":"done","data":{},"filePaths":[],"diagnostics":{"exitCode":0}}',
        'extra trailing details',
      ].join('\n'),
    );

    expect(parsed.ok).toBe(true);
  });
});
