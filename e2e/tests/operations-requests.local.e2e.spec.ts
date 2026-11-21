import { test, expect } from '@playwright/test';
import { appPath } from '../utils/app-path';

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
    const waiting = page.getByRole('link').filter({ hasText: 'Open requests' });
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
    // The inbox lists every request in one table; a header row leads it.
    const rows = page
      .getByRole('region', { name: 'Requests' })
      .getByRole('row');
    const tab = (name: string) =>
      page.getByRole('tab', { name: new RegExp(`^${name}`) });
    await waiting.click();
    await expect(page).toHaveURL(/\/operations\/requests$/);
    await expect(tab('Open')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('Open')).toContainText(String(waitingCount));
    await expect(rows).toHaveCount(waitingCount + 1);
    await page.goBack();
    await overdue.click();
    await expect(page).toHaveURL(/\/operations\/requests\?filter=overdue$/);
    await expect(tab('Overdue')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('Overdue')).toContainText(String(overdueCount));
    await expect(rows).toHaveCount(overdueCount + 1);
    await page.reload();
    await expect(tab('Overdue')).toHaveAttribute('aria-selected', 'true');
    await expect(rows).toHaveCount(overdueCount + 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
  });
}
