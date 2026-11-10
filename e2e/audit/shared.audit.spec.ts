import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect, type Page } from '@playwright/test';
import { test, buildWorkflow, type MockApi } from '../fixtures';
import { api, json, knownDefect } from './helpers';

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src'
);
const WF = 'wf_shared';
const INST = 'inst_shared';
const POLL = 10_000;

const envelope = (data: unknown) => ({ data, success: true });

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

// ---- OIDC boot ---------------------------------------------------------------

const AUTHORITY = 'http://localhost:8081/__idp';
const CLIENT_ID = 'audit-client';

/** Boots the SPA in OIDC mode under a static mount, signed in with a token
 *  that names no tenant (no org_id claim). */
async function bootOidc(
  page: Page,
  mockApi: MockApi,
  { expiresIn = 3600 }: { expiresIn?: number } = {}
) {
  await mockApi.bootstrap(page);
  await page.route(/localhost:8081\/config\.js(\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript; charset=utf-8',
      body: `window.__RUNTARA_CONFIG__=${JSON.stringify({
        authMode: 'oidc',
        hosting: 'static',
        mountPath: '/ui/',
        apiBaseUrl: '',
        oidcAuthority: AUTHORITY,
        oidcClientId: CLIENT_ID,
        oidcAudience: 'audit-audience',
        oidcOrganizations: 'false',
      })};`,
    })
  );
  await page.addInitScript(
    ({ key, expiresIn }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: 'token-1',
          refresh_token: 'refresh-1',
          id_token: 'id-token',
          token_type: 'Bearer',
          scope: 'email openid',
          profile: { sub: 'user-1', email: 'audit@example.test' },
          expires_at: now + expiresIn,
        })
      );
    },
    { key: `oidc.user:${AUTHORITY}:${CLIENT_ID}`, expiresIn }
  );
}

const authHeader = (headers: Record<string, string>) =>
  (headers.authorization ?? '').replace(/^Bearer /, '');

// ---- Run page mock -----------------------------------------------------------

const elided = (preview: string) => ({
  _elided: true,
  _original_size: 1_843_200,
  _preview: preview,
});

type RunShape = (full: boolean) => Record<string, unknown>;

async function mockRun(
  page: Page,
  mockApi: MockApi,
  shape: RunShape,
  onFull?: () => Promise<void>
) {
  await mockApi.bootstrap(page);
  const log = { polls: 0, fulls: 0 };
  await page.route(api(`workflows/${WF}/instances/${INST}`), async (route) => {
    const full = new URL(route.request().url()).searchParams.has('full');
    if (full) {
      log.fulls += 1;
      await onFull?.();
    } else {
      log.polls += 1;
    }
    return json(route, {
      data: {
        instance: {
          id: INST,
          workflowId: WF,
          created: '2026-01-01T12:00:00Z',
          updated: '2026-01-01T12:00:00Z',
          usedVersion: 1,
          steps: [],
          ...shape(full),
        },
        metadata: { workflowName: 'Shared workflow' },
      },
      message: 'ok',
      success: true,
    });
  });
  await page.route(
    api(`workflows/${WF}/instances/${INST}/pending-input`),
    (route) => json(route, envelope({ pendingInputs: [], count: 0 }))
  );
  await page.route(api(`workflows/${WF}/instances/${INST}/steps`), (route) =>
    json(route, envelope({ steps: [], count: 0, totalCount: 0 }))
  );
  await page.route(
    api(`workflows/${WF}/instances/${INST}/step-events`),
    (route) => json(route, envelope({ events: [], count: 0, totalCount: 0 }))
  );
  return log;
}

const explorerOf = (page: Page) =>
  page.getByRole('region', { name: 'Run data' });

// ---- Workflow grid mock ------------------------------------------------------

async function openGrid(page: Page, mockApi: MockApi, workflow: unknown) {
  await mockApi.bootstrap(page);
  await mockApi.workflows.list(page, [workflow as never]);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const restricted = {
  tenantId: 'org_mocked_e2e',
  pricingTier: 'starter',
  features: { database: false, api: true, mcp: true },
  agents: [],
  limits: {},
};

test.describe('Shared audit', () => {
  test('SH-1 A failed tenant lookup at the bare mount stops the spinner', async ({
    page,
    mockApi,
  }) => {
    await bootOidc(page, mockApi);
    let ok = false;
    const lookups: string[] = [];
    await page.route(api('me/tenants'), (route) => {
      lookups.push(authHeader(route.request().headers()));
      return ok
        ? json(route, {
            tenants: [
              { id: 'acme', role: 'owner' },
              { id: 'globex', role: 'viewer' },
            ],
          })
        : json(route, { message: 'boom' }, 500);
    });
    await page.goto('/ui/');

    // The scenario was reached: the signed-in token asked and was refused.
    await expect.poll(() => lookups.length).toBeGreaterThan(0);
    expect(lookups[0]).toBe('token-1');
    // Fixed: the failure stops the spinner and says so.
    await expect(page.locator('.animate-spin')).toHaveCount(0, {
      timeout: 8_000,
    });
    await expect(
      page.getByText('Could not load your workspaces')
    ).toBeVisible();
    await expect(page.getByText('Choose a workspace')).toHaveCount(0);

    // Try again asks once more, and a good answer offers the workspaces.
    const attempts = lookups.length;
    ok = true;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Choose a workspace')).toBeVisible();
    expect(lookups.length).toBe(attempts + 1);
  });

  test('SH-2 A failed lookup at a tenant URL does not render the router', async ({
    page,
    mockApi,
  }) => {
    await bootOidc(page, mockApi);
    await mockApi.workflows.list(page, [
      buildWorkflow({ id: WF, name: 'Tenant workflow' }),
    ]);
    let mode: 'fail' | 'others' = 'fail';
    let lookups = 0;
    await page.route(api('me/tenants'), (route) => {
      lookups += 1;
      return mode === 'fail'
        ? json(route, { message: 'boom' }, 500)
        : json(route, {
            tenants: [
              { id: 'other-1', role: 'owner' },
              { id: 'other-2', role: 'owner' },
            ],
          });
    });
    await page.goto('/ui/acme/workflows');

    await expect.poll(() => lookups).toBeGreaterThan(0);
    // Let the route load: the list is absent until then, defect or not.
    await page.waitForTimeout(5_000);
    // Fixed: the failure stops at the gate, which offers a retry.
    await expect(page.getByText('Tenant workflow')).toHaveCount(0);
    await expect(
      page.getByText('Could not load your workspaces')
    ).toBeVisible();

    // Control: membership that excludes this tenant does stop at the gate, so
    // only the failure let the page through.
    mode = 'others';
    await page.reload();
    await expect(page.getByText('No access')).toBeVisible();
    await expect(page.getByText('Tenant workflow')).toHaveCount(0);
  });

  test('SH-3 Restricted entitlements do not show full access while loading or after a failed fetch', async ({
    page,
    mockApi,
  }) => {
    await mockApi.bootstrap(page);
    const hold = gate();
    let mode: 'hold' | 'fail' = 'hold';
    let entitlementGets = 0;
    let schemaGets = 0;
    await page.route(api('entitlements'), async (route) => {
      entitlementGets += 1;
      if (mode === 'fail') return json(route, { message: 'boom' }, 500);
      await hold.opened;
      return json(route, restricted);
    });
    await page.route(api('object-model/schemas'), (route) => {
      schemaGets += 1;
      return json(route, { schemas: [], totalCount: 0 });
    });
    await page.goto('/objects/types');

    const database = page.getByRole('link', { name: 'Database' });
    const disabled = page.getByText('Feature not enabled');

    // Loading: the gated page and its menu entry stay shut until the answer.
    await expect.poll(() => entitlementGets).toBeGreaterThan(0);
    // Let the route load: the page's own request comes after that.
    await page.waitForTimeout(3_000);
    // Fixed: the gate waits for the tenant's answer.
    expect(schemaGets, 'gated page requests while loading').toBe(0);
    await expect(database).toHaveCount(0);

    // Control: the answer arrives and the same tenant is locked out.
    hold.open();
    await expect(disabled).toBeVisible();
    await expect(database).toHaveCount(0);

    // Failed fetch: the answer is unknown, which must not read as full access.
    mode = 'fail';
    const beforeFail = entitlementGets;
    await page.reload();
    await expect.poll(() => entitlementGets).toBeGreaterThan(beforeFail);
    await page.waitForTimeout(3_000);
    // Kept by design: after a failed fetch the documented permissive fallback
    // applies (see useEntitlementsState), so this half still reproduces.
    await knownDefect('SH-3', async () => {
      await expect(database).toHaveCount(0);
    });
  });

  test('SH-4 A failed /me keeps known permissions', async ({
    page,
    mockApi,
  }) => {
    // Under a minute left, so the silent renew fires straight away; the token
    // endpoint holds it until the first /me has been observed.
    await bootOidc(page, mockApi, { expiresIn: 30 });
    await mockApi.workflows.list(page, [
      buildWorkflow({ id: WF, name: 'Permission workflow' }),
    ]);
    await page.route(api('me/tenants'), (route) =>
      json(route, { tenants: [{ id: 'acme', role: 'viewer' }] })
    );
    const me: { token: string; status: number }[] = [];
    await page.route(api('me'), (route) => {
      const token = authHeader(route.request().headers());
      const status = token === 'token-1' ? 200 : 500;
      me.push({ token, status });
      return status === 200
        ? json(route, {
            role: 'viewer',
            permissions: { 'workflow:read': ['viewer'] },
          })
        : json(route, { message: 'boom' }, 500);
    });
    const renew = gate();
    let renewals = 0;
    await page.route(`${AUTHORITY}/oauth/token`, async (route) => {
      renewals += 1;
      await renew.opened;
      return json(route, {
        access_token: 'token-2',
        refresh_token: 'refresh-2',
        token_type: 'Bearer',
        scope: 'email openid',
        expires_in: 3600,
      });
    });
    await page.goto('/ui/acme/workflows');

    const row = page
      .getByRole('row')
      .filter({ hasText: 'Permission workflow' });
    await expect(row).toBeVisible();
    // A viewer: the server said no execute and no delete.
    await expect.poll(() => me.some((m) => m.status === 200)).toBe(true);
    await expect(row.getByTitle('Start')).toHaveCount(0);
    await expect(row.getByTitle('Delete')).toHaveCount(0);
    await expect.poll(() => renewals).toBeGreaterThan(0);

    renew.open();
    await expect
      .poll(() => me.some((m) => m.token === 'token-2' && m.status === 500))
      .toBe(true);

    console.log(`SH-4 /me calls: ${JSON.stringify(me)}`);
    // Let the failure land: the controls are absent until it does.
    await page.waitForTimeout(1_000);
    // The role did not change, only a read failed, so the controls stay away.
    // Fixed: the failed read keeps the known role.
    await expect(row.getByTitle('Start')).toHaveCount(0);
    await expect(row.getByTitle('Delete')).toHaveCount(0);
  });

  test("SH-5 One field's dependency change clears only that field; no product code supplies a resolver", async ({
    page,
    mockApi,
  }) => {
    // No page in the product passes a frame with resolveOptions, so nothing
    // reaches this through the UI; the claim is exercised on the real module in
    // the browser, and the reachability half is settled by grep.
    const callers = walk(SRC)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) =>
        fs.readFileSync(file, 'utf8').includes('resolveOptions')
      )
      .map((file) => path.relative(SRC, file))
      .sort();
    // The contract's declaration and its one reader; nobody sets it.
    expect(callers).toEqual([
      'shared/forms/FormRenderer.tsx',
      'shared/forms/types.ts',
    ]);

    await mockApi.bootstrap(page);
    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.evaluate(`(async () => {
      const boot = await (await fetch('/src/bootstrap.tsx')).text();
      const domUrl = boot.match(/["']([^"']*deps\\/react-dom_client\\.js[^"']*)["']/)[1];
      const reactUrl = domUrl.replace('react-dom_client.js', 'react.js');
      const React = (await import(reactUrl)).default;
      const ReactDOM = (await import(domUrl)).default;
      const { useResolvedOptions } = await import('/src/shared/forms/use-resolved-options.ts');
      const definition = {
        fields: {
          x: { type: 'string' },
          y: { type: 'string' },
          a: { type: 'string', control: { kind: 'lookup', optionResolver: 'ra', optionDependencies: ['x'] } },
          b: { type: 'string', control: { kind: 'lookup', optionResolver: 'rb', optionDependencies: ['y'] } },
        },
      };
      window.__calls = [];
      window.__gate = Promise.resolve();
      const resolver = async ({ fieldName }) => {
        window.__calls.push(fieldName);
        await window.__gate;
        return { options: [{ value: fieldName, label: fieldName }] };
      };
      function Harness() {
        const [data, setData] = React.useState({ x: 1, y: 1 });
        window.__setData = setData;
        const state = useResolvedOptions(definition, data, resolver);
        return React.createElement('pre', { id: 'audit-harness' }, JSON.stringify({
          options: Object.keys(state.options).sort(),
          loading: [...state.loading].sort(),
        }));
      }
      const host = document.createElement('div');
      document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(Harness));
    })()`);

    const harness = page.locator('#audit-harness');
    await expect(harness).toHaveText('{"options":["a","b"],"loading":[]}');
    const callsBefore = await page.evaluate(`window.__calls.slice()`);

    // Only x changes, which only field a depends on.
    await page.evaluate(`
      window.__gate = new Promise((resolve) => { window.__release = resolve; });
      window.__setData({ x: 2, y: 1 });
    `);
    // The change has landed: field a is reloading.
    await expect(harness).toHaveText(/"loading":\[[^\]]*"a"/);
    const calls = (await page.evaluate(`window.__calls.slice()`)) as string[];
    const before = callsBefore as string[];
    // Fixed: only the changed field is asked again; b keeps its own.
    await expect(harness).toHaveText(/"options":\[(?:"a",)?"b"\]/);
    expect(
      calls.filter((c) => c === 'b').length,
      'field b was not fetched again, as its dependency did not change'
    ).toBe(before.filter((c) => c === 'b').length);

    await page.evaluate(`window.__release()`);
    await expect(harness).toHaveText('{"options":["a","b"],"loading":[]}');
  });

  test('SH-6 After "Load full value", polled updates to that section still show', async ({
    page,
    mockApi,
  }) => {
    let version = 1;
    const log = await mockRun(page, mockApi, (full) => ({
      status: 'running',
      inputs: {
        data: {
          catalogId: `cat_v${version}`,
          upload: full ? 'FULL-BYTES' : elided('JVBER'),
        },
      },
      outputs: { revision: `out_v${version}` },
    }));
    await page.goto(`/workflows/${WF}/history/${INST}`);

    const explorer = explorerOf(page);
    await explorer.getByRole('button', { name: 'JSON', exact: true }).click();
    const panel = explorer.getByRole('tabpanel');
    await explorer.getByRole('tab', { name: /^Input/ }).click();
    await expect(panel).toContainText('cat_v1');
    await explorer
      .getByRole('button', { name: 'Load full value' })
      .first()
      .click();
    await expect(panel).toContainText('FULL-BYTES');
    expect(log.fulls).toBe(1);

    version = 2;
    const polls = log.polls;
    await expect
      .poll(() => log.polls, { timeout: POLL + 5_000 })
      .toBeGreaterThan(polls);

    // Control: the poll landed; the section that was not loaded in full moved on.
    await explorer.getByRole('tab', { name: /^Output/ }).click();
    await expect(panel).toContainText('out_v2');
    await explorer.getByRole('tab', { name: /^Input/ }).click();
    await knownDefect('SH-6', async () => {
      await expect(panel).toContainText('cat_v2');
    });
  });

  test("SH-7 Overlapping full-value loads keep each other's indicator", async ({
    page,
    mockApi,
  }) => {
    const gates = [gate(), gate()];
    let nextFull = 0;
    await mockRun(
      page,
      mockApi,
      (full) => ({
        status: 'completed',
        inputs: { data: { upload: full ? 'FULL-INPUT' : elided('AAA') } },
        outputs: { ok: true },
        state: { blob: full ? 'FULL-STATE' : elided('BBB') },
      }),
      () => gates[nextFull++].opened
    );
    await page.goto(`/workflows/${WF}/history/${INST}`);

    const explorer = explorerOf(page);
    const panelNote = (name: string) =>
      explorer.getByRole('button', { name, exact: true }).first();

    await explorer.getByRole('tab', { name: /^Input/ }).click();
    await panelNote('Load full value').click();
    await expect(panelNote('Loading…')).toBeVisible();

    await explorer.getByRole('tab', { name: /^State/ }).click();
    await panelNote('Load full value').click();
    await expect(panelNote('Loading…')).toBeVisible();
    await expect.poll(() => nextFull).toBe(2);

    // The input load finishes; the state load is still held open.
    gates[0].open();
    await expect(page.getByText('Loaded the full input')).toBeVisible();
    // Loading… was already showing: let the finished load's update land.
    await page.waitForTimeout(500);

    // State's request is still in flight, so it should still say so.
    // Fixed: the other section's load keeps its own indicator.
    await expect(panelNote('Loading…')).toBeVisible();

    gates[1].open();
    await expect(page.getByText('Loaded the full state')).toBeVisible();
    await expect(explorer.getByText('1 large value not loaded')).toHaveCount(0);
  });

  test('SH-8 File input: overlapping reads, with the newest choice winning', async ({
    page,
    mockApi,
  }) => {
    // Reads are held as a mock response would be: a real read of the same files
    // would settle too fast to overlap reliably.
    await page.addInitScript(() => {
      const original = FileReader.prototype.readAsDataURL;
      const held: Record<string, () => void> = {};
      (window as any).__heldReads = held;
      FileReader.prototype.readAsDataURL = function (file: File) {
        held[file.name] = () => original.call(this, file);
      };
    });
    const workflow = buildWorkflow({
      id: 'wf_file',
      name: 'File workflow',
      inputSchema: { doc: { type: 'file', required: true } },
    } as never);
    await openGrid(page, mockApi, workflow);
    const bodies: any[] = [];
    await page.route(api('workflows/wf_file/execute'), (route) => {
      bodies.push(route.request().postDataJSON());
      return json(route, envelope({ instanceId: 'inst_x', status: 'queued' }));
    });
    await page.goto('/workflows');
    const row = page.getByRole('row').filter({ hasText: 'File workflow' });
    await row.hover();
    await row.getByTitle('Start').click();

    const dialog = page.getByRole('dialog');
    const input = dialog.locator('input[type="file"]');
    const file = (name: string) => ({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from(name),
    });
    await input.setInputFiles(file('first.txt'));
    await input.setInputFiles(file('second.txt'));
    await expect
      .poll(() => page.evaluate(() => Object.keys((window as any).__heldReads)))
      .toEqual(['first.txt', 'second.txt']);

    // The newer choice finishes first and shows.
    await page.evaluate(() => (window as any).__heldReads['second.txt']());
    await expect(dialog.getByText('second.txt')).toBeVisible();

    // The older choice finishes last; let its read land before submitting.
    await page.evaluate(() => (window as any).__heldReads['first.txt']());
    await page.waitForTimeout(500);

    await dialog.getByRole('button', { name: 'Execute' }).click();
    await expect.poll(() => bodies.length).toBe(1);
    // Fixed: the last file chosen wins.
    expect(JSON.stringify(bodies[0])).toContain('second.txt');
    expect(JSON.stringify(bodies[0])).not.toContain('first.txt');
  });

  test('SH-9 A 429 entitlement denial gets the entitlement toast', async ({
    page,
    mockApi,
  }) => {
    const workflow = buildWorkflow({
      id: 'wf_limit',
      name: 'Limit workflow',
      inputSchema: {},
    } as never);
    await openGrid(page, mockApi, workflow);
    let status = 429;
    let hits = 0;
    await page.route(api('workflows/wf_limit/execute'), (route) => {
      hits += 1;
      return json(
        route,
        {
          code: 'ENTITLEMENT_LIMIT_EXCEEDED',
          limit: 'maxConcurrentExecutions',
          maximum: 5,
          message: 'Concurrent run limit reached',
        },
        status
      );
    });
    await page.goto('/workflows');
    const row = page.getByRole('row').filter({ hasText: 'Limit workflow' });
    await row.hover();
    await row.getByTitle('Start').click();

    await expect.poll(() => hits).toBe(1);
    // Fixed: a 429 with an entitlement body gets the same toast as a 403.
    await expect(page.getByText('Tier limit reached')).toBeVisible();

    // Control: the identical body at 403 gets the entitlement toast.
    status = 403;
    await row.hover();
    await row.getByTitle('Start').click();
    await expect.poll(() => hits).toBe(2);
    await expect(page.getByText('Tier limit reached')).toBeVisible();
  });

  test('SH-10 readJsonEventStream has a non-test caller or is gone', async () => {
    const uses = walk(SRC)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) =>
        fs.readFileSync(file, 'utf8').includes('readJsonEventStream')
      )
      .map((file) => path.relative(SRC, file))
      .sort();
    // Fixed: the orphaned module is gone.
    expect(uses).not.toEqual(['shared/utils/sse.ts']);
  });
});
