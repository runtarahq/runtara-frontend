import { expect, type Page, type Route } from '@playwright/test';
import {
  test,
  buildApiKey,
  buildConnection,
  buildTrigger,
  buildWorkflow,
} from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { api, json } from './helpers';

const CUSTOM = { custom_key: 'custom_val' };

async function openApplicationTrigger(page: Page, mockApi: MockApi) {
  const workflow = buildWorkflow({ id: 'scn_1', name: 'Orders sync' });
  const trigger = buildTrigger({
    id: 'trg_app',
    workflow_id: workflow.id,
    trigger_type: 'APPLICATION',
    single_instance: false,
    configuration: { applicationName: 'shop', eventType: 'order', ...CUSTOM },
  } as never);
  const puts: any[] = [];

  await mockApi.bootstrap(page);
  await mockApi.workflows.list(page, [workflow]);
  await mockApi.connections.list(page, []);
  await page.route(api('triggers/trg_app'), (route) => {
    if (route.request().method() === 'PUT') {
      puts.push(route.request().postDataJSON());
    }
    return json(route, { data: trigger, success: true });
  });
  await page.route(api('triggers'), (route) =>
    json(route, { data: [trigger], success: true })
  );

  await page.goto('/invocation-triggers/trg_app');
  await expect(
    page.getByRole('heading', { name: /edit trigger/i })
  ).toBeVisible({ timeout: 15_000 });
  return { puts };
}

const keyInputs = (page: Page) => page.getByPlaceholder('Key');
const valueInputs = (page: Page) => page.getByPlaceholder('Value');
const addPair = (page: Page) =>
  page.getByRole('button', { name: 'Add Key/Value Pair' });

/** Serves the API key list and create, with the create response held open if asked. */
async function mockApiKeys(page: Page, mockApi: MockApi) {
  const posts: unknown[] = [];
  let gate: Promise<void> | null = null;
  await mockApi.bootstrap(page);
  await page.route(api('api-keys'), async (route: Route) => {
    if (route.request().method() !== 'POST') return json(route, []);
    posts.push(route.request().postDataJSON());
    if (gate) await gate;
    return json(
      route,
      { ...buildApiKey({ name: 'Audit key' }), key: SECRET },
      201
    );
  });
  return {
    posts,
    hold() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

const SECRET = 'rt_org_mocked_e2e_deadbeef';

async function openCreateDialog(page: Page) {
  await page.goto('/settings/api-keys');
  await page.getByRole('button', { name: /new api key/i }).click({
    timeout: 15_000,
  });
  await expect(page.getByText('Create API Key')).toBeVisible();
}

async function createKey(page: Page) {
  await page.getByLabel('Name').fill('Audit key');
  await page.getByRole('button', { name: /^create$/i }).click();
}

const usageBody = {
  totalExecutions: 42,
  successfulExecutions: 40,
  failedExecutions: 2,
  executionTimeSeries: [],
  workflowBreakdown: [],
};

const systemBody = {
  success: true,
  message: 'ok',
  data: {
    cpu: { physicalCores: 8, logicalCores: 16, architecture: 'x86_64' },
    memory: {
      availableBytes: 4_000_000_000,
      availableForWorkflowsBytes: 3_200_000_000,
      totalBytes: 8_000_000_000,
    },
    disk: {
      availableBytes: 50_000_000_000,
      totalBytes: 100_000_000_000,
      path: '/data',
    },
  },
};

const rateStatus = (connectionId: string, connectionTitle: string) => ({
  connectionId,
  connectionTitle,
  integrationId: 'http',
  config: null,
  state: { available: true },
  metrics: { isRateLimited: false },
  periodStats: null,
});

async function mockRateLimits(
  page: Page,
  mockApi: MockApi,
  statuses: ReturnType<typeof rateStatus>[]
) {
  const timeline: URLSearchParams[] = [];
  await mockApi.bootstrap(page);
  await mockApi.connections.list(
    page,
    statuses.map((s) =>
      buildConnection({ id: s.connectionId, title: s.connectionTitle })
    )
  );
  await page.route(api('rate-limits'), (route) =>
    json(route, { success: true, data: statuses })
  );
  await page.route(/\/connections\/[^/]+\/rate-limit-history/, (route) =>
    json(route, { success: true, data: [] })
  );
  await page.route(/\/connections\/[^/]+\/rate-limit-timeline/, (route) => {
    timeline.push(new URL(route.request().url()).searchParams);
    return json(route, { success: true, data: { buckets: [] } });
  });
  return { timeline };
}

test.describe('Triggers audit', () => {
  test("TR-1 An existing trigger's custom pairs load", async ({
    page,
    mockApi,
  }) => {
    await openApplicationTrigger(page, mockApi);

    // The sibling fields read the same configuration, and they did load.
    await expect(page.getByLabel('Application name')).toHaveValue('shop');
    await expect(page.getByLabel('Event type')).toHaveValue('order');
    await expect(addPair(page)).toBeVisible();

    await expect(keyInputs(page)).toHaveCount(1);
    await expect(keyInputs(page).nth(0)).toHaveValue('custom_key');
    await expect(valueInputs(page).nth(0)).toHaveValue('custom_val');
  });

  test('TR-2 A removed pair is deleted, not merged back by the edit page', async ({
    page,
    mockApi,
  }) => {
    const { puts } = await openApplicationTrigger(page, mockApi);

    // The stored pair loads (TR-1). A kept pair is added too, proving the
    // form's pairs do reach PUT.
    await expect(keyInputs(page).nth(0)).toHaveValue('custom_key');
    await addPair(page).click();
    await keyInputs(page).nth(1).fill('fresh_key');
    await valueInputs(page).nth(1).fill('fresh_val');

    const firstRow = keyInputs(page).nth(0).locator('..');
    await firstRow.getByRole('button').click();
    await expect(keyInputs(page)).toHaveCount(1);
    await expect(keyInputs(page).nth(0)).toHaveValue('fresh_key');

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].configuration.fresh_key).toBe('fresh_val');
    expect(puts[0].configuration.custom_key).toBeUndefined();
  });
});

test.describe('Settings audit', () => {
  test('ST-1 Closing the API key dialog during submit still shows the created key, and reopening reveals it', async ({
    page,
    mockApi,
  }) => {
    const keys = await mockApiKeys(page, mockApi);
    const release = keys.hold();
    await openCreateDialog(page);
    await createKey(page);
    await expect.poll(() => keys.posts.length).toBe(1);
    await expect(
      page.getByRole('button', { name: 'Creating...' })
    ).toBeDisabled();

    // Fixed: the dialog stays open while the key is being created.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(1);

    release();
    // The server made the key and says so; the key reaches the user.
    await expect(
      page.getByText('API key created', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'API Key Created' })
    ).toBeVisible();
    await expect(page.getByText(SECRET)).toBeVisible();
    expect(keys.posts).toHaveLength(1);
  });

  test('ST-2 Esc on the reveal view keeps the key or asks for confirmation', async ({
    page,
    mockApi,
  }) => {
    const keys = await mockApiKeys(page, mockApi);
    await openCreateDialog(page);
    await createKey(page);
    await expect(page.getByText(SECRET)).toBeVisible();

    await page.keyboard.press('Escape');
    // The key is on screen before Esc: let the dialog finish closing, if it does.
    await page.waitForTimeout(800);
    await expect(
      page.getByText(SECRET).or(page.getByRole('alertdialog')).first()
    ).toBeVisible();
    expect(keys.posts).toHaveLength(1);
  });

  test('ST-3 A clipboard rejection is handled', async ({ page, mockApi }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      const w = window as any;
      w.__clipboardCalls = 0;
      w.__rejections = [];
      window.addEventListener('unhandledrejection', (event) => {
        w.__rejections.push(String(event.reason));
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => {
            w.__clipboardCalls += 1;
            return Promise.reject(new Error('audit clipboard denied'));
          },
        },
      });
    });

    await mockApiKeys(page, mockApi);
    await openCreateDialog(page);
    await createKey(page);
    const key = page.getByText(SECRET);
    await expect(key).toBeVisible();

    await key.locator('..').getByRole('button').click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__clipboardCalls))
      .toBe(1);
    // Give the rejection time to surface before reading that there was none.
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as any).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);

    // A rejected copy must not claim success.
    await expect(page.getByText('Copied to clipboard')).toHaveCount(0);
    await expect(page.getByText('Could not copy the key')).toBeVisible();
  });
});

test.describe('Analytics audit', () => {
  test('AN-1 The 60-second metrics refresh moves the requested window', async ({
    page,
    mockApi,
  }) => {
    const requests: URLSearchParams[] = [];
    await page.clock.install();
    await mockApi.bootstrap(page);
    await page.route(api('metrics/tenant'), (route) => {
      requests.push(new URL(route.request().url()).searchParams);
      return json(route, usageBody);
    });
    await mockApi.analytics.system(page, systemBody);

    await page.goto('/usage');
    await expect(page.getByText('16 cores')).toBeVisible({ timeout: 15_000 });

    // The headline query, not the single-bucket previous-period one.
    const previous = new Set(['1h', '1d', '7d', '30d', '90d']);
    const displayed = () =>
      requests.filter((r) => !previous.has(r.get('granularity') ?? ''));
    await expect.poll(() => displayed().length).toBe(1);

    const before = await page.evaluate(() => Date.now());
    await page.clock.fastForward('01:05');
    await expect.poll(() => displayed().length).toBeGreaterThanOrEqual(2);
    await page.clock.fastForward('01:05');
    await expect.poll(() => displayed().length).toBeGreaterThanOrEqual(3);
    const after = await page.evaluate(() => Date.now());
    expect(after - before).toBeGreaterThanOrEqual(130_000);

    const windows = displayed().map(
      (r) => `${r.get('startTime')}|${r.get('endTime')}`
    );
    console.log(
      `AN-1: ${windows.length} requests over ${after - before}ms, window ${windows[0]}`
    );
    expect(new Set(windows).size).toBeGreaterThan(1);
  });

  test('AN-2 The rate-limit timeline poll moves its window', async ({
    page,
    mockApi,
  }) => {
    await page.clock.install();
    const { timeline } = await mockRateLimits(page, mockApi, [
      rateStatus('conn_limited', 'Limited API'),
    ]);

    await page.goto('/connections/rate-limits?connection=conn_limited');
    await expect(page.getByText('Rate Limit History: Limited API')).toBeVisible(
      { timeout: 15_000 }
    );
    expect(timeline).toHaveLength(1);

    const before = await page.evaluate(() => Date.now());
    await page.clock.fastForward('00:31');
    await expect.poll(() => timeline.length).toBeGreaterThanOrEqual(2);
    await page.clock.fastForward('00:31');
    await expect.poll(() => timeline.length).toBeGreaterThanOrEqual(3);
    const after = await page.evaluate(() => Date.now());
    expect(after - before).toBeGreaterThanOrEqual(62_000);

    const windows = timeline.map(
      (r) => `${r.get('startTime')}|${r.get('endTime')}`
    );
    console.log(
      `AN-2: ${windows.length} requests over ${after - before}ms, window ${windows[0]}`
    );
    expect(new Set(windows).size).toBeGreaterThan(1);
  });

  test('AN-3 The deep-link scroll is not left armed when the connection is missing', async ({
    page,
    mockApi,
  }) => {
    await page.addInitScript(() => {
      const w = window as any;
      w.__historyScrolls = 0;
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args: any[]) {
        if (this.classList.contains('scroll-mt-4')) w.__historyScrolls += 1;
        return original.apply(this, args as never);
      };
    });
    await mockRateLimits(page, mockApi, [
      rateStatus('conn_a', 'Alpha API'),
      rateStatus('conn_b', 'Beta API'),
    ]);
    const scrolls = () =>
      page.evaluate(() => (window as any).__historyScrolls as number);
    const history = page.getByText('Rate Limit History: Alpha API');

    // Control: with no deep link, choosing a card does not scroll.
    await page.goto('/connections/rate-limits');
    await page.getByText('Alpha API').click({ timeout: 15_000 });
    await expect(history).toBeVisible();
    await page.waitForTimeout(500);
    expect(await scrolls()).toBe(0);

    // A link to a connection that is not in the list: nothing to scroll to.
    await page.goto('/connections/rate-limits?connection=conn_gone');
    await expect(page.getByText('Alpha API')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: 'Clear selection' })
    ).toBeVisible();
    await expect(page.getByText(/Rate Limit History/)).toHaveCount(0);
    expect(await scrolls()).toBe(0);

    // A later, ordinary card click must not scroll, as in the control above.
    await page.getByText('Alpha API').click();
    await expect(history).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await scrolls()).toBe(0);
  });
});
