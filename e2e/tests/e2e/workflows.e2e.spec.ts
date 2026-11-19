import { test, expect } from '@playwright/test';

/**
 * Workflows E2E Tests
 *
 * Full request path:
 * Browser -> Frontend(:8081) -> Gateway(:8080) -> Runtime API(:7001) -> PostgreSQL
 *
 * Requires: full local stack running
 */

test.describe('Workflows E2E', () => {
  test('workflows page loads with header from runtime API', async ({
    page,
  }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    // The page's header is its breadcrumb, whose last item is the heading.
    await expect(
      page
        .getByRole('main')
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('heading', { name: 'Workflows', exact: true, level: 1 })
    ).toBeVisible();
  });

  test('workflows page shows content after loading', async ({ page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    // Either the empty state or the list (a table, one row per workflow or
    // folder) should be visible
    const main = page.getByRole('main');
    const emptyState = main.getByText(/no workflows yet/i);
    const workflowList = main.locator('table tbody tr').first();
    await expect(emptyState.or(workflowList)).toBeVisible();
  });

  test('new workflow button is present and functional', async ({ page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('link', { name: /new workflow/i })
    ).toBeVisible();
  });

  test('can navigate to create workflow page', async ({ page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: /new workflow/i }).click();
    await expect(page).toHaveURL(/\/workflows\/create/);
  });

  test('workflows page renders without API errors', async ({ page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    // Wait for API calls to complete
    await page.waitForTimeout(2000);

    // No network error alerts
    const errorAlert = page.locator('[role="alert"]');
    const alertCount = await errorAlert.count();
    if (alertCount > 0) {
      const alertText = await errorAlert.first().textContent();
      expect(alertText).not.toContain('Network Error');
      expect(alertText).not.toContain('Failed to fetch');
    }
  });
});
