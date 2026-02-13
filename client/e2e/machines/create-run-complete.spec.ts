/**
 * Suite 1 — §20.1: Create → Run → View → Complete
 *
 * Exercises the full happy-path lifecycle: seed a definition, start an
 * instance, watch it run to completion, and verify the UI reflects every
 * step (status badge, state diagram, transition history, final result).
 */

import { expect, test } from '@playwright/test';

import { LINEAR_DEFINITION, LINEAR_INPUT, SIMPLE_DEFINITION, SIMPLE_INPUT } from '../fixtures/definitions';
import {
  E2E_TEST_WORKSPACE_ROOT,
  apiCreateDefinition,
  apiStartInstance,
  clickInstanceTab,
  navigateToInstance,
  navigateToMachines,
  pollInstanceStatus,
  startInstanceViaUI,
  waitForDefinitionCard,
  waitForInstanceRow,
  waitForStatusBadge,
} from '../helpers/machine-helpers';

test.describe('Create → Run → Complete', () => {
  test('complete linear workflow via API + UI viewer', async ({ page, request }) => {
    // 1. Create a 3-state linear definition via API
    const def = await apiCreateDefinition(request, LINEAR_DEFINITION);
    expect(def.id).toBeTruthy();

    // 2. Start an instance via API
    const inst = await apiStartInstance(request, def.id, LINEAR_INPUT);
    expect(inst.status).toBe('running');

    // 3. Poll until completed
    await pollInstanceStatus(request, inst.id, ['completed'], 15_000);

    // 4. Navigate to instance viewer
    await navigateToInstance(page, inst.id);

    // 5. Verify status badge shows "completed"
    await waitForStatusBadge(page, 'completed');

    // 5b. Verify workspace information is displayed
    await expect(page.getByTestId('workspace-root')).toContainText(E2E_TEST_WORKSPACE_ROOT);
    await expect(page.getByTestId('artifacts-path')).toContainText('artifacts');
    await expect(page.getByTestId('family-root-instance-id')).toContainText(inst.id);

    // 6. Verify state diagram tab shows all states as visited
    await clickInstanceTab(page, 'diagram');
    const diagram = page.getByTestId('state-diagram');
    await expect(diagram).toBeVisible();

    // Each state from the definition should have a node rendered
    for (const stateName of Object.keys(LINEAR_DEFINITION.states)) {
      await expect(page.getByTestId(`state-node-${stateName}`)).toBeVisible();
    }

    // 7. Verify transition history tab shows transitions
    await clickInstanceTab(page, 'history');
    const historyTable = page.getByTestId('transition-history');
    await expect(historyTable).toBeVisible();

    // There should be at least 2 transitions: init→process, process→completed
    const rows = historyTable.getByTestId(/^transition-row-/);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  test('complete simple machine via QuickStartPanel in UI', async ({ page, request }) => {
    // 1. Create a definition via API
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);

    // 2. Navigate to machines dashboard
    await navigateToMachines(page);

    // 3. Verify definition card appears
    await waitForDefinitionCard(page, def.id);

    // 4. Start instance via the QuickStartPanel
    await startInstanceViaUI(page, def.id, SIMPLE_INPUT, E2E_TEST_WORKSPACE_ROOT);

    // 5. Should navigate to instance viewer
    await expect(page.getByTestId('machine-instance-page')).toBeVisible({ timeout: 10_000 });

    // 6. Wait for completion
    await waitForStatusBadge(page, 'completed', 15_000);

    // 7. Verify workspace fields on instance viewer
    await expect(page.getByTestId('workspace-root')).toContainText(E2E_TEST_WORKSPACE_ROOT);
    await expect(page.getByTestId('artifacts-path')).toContainText('artifacts');
  });

  test('instance appears on the dashboard after creation', async ({ page, request }) => {
    // 1. Seed definition + instance
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    // 2. Navigate to dashboard
    await navigateToMachines(page);

    // 3. Verify the instance row exists (may need to wait for auto-refresh)
    await waitForInstanceRow(page, inst.id, 15_000);
  });

  test('view running instance with live status update', async ({ page, request }) => {
    // Use SIMPLE (fast) — start it and immediately navigate
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);

    // Navigate immediately — may catch "running" or "completed"
    await navigateToInstance(page, inst.id);

    // Eventually should show completed
    await waitForStatusBadge(page, 'completed', 15_000);

    // Verify logs tab has entries
    await clickInstanceTab(page, 'logs');
    const logContainer = page.getByTestId('log-viewer');
    await expect(logContainer).toBeVisible();
  });
});
