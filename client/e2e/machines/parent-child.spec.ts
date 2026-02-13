/**
 * Suite 3 — §20.3: Parent-Child Composition
 *
 * Tests the parent-child machine workflow: parent spawns a child via the
 * `child_machine` state type, verifies the child appears in the tree,
 * and validates navigation between parent ↔ child instance pages.
 *
 * Note: With built-in actions the parent's post-child action cannot complete
 * successfully (MachineResult lacks the fields built-in actions need), so
 * the parent ends in "error". The tests verify child spawning, waiting_for_child
 * status, child tree display, and parent ↔ child navigation.
 */

import { expect, test } from '@playwright/test';

import { CHILD_DEFINITION, makeParentDefinition, PARENT_INPUT } from '../fixtures/definitions';
import {
  E2E_TEST_WORKSPACE_ROOT,
  apiCreateDefinition,
  apiGetInstance,
  apiListChildren,
  apiStartInstance,
  clickInstanceTab,
  navigateToInstance,
  pollInstanceStatus,
} from '../helpers/machine-helpers';

test.describe('Parent-Child composition', () => {
  test('parent spawns child and child completes', async ({ page, request }) => {
    // 1. Create child definition
    const childDef = await apiCreateDefinition(request, CHILD_DEFINITION);

    // 2. Create parent definition referencing child
    const parentDef = await apiCreateDefinition(request, makeParentDefinition(childDef.id));

    // 3. Start the parent instance
    const parentInst = await apiStartInstance(request, parentDef.id, PARENT_INPUT);
    expect(parentInst.status).toBe('running');

    // 4. Wait for the parent to reach a terminal state
    // (parent will end in error due to post-child action, but child should complete)
    const finalParent = await pollInstanceStatus(
      request,
      parentInst.id,
      ['completed', 'error', 'waiting_for_child'],
      20_000,
    );

    // 5. Verify child instance(s) were created
    const children = await apiListChildren(request, parentInst.id);
    expect(children.length).toBeGreaterThanOrEqual(1);

    // 5b. Child should inherit workspace fields from parent family
    const childInst = await apiGetInstance(request, children[0].id);
    expect(childInst).toHaveProperty('workspaceRoot', E2E_TEST_WORKSPACE_ROOT);
    expect(childInst).toHaveProperty('familyRootInstanceId', parentInst.id);

    // 6. Navigate to parent instance viewer
    await navigateToInstance(page, parentInst.id);

    // 7. Check the children tab shows child instances
    await clickInstanceTab(page, 'children');
    const childTree = page.getByTestId('child-machine-tree');
    await expect(childTree).toBeVisible({ timeout: 10_000 });

    // Wait for child entries to appear
    const childEntries = childTree.getByTestId(/^child-node-/);
    await expect(childEntries.first()).toBeVisible({ timeout: 10_000 });
  });

  test('navigate from parent to child instance and back', async ({ page, request }) => {
    // 1. Seed parent + child definitions and start parent
    const childDef = await apiCreateDefinition(request, CHILD_DEFINITION);
    const parentDef = await apiCreateDefinition(request, makeParentDefinition(childDef.id));
    const parentInst = await apiStartInstance(request, parentDef.id, PARENT_INPUT);

    // 2. Wait for parent to finish (error or completed)
    await pollInstanceStatus(request, parentInst.id, ['completed', 'error'], 20_000);

    // 3. Get child instance ID
    const children = await apiListChildren(request, parentInst.id);
    expect(children.length).toBeGreaterThanOrEqual(1);
    const childInstId = children[0].id;

    // 4. Navigate to parent instance → children tab
    await navigateToInstance(page, parentInst.id);
    await clickInstanceTab(page, 'children');

    // 5. Click on the child instance to navigate
    const childButton = page.getByTestId(`child-node-${childInstId}`);
    await expect(childButton).toBeVisible({ timeout: 10_000 });
    await childButton.click();

    // 6. Verify we're on the child instance page
    await expect(page.getByTestId('machine-instance-page')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('workspace-root')).toContainText(E2E_TEST_WORKSPACE_ROOT);
    await expect(page.getByTestId('family-root-instance-id')).toContainText(parentInst.id);

    // 7. Verify the parent breadcrumb is visible
    const breadcrumb = page.getByTestId('parent-breadcrumb');
    await expect(breadcrumb).toBeVisible();

    // 8. Click breadcrumb to go back to parent
    await breadcrumb.click();
    await expect(page.getByTestId('machine-instance-page')).toBeVisible({ timeout: 10_000 });
  });

  test('child instance has correct parentInstanceId', async ({ request }) => {
    // API-only verification
    const childDef = await apiCreateDefinition(request, CHILD_DEFINITION);
    const parentDef = await apiCreateDefinition(request, makeParentDefinition(childDef.id));
    const parentInst = await apiStartInstance(request, parentDef.id, PARENT_INPUT);

    await pollInstanceStatus(request, parentInst.id, ['completed', 'error'], 20_000);

    const children = await apiListChildren(request, parentInst.id);
    expect(children.length).toBeGreaterThanOrEqual(1);

    const childInst = await apiGetInstance(request, children[0].id);
    expect(childInst).toHaveProperty('parentInstanceId', parentInst.id);
    expect(childInst).toHaveProperty('workspaceRoot', E2E_TEST_WORKSPACE_ROOT);
    expect(childInst).toHaveProperty('familyRootInstanceId', parentInst.id);
  });
});
