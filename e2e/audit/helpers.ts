import { expect, type Page, type Route } from '@playwright/test';
import { buildWorkflow } from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';

/** Matches `/api/runtime[/org]/<suffix>`; `suffix` is a regex source. */
export function api(suffix: string): RegExp {
  return new RegExp(`/api/runtime(?:/[^/]+)?/${suffix}(?:\\?[^/]*)?$`);
}

export function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** A Log-only workflow; `breakpoint` puts a breakpoint on the step. */
export function logWorkflow(id: string, opts: { breakpoint?: boolean } = {}) {
  return buildWorkflow({
    id,
    name: 'Audit workflow',
    currentVersionNumber: 1,
    lastVersionNumber: 1,
    executionGraph: {
      name: 'Audit workflow',
      entryPoint: 'log',
      steps: {
        log: {
          id: 'log',
          stepType: 'Log',
          message: 'hello',
          level: 'info',
          ...(opts.breakpoint ? { breakpoint: true } : {}),
          renderingParameters: { x: 100, y: 100 },
        },
      },
      executionPlan: [],
    } as never,
  });
}

/**
 * Mocks everything the workflow editor page reads, then opens it. `routes` runs
 * after the bootstrap catch-all: Playwright matches the latest route first, so
 * a spec's own mocks must be registered after it or they never fire.
 */
export async function openWorkflow(
  page: Page,
  mockApi: MockApi,
  workflow: ReturnType<typeof buildWorkflow>,
  routes: () => Promise<unknown> = async () => {},
  versions: unknown[] = [
    {
      versionNumber: 1,
      version: 1,
      compiled: true,
      created: '2026-01-01T12:00:00Z',
      trackEvents: false,
    },
  ]
) {
  await mockApi.bootstrap(page);
  await mockApi.agents.catalog(page, []);
  await mockApi.workflows.get(page, workflow.id!, workflow);
  await page.route(api(`workflows/${workflow.id}/versions`), (route) =>
    json(route, { data: versions, success: true })
  );
  await page.route(api(`workflows/${workflow.id}/triggers`), (route) =>
    json(route, { data: [], success: true })
  );
  await page.route(api('metadata/workflow/step-types'), (route) =>
    json(route, { step_types: [] })
  );
  await routes();
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({
    timeout: 15_000,
  });
}
