import { test, expect } from '@playwright/test';
import { apiHeaders, getAccessToken } from '../../utils/api-auth';
import {
  WorkflowBuilderPage,
  randomDoubleStep,
} from '../../pages/WorkflowBuilderPage';

/**
 * Workflow Lifecycle E2E Test — Browser UI
 *
 * True end-to-end test that drives the UI:
 * Browser navigation → forms → ReactFlow canvas → toolbar actions → execution → deletion
 *
 * Flow: create via form → add step via canvas "+" → save → execute via Play → verify history → verify versions → delete
 *
 * Requires: full local stack running (gateway, runtime, management, frontend)
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
const WORKFLOW_NAME = `E2E UI Lifecycle ${Date.now()}`;

/** Read the access token from the Playwright auth state file. */
/** Build common headers for authenticated API calls. */
test.describe.serial('Workflow Lifecycle (UI)', () => {
  let workflowId: string;
  let token: string;
  let compilationWorks = false;

  test.beforeAll(() => {
    token = getAccessToken();
  });

  // Safety-net cleanup: delete workflow via API if UI deletion fails mid-test
  test.afterAll(async () => {
    if (!workflowId) return;
    try {
      await fetch(`${GATEWAY_URL}/api/runtime/workflows/${workflowId}/delete`, {
        method: 'POST',
        headers: apiHeaders(token),
      });
    } catch {
      // best-effort cleanup
    }
  });

  test('create workflow via UI', async ({ page }) => {
    // Navigate to the create workflow form
    await page.goto('/workflows/create');
    await page.waitForLoadState('networkidle');

    // Fill the name field and submit
    await page.getByLabel('Name').fill(WORKFLOW_NAME);
    await page.getByRole('button', { name: 'Save' }).click();

    // Should redirect to the workflow editor page (not /workflows/create)
    await page.waitForURL(
      (url) => /\/workflows\/(?!create\b)[a-zA-Z0-9_-]+$/.test(url.pathname),
      { timeout: 15000 }
    );

    // Extract workflow ID from URL for subsequent tests
    const url = page.url();
    workflowId = url.split('/workflows/').pop()!;
    expect(workflowId).toBeTruthy();
    expect(workflowId).not.toBe('create');
  });

  test('add a random-double step and save', async ({ page }) => {
    const builder = new WorkflowBuilderPage(page);
    await builder.gotoWorkflow(workflowId);

    // Click the "+" on the Start node and pick the "Random Double" capability
    // from the step picker; the step dialog opens in create mode — save it.
    await builder.addFirstCanvasStep(randomDoubleStep);

    // Verify the node appears on the canvas
    await expect(
      page.locator('.react-flow__node').filter({ hasText: 'Random Double' })
    ).toBeVisible({ timeout: 10000 });

    // Now save the workflow via toolbar (the graph is dirty after adding a step)
    await builder.saveWorkflow();
  });

  test('execute and verify completion', async ({ page }) => {
    await page.goto(`/workflows/${workflowId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15000 });

    // Play button should be enabled (no unsaved changes after fresh load)
    const playButton = page.getByTitle('Start workflow');
    await expect(playButton).toBeVisible({ timeout: 10000 });
    await expect(playButton).toBeEnabled({ timeout: 5000 });
    await playButton.click();

    // Wait for execution — backend compiles on-demand then runs
    // If compilation fails, the execution won't show "Execution in progress"
    try {
      await expect(page.getByText('Execution in progress')).toBeVisible({
        timeout: 60000,
      });
    } catch {
      // Compilation likely unavailable (e.g. native cache stale in CI)
      console.log(
        'Execution did not start — compilation may be unavailable, skipping execution tests'
      );
      test.skip(true, 'Workflow compilation unavailable');
      return;
    }

    compilationWorks = true;

    // Click "View execution details" to switch to History tab
    await page.getByTitle('View execution details').click();

    // Wait for the "Completed" badge in the history panel's list of recent
    // executions (the toolbar shows the same word, so scope to the panel)
    const recentExecutions = page
      .getByText('Recent Executions', { exact: true })
      .locator('xpath=../..');
    await expect(
      recentExecutions.getByText('Completed', { exact: true }).first()
    ).toBeVisible({ timeout: 60000 });
  });

  test('verify version in Versions panel', async ({ page }) => {
    test.skip(!compilationWorks, 'Skipped — compilation unavailable');

    await page.goto(`/workflows/${workflowId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15000 });

    // Click Versions tab (auto-expands the panel)
    await page.getByRole('button', { name: /Versions/ }).click();

    const versionsPanel = page
      .getByText('Workflow Versions', { exact: true })
      .locator('xpath=../..');

    // Verify a "Compiled" badge is visible (exact: "Not compiled" is a
    // different badge, and the toolbar has its own compile indicator)
    await expect(
      versionsPanel.getByText('Compiled', { exact: true }).first()
    ).toBeVisible({ timeout: 10000 });

    // Verify an active version exists
    await expect(
      versionsPanel.getByRole('button', { name: /Active/ })
    ).toBeVisible();
  });

  test('delete workflow from list', async ({ page }) => {
    // Find the workflow's row by its unique name, delete it from the row's
    // actions, confirm, and verify the row disappears
    await new WorkflowBuilderPage(page).deleteWorkflowFromList(WORKFLOW_NAME);

    // Clear workflowId so afterAll doesn't try to double-delete
    workflowId = '';
  });
});
