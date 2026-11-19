import { test, expect } from '@playwright/test';
import { apiHeaders, getAccessToken } from '../../utils/api-auth';
import {
  WorkflowBuilderPage,
  randomDoubleStep,
} from '../../pages/WorkflowBuilderPage';

/**
 * SYN-106: Input validation failed for array/object input types
 *
 * Reproduces the bug where executing a workflow with array or object
 * input schema fields failed with "Input validation failed: Invalid
 * schema: true is not of type 'array'".
 *
 * Root causes fixed:
 * 1. Frontend: WorkflowExecuteDialog used raw text <Input> for array/object
 *    fields, sending stringified JSON instead of actual arrays/objects.
 *    Fix: replaced with CompositeValueEditor.
 * 2. Frontend: buildSchemaFromFields generated non-standard JSON Schema
 *    (per-field "required": true instead of proper JSON Schema format).
 *    Fix: generates standard { type: "object", properties, required: [] }.
 * 3. Backend: validate_inputs validated the full {data, variables} wrapper
 *    instead of the inner user data. Fix: validates inputs.data.
 *
 * This test verifies:
 * - Frontend renders structured editors for array/object fields (a tag
 *   input and a key/value editor), not a raw text input
 * - HTTP request body contains properly typed data (not stringified JSON)
 * - Frontend rejects empty required array/object fields (client-side validation)
 * - Backend rejects wrong types via JSON Schema validation
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

test.describe.serial('SYN-106: Execute with complex input types', () => {
  const workflowName = `SYN-106 Complex Input ${Date.now()}`;
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

  // ── Setup: create workflow with required array/object input schema ───

  test('create workflow with array/object input schema', async ({ page }) => {
    await page.goto('/workflows/create');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Name').fill(workflowName);
    await page.getByRole('button', { name: 'Save' }).click();

    await page.waitForURL(
      (url) => /\/workflows\/(?!create\b)[a-zA-Z0-9_-]+$/.test(url.pathname),
      { timeout: 15000 }
    );
    workflowId = page.url().split('/workflows/').pop()!;

    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15000 });

    // Open Settings → Input section
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Settings' })
      .click();
    await page.getByText('Input schema fields').click();

    // Add "tags" field — type array, required (default)
    await page.getByRole('button', { name: 'Add Field' }).click();
    const rows = page.locator('tbody tr');
    const row1 = rows.nth(0);
    await row1.getByPlaceholder('fieldName').fill('tags');
    await row1.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Array' }).click();

    // Add "metadata" field — type object, required (default)
    await page.getByRole('button', { name: 'Add Field' }).click();
    const row2 = rows.nth(1);
    await row2.getByPlaceholder('fieldName').fill('metadata');
    await row2.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Object' }).click();

    // Add a random-double step so the workflow has a valid graph
    const builder = new WorkflowBuilderPage(page);
    await builder.addFirstCanvasStep(randomDoubleStep);

    await expect(
      page.locator('.react-flow__node').filter({ hasText: 'Random Double' })
    ).toBeVisible({ timeout: 10000 });

    // Save via toolbar
    await builder.saveWorkflow();
  });

  // ── Negative: frontend rejects empty required fields ─────────────────

  test('frontend rejects empty required array/object fields', async ({
    page,
  }) => {
    await page.goto(`/workflows/${workflowId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15000 });

    const playButton = page.getByTitle('Start workflow');
    await expect(playButton).toBeVisible({ timeout: 10000 });
    await expect(playButton).toBeEnabled({ timeout: 5000 });
    await playButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Try to execute with empty required fields — should be rejected
    await dialog.getByRole('button', { name: 'Execute' }).click();

    // Validation errors must appear for both required fields
    await expect(dialog.getByText('tags is required')).toBeVisible();
    await expect(dialog.getByText('metadata is required')).toBeVisible();

    // Dialog must stay open (form was NOT submitted)
    await expect(dialog).toBeVisible();

    // Close dialog for next test
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  // ── Negative: backend rejects wrong types via API ────────────────────

  test('backend rejects wrong input types via API', async () => {
    // Send a string where an array is expected, and a number where an object
    // is expected — directly via API to test backend JSON Schema validation.
    const res = await fetch(
      `${GATEWAY_URL}/api/runtime/workflows/${workflowId}/execute`,
      {
        method: 'POST',
        headers: apiHeaders(token),
        body: JSON.stringify({
          inputs: {
            data: {
              tags: 'not-an-array',
              metadata: 12345,
            },
            variables: {},
          },
        }),
      }
    );

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('Input validation failed');
  });

  // ── Positive: valid data passes both frontend and backend ────────────

  test('execute with valid array/object data passes validation', async ({
    page,
  }) => {
    await page.goto(`/workflows/${workflowId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 15000 });

    const playButton = page.getByTitle('Start workflow');
    await expect(playButton).toBeVisible({ timeout: 10000 });
    await expect(playButton).toBeEnabled({ timeout: 5000 });
    await playButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // The dialog draws an array field as a tag input and an object field as
    // a key/value editor — structured editors, not a raw text input
    const tagsInput = dialog
      .locator('[data-field="tags"]')
      .getByRole('textbox');
    await expect(tagsInput).toHaveAttribute(
      'placeholder',
      'Type and press Enter'
    );
    const metadataEditor = dialog
      .locator('[data-field="metadata"]')
      .getByRole('group');
    await expect(metadataEditor).toBeVisible();

    // Populate array field with real data
    await tagsInput.fill('tag1');
    await tagsInput.press('Enter');
    await expect(dialog.getByText('tag1', { exact: true })).toBeVisible();

    // Populate object field with real data
    await metadataEditor.getByPlaceholder('Key').fill('key1');
    await metadataEditor.getByPlaceholder('Value').fill('value1');
    await metadataEditor.getByRole('button', { name: 'Add entry' }).click();
    await expect(metadataEditor.getByPlaceholder('Key').first()).toHaveValue(
      'key1'
    );

    // Intercept the HTTP request to verify wire format
    const isExecuteRequest = (url: string, method: string) =>
      url.includes(`/workflows/${workflowId}/execute`) && method === 'POST';
    const executeRequestPromise = page.waitForRequest(
      (req) => isExecuteRequest(req.url(), req.method()),
      { timeout: 15000 }
    );
    const executeResponsePromise = page.waitForResponse(
      (res) => isExecuteRequest(res.url(), res.request().method()),
      { timeout: 30000 }
    );

    await dialog.getByRole('button', { name: 'Execute' }).click();

    // Verify wire format: arrays are arrays, objects are objects
    const executeRequest = await executeRequestPromise;
    const body = executeRequest.postDataJSON();
    const inputData = body?.inputs?.data;
    expect(inputData).toBeDefined();
    expect(Array.isArray(inputData.tags)).toBe(true);
    expect(inputData.tags).toEqual(['tag1']);
    expect(typeof inputData.metadata).toBe('object');
    expect(inputData.metadata).not.toBeNull();
    expect(Array.isArray(inputData.metadata)).toBe(false);
    expect(inputData.metadata).toEqual({ key1: 'value1' });

    // Backend must accept the correctly typed data
    const executeResponse = await executeResponsePromise;
    expect(
      executeResponse.status(),
      `execute response: ${await executeResponse.text()}`
    ).toBe(200);
    await expect(dialog).not.toBeVisible({ timeout: 15000 });
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  test('delete workflow', async ({ page }) => {
    await new WorkflowBuilderPage(page).deleteWorkflowFromList(workflowName);

    workflowId = '';
  });
});
