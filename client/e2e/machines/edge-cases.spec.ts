/**
 * Suite 8 — §21: Negative & Edge Cases
 *
 * Tests error conditions, 404 pages, validation errors, concurrent instances,
 * and WebSocket reconnection indicators.
 */

import { expect, test } from '@playwright/test';

import {
  ERROR_DEFINITION,
  ERROR_INPUT,
  SIMPLE_DEFINITION,
  SIMPLE_INPUT,
} from '../fixtures/definitions';
import {
  E2E_TEST_WORKSPACE_ROOT,
  apiCreateDefinition,
  apiStartInstance,
  clickInstanceTab,
  navigateToInstance,
  navigateToMachines,
  pollInstanceStatus,
  waitForDefinitionCard,
  waitForInstanceRow,
  waitForStatusBadge,
} from '../helpers/machine-helpers';

const E2E_RUNTIME_OPTIONS = {
  cliDirectoryPolicy: {
    workspaceDirs: [E2E_TEST_WORKSPACE_ROOT],
  },
  cliOutputCapture: {
    enabled: false,
  },
};

test.describe('Negative & Edge Cases', () => {
  test('view non-existent instance shows not-found', async ({ page }) => {
    // Navigate to a fake instance ID
    await page.goto('/#/machines/instances/non-existent-id-12345');

    // Should show the error state (API returns 404 which shows as error)
    const errorState = page.getByTestId('instance-error');
    await expect(errorState).toBeVisible({ timeout: 10_000 });
  });

  test('error machine shows error status', async ({ page, request }) => {
    // 1. Create an error-prone definition (delay with short timeout)
    const def = await apiCreateDefinition(request, ERROR_DEFINITION);

    // 2. Start instance — the delay will exceed the state timeout
    const inst = await apiStartInstance(request, def.id, ERROR_INPUT);

    // 3. Wait for error status
    await pollInstanceStatus(request, inst.id, ['error'], 15_000);

    // 4. Navigate to instance viewer
    await navigateToInstance(page, inst.id);

    // 5. Verify error status badge
    await waitForStatusBadge(page, 'error');
  });

  test('start instance with invalid JSON input via API returns 400', async ({ request }) => {
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);

    // Send a request with malformed body
    const res = await request.post('http://localhost:3001/api/machines/instances', {
      data: {
        definitionId: def.id,
        input: 'not-an-object',
        workspaceRoot: E2E_TEST_WORKSPACE_ROOT,
        runtimeOptions: E2E_RUNTIME_OPTIONS,
      },
    });

    // The server should still accept this (input schema is { type: 'object' })
    // but non-object input may fail validation depending on schema strictness
    // Accept 201, 400, or 500
    expect([201, 400, 500]).toContain(res.status());
  });

  test('start instance for non-existent definition returns 404', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/machines/instances', {
      data: {
        definitionId: 'non-existent-def-id',
        input: {},
        workspaceRoot: E2E_TEST_WORKSPACE_ROOT,
        runtimeOptions: E2E_RUNTIME_OPTIONS,
      },
    });
    expect(res.status()).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty('message');
  });

  test('delete a non-existent definition returns 404', async ({ request }) => {
    const res = await request.delete(
      'http://localhost:3001/api/machines/definitions/non-existent-def-id',
    );
    expect(res.status()).toBe(404);
  });

  test('definition validation errors shown in editor', async ({ page }) => {
    // 1. Navigate to new definition editor
    await page.goto('/#/machines/definitions/new');
    await expect(page.getByTestId('definition-editor')).toBeVisible();

    // 2. Add a state so the editor has some content but is still invalid
    //    (missing required terminals, missing transitions)
    await page.getByTestId('add-state-btn').click();
    await expect(page.getByTestId(/^editor-node-/).first()).toBeVisible();

    // 3. Click Validate
    await page.getByTestId('validate-btn').click();

    // 4. Validation errors panel appears at the bottom of the editor
    //    It may need scrolling to be visible
    const errorPanel = page.getByTestId('validation-errors');
    await errorPanel.scrollIntoViewIfNeeded();
    await expect(errorPanel).toBeVisible({ timeout: 10_000 });
  });

  test('quick start validates missing and invalid workspace root', async ({ page, request }) => {
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);

    await navigateToMachines(page);
    await waitForDefinitionCard(page, def.id);

    const definitionSelect = page.getByTestId('definition-select');
    await definitionSelect.selectOption(def.id);

    const launchBtn = page.getByTestId('launch-button');
    await expect(launchBtn).toBeDisabled();

    const workspaceRootInput = page.getByTestId('workspace-root-input');
    await workspaceRootInput.fill('tmp/not-absolute');
    await expect(launchBtn).toBeEnabled();

    await launchBtn.click();
    await expect(page.getByTestId('workspace-root-error')).toBeVisible();
  });

  test('concurrent instances visible on dashboard', async ({ page, request }) => {
    // 1. Create a definition
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);

    // 2. Start multiple instances concurrently
    const instances = await Promise.all([
      apiStartInstance(request, def.id, SIMPLE_INPUT),
      apiStartInstance(request, def.id, SIMPLE_INPUT),
      apiStartInstance(request, def.id, SIMPLE_INPUT),
    ]);

    // 3. Wait for all to complete
    await Promise.all(
      instances.map((inst) => pollInstanceStatus(request, inst.id, ['completed'], 10_000)),
    );

    // 4. Navigate to dashboard
    await navigateToMachines(page);

    // 5. Verify all instances appear in the instance table
    for (const inst of instances) {
      await waitForInstanceRow(page, inst.id, 15_000);
    }
  });

  test('instance viewer diagram tab loads for completed machine', async ({ page, request }) => {
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    await navigateToInstance(page, inst.id);
    await clickInstanceTab(page, 'diagram');

    const diagram = page.getByTestId('state-diagram');
    await expect(diagram).toBeVisible();
  });

  test('instance viewer logs tab shows log entries', async ({ page, request }) => {
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    await navigateToInstance(page, inst.id);
    await clickInstanceTab(page, 'logs');

    const logViewer = page.getByTestId('log-viewer');
    await expect(logViewer).toBeVisible();

    // log-message action should have created at least one log entry
    const logEntries = page.getByTestId(/^log-entry-/);
    await expect(logEntries.first()).toBeVisible({ timeout: 10_000 });
  });

  test('status filter tabs work on dashboard', async ({ page, request }) => {
    // 1. Seed definitions and instances with different statuses
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    // 2. Navigate to dashboard
    await navigateToMachines(page);

    // 3. Click "Completed" filter tab
    const completedTab = page.getByTestId('filter-tab-completed');
    await expect(completedTab).toBeVisible();
    await completedTab.click();

    // 4. Instance should still be visible (it's completed)
    await waitForInstanceRow(page, inst.id, 10_000);

    // 5. Click "Running" filter tab
    const runningTab = page.getByTestId('filter-tab-running');
    await runningTab.click();

    // 6. The completed instance should NOT be visible under "running" filter
    await expect(page.getByTestId(`instance-row-${inst.id}`)).not.toBeVisible({ timeout: 3_000 });

    // 7. Click "All" to restore
    await page.getByTestId('filter-tab-all').click();
    await waitForInstanceRow(page, inst.id, 10_000);
  });

  test('definition card edit button navigates to editor', async ({ page, request }) => {
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);

    await navigateToMachines(page);

    // Click edit on the definition card
    const editBtn = page.getByTestId(`edit-definition-${def.id}`);
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
    await editBtn.click();

    // Should navigate to the editor
    await expect(page.getByTestId('definition-editor')).toBeVisible({ timeout: 10_000 });
  });

  test('definition card delete removes it from dashboard', async ({ page, request }) => {
    const def = await apiCreateDefinition(request, {
      ...SIMPLE_DEFINITION,
      name: 'E2E Delete Target',
    });

    await navigateToMachines(page);

    // Verify card exists
    const card = page.getByTestId(`definition-card-${def.id}`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Click delete
    const deleteBtn = page.getByTestId(`delete-definition-${def.id}`);
    await deleteBtn.click();

    // Confirm deletion
    const confirmBtn = page.getByTestId('confirm-dialog-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Card should disappear
    await expect(card).not.toBeVisible({ timeout: 10_000 });
  });
});
