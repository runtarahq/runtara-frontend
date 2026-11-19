import { test, expect } from '@playwright/test';
import { apiHeaders, getAccessToken } from '../../utils/api-auth';
import { WorkflowBuilderPage } from '../../pages/WorkflowBuilderPage';

/**
 * Problem Tab Step Reference E2E Test (SYN-234)
 *
 * Verifies that a step missing required configuration (e.g., Group By without
 * config) puts an ERROR (not just a warning) in the Problem tab that references
 * the correct step name ("Group By").
 *
 * The test used to add the unconfigured step, then save the workflow, and read
 * the server's validation error. The editor now runs the same validator in the
 * browser when a step is added and refuses one that leaves the workflow
 * invalid, so the error shows as soon as "Add step" is pressed and the step
 * never reaches the canvas.
 *
 * Requires: full local stack running (gateway, runtime, management, frontend)
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
const WORKFLOW_NAME = `E2E Step Ref ${Date.now()}`;

const groupByStep = {
  type: 'capability' as const,
  agentId: 'transform',
  capabilityId: 'group-by',
  search: 'Group By',
};

test.describe.serial('Problem tab shows correct step name (SYN-234)', () => {
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

  test('add Group By step without config and verify error references correct step', async ({
    page,
  }) => {
    const builder = new WorkflowBuilderPage(page);
    await builder.gotoWorkflow(workflowId);

    // Add a Group By step from the canvas and confirm its config dialog
    // WITHOUT filling required fields
    await builder.beginFirstCanvasStep(groupByStep);
    const dialog = page.getByTestId('node-config-dialog');
    await dialog.getByTestId('node-config-save').click();

    // The step is refused: its dialog stays open and the step is not added
    await expect(
      page.getByText('Step validation failed', { exact: true })
    ).toBeVisible({ timeout: 10000 });
    await expect(dialog).toBeVisible();
    await builder.expectStepHidden('Group By');

    // Open the Problems tab
    const problemsButton = page.getByRole('button', { name: /Problems/ });
    await problemsButton.click();

    // KEY ASSERTION: The Problem tab should have an ERROR (red, severity=error)
    // about missing configuration that references the "Group By" step.
    // The Errors tab must exist and have at least 1 error.
    const errorsTab = page.getByRole('button', { name: /Errors \([1-9]\d*\)/ });
    await expect(errorsTab).toBeVisible({ timeout: 5000 });

    // Switch to Errors-only filter to isolate from warnings
    await errorsTab.click();
    await page.waitForTimeout(300);

    // Find an error message (red text) about the missing required input
    const missingInputError = page
      .getByTestId('validation-message')
      .filter({ has: page.locator('.text-destructive') })
      .filter({ hasText: /requires input '\w+' but it is not provided/ });
    await expect(missingInputError.first()).toBeVisible({ timeout: 5000 });

    // The error about missing config should have a "Step: Group By" badge
    // This is the core assertion: the error references the CORRECT step
    const errorWithStep = missingInputError.filter({
      hasText: 'Step: Group By',
    });
    await expect(errorWithStep.first()).toBeVisible({ timeout: 5000 });
  });

  test('delete workflow', async ({ page }) => {
    await new WorkflowBuilderPage(page).deleteWorkflowFromList(WORKFLOW_NAME);
    workflowId = '';
  });
});
