import { test, expect } from '@playwright/test';
import { apiHeaders, getAccessToken } from '../../utils/api-auth';
import {
  WorkflowBuilderPage,
  randomDoubleStep,
} from '../../pages/WorkflowBuilderPage';

/**
 * Problem Tab Filter Switching E2E Test (SYN-235)
 *
 * Verifies that the Problem tab's filter tabs (All / Errors / Warnings)
 * correctly filter the displayed validation messages.
 *
 * Flow: create workflow → add step → save (triggers server validation errors) →
 *       verify filter tabs switch displayed messages → delete workflow
 *
 * Requires: full local stack running (gateway, runtime, management, frontend)
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
const WORKFLOW_NAME = `E2E Problem Filter ${Date.now()}`;

test.describe.serial('Problem tab filter switching (SYN-235)', () => {
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

  test('add step, save, and verify filter tabs work', async ({ page }) => {
    const builder = new WorkflowBuilderPage(page);
    await builder.gotoWorkflow(workflowId);

    // Add a Random Double step from the canvas (requires no configuration)
    // and save it in its config dialog
    await builder.addFirstCanvasStep(randomDoubleStep);

    // Verify node appears on canvas
    await expect(
      page.locator('.react-flow__node').filter({ hasText: 'Random Double' })
    ).toBeVisible({ timeout: 10000 });

    // Save the workflow — triggers server-side validation/compilation
    const saveButton = page.getByTitle('Save changes');
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Wait for save to complete (either success or validation errors)
    // The save either succeeds (title changes to "No changes to save") or fails
    // (validation panel opens with errors). Wait for either outcome.
    await page.waitForTimeout(5000);

    // Check if the validation panel is expanded with problems
    // The panel might have errors (from server validation) or warnings (from client)
    const problemsButton = page.getByRole('button', { name: /Problems/ });

    // Click Problems tab to ensure we're on it and the panel is expanded
    await problemsButton.click();
    await page.waitForTimeout(500);

    // Check if there are any validation messages
    const allFilterTab = page.getByRole('button', { name: /All \(\d+\)/ });
    const hasMessages = await allFilterTab.isVisible().catch(() => false);

    if (!hasMessages) {
      // If save succeeded with no validation issues, the workflow compiled OK.
      // We still need to test filter tabs, so trigger client-side validation
      // by making the graph invalid: delete the step to make it empty, then save.
      const randomDoubleNode = page
        .locator('.react-flow__node')
        .filter({ hasText: 'Random Double' });
      await randomDoubleNode.click();
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);

      // Save with empty workflow — triggers "at least one step" error
      const saveBtn = page.getByTitle('Save changes');
      await expect(saveBtn).toBeEnabled({ timeout: 5000 });
      await saveBtn.click();
      await page.waitForTimeout(2000);

      // Ensure Problems tab is active
      await page.getByRole('button', { name: /Problems/ }).click();
      await page.waitForTimeout(500);
    }

    // Now we should have validation messages. Read the filter tabs.
    const allTab = page.getByRole('button', { name: /All \(\d+\)/ });
    await expect(allTab).toBeVisible({ timeout: 5000 });

    // Extract total count from the All tab text
    const allTabText = await allTab.textContent();
    const totalMatch = allTabText?.match(/All \((\d+)\)/);
    const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    expect(totalCount).toBeGreaterThan(0);

    // Get the Errors and Warnings tabs
    const errorsTab = page.getByRole('button', { name: /Errors \(\d+\)/ });
    const warningsTab = page.getByRole('button', { name: /Warnings \(\d+\)/ });
    await expect(errorsTab).toBeVisible();
    await expect(warningsTab).toBeVisible();

    // Extract counts
    const errorsTabText = await errorsTab.textContent();
    const errorsMatch = errorsTabText?.match(/Errors \((\d+)\)/);
    const errorCount = errorsMatch ? parseInt(errorsMatch[1], 10) : 0;

    const warningsTabText = await warningsTab.textContent();
    const warningsMatch = warningsTabText?.match(/Warnings \((\d+)\)/);
    const warningCount = warningsMatch ? parseInt(warningsMatch[1], 10) : 0;

    expect(errorCount + warningCount).toBe(totalCount);

    // KEY TEST: Click a filter tab that has 0 messages and verify empty state
    if (warningCount === 0) {
      await warningsTab.click();
      await expect(page.getByText('No issues in this category')).toBeVisible({
        timeout: 3000,
      });

      // Switch back to All — messages should reappear
      await allTab.click();
      // Use a locator for the message list area and check it has content
      const messageItems = page.getByTestId('validation-message');
      await expect(messageItems.first()).toBeVisible({ timeout: 3000 });
    } else if (errorCount === 0) {
      await errorsTab.click();
      await expect(page.getByText('No issues in this category')).toBeVisible({
        timeout: 3000,
      });

      // Switch back to All
      await allTab.click();
      const messageItems = page.getByTestId('validation-message');
      await expect(messageItems.first()).toBeVisible({ timeout: 3000 });
    }

    // Also test: switch between Errors and Warnings tabs
    if (errorCount > 0) {
      await errorsTab.click();
      // Error messages should be visible, count should match
      const visibleErrors = page.locator('.text-destructive');
      await expect(visibleErrors.first()).toBeVisible({ timeout: 3000 });
    }

    if (warningCount > 0) {
      await warningsTab.click();
      // Warning messages should be visible
      const visibleWarnings = page.locator('.text-warning');
      await expect(visibleWarnings.first()).toBeVisible({ timeout: 3000 });
    }

    // Switch back to All — all messages should be visible again
    await allTab.click();
    const allMessages = page.getByTestId('validation-message');
    const messageCount = await allMessages.count();
    expect(messageCount).toBe(totalCount);
  });

  test('delete workflow', async ({ page }) => {
    await new WorkflowBuilderPage(page).deleteWorkflowFromList(WORKFLOW_NAME);
    workflowId = '';
  });
});
