/**
 * Shared Playwright helpers for machine E2E tests.
 *
 * These helpers communicate with the server API at localhost:3001 to seed
 * data, and use Playwright `page` for UI interactions and assertions.
 */

import { type APIRequestContext, expect, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api';
export const E2E_TEST_WORKSPACE_ROOT = '/tmp/aiflow-e2e-test';

const makeRuntimeOptions = (workspaceRoot: string) => ({
  cliDirectoryPolicy: {
    workspaceDirs: [workspaceRoot],
    artifactDirs: [`${workspaceRoot}/artifacts`],
  },
  cliOutputCapture: {
    enabled: false,
  },
});

// ────────────────────────────────────────────────────────────────────────────
// API helpers (bypass the UI for fast seeding)
// ────────────────────────────────────────────────────────────────────────────

/** POST a new definition via the server API. Returns the full saved definition (with `id`). */
export async function apiCreateDefinition(
  request: APIRequestContext,
  definition: object,
): Promise<{ id: string; name: string; version: number; [k: string]: unknown }> {
  const res = await request.post(`${API_BASE}/machines/definitions`, { data: definition });
  expect(res.status()).toBe(201);
  return res.json();
}

/** PUT to update an existing definition via the server API. */
export async function apiUpdateDefinition(
  request: APIRequestContext,
  id: string,
  definition: object,
): Promise<{ id: string; name: string; version: number; [k: string]: unknown }> {
  const res = await request.put(`${API_BASE}/machines/definitions/${id}`, { data: definition });
  expect(res.status()).toBe(200);
  return res.json();
}

/** DELETE a definition via the server API. */
export async function apiDeleteDefinition(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  const res = await request.delete(`${API_BASE}/machines/definitions/${id}`);
  expect(res.status()).toBe(204);
}

/** POST to start a new instance via the server API. Returns the full instance. */
export async function apiStartInstance(
  request: APIRequestContext,
  definitionId: string,
  input: object = {},
  workspaceRoot: string = E2E_TEST_WORKSPACE_ROOT,
): Promise<{ id: string; status: string; definitionId: string; [k: string]: unknown }> {
  const res = await request.post(`${API_BASE}/machines/instances`, {
    data: {
      definitionId,
      input,
      workspaceRoot,
      runtimeOptions: makeRuntimeOptions(workspaceRoot),
    },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

/** GET a single instance by ID. */
export async function apiGetInstance(
  request: APIRequestContext,
  instanceId: string,
): Promise<{ id: string; status: string; currentState: string; [k: string]: unknown }> {
  const res = await request.get(`${API_BASE}/machines/instances/${instanceId}`);
  expect(res.status()).toBe(200);
  return res.json();
}

/** POST to cancel an instance via the server API. */
export async function apiCancelInstance(
  request: APIRequestContext,
  instanceId: string,
): Promise<void> {
  const res = await request.post(`${API_BASE}/machines/instances/${instanceId}/cancel`);
  expect(res.ok()).toBeTruthy();
}

/** POST to resume a suspended instance via the server API. */
export async function apiResumeInstance(
  request: APIRequestContext,
  instanceId: string,
): Promise<void> {
  const res = await request.post(`${API_BASE}/machines/instances/${instanceId}/resume`);
  expect(res.ok()).toBeTruthy();
}

/** GET child instances for a parent. */
export async function apiListChildren(
  request: APIRequestContext,
  parentInstanceId: string,
): Promise<Array<{ id: string; status: string; [k: string]: unknown }>> {
  const res = await request.get(
    `${API_BASE}/machines/instances?parentInstanceId=${parentInstanceId}`,
  );
  expect(res.status()).toBe(200);
  return res.json();
}

/** GET registered actions. */
export async function apiGetActions(
  request: APIRequestContext,
): Promise<Array<{ id: string; description: string }>> {
  const res = await request.get(`${API_BASE}/machines/actions`);
  expect(res.status()).toBe(200);
  return res.json();
}

// ────────────────────────────────────────────────────────────────────────────
// Polling helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Poll the API until the instance reaches one of `targetStatuses`.
 * Throws if timeout is exceeded.
 */
export async function pollInstanceStatus(
  request: APIRequestContext,
  instanceId: string,
  targetStatuses: string[],
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<{ id: string; status: string; currentState: string; [k: string]: unknown }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inst = await apiGetInstance(request, instanceId);
    if (targetStatuses.includes(inst.status)) return inst;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Instance ${instanceId} did not reach status [${targetStatuses.join(', ')}] within ${timeoutMs}ms`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// UI navigation helpers
// ────────────────────────────────────────────────────────────────────────────

/** Navigate to the machines dashboard. */
export async function navigateToMachines(page: Page): Promise<void> {
  await page.goto('/#/machines');
  await expect(page.getByTestId('machines-page')).toBeVisible();
}

/** Navigate to a specific instance viewer page. */
export async function navigateToInstance(page: Page, instanceId: string): Promise<void> {
  await page.goto(`/#/machines/instances/${instanceId}`);
  await expect(page.getByTestId('machine-instance-page')).toBeVisible();
}

/** Navigate to the new definition editor page. */
export async function navigateToNewDefinition(page: Page): Promise<void> {
  await page.goto('/#/machines/definitions/new');
  await expect(page.getByTestId('definition-editor')).toBeVisible();
}

/** Navigate to the edit definition editor page. */
export async function navigateToEditDefinition(page: Page, definitionId: string): Promise<void> {
  await page.goto(`/#/machines/definitions/${definitionId}/edit`);
  await expect(page.getByTestId('definition-editor')).toBeVisible();
}

// ────────────────────────────────────────────────────────────────────────────
// UI assertion helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wait for the instance status badge in the UI to show the expected status.
 * Uses the `status-badge-<status>` test-id pattern.
 */
export async function waitForStatusBadge(
  page: Page,
  status: string,
  timeout = 30_000,
): Promise<void> {
  await expect(page.getByTestId(`status-badge-${status}`)).toBeVisible({ timeout });
}

/**
 * Wait for a definition card with the given name to appear on the dashboard.
 */
export async function waitForDefinitionCard(
  page: Page,
  definitionId: string,
  timeout = 10_000,
): Promise<void> {
  await expect(page.getByTestId(`definition-card-${definitionId}`)).toBeVisible({ timeout });
}

/**
 * Wait for an instance row with the given ID to appear on the dashboard.
 */
export async function waitForInstanceRow(
  page: Page,
  instanceId: string,
  timeout = 10_000,
): Promise<void> {
  await expect(page.getByTestId(`instance-row-${instanceId}`)).toBeVisible({ timeout });
}

/**
 * Start an instance via the QuickStartPanel in the UI.
 * Assumes the machines dashboard is already loaded and definitions are present.
 */
export async function startInstanceViaUI(
  page: Page,
  definitionId: string,
  input: object = {},
  workspaceRoot: string = E2E_TEST_WORKSPACE_ROOT,
): Promise<void> {
  const panel = page.getByTestId('quick-start-panel');
  await expect(panel).toBeVisible();

  // Select definition from dropdown
  const select = page.getByTestId('definition-select');
  await select.selectOption(definitionId);

  // Fill input JSON
  const inputField = page.getByTestId('json-input');
  await inputField.fill(JSON.stringify(input));

  // Fill workspace root
  const workspaceRootField = page.getByTestId('workspace-root-input');
  await workspaceRootField.fill(workspaceRoot);

  // Click launch
  await page.getByTestId('launch-button').click();
}

/**
 * Click a tab on the instance viewer page.
 */
export async function clickInstanceTab(
  page: Page,
  tab: 'diagram' | 'history' | 'logs' | 'children' | 'artifacts',
): Promise<void> {
  await page.getByTestId(`tab-${tab}`).click();
}
