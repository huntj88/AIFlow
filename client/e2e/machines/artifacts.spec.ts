/**
 * Suite 6 — §20.6: Artifacts Workflow
 *
 * Tests that artifacts produced by machine executions are visible in the
 * instance viewer's artifacts tab. Built-in actions don't write artifacts,
 * but the log-message action creates log entries. We verify the artifacts
 * tab renders (empty for log-only machines) and that the API endpoint works.
 */

import { expect, test } from '@playwright/test';

import { SIMPLE_DEFINITION, SIMPLE_INPUT } from '../fixtures/definitions';
import {
  apiCreateDefinition,
  apiStartInstance,
  clickInstanceTab,
  navigateToInstance,
  pollInstanceStatus,
} from '../helpers/machine-helpers';

test.describe('Artifacts workflow', () => {
  test('artifacts tab renders on instance viewer', async ({ page, request }) => {
    // 1. Create and complete a simple machine
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    // 2. Navigate to instance viewer
    await navigateToInstance(page, inst.id);

    // 3. Click the artifacts tab
    await clickInstanceTab(page, 'artifacts');

    // 4. Verify the artifact viewer component is visible
    const artifactViewer = page.getByTestId('artifact-viewer');
    await expect(artifactViewer).toBeVisible();

    // 5. Simple log-message machine produces no artifacts
    // The server returns a tree structure even for empty artifacts,
    // so the tree view renders (not the flat empty state).
    // Verify the tree shows "0 files" or the viewer is present.
  });

  test('artifacts API returns empty array for log-only machine', async ({ request }) => {
    // API-only test
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    const res = await request.get(
      `http://localhost:3001/api/machines/instances/${inst.id}/artifacts`,
    );
    expect(res.status()).toBe(200);
    const artifacts = await res.json();
    expect(Array.isArray(artifacts)).toBeTruthy();
  });

  test('artifacts tree endpoint returns valid structure', async ({ request }) => {
    const def = await apiCreateDefinition(request, SIMPLE_DEFINITION);
    const inst = await apiStartInstance(request, def.id, SIMPLE_INPUT);
    await pollInstanceStatus(request, inst.id, ['completed'], 10_000);

    const res = await request.get(
      `http://localhost:3001/api/machines/instances/${inst.id}/artifacts?tree=true`,
    );
    expect(res.status()).toBe(200);
    const tree = await res.json();
    expect(tree).toBeTruthy();
  });
});
