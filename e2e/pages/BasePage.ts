import { existsSync } from 'node:fs';
import { expect, test, Locator, Page } from '@playwright/test';
import { appPath } from '../utils/app-path';

export abstract class BasePage {
  protected readonly page: Page;
  abstract readonly path: string;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    if (process.env.E2E_DEBUG === 'true') {
      this.page.on('pageerror', (err) =>
        console.log(`[page-error] ${this.path}:`, err.message)
      );
      this.page.on('console', (msg) => {
        if (msg.type() === 'error')
          console.log(`[browser-error] ${this.path}:`, msg.text());
      });
    }
    await this.page.goto(appPath(this.path));
    await this.waitForReady();
  }

  /** Default readiness check: page is interactive and sidebar nav is visible. */
  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await expect(this.main).toBeVisible();
  }

  get main(): Locator {
    return this.page.locator('main');
  }

  get heading(): Locator {
    return this.page.getByRole('heading').first();
  }

  get sidebar(): Locator {
    return this.page.locator('[data-testid="sidebar"], aside').first();
  }

  async expectHeading(pattern: RegExp | string): Promise<void> {
    const re = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    await expect(
      this.page.getByRole('heading', { name: re }).first()
    ).toBeVisible();
  }

  /**
   * Compares the page with its baseline image, where there is one.
   *
   * A baseline is for one platform (fonts render differently on each), and
   * the repository keeps only the CI runners': Linux. So the comparison runs
   * wherever a baseline for this platform is committed, which is CI, and is
   * skipped where there is none, which is a developer's machine. A run with
   * `--update-snapshots` writes the baselines. See e2e/README.md.
   */
  async expectMatchesSnapshot(name: string): Promise<void> {
    const file = `${name}.png`;
    const info = test.info();
    const writing = !['missing', 'none'].includes(info.config.updateSnapshots);
    if (!writing && !existsSync(info.snapshotPath(file))) return;
    await expect(this.page).toHaveScreenshot(file, {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  }
}
