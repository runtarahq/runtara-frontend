import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Runs the implicit-state audit (docs/implicit-state.md) on its own, outside
 * the mocked PR gate. Each spec states the correct behaviour of one claim; the
 * defects are fixed, so these are regression tests, and a failure is a
 * regression. The one that still wraps its assertions in `knownDefect()`
 * (SH-3, kept by decision) passes while that defect is there.
 *
 * About 16 minutes, so CI runs it on main and nightly
 * (.github/workflows/audit.yml) rather than on every pull request.
 *
 *   npx playwright test -c e2e/audit/playwright.audit.config.ts
 */
const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: dir,
  testMatch: /.*\.audit\.spec\.ts/,
  fullyParallel: true,
  workers: 4,
  // A spec that waits on a held response can lose a race on a busy runner.
  retries: process.env.CI ? 1 : 0,
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
