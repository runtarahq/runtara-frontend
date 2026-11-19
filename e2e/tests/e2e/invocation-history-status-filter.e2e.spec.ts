import { test, expect } from '@playwright/test';

/**
 * Invocation History Status Filter E2E Test — SYN-128
 *
 * Verifies that the Status filter on the runs list (Operations → Runs, which
 * is where /invocation-history leads now) offers only statuses the backend
 * knows.
 *
 * The filter is a set of checkboxes in the Filters popover; no selection means
 * all statuses. It offers the server's whole ExecutionStatus set. "Compiling"
 * and "Timeout" are among them on purpose: the server accepts them as filter
 * aliases (their runs are listed as queued and failed), so each option is
 * checked here against the server too — it must answer the filtered query.
 *
 * Requires: full local stack running (runtara server, frontend)
 */

const VALID_STATUSES: { label: string; value: string }[] = [
  { label: 'Queued', value: 'queued' },
  { label: 'Compiling', value: 'compiling' },
  { label: 'Timeout', value: 'timeout' },
  { label: 'Running', value: 'running' },
  { label: 'Waiting (including paused)', value: 'suspended' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

test.describe('Invocation History Status Filter (SYN-128)', () => {
  test('status filter dropdown shows only valid statuses', async ({ page }) => {
    await page.goto('/invocation-history');
    await page.waitForLoadState('networkidle');

    // Verify we're on the runs list: the old address redirects to it
    await expect(page).toHaveURL(/\/operations\/runs/);
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Runs', level: 1 })
    ).toBeVisible({ timeout: 15000 });

    // Open the Filters popover, which holds the Status checkboxes
    await page.getByRole('button', { name: /^Filters/ }).click();
    const statusGroup = page
      .locator('div.space-y-1\\.5')
      .filter({ has: page.getByText('Status', { exact: true }) })
      .filter({ has: page.getByRole('checkbox') });
    await expect(statusGroup).toBeVisible({ timeout: 5000 });
    await expect(
      statusGroup.getByText('No selection includes all statuses.')
    ).toBeVisible();

    // Get all option texts
    const options = statusGroup
      .locator('label')
      .filter({ has: page.getByRole('checkbox') });
    const optionTexts = (await options.allTextContents()).map((text) =>
      text.trim()
    );

    // Verify the options are exactly the valid statuses, no more and no fewer
    expect(optionTexts).toEqual(VALID_STATUSES.map((status) => status.label));
    await expect(statusGroup.getByRole('checkbox')).toHaveCount(
      VALID_STATUSES.length
    );

    // Verify each offered status is one the backend accepts as a filter
    for (const status of VALID_STATUSES) {
      const checkbox = statusGroup.getByRole('checkbox', {
        name: status.label,
        exact: true,
      });
      const filtered = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'GET' &&
          url.pathname.endsWith('/api/runtime/executions') &&
          url.searchParams.get('status') === status.value
        );
      });
      // The box follows the URL's filter, so it flips a render after the
      // click rather than with it.
      await checkbox.click();
      await expect(checkbox).toBeChecked();
      expect(
        (await filtered).status(),
        `Backend should accept the "${status.label}" status filter`
      ).toBe(200);
      await expect(page.getByText('Could not load runs.')).toHaveCount(0);
      await checkbox.click();
      await expect(checkbox).not.toBeChecked();
      await expect(page).not.toHaveURL(/[?&]status=/);
    }
  });
});
