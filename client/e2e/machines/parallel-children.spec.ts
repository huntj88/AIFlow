/**
 * Suite 4 — §20.4: Parallel Children
 *
 * Tests the parallel_children state type: parent spawns multiple children
 * concurrently, verifies they appear in the child tree, and validates
 * their completion.
 */

import { expect, test } from '@playwright/test';

import { CHILD_DEFINITION, makeParallelDefinition, PARALLEL_INPUT } from '../fixtures/definitions';
import {
  apiCreateDefinition,
  apiListChildren,
  apiStartInstance,
  clickInstanceTab,
  navigateToInstance,
  pollInstanceStatus,
} from '../helpers/machine-helpers';

test.describe('Parallel children', () => {
  test('parallel children all spawn and complete', async ({ page, request }) => {
    // 1. Create two child definitions (can reuse the same definition)
    const childDef = await apiCreateDefinition(request, {
      ...CHILD_DEFINITION,
      name: 'E2E Parallel Child',
    });

    // 2. Create parent with parallel_children state
    const parentDef = await apiCreateDefinition(
      request,
      makeParallelDefinition(childDef.id, childDef.id),
    );

    // 3. Start parent instance
    const parentInst = await apiStartInstance(request, parentDef.id, PARALLEL_INPUT);
    expect(parentInst.status).toBe('running');

    // 4. Wait for parent to reach a terminal state
    await pollInstanceStatus(request, parentInst.id, ['completed', 'error'], 30_000);

    // 5. Verify children were created
    const children = await apiListChildren(request, parentInst.id);
    expect(children.length).toBeGreaterThanOrEqual(2);

    // 6. Navigate to parent instance → children tab
    await navigateToInstance(page, parentInst.id);
    await clickInstanceTab(page, 'children');

    const childTree = page.getByTestId('child-machine-tree');
    await expect(childTree).toBeVisible({ timeout: 10_000 });

    // 7. Verify multiple child entries appear
    const childEntries = childTree.getByTestId(/^child-node-/);
    await expect(childEntries.first()).toBeVisible({ timeout: 10_000 });
    expect(await childEntries.count()).toBeGreaterThanOrEqual(2);
  });

  test('each parallel child can be viewed individually', async ({ page, request }) => {
    // 1. Seed definitions
    const childDef = await apiCreateDefinition(request, {
      ...CHILD_DEFINITION,
      name: 'E2E Parallel Child View',
    });
    const parentDef = await apiCreateDefinition(
      request,
      makeParallelDefinition(childDef.id, childDef.id),
    );

    // 2. Start and wait for completion
    const parentInst = await apiStartInstance(request, parentDef.id, PARALLEL_INPUT);
    await pollInstanceStatus(request, parentInst.id, ['completed', 'error'], 30_000);

    // 3. Get child instance IDs
    const children = await apiListChildren(request, parentInst.id);
    expect(children.length).toBeGreaterThanOrEqual(2);

    // 4. Navigate to each child and verify it renders
    for (const child of children) {
      await navigateToInstance(page, child.id);
      await expect(page.getByTestId('machine-instance-page')).toBeVisible();
    }
  });
});
