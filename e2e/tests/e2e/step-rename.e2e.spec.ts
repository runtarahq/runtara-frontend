import { test, expect } from '@playwright/test';
import { apiHeaders, getAccessToken } from '../../utils/api-auth';
import {
  WorkflowBuilderPage,
  randomDoubleStep,
} from '../../pages/WorkflowBuilderPage';

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
 * The editor validates a step when it is added and keeps the dialog open on
 * one that leaves the workflow invalid, so neither step can be added to an
 * empty canvas any more:
 * - a Conditional needs both branches to lead somewhere, so it is inserted on
 *   a route between two steps;
 * - a new Split has no steps inside it, which the validator refuses (E004),
 *   so the workflow is created through the API with a Split that has one, and
 *   the Split is renamed in its dialog.
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
const API_BASE = `${GATEWAY_URL}/api/runtime/workflows`;

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

    // A Conditional needs both its branches to lead somewhere, so it is
    // inserted on a route between two steps: both branches then lead on to
    // the second one.
    await builder.addFirstCanvasStep(randomDoubleStep, { name: 'First step' });
    await builder.addCanvasStepAfter('First step', randomDoubleStep, {
      name: 'Next step',
    });
    const firstId = await builder.canvasNodeId('First step');
    const nextId = await builder.canvasNodeId('Next step');
    await builder.useCanvas();
    // Selecting the route shows its toolbar.
    await page
      .locator(`[data-edge-source="${firstId}"][data-edge-target="${nextId}"]`)
      .locator('path')
      .last()
      .click({ force: true });
    await page
      .getByRole('button', { name: 'Insert a step on this route' })
      .click();
    await page.getByTestId('step-picker-step-type-conditional').click();

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

  test('rename shows on canvas', async ({ page, request }) => {
    // 1. Create the workflow with a Split that carries its default name and
    //    has a step inside it
    const createRes = await request.post(`${API_BASE}/create`, {
      headers: apiHeaders(token),
      data: { name: workflowName, description: 'SYN-140 E2E — safe to delete' },
    });
    expect(createRes.status()).toBe(200);
    workflowId = (await createRes.json()).data.id;

    const updateRes = await request.post(`${API_BASE}/${workflowId}/update`, {
      headers: apiHeaders(token),
      data: {
        executionGraph: {
          name: workflowName,
          entryPoint: 'split',
          steps: {
            split: {
              stepType: 'Split',
              id: 'split',
              name: 'Split',
              config: { value: { valueType: 'immediate', value: [1, 2] } },
              subgraph: {
                name: 'Each item',
                entryPoint: 'work',
                steps: {
                  work: {
                    stepType: 'Agent',
                    id: 'work',
                    name: 'Work',
                    agentId: 'utils',
                    capabilityId: 'random-double',
                    inputMapping: {},
                  },
                },
                executionPlan: [],
              },
            },
          },
          executionPlan: [],
        },
      },
    });
    expect(
      updateRes.status(),
      `Update failed: ${(await updateRes.text()).slice(0, 500)}`
    ).toBe(200);

    // 2. Open the Split's NodeConfigDialog from the canvas
    const builder = new WorkflowBuilderPage(page);
    await builder.gotoWorkflow(workflowId);
    await builder.expectStepVisible('Split');
    // Double-click the Split's own area, below the step inside it.
    await builder.useCanvas();
    const splitNode = builder.canvasStep('Split');
    const box = await splitNode.boundingBox();
    expect(box).not.toBeNull();
    await splitNode.dblclick({
      position: { x: box!.width / 2, y: box!.height - 12 },
    });
    await expect(page.getByTestId('node-config-dialog')).toBeVisible();

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
