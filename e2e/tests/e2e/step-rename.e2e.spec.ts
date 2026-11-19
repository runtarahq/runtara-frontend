import { test, expect } from '@playwright/test';
import { apiHeaders, getAccessToken } from '../../utils/api-auth';
import { WorkflowBuilderPage } from '../../pages/WorkflowBuilderPage';

/**
 * SYN-140: Cannot rename Conditional and Split step
 *
 * Reproduces the bug where renaming Conditional/Split steps in the
 * NodeConfigDialog did not persist to the canvas node label.
 *
 * For each step type:
 * 1. Create workflow → open the step's dialog → rename in dialog → save dialog
 * 2. Verify canvas shows the custom name (not the default step type name)
 * 3. Delete workflow
 *
 * Each is added to an empty canvas and renamed in the dialog it is added
 * from: a Conditional before it has branches, a Split before it has a body.
 * The editor lists those as problems and lets the step be added.
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

/**
 * Helper: rename the step whose config dialog is open, save the dialog, and
 * verify the canvas node shows the custom name.
 */
async function renameOpenStepAndVerify(
  page: import('@playwright/test').Page,
  builder: WorkflowBuilderPage,
  opts: { stepTypeName: string; customName: string }
): Promise<void> {
  // Rename the step and save the dialog
  await builder.saveOpenCanvasDialog({ name: opts.customName });

  // Verify the node shows the custom name on canvas (not the default)
  // This is the core SYN-140 assertion — the bug caused the canvas to
  // show the original step type name instead of the renamed value.
  await expect(
    page.locator('.react-flow__node').filter({ hasText: opts.customName })
  ).toBeVisible({ timeout: 10000 });
  await expect(builder.canvasStep(opts.customName)).toHaveCount(1);
  await expect(builder.canvasStep(opts.stepTypeName)).toHaveCount(0);
}

// ── Conditional step rename ─────────────────────────────────────────

test.describe.serial('SYN-140: Conditional step rename', () => {
  const workflowName = `SYN-140 Conditional ${Date.now()}`;
  const customName = 'My Custom Conditional';
  let workflowId: string;
  let token: string;

  test.beforeAll(() => {
    token = getAccessToken();
  });

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

  test('rename shows on canvas', async ({ page }) => {
    const builder = new WorkflowBuilderPage(page);
    workflowId = await builder.createWorkflow(workflowName);

    await builder.beginFirstCanvasStep({
      type: 'step',
      stepType: 'Conditional',
    });

    // NodeConfigDialog opens in create mode
    await expect(
      page
        .getByTestId('node-config-dialog')
        .getByText('New Conditional', { exact: true })
    ).toBeVisible({ timeout: 10000 });
    await builder.configureOpenCondition();

    await renameOpenStepAndVerify(page, builder, {
      stepTypeName: 'Conditional',
      customName,
    });
  });

  test('delete workflow', async ({ page }) => {
    await new WorkflowBuilderPage(page).deleteWorkflowFromList(workflowName);

    workflowId = '';
  });
});

// ── Split step rename ───────────────────────────────────────────────

test.describe.serial('SYN-140: Split step rename', () => {
  const workflowName = `SYN-140 Split ${Date.now()}`;
  const customName = 'My Custom Split';
  let workflowId: string;
  let token: string;

  test.beforeAll(() => {
    token = getAccessToken();
  });

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

  test('rename shows on canvas', async ({ page }) => {
    const builder = new WorkflowBuilderPage(page);
    workflowId = await builder.createWorkflow(workflowName);

    await builder.beginFirstCanvasStep({ type: 'step', stepType: 'Split' });

    // NodeConfigDialog opens in create mode; a Split needs its array source
    await expect(
      page
        .getByTestId('node-config-dialog')
        .getByText('New Split', { exact: true })
    ).toBeVisible({ timeout: 10000 });
    await builder.configureOpenCanvasSplitSource();

    await renameOpenStepAndVerify(page, builder, {
      stepTypeName: 'Split',
      customName,
    });
  });

  test('delete workflow', async ({ page }) => {
    await new WorkflowBuilderPage(page).deleteWorkflowFromList(workflowName);

    workflowId = '';
  });
});
