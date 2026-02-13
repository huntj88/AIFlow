/**
 * Suite 6 — §20.6: Artifacts Path Display
 *
 * Verifies the instance viewer shows `workspaceRoot` and `artifactsPath`
 * as text fields under workspace information.
 */

import { expect, test } from '@playwright/test';

import { SIMPLE_DEFINITION, SIMPLE_INPUT } from '../fixtures/definitions';
import {
  E2E_TEST_WORKSPACE_ROOT,
  apiCreateDefinition,
  apiStartInstance,
  navigateToInstance,
  pollInstanceStatus,
} from '../helpers/machine-helpers';

test.describe('Artifacts path display', () => {
  test('displays artifactsPath in the instance viewer', async ({ page, request }) => {
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    await navigateToInstance(page, inst.id);

    const artifactsPath = page.getByTestId('artifacts-path');
    await expect(artifactsPath).toBeVisible();
    await expect(artifactsPath).toContainText('artifacts');
  });

  test('shows workspace root in the instance viewer', async ({ page, request }) => {
    const def = await apiCreateDefinition(request, {
      ...SIMPLE_DEFINITION,
      name: 'E2E Workspace Root Display',
    });
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    await navigateToInstance(page, inst.id);

    const workspaceRoot = page.getByTestId('workspace-root');
    await expect(workspaceRoot).toBeVisible();
    await expect(workspaceRoot).toContainText(E2E_TEST_WORKSPACE_ROOT);
  });
});
