/**
 * Prompt template helpers for `copilot-cli-prompt`.
 *
 * Task 10 — directory guidance prelude + strict JSON prompts.
 *
 * @module
 */

export interface DirectoryGuidancePreludeInput {
  readonly workspaceRoot: string;
  readonly artifactsWorkspaceRoot: string;
  readonly stateName: string;
  readonly machineInstanceId: string;
}

export const buildDirectoryGuidancePrelude = (input: DirectoryGuidancePreludeInput): string =>
  [
    'You have access to two working directories:',
    `1) Workspace: ${input.workspaceRoot} (project/source files).`,
    `2) Artifacts workspace: ${input.artifactsWorkspaceRoot} (generated non-project files and artifacts).`,
    '',
    'Default file placement guidance (recommendation, not restriction):',
    '- Put non-project generated files in artifacts workspace.',
    '- Artifact files include plans, reports, checklists, and metadata.',
    '- Put plans and high-level documents at the root of the artifacts family tree folder.',
    '- Put reports/logs and other non-structural files in the folder associated with the current state machine instance.',
    '- For child state machines, nested instance folders should follow children/<childInstanceId>/... lineage.',
    '',
    `Current state: ${input.stateName}`,
    `Current machine instance id: ${input.machineInstanceId}`,
    '',
    'You may read/write files anywhere within either workspace root when needed.',
  ].join('\n');

export interface FirstTurnPromptInput extends DirectoryGuidancePreludeInput {
  readonly userPrompt: string;
}

export const buildFirstTurnPrompt = (input: FirstTurnPromptInput): string =>
  `${buildDirectoryGuidancePrelude(input)}\n\nUser task:\n${input.userPrompt}`;

export const buildStrictJsonResultPrompt = (): string =>
  [
    'Format the results of the conversation so far into the expected JSON object below.',
    'Return STRICT JSON only. No markdown, no code fences, no prose.',
    'Output must validate against exactly this schema:',
    '{',
    '  "schemaVersion": "copilot-action-result.v1",',
    '  "status": "ok" | "error",',
    '  "summary": "<non-empty string>",',
    '  "data": { ...object },',
    '  "filePaths": [',
    '    { "workspace": "workspace" | "artifacts", "path": "<relative path>", "description": "<optional string>" }',
    '  ],',
    '  "diagnostics": { "exitCode": <number>, "durationMs": <optional number>, ... }',
    '}',
    'Top-level additional properties are NOT allowed.',
  ].join('\n');

export interface JsonRepairPromptInput {
  readonly previousOutput: string;
}

export const buildJsonRepairPrompt = (input: JsonRepairPromptInput): string => {
  const compact =
    input.previousOutput.length > 1200
      ? `${input.previousOutput.slice(0, 1200)}\n...<truncated>`
      : input.previousOutput;

  return [
    'Your previous response was not valid for the required strict JSON schema.',
    'Reformat ONLY the previous response as STRICT JSON.',
    'Do not add markdown/code fences/explanatory text.',
    'If a field is unknown, provide the nearest valid placeholder while preserving intent.',
    '',
    'Previous response:',
    compact,
  ].join('\n');
};

export const buildConversationResetPrompt = (): string =>
  [
    'System maintenance instruction: discard this result-formatting exchange from future context.',
    'Continue the conversation as if only user task prompts were added.',
    'Reply with exactly: OK',
  ].join('\n');
