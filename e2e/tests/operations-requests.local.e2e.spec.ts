import { test, expect } from '@playwright/test';
import { appPath } from '../utils/app-path';

// The request list shows a page of 25; a server other runs have left requests
// on can hold more than that.
const pageSize = 25;

for (const width of [1440, 390]) {
  test(`Overview request metrics open matching lists at ${width}px`, async ({
    page,
  }) => {
    test.skip(
      !process.env.E2E_OPERATIONS_FIXTURE,
      'Requires the isolated Operations fixture'
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(appPath('/operations'));
    // Each metric is one link: label, value, note.
    const waiting = page
      .getByRole('link')
      .filter({ hasText: 'Waiting for a decision' });
    const overdue = page
      .getByRole('link')
      .filter({ hasText: 'Past their configured due time' });
    await expect(waiting.locator('span').nth(1)).toHaveText(/^\d+$/);
    await expect(overdue.locator('span').nth(1)).toHaveText(/^\d+$/);
    const waitingCount = Number(
      await waiting.locator('span').nth(1).innerText()
    );
    const overdueCount = Number(
      await overdue.locator('span').nth(1).innerText()
    );
    expect(waitingCount).toBeGreaterThan(overdueCount);
    expect(overdueCount).toBeGreaterThan(0);
    await waiting.click();
    await expect(page).toHaveURL(/\/operations\/requests$/);
    await expect(
      page.getByRole('heading', {
        name: `${waitingCount} waiting requests`,
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: 'Requests requiring input' })
        .getByRole('listitem')
    ).toHaveCount(Math.min(waitingCount, pageSize));
    await page.goBack();
    // The tile itself is the link to the overdue list.
    await overdue.click();
    await expect(page).toHaveURL(/\/operations\/requests\?filter=overdue$/);
    await expect(
      page.getByRole('heading', {
        name: `${overdueCount} overdue requests`,
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: 'Requests requiring input' })
        .getByRole('listitem')
    ).toHaveCount(Math.min(overdueCount, pageSize));
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: `${overdueCount} overdue requests`,
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Request filters' })
        .getByRole('link', { name: 'Overdue', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
  });
}
