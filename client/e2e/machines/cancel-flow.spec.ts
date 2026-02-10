/**
 * Suite 2 — §20.2: Create → Run → Cancel
 *
 * Tests the cancellation workflow: start a long-running instance, cancel it
 * while running, and verify the UI shows the correct cancelled state.
 */

import { expect, test } from '@playwright/test';

import {
  DELAY_DEFINITION,
  DELAY_INPUT_LONG,
  SIMPLE_DEFINITION,
  SIMPLE_INPUT,
} from '../fixtures/definitions';
import {
  apiCreateDefinition,
  apiStartInstance,
  navigateToInstance,
  pollInstanceStatus,
  waitForStatusBadge,
} from '../helpers/machine-helpers';

test.describe('Cancel flow', () => {
  test('cancel a running instance via UI', async ({ page, request }) => {
    // 1. Create a definition with a long delay
    const def = await apiCreateDefinition(request, DELAY_DEFINITION);

    // 2. Start instance (30s delay — plenty of time to cancel)
    const inst = await apiStartInstance(request, def.id, DELAY_INPUT_LONG);
    expect(inst.status).toBe('running');

    // 3. Navigate to instance viewer
    await navigateToInstance(page, inst.id);

    // 4. Verify it's running
    await waitForStatusBadge(page, 'running');

    // 5. Click the "Cancel" button
    const cancelBtn = page.getByTestId('cancel-button');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // 6. Confirm the cancel dialog
    const confirmBtn = page.getByTestId('confirm-dialog-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 7. Verify status becomes "cancelled"
    await waitForStatusBadge(page, 'cancelled', 15_000);
  });

  test('cancel button is hidden for completed instances', async ({ page, request }) => {
    // 1. Create and run a fast instance to completion
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    // 2. Navigate to instance viewer
    await navigateToInstance(page, inst.id);

    // 3. Verify status is completed
    await waitForStatusBadge(page, 'completed');

    // 4. Cancel button should NOT be visible
    await expect(page.getByTestId('cancel-button')).not.toBeVisible();
  });

  test('cancel via API and verify UI reflects it', async ({ page, request }) => {
    // 1. Create a long-running instance
    const def = await apiCreateDefinition(request, DELAY_DEFINITION);
    const inst = await apiStartInstance(request, def.id, DELAY_INPUT_LONG);

    // 2. Navigate to instance viewer
    await navigateToInstance(page, inst.id);
    await waitForStatusBadge(page, 'running');

    // 3. Cancel via API
    const cancelRes = await request.post(
      `http://localhost:3001/api/machines/instances/${inst.id}/cancel`,
    );
    expect(cancelRes.ok()).toBeTruthy();

    // 4. Reload the page since WebSocket live updates may not be connected
    await page.reload();
    await expect(page.getByTestId('machine-instance-page')).toBeVisible({ timeout: 10_000 });

    // 5. UI should show "cancelled"
    await waitForStatusBadge(page, 'cancelled', 15_000);
  });
});
