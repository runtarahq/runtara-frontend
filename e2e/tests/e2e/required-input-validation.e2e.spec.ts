import { test, expect } from '@playwright/test';
import { apiHeaders, getAccessToken } from '../../utils/api-auth';
import {
  WorkflowBuilderPage,
  randomDoubleStep,
} from '../../pages/WorkflowBuilderPage';

/**
 * SYN-110: Required input validation for workflow execution
 *
 * Verifies that:
 * 1. Frontend blocks execution when required fields are not set
 * 2. Empty values (empty string, empty array, 0) are accepted for required fields
 * 3. Optional fields can be cleared and are excluded from payload
 * 4. Backend rejects missing required fields
 * 5. Backend accepts empty values for required fields
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';

test.describe
  .serial('SYN-110: Required input validation for workflow execution', () => {
  const workflowName = `SYN-110 Required Input ${Date.now()}`;
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

  // ── Setup: create workflow with mixed required/optional input schema ──

  test('create workflow with required and optional input fields', async ({
    page,
  }) => {
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

    // Open Settings -> Input section
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Settings' })
      .click();
    await page.getByText('Input schema fields').click();

    // Add "name" field — type string, required (default)
    await page.getByRole('button', { name: 'Add Field' }).click();
    const rows = page.locator('tbody tr');
    const row1 = rows.nth(0);
    await row1.getByPlaceholder('fieldName').fill('name');
    // String type is the default

    // Add "count" field — type number, required
    await page.getByRole('button', { name: 'Add Field' }).click();
    const row2 = rows.nth(1);
    await row2.getByPlaceholder('fieldName').fill('count');
    await row2.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Number' }).click();

    // Add "tags" field — type array, required
    await page.getByRole('button', { name: 'Add Field' }).click();
    const row3 = rows.nth(2);
    await row3.getByPlaceholder('fieldName').fill('tags');
    await row3.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Array' }).click();

    // Add "notes" field — type string, optional
    await page.getByRole('button', { name: 'Add Field' }).click();
    const row4 = rows.nth(3);
    await row4.getByPlaceholder('fieldName').fill('notes');
    // Make it optional by unchecking Required (the row's first checkbox; the
    // second is Nullable)
    const requiredCheckbox = row4.getByRole('checkbox').first();
    await expect(requiredCheckbox).toBeChecked();
    await requiredCheckbox.click();
    await expect(requiredCheckbox).not.toBeChecked();

    // Add a random-double step so the workflow has a valid graph
    const builder = new WorkflowBuilderPage(page);
    await builder.addFirstCanvasStep(randomDoubleStep);

    await expect(
      page.locator('.react-flow__node').filter({ hasText: 'Random Double' })
    ).toBeVisible({ timeout: 10000 });

    // Save via toolbar
    await builder.saveWorkflow();
  });

  // ── Frontend blocks unset required fields ──────────────────────────────

  test('frontend blocks execution when required fields are not set', async ({
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

    // Click Execute without filling any fields
    await dialog.getByRole('button', { name: 'Execute' }).click();

    // Validation errors for required fields
    await expect(dialog.getByText('name is required')).toBeVisible();
    await expect(dialog.getByText('count is required')).toBeVisible();
    await expect(dialog.getByText('tags is required')).toBeVisible();

    // No error for optional "notes"
    await expect(dialog.getByText('notes is required')).not.toBeVisible();

    // Dialog stays open
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  // ── Required fields accept empty values ────────────────────────────────

  test('required fields accept empty values (empty string, empty array, zero)', async ({
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

    // Type in "name" field then clear to empty string (field is touched but empty)
    const nameInput = dialog
      .locator('[data-field="name"]')
      .getByRole('textbox');
    await nameInput.fill('temp');
    await nameInput.clear();

    // Enter 0 for "count"
    const countInput = dialog
      .locator('[data-field="count"]')
      .getByRole('spinbutton');
    await countInput.fill('0');

    // Give "tags" as an empty list: add a tag, then take it away. A list
    // nobody touched is not given at all, and is refused as missing.
    const tagsInput = dialog
      .locator('[data-field="tags"]')
      .getByRole('textbox');
    await tagsInput.fill('temp');
    await tagsInput.press('Enter');
    await expect(dialog.locator('[data-field="tags"]')).toContainText('temp');
    await tagsInput.press('Backspace');
    await expect(dialog.locator('[data-field="tags"]')).not.toContainText(
      'temp'
    );

    // Intercept the request to verify payload
    const executeRequestPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/workflows/${workflowId}/execute`) &&
        req.method() === 'POST',
      { timeout: 15000 }
    );

    await dialog.getByRole('button', { name: 'Execute' }).click();

    const executeRequest = await executeRequestPromise;
    const body = executeRequest.postDataJSON();
    const inputData = body?.inputs?.data;
    expect(inputData).toBeDefined();
    expect(inputData.name).toBe('');
    expect(inputData.tags).toEqual([]);
    expect(inputData.count).toBe(0);
    // notes should NOT be in payload (optional, not touched)
    expect(inputData).not.toHaveProperty('notes');
  });

  // ── An emptied optional field is not sent ──────────────────────────────────

  test('an optional field that is emptied is left out of the payload', async ({
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

    // Fill required fields; "tags" needs a value to count as given
    const tagsInput = dialog
      .locator('[data-field="tags"]')
      .getByRole('textbox');
    await tagsInput.fill('a');
    await tagsInput.press('Enter');
    await dialog
      .locator('[data-field="name"]')
      .getByRole('textbox')
      .fill('test');
    await dialog
      .locator('[data-field="count"]')
      .getByRole('spinbutton')
      .fill('5');

    // Fill optional "notes" field
    const notesInput = dialog
      .locator('[data-field="notes"]')
      .getByRole('textbox');
    await notesInput.fill('some notes');
    await expect(notesInput).toHaveValue('some notes');

    // Now clear it again (the field has no separate clear button any more:
    // emptying an optional field is what leaves it out)
    await notesInput.clear();
    await expect(notesInput).toHaveValue('');

    // Intercept the request
    const executeRequestPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/workflows/${workflowId}/execute`) &&
        req.method() === 'POST',
      { timeout: 15000 }
    );

    await dialog.getByRole('button', { name: 'Execute' }).click();

    const executeRequest = await executeRequestPromise;
    const body = executeRequest.postDataJSON();
    const inputData = body?.inputs?.data;
    expect(inputData).toBeDefined();
    expect(inputData.name).toBe('test');
    expect(inputData.count).toBe(5);
    // notes should NOT be in payload after clearing
    expect(inputData).not.toHaveProperty('notes');
  });

  // ── Backend rejects missing required field ─────────────────────────────

  test('backend rejects missing required field via API', async () => {
    const res = await fetch(
      `${GATEWAY_URL}/api/runtime/workflows/${workflowId}/execute`,
      {
        method: 'POST',
        headers: apiHeaders(token),
        body: JSON.stringify({
          inputs: {
            data: { notes: 'x' },
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

  // ── Backend accepts empty values for required fields ───────────────────

  test('backend accepts empty values for required fields', async () => {
    const res = await fetch(
      `${GATEWAY_URL}/api/runtime/workflows/${workflowId}/execute`,
      {
        method: 'POST',
        headers: apiHeaders(token),
        body: JSON.stringify({
          inputs: {
            data: { name: '', count: 0, tags: [] },
            variables: {},
          },
        }),
      }
    );

    // Should not be a 400 validation error
    expect(res.status).not.toBe(400);
  });

  // ── Cleanup ────────────────────────────────────────────────────────────

  test('delete workflow', async ({ page }) => {
    await new WorkflowBuilderPage(page).deleteWorkflowFromList(workflowName);

    workflowId = '';
  });
});
