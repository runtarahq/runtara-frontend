import { test, expect } from '@playwright/test';
import { apiHeaders, getAccessToken } from '../../utils/api-auth';
import { WorkflowBuilderPage } from '../../pages/WorkflowBuilderPage';

/**
 * Error Step Validation E2E Test (SYN-204)
 *
 * Verifies that the Error step form enforces required fields (Error Code, Error Message)
 * and prevents saving when they are empty.
 *
 * Flow: create workflow → add Error step → attempt save with empty fields → verify validation errors →
 *       fill required fields → save successfully → delete workflow
 *
 * Requires: full local stack running (gateway, runtime, management, frontend)
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
const WORKFLOW_NAME = `E2E Step Validation ${Date.now()}`;

const errorStep = { type: 'step' as const, stepType: 'Error' };

test.describe.serial('Error Step Validation (SYN-204)', () => {
  let workflowId: string;
  let token: string;

  test.beforeAll(() => {
    token = getAccessToken();
  });

  // Safety-net cleanup: delete workflow via API if UI deletion fails
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

  test('create workflow', async ({ page }) => {
    workflowId = await new WorkflowBuilderPage(page).createWorkflow(
      WORKFLOW_NAME
    );
    expect(workflowId).toBeTruthy();
  });

  test('Error step Save is blocked when required fields are empty', async ({
    page,
  }) => {
    const builder = new WorkflowBuilderPage(page);
    await builder.gotoWorkflow(workflowId);

    // Add an Error step from the canvas
    await builder.beginFirstCanvasStep(errorStep);

    // The step's config dialog is open — Error Code and Error Message should be visible
    const dialog = page.getByTestId('node-config-dialog');
    await expect(dialog.getByText('Error Code *')).toBeVisible();
    await expect(dialog.getByText('Error Message *')).toBeVisible();

    // Try to save without filling required fields
    await dialog.getByTestId('node-config-save').click();

    // Wait a beat for any async submission to complete
    await page.waitForTimeout(1000);

    // Dialog should still be open — save was blocked by validation
    await expect(dialog).toBeVisible();

    // Verify the form fields are still empty (didn't submit and reset)
    await expect(dialog.getByPlaceholder('Enter error code...')).toHaveValue(
      ''
    );
    await expect(dialog.getByPlaceholder('Enter error message...')).toHaveValue(
      ''
    );

    // Validation error messages should appear
    await expect(dialog.getByText('Error Code is required.')).toBeVisible({
      timeout: 3000,
    });
    await expect(dialog.getByText('Error Message is required.')).toBeVisible({
      timeout: 3000,
    });
  });

  test('Error step saves successfully with required fields filled', async ({
    page,
  }) => {
    const builder = new WorkflowBuilderPage(page);
    await builder.gotoWorkflow(workflowId);

    // Add Error step
    await builder.beginFirstCanvasStep(errorStep);

    // Fill required fields
    const dialog = page.getByTestId('node-config-dialog');

    // Fill Error Code
    await dialog
      .getByPlaceholder('Enter error code...')
      .fill('CREDIT_LIMIT_EXCEEDED');

    // Fill Error Message
    await dialog
      .getByPlaceholder('Enter error message...')
      .fill('Credit limit has been exceeded');

    // Save — should succeed and close the dialog
    await dialog.getByTestId('node-config-save').click();

    // Verify dialog closed (save succeeded)
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify the Error node appears on the canvas
    await expect(
      page.locator('.react-flow__node').filter({ hasText: 'Error' })
    ).toBeVisible({ timeout: 10000 });
  });

  test('delete workflow', async ({ page }) => {
    await new WorkflowBuilderPage(page).deleteWorkflowFromList(WORKFLOW_NAME);
    workflowId = '';
  });
});
