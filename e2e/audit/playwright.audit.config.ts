import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Runs the implicit-state audit (docs/implicit-state.md) on its own, outside
 * the mocked PR gate: these specs assert defects that exist today, so a passing
 * spec means "reproduced", and they must not gate pull requests.
 *
 *   npx playwright test -c e2e/audit/playwright.audit.config.ts
 */
const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: dir,
  testMatch: /.*\.audit\.spec\.ts/,
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  outputDir: path.join(dir, '../../e2e-results/audit'),
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: {
    ...devices['Desktop Chrome'],
    // The installed Chrome, so the audit needs no browser download.
    channel: 'chrome',
    baseURL: 'http://localhost:8081',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8081',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
