import { expect, type Page, type Route } from '@playwright/test';
import { test, buildConnection, buildConnectionType } from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { api, json, knownDefect } from './helpers';

const LANDING = 'http://localhost:8081/oauth-complete.html';
const INTEGRATION = 'acme_oauth';

// Client ID resets the authorization when changed; Scopes does not.
const oauthType = buildConnectionType({
  integrationId: INTEGRATION,
  displayName: 'Acme',
  category: 'crm',
  oauthConfig: {
    authUrl: 'https://provider.test/authorize',
    tokenUrl: 'https://provider.test/token',
    defaultScopes: 'read',
  },
  fieldBehaviors: {
    client_id: { requiresReauthorization: true },
    client_secret: { requiresReauthorization: true },
  },
  formDefinition: {
    schemaVersion: 1,
    fields: {
      client_id: {
        type: 'string',
        label: 'Client ID',
        required: true,
        access: 'read_write',
      },
      client_secret: {
        type: 'string',
        label: 'Client Secret',
        access: 'write',
        secret: true,
      },
      scopes: { type: 'string', label: 'Scopes', access: 'read_write' },
    },
    sections: [],
    allowUnknownFields: false,
  },
} as never);

const plainType = buildConnectionType({
  integrationId: 'plain_key',
  displayName: 'Plain',
  category: 'api',
  fieldBehaviors: {},
  formDefinition: {
    schemaVersion: 1,
    fields: {
      endpoint: {
        type: 'string',
        label: 'Endpoint',
        required: true,
        access: 'read_write',
      },
    },
    sections: [],
    allowUnknownFields: false,
  },
} as never);

type Conn = Record<string, any>;

function oauthConn(id: string, title: string, status = 'ACTIVE'): Conn {
  return buildConnection({
    id,
    title,
    integrationId: INTEGRATION,
    status: status as never,
    editProjection: {
      values: { client_id: 'cid-server', scopes: 'read' },
      secretState: {},
      version: 'v1',
    },
  } as never) as unknown as Conn;
}

/** A stateful backend: reads answer from `conns`, and the counters are checked. */
async function mockBackend(page: Page, mockApi: MockApi, conns: Conn[] = []) {
  await mockApi.bootstrap(page);
  await mockApi.workflows.list(page, []);
  const byId = new Map(conns.map((conn) => [conn.id as string, conn]));
  const ctl = {
    byId,
    counts: {
      list: 0,
      get: 0,
      put: 0,
      post: 0,
      pending: 0,
      authorize: [] as string[],
      postTitles: [] as string[],
    },
    failGet: false,
    /** Overrides the default PUT, which applies the patch and bumps the version. */
    onPut: null as null | ((route: Route, conn: Conn) => Promise<unknown>),
    pending: null as null | ((route: Route) => Promise<unknown>),
    popups: [] as Page[],
  };

  page.on('popup', (popup) => ctl.popups.push(popup));

  await page.route(api('connections'), (route) => {
    if (route.request().method() === 'POST') {
      ctl.counts.post += 1;
      const body = route.request().postDataJSON();
      ctl.counts.postTitles.push(body.title);
      const id = `conn_new_${ctl.counts.post}`;
      byId.set(id, oauthConn(id, body.title, 'REQUIRES_RECONNECTION'));
      return json(route, { success: true, connectionId: id }, 201);
    }
    ctl.counts.list += 1;
    return json(route, {
      connections: [...byId.values()],
      count: byId.size,
      success: true,
    });
  });
  await page.route(api('connections/[^/]+'), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const conn = byId.get(id);
    if (!conn) return route.fallback();
    if (route.request().method() === 'PUT') {
      ctl.counts.put += 1;
      if (ctl.onPut) return ctl.onPut(route, conn);
      const body = route.request().postDataJSON();
      const version = Number(conn.editProjection.version.slice(1)) + 1;
      conn.editProjection = {
        ...conn.editProjection,
        version: `v${version}`,
        values: {
          ...conn.editProjection.values,
          ...(body.connectionParameterPatch?.set ?? {}),
        },
      };
      if (body.title) conn.title = body.title;
      return json(route, { success: true });
    }
    ctl.counts.get += 1;
    if (ctl.failGet) return json(route, { error: 'boom' }, 500);
    return json(route, { connection: conn, success: true });
  });
  await page.route(api('connections/types'), (route) =>
    json(route, { connectionTypes: [oauthType, plainType] })
  );
  await page.route(api('connections/[^/]+/oauth/authorize'), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-3)!;
    ctl.counts.authorize.push(id);
    return json(route, {
      authorizationUrl: `https://provider.test/authorize?c=${id}`,
    });
  });
  await page.route(api('connections/[^/]+/oauth/pending'), (route) => {
    ctl.counts.pending += 1;
    return ctl.pending
      ? ctl.pending(route)
      : json(route, { success: true, pending: null });
  });
  await page
    .context()
    .route(/provider\.test/, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Consent</h1>' })
    );
  return ctl;
}

const toasts = (page: Page) => page.locator('[data-sonner-toast]');
const toast = (page: Page, text: string | RegExp) =>
  toasts(page).filter({ hasText: text });
const row = (page: Page, title: string) =>
  page.getByRole('row', { name: new RegExp(title) });
const rowReconnect = (page: Page, title: string) =>
  row(page, title).getByRole('button', { name: 'Reconnect' });
const cardButton = (page: Page, name: 'Connect' | 'Reconnect') =>
  page.getByRole('button', { name, exact: true });
const guard = (page: Page) => page.getByRole('alertdialog');
const titleField = (page: Page) =>
  page.getByRole('textbox', { name: /^Title/ });
const clientId = (page: Page) =>
  page.getByRole('textbox', { name: /^Client ID/ });
const scopes = (page: Page) => page.getByRole('textbox', { name: /^Scopes/ });

async function openConnection(page: Page, id: string) {
  await page.goto(`/connections/${id}`);
  await expect(titleField(page)).toBeVisible({ timeout: 15_000 });
}

async function openList(page: Page, first: string) {
  await page.goto('/connections');
  await expect(row(page, first)).toBeVisible({ timeout: 15_000 });
}

async function openCreate(page: Page, integration = INTEGRATION) {
  await page.goto(`/connections/${integration}/create`);
  await expect(titleField(page)).toBeVisible({ timeout: 15_000 });
}

async function fillCreate(page: Page, title = 'New Acme') {
  await titleField(page).fill(title);
  await clientId(page).fill('cid-new');
}

/** Waits for the popup count, and returns the newest popup. */
async function popupOpened(ctl: { popups: Page[] }, count = 1) {
  await expect.poll(() => ctl.popups.length).toBe(count);
  return ctl.popups[count - 1];
}

/** Sends a popup to the real landing page, as the OAuth callback does. */
async function land(popup: Page, query: string) {
  await popup.goto(`${LANDING}?${query}`);
}

/** The real landing page, in a tab of its own: no link to the opener. */
async function landInOtherTab(page: Page, query: string) {
  const tab = await page.context().newPage();
  await tab.goto(`${LANDING}?${query}`);
  await expect(tab.locator('#title')).not.toHaveText(
    'Finishing authorization…'
  );
  await tab.close();
}

test.describe('Connections audit', () => {
  test('CN-1 Opening a second OAuth popup still settles the first flow', async ({
    page,
    mockApi,
  }) => {
    await page.clock.install();
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A', 'REQUIRES_RECONNECTION'),
      oauthConn('conn_b', 'Conn B', 'REQUIRES_RECONNECTION'),
    ]);
    await openList(page, 'Conn A');

    await rowReconnect(page, 'Conn A').click();
    const popup = await popupOpened(ctl);
    await rowReconnect(page, 'Conn B').click();
    // The second flow reuses the named window: A's consent page is gone.
    await expect.poll(() => popup.url()).toContain('c=conn_b');
    expect(ctl.popups).toHaveLength(1);
    expect(ctl.counts.authorize).toEqual(['conn_a', 'conn_b']);
    // Fixed: taking over the popup settles A, and the user is told.
    await expect(
      toast(page, /Reconnect failed: another sign-in replaced it/)
    ).toHaveCount(1);

    // A's own completion: read now, before B's outcome adds a toast and a
    // list refresh of its own.
    const listsBefore = ctl.counts.list;
    await landInOtherTab(page, 'result=ok&connection=conn_a');
    await page.waitForTimeout(1_000);
    const heardAtLanding =
      (await toasts(page).count()) + (ctl.counts.list - listsBefore);

    // B still works.
    await land(popup, 'result=ok&connection=conn_b');
    await expect(
      toast(page, 'Connection reconnected successfully')
    ).toHaveCount(1);

    // Past the 5-minute backstop, A has had an outcome one way or the other:
    // something on its landing or a rejection, here or when B opened.
    await page.clock.fastForward(310_000);
    await page.waitForTimeout(500);
    const rejected = await toast(page, /Reconnect failed/).count();
    // Fixed: A was settled when B took over the popup (see above).
    expect(heardAtLanding + rejected).toBeGreaterThan(0);

    // Control: the same jump does time out a flow that is still listening.
    await expect(rowReconnect(page, 'Conn A')).toBeEnabled();
    await rowReconnect(page, 'Conn A').click();
    await popupOpened(ctl, 2);
    await page.clock.fastForward(301_000);
    await expect(toast(page, 'OAuth authorization timed out')).toHaveCount(1);
  });

  test('CN-2 A failure reported from another tab does not reject this popup', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A', 'REQUIRES_RECONNECTION'),
    ]);
    await openList(page, 'Conn A');
    await rowReconnect(page, 'Conn A').click();
    const popup = await popupOpened(ctl);
    await expect(rowReconnect(page, 'Conn A')).toBeDisabled();

    // Control: a success for another connection is correctly ignored.
    await landInOtherTab(page, 'result=ok&connection=conn_other');
    await page.waitForTimeout(500);
    await expect(toasts(page)).toHaveCount(0);
    await expect(rowReconnect(page, 'Conn A')).toBeDisabled();

    // A failure carries no connection id, so it rejects whichever flow runs.
    await landInOtherTab(page, 'result=error&error=access_denied');
    await page.waitForTimeout(1_000);
    expect(popup.isClosed()).toBe(false);

    // Read once: a retrying toHaveCount(0) would pass when the toast expires.
    expect(
      await toast(page, 'Reconnect failed: access was denied').count()
    ).toBe(0);
    // This popup's real result is still heard.
    await land(popup, 'result=ok&connection=conn_a');
    await expect(toast(page, 'Connection reconnected')).toHaveCount(1, {
      timeout: 1_000,
    });
  });

  test('CN-3 Reloading the OAuth landing page does not report failure', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A', 'REQUIRES_RECONNECTION'),
    ]);
    const context = page.context();
    const listener = await context.newPage();
    await listener.goto('http://localhost:8081/logo-icon.png');
    await listener.evaluate(() => {
      const w = window as unknown as { msgs: unknown[]; bc: BroadcastChannel };
      w.msgs = [];
      w.bc = new BroadcastChannel('runtara-oauth');
      w.bc.onmessage = (event) => w.msgs.push(event.data);
    });
    const received = () =>
      listener.evaluate(() => (window as unknown as { msgs: any[] }).msgs);

    for (const [query, firstTitle] of [
      ['result=pending&connection=conn_x', 'Authorization received'],
      ['result=ok&connection=conn_x', 'Authorization successful'],
    ]) {
      const before = (await received()).length;
      const tab = await context.newPage();
      await tab.goto(`${LANDING}?${query}`);
      await expect(tab.locator('#title')).toHaveText(firstTitle);
      await expect.poll(async () => (await received()).length).toBe(before + 1);
      expect((await received())[before].success).toBe(true);
      expect(tab.url()).not.toContain('result=');

      await tab.reload();
      // The landing script has run, and its broadcast has had time to arrive.
      await expect(tab.locator('#title')).not.toHaveText(
        'Finishing authorization…'
      );
      await page.waitForTimeout(300);
      const reported = (await received()).slice(before);
      expect(reported.filter((message) => !message.success)).toEqual([]);
      await expect(tab.locator('#title')).not.toHaveText(
        'Authorization failed'
      );
      await tab.close();
    }

    // The consequence: a stale tab's reload must not fail a flow running
    // elsewhere.
    await openList(page, 'Conn A');
    await rowReconnect(page, 'Conn A').click();
    await popupOpened(ctl);
    const stale = await context.newPage();
    await stale.goto(`${LANDING}?result=pending&connection=conn_x`);
    await expect(stale.locator('#title')).toHaveText('Authorization received');
    await page.waitForTimeout(300);
    await expect(toasts(page)).toHaveCount(0);
    await stale.reload();
    await expect(stale.locator('#title')).not.toHaveText(
      'Finishing authorization…'
    );
    await page.waitForTimeout(1_000);
    // Read once: a retrying toHaveCount(0) would pass when the toast expires.
    expect(
      await toast(
        page,
        'Reconnect failed: OAuth authorization failed (server_error)'
      ).count()
    ).toBe(0);
  });

  async function conflictWithFailedLatest(page: Page, mockApi: MockApi) {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A'),
    ]);
    ctl.onPut = (route) => {
      // Only the first conflict's read of the latest version fails.
      ctl.failGet = ctl.counts.put === 1;
      return json(route, { error: 'Version conflict.' }, 409);
    };
    await openConnection(page, 'conn_a');
    await scopes(page).fill('read write');
    const getsBefore = ctl.counts.get;
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByText('Review newer connection changes')
    ).toBeVisible();
    await expect(
      page.getByText(/The latest version could not be loaded/)
    ).toBeVisible();
    // The failed read really happened, and the spinner has gone.
    expect(ctl.counts.put).toBe(1);
    expect(ctl.counts.get).toBeGreaterThan(getsBefore);
    await expect(page.getByText('Loading the latest version…')).toHaveCount(0);
    return ctl;
  }

  test('CN-4 After a failed latest-version load, the conflict notice does not describe changes it never loaded', async ({
    page,
    mockApi,
  }) => {
    await conflictWithFailedLatest(page, mockApi);
    // Nothing was loaded, so the notice cannot say what changed on the server.
    // Fixed: the notice says the latest version could not be loaded.
    await expect(
      page.getByText(
        'The server version changed in fields that are not readable in this editor.'
      )
    ).toHaveCount(0, { timeout: 1_000 });
  });

  test('CN-5 After a failed latest-version load, Reload latest can retry the load', async ({
    page,
    mockApi,
  }) => {
    const ctl = await conflictWithFailedLatest(page, mockApi);
    const reload = page.getByRole('button', { name: 'Reload latest' });
    const apply = page.getByRole('button', {
      name: 'Apply my submitted changes',
    });
    await expect(reload).toBeVisible();
    await expect(apply).toBeVisible();
    // Fixed: Reload latest stays usable and tries the load again.
    await expect(reload).toBeEnabled({ timeout: 1_000 });

    // Control: a second 409 whose read succeeds does recover the notice.
    ctl.failGet = false;
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => ctl.counts.put).toBe(2);
    await expect(reload).toBeEnabled();
    await expect(apply).toBeEnabled();
  });

  test('CN-6 The armed reconnect prompt disarms after a status-card reconnect', async ({
    page,
    mockApi,
  }) => {
    const prompt = () => page.getByText('Saved — reconnection needed');
    const conn = oauthConn('conn_a', 'Conn A');
    const ctl = await mockBackend(page, mockApi, [conn]);
    ctl.onPut = (route, target) => {
      target.status = 'REQUIRES_RECONNECTION';
      target.editProjection = {
        ...target.editProjection,
        version: 'v2',
        secretState: { client_secret: { configured: false, clearable: false } },
      };
      return json(route, { success: true });
    };

    /** Arm the prompt, reconnect, then have a later reconnect fail with the
     *  server back to REQUIRES_RECONNECTION. Clearing a secret arms it without
     *  leaving a dirty field, which would put the guard dialog in the way of
     *  the status card (see the CN-19 test). */
    const flow = async (startReconnect: () => Promise<void>) => {
      conn.status = 'ACTIVE';
      conn.editProjection = {
        ...conn.editProjection,
        version: 'v1',
        secretState: { client_secret: { configured: true, clearable: true } },
      };
      await openConnection(page, 'conn_a');
      await page
        .getByRole('button', { name: 'Clear stored Client Secret' })
        .click();
      await page.getByRole('button', { name: 'Save & Reconnect' }).click();
      await expect(prompt()).toBeVisible();
      await expect(cardButton(page, 'Connect')).toBeVisible();

      const seen = ctl.popups.length;
      await startReconnect();
      const popup = await popupOpened(ctl, seen + 1);
      conn.status = 'ACTIVE';
      const close = popup.waitForEvent('close');
      await land(popup, 'result=ok&connection=conn_a');
      await close;
      await expect(cardButton(page, 'Reconnect')).toBeVisible();
      await expect(prompt()).toHaveCount(0);

      conn.status = 'REQUIRES_RECONNECTION';
      await cardButton(page, 'Reconnect').click();
      const second = await popupOpened(ctl, seen + 2);
      await land(second, 'result=error&error=access_denied');
      await expect(cardButton(page, 'Connect')).toBeVisible();
      await second.close();
    };

    // Control: reconnecting from the prompt itself disarms it.
    await flow(() =>
      page.getByRole('button', { name: 'Reconnect now' }).click()
    );
    await page.waitForTimeout(500);
    await expect(prompt()).toHaveCount(0);

    // From the status card, it must not come back blaming the old save.
    await flow(() => cardButton(page, 'Connect').click());
    await page.waitForTimeout(500);
    expect(ctl.counts.put).toBe(2);
    // Fixed: the status card's reconnect answers the armed prompt too.
    await expect(prompt()).toHaveCount(0, { timeout: 1_000 });
    await expect(
      page.getByText(/Because Client Secret changed, the stored authorization/)
    ).toHaveCount(0, { timeout: 1_000 });
  });

  test('CN-7 The pending-confirmation expiry updates while mounted', async ({
    page,
    mockApi,
  }) => {
    const t0 = new Date('2026-06-01T12:00:00Z').getTime();
    await page.clock.install({ time: t0 });
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A', 'PENDING_CONFIRMATION'),
    ]);
    ctl.pending = (route) =>
      json(route, {
        success: true,
        pending: {
          id: 'pending-1',
          account: { id: '42', display: 'ops@acme.test' },
          startedBy: 'api_key:user-1',
          authorizedAt: new Date(t0).toISOString(),
          pendingUntil: new Date(t0 + 15 * 60_000).toISOString(),
        },
      });
    let decisions = 0;
    await page.route(api('connections/conn_a/oauth/confirm'), (route) => {
      decisions += 1;
      return json(route, { error: 'gone' }, 410);
    });

    await openConnection(page, 'conn_a');
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(
      page.getByText(/Confirm it within 1[45] minutes/)
    ).toBeVisible();
    await expect(confirm).toBeEnabled();

    await page.clock.fastForward(20 * 60_000);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => Date.now())).toBeGreaterThan(
      t0 + 15 * 60_000
    );
    // Five minutes past the deadline, the page shows the expiry, as a fresh
    // mount does below.
    await knownDefect('CN-7', async () => {
      await expect(
        page.getByText('The time to confirm it is over.')
      ).toBeVisible({ timeout: 1_000 });
      await expect(confirm).toBeDisabled({ timeout: 1_000 });
    });

    await confirm.click();
    await expect(
      toast(page, 'The time to confirm it is over; start the authorization')
    ).toHaveCount(1);
    expect(decisions).toBe(1);
    // A re-render must not count the distance past the deadline as time left.
    await knownDefect('CN-7', async () => {
      await expect(
        page.getByText(/Confirm it within [45] minutes/)
      ).toHaveCount(0, { timeout: 1_000 });
      await expect(confirm).toBeDisabled({ timeout: 1_000 });
    });

    // Control: mounting afresh at the same moment does see the expiry.
    await openConnection(page, 'conn_a');
    await expect(
      page.getByText('The time to confirm it is over.')
    ).toBeVisible();
    await expect(confirm).toBeDisabled();
  });

  test('CN-8 A pending-confirmation query error is shown to the user', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A', 'PENDING_CONFIRMATION'),
    ]);
    ctl.pending = (route) => json(route, { error: 'boom' }, 500);

    await openConnection(page, 'conn_a');
    await expect(page.getByText('Waiting for confirmation')).toBeVisible();
    // The query failed, and its single retry has run as well.
    await expect.poll(() => ctl.counts.pending).toBe(2);
    await page.waitForTimeout(1_000);
    expect(ctl.counts.pending).toBe(2);
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
    // Any of these will do: the notice with its error, an alert, or a toast.
    await knownDefect('CN-8', async () => {
      await expect
        .poll(
          async () =>
            (await page.getByText('Waiting for your confirmation').count()) +
            (await page.getByRole('alert').count()) +
            (await toasts(page).count()),
          { timeout: 1_000 }
        )
        .toBeGreaterThan(0);
    });

    // Control: the same page with the query answering shows the decision.
    ctl.pending = (route) =>
      json(route, {
        success: true,
        pending: {
          id: 'pending-1',
          startedBy: 'api_key:user-1',
          authorizedAt: new Date().toISOString(),
          pendingUntil: new Date(Date.now() + 600_000).toISOString(),
        },
      });
    await openConnection(page, 'conn_a');
    await expect(page.getByText('Waiting for your confirmation')).toBeVisible();
  });

  test('CN-9 A second click on Create while the popup is open does not create a second connection', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi);
    await openCreate(page);
    await fillCreate(page);
    const create = page.getByRole('button', { name: 'Create & Connect' });

    await create.click();
    const popup = await popupOpened(ctl);
    expect(ctl.counts.post).toBe(1);
    expect(popup.isClosed()).toBe(false);

    // Fixed: Create stays disabled (reading "Saving...") while the popup is
    // open, and a forced click still sends nothing.
    const submit = page.locator('button[type="submit"]');
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    await page.waitForTimeout(1_000);
    expect(ctl.popups).toHaveLength(1);
    expect(ctl.counts.post).toBe(1);
    expect(ctl.counts.postTitles).toEqual(['New Acme']);
    expect(ctl.counts.authorize).toEqual(['conn_new_1']);
    expect([...ctl.byId.keys()]).toEqual(['conn_new_1']);
    expect(popup.url()).toContain('c=conn_new_1');
  });

  test('CN-10 The unsaved-changes blocker stays on during the popup', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi);
    await openCreate(page);
    await fillCreate(page);
    const leave = page.getByRole('link', { name: /^Workflows/ }).first();

    // Control: the same click on the same dirty form is blocked beforehand.
    await leave.click();
    // The heading, not the text: the save bar's "2 unsaved changes" matches
    // that too, once it renders first.
    await expect(
      page.getByRole('heading', { name: 'Unsaved changes' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/\/connections\/acme_oauth\/create$/);

    await page.getByRole('button', { name: 'Create & Connect' }).click();
    const popup = await popupOpened(ctl);
    expect(popup.isClosed()).toBe(false);
    await expect(titleField(page)).toHaveValue('New Acme');

    await leave.click();
    // Let the click land: until it does, the URL is still right, and the save
    // bar's "2 unsaved changes" also matches the text the control looks for.
    await page.waitForTimeout(500);
    await knownDefect('CN-10', async () => {
      await expect(page).toHaveURL(/\/connections\/acme_oauth\/create$/, {
        timeout: 1_000,
      });
      await expect(
        page.getByRole('button', { name: 'Keep editing' })
      ).toBeVisible({ timeout: 1_000 });
    });
  });

  test('CN-11 Popup completion leaves the user where they moved to', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi);
    const cases = [
      {
        query: (id: string) => `result=ok&connection=${id}`,
        message: 'Connection authorized and ready.',
      },
      {
        query: (id: string) => `result=pending&connection=${id}`,
        message: 'Authorized: confirm the connection to use it.',
      },
      {
        query: () => 'result=error&error=access_denied',
        message: "Connection saved, but authorization didn't complete",
      },
    ];

    for (const [index, flow] of cases.entries()) {
      const id = `conn_new_${index + 1}`;
      await openCreate(page);
      await fillCreate(page);
      await page.getByRole('button', { name: 'Create & Connect' }).click();
      const popup = await popupOpened(ctl, index + 1);

      await page
        .getByRole('link', { name: /^Workflows/ })
        .first()
        .click();
      await expect(page).toHaveURL(/\/workflows/);
      await expect(titleField(page)).toHaveCount(0);

      // The toast shows that the outcome has been handled; the code navigates
      // just before it, so give a navigation time to land.
      await land(popup, flow.query(id));
      await expect(toast(page, flow.message)).toHaveCount(1);
      await page.waitForTimeout(500);
      await knownDefect('CN-11', async () => {
        await expect(page).toHaveURL(/\/workflows/, { timeout: 1_000 });
      });
      if (!popup.isClosed()) await popup.close().catch(() => {});
      await expect.poll(() => popup.isClosed()).toBe(true);
    }
  });

  test('CN-12 Closing the popup gives the same kind of toast on reconnect as on create', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A', 'REQUIRES_RECONNECTION'),
    ]);
    const closeAndCancel = async (count: number) => {
      const popup = await popupOpened(ctl, count);
      await popup.close();
      const wait = toast(page, 'Waiting for the sign-in to finish');
      await expect(wait).toHaveCount(1);
      await wait.getByRole('button', { name: 'Cancel' }).click();
      // The cancel has been handled, and its outcome has been reported.
      await expect(wait).toHaveCount(0);
    };
    const errorToasts = page.locator('[data-sonner-toast][data-type="error"]');

    await openList(page, 'Conn A');
    await rowReconnect(page, 'Conn A').click();
    await closeAndCancel(1);
    const reconnectErrors = await errorToasts.count();

    await openCreate(page);
    await fillCreate(page);
    await page.getByRole('button', { name: 'Create & Connect' }).click();
    await closeAndCancel(2);
    await expect(
      page.locator('[data-sonner-toast][data-type="info"]', {
        hasText: 'Connection saved — authorization still needed.',
      })
    ).toHaveCount(1);
    const createErrors = await errorToasts.count();

    await knownDefect('CN-12', async () => {
      expect(reconnectErrors).toBe(createErrors);
    });
  });

  test('CN-13 Starting a second row OAuth does not hide the running flow', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A', 'REQUIRES_RECONNECTION'),
      oauthConn('conn_b', 'Conn B', 'REQUIRES_RECONNECTION'),
    ]);
    await openList(page, 'Conn A');
    const spinner = (title: string) =>
      rowReconnect(page, title).locator('svg.animate-spin');

    await rowReconnect(page, 'Conn A').click();
    await popupOpened(ctl);
    await expect(rowReconnect(page, 'Conn A')).toBeDisabled();
    await expect(spinner('Conn A')).toHaveCount(1);

    // A fix may refuse a second flow, so neither step has to succeed. When B
    // does start, the running id has moved before the authorize request.
    await rowReconnect(page, 'Conn B')
      .click({ timeout: 1_000 })
      .catch(() => {});
    await expect
      .poll(() => ctl.counts.authorize, { timeout: 1_000 })
      .toEqual(['conn_a', 'conn_b'])
      .catch(() => {});
    // Fixed with CN-1: A is settled when B starts, and the user is told.
    await expect
      .poll(
        async () =>
          (await spinner('Conn A').count()) + (await toasts(page).count()),
        { timeout: 1_000 }
      )
      .toBeGreaterThan(0);

    await expect(rowReconnect(page, 'Conn B')).toBeDisabled();
    await expect(spinner('Conn B')).toHaveCount(1);

    await rowReconnect(page, 'Conn A').click();
    await expect
      .poll(() => ctl.counts.authorize)
      .toEqual(['conn_a', 'conn_b', 'conn_a']);
    await expect(spinner('Conn A')).toHaveCount(1);
  });

  test('CN-14 "Save & Reconnect" saves and then reconnects', async ({
    page,
    mockApi,
  }) => {
    const conn = oauthConn('conn_a', 'Conn A');
    const ctl = await mockBackend(page, mockApi, [conn]);
    await openConnection(page, 'conn_a');
    const reconnects = async () => {
      const authorizations = ctl.counts.authorize.length;
      const popups = ctl.popups.length;
      await expect
        .poll(() => ctl.counts.authorize.length, { timeout: 1_500 })
        .toBeGreaterThan(authorizations);
      await expect.poll(() => ctl.popups.length).toBeGreaterThan(popups);
    };

    // The guard dialog's button.
    await clientId(page).fill('cid-edited');
    await cardButton(page, 'Reconnect').click();
    await guard(page).getByRole('button', { name: 'Save & Reconnect' }).click();
    await expect.poll(() => ctl.counts.put).toBe(1);
    await expect(toast(page, 'Connection saved.')).toHaveCount(1);
    await knownDefect('CN-14', reconnects);

    // The save bar's button, under the same label.
    await clientId(page).fill('cid-edited-again');
    await page.getByRole('button', { name: 'Save & Reconnect' }).click();
    await expect.poll(() => ctl.counts.put).toBe(2);
    await knownDefect('CN-14', reconnects);
  });

  test('CN-15 "Save & Reconnect" on an invalid form gives feedback', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A'),
    ]);
    const clickDialogSave = async () => {
      await cardButton(page, 'Reconnect').click();
      await guard(page)
        .getByRole('button', { name: 'Save & Reconnect' })
        .click();
      await expect(guard(page)).toHaveCount(0);
    };

    // A title the frame schema rejects: a toast, the message or a newly marked
    // field will do.
    await openConnection(page, 'conn_a');
    await scopes(page).fill('read write');
    await titleField(page).fill('');
    const invalidBefore = await page.locator('[aria-invalid="true"]').count();
    await clickDialogSave();
    // Fixed: the status card's Save & Reconnect reports the invalid form.
    await expect
      .poll(
        async () =>
          (await toasts(page).count()) +
          (await page.getByText('Please enter a title').count()) +
          (await page.locator('[aria-invalid="true"]').count()) -
          invalidBefore,
        { timeout: 1_500 }
      )
      .toBeGreaterThan(0);
    expect(ctl.counts.put).toBe(0);
    console.log(
      `CN-15 fields marked invalid before and after: ${invalidBefore}`
    );
    // Control: the save bar reports the same invalid form.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(toast(page, 'Please enter a title')).toHaveCount(1);
    expect(ctl.counts.put).toBe(0);

    // A parameter the form analysis rejects: this one does report.
    await openConnection(page, 'conn_a');
    await clientId(page).fill('');
    await clickDialogSave();
    await expect(
      toast(page, 'Fix the highlighted connection fields before saving.')
    ).toHaveCount(1);
    expect(ctl.counts.put).toBe(0);
  });

  test('CN-16 Reconnect is not offered while a connection is pending confirmation', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A', 'PENDING_CONFIRMATION'),
    ]);
    ctl.pending = (route) =>
      json(route, {
        success: true,
        pending: {
          id: 'pending-1',
          startedBy: 'api_key:user-1',
          authorizedAt: new Date().toISOString(),
          pendingUntil: new Date(Date.now() + 600_000).toISOString(),
        },
      });
    await openConnection(page, 'conn_a');
    await expect(page.getByText('Waiting for your confirmation')).toBeVisible();
    // Disabled or gone: either way, no enabled Reconnect.
    await knownDefect('CN-16', async () => {
      await expect(
        cardButton(page, 'Reconnect').and(page.locator(':enabled'))
      ).toHaveCount(0, { timeout: 1_000 });
    });

    await cardButton(page, 'Reconnect').click();
    await popupOpened(ctl);
    expect(ctl.counts.authorize).toEqual(['conn_a']);
    await expect(page.getByText('Waiting for your confirmation')).toBeVisible();
  });

  test('CN-17 Two clicks during form analysis send one submit', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi);
    const create = page.getByRole('button', { name: 'Create connection' });
    const counts: number[] = [];

    // FormRenderer renders no fields until the validator has loaded, so holding
    // the WASM cannot widen the window: these are plain double clicks on a
    // ready form, and the POST is answered at once.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await openCreate(page, 'plain_key');
      await titleField(page).fill('Plain');
      await page.getByRole('textbox', { name: /^Endpoint/ }).fill('https://x');
      const before = ctl.counts.post;
      await create.dblclick();
      await expect(page).toHaveURL(/\/connections$/);
      await page.waitForTimeout(500);
      counts.push(ctl.counts.post - before);
    }
    console.log(`CN-17 POSTs per real double click: ${counts.join(', ')}`);
    // Fixed by CN-9's guard: the page sends its create once.
    expect(counts).toEqual([1, 1, 1]);
  });

  test('CN-18 Reconnect without saving keeps edits, or warns, if the server bumps the version', async ({
    page,
    mockApi,
  }) => {
    const conn = oauthConn('conn_a', 'Conn A');
    const ctl = await mockBackend(page, mockApi, [conn]);
    await openConnection(page, 'conn_a');
    await scopes(page).fill('read write');

    const reconnectWithoutSaving = async (count: number) => {
      await cardButton(page, 'Reconnect').click();
      await guard(page)
        .getByRole('button', { name: 'Reconnect without saving' })
        .click();
      const popup = await popupOpened(ctl, count);
      const close = popup.waitForEvent('close');
      const getsBefore = ctl.counts.get;
      await land(popup, 'result=ok&connection=conn_a');
      await close;
      await expect(
        toast(page, 'Connection reconnected successfully')
      ).not.toHaveCount(0);
      await expect.poll(() => ctl.counts.get).toBeGreaterThan(getsBefore);
      await expect(cardButton(page, 'Reconnect')).toBeEnabled();
    };

    // Control: a refetch at the same version keeps the edit.
    await reconnectWithoutSaving(1);
    await page.waitForTimeout(500);
    await expect(scopes(page)).toHaveValue('read write');
    await expect(page.getByText('1 unsaved change')).toBeVisible();

    // The real server does bump it here: storing the token rewrites the row's
    // updated_at, which is the version (runtara service/oauth.rs).
    conn.editProjection = { ...conn.editProjection, version: 'v2' };
    await reconnectWithoutSaving(2);
    // Time for the refetched version to reach the form: until then the field
    // still holds the edit, which would look like it had been kept.
    await page.waitForTimeout(1_000);
    expect(ctl.counts.put).toBe(0);
    const warnings = await page
      .locator('[data-sonner-toast]', { hasText: /unsaved|discard|lost/i })
      .count();
    const outcome = warnings > 0 ? 'warned' : await scopes(page).inputValue();
    // Fixed: a bump we did not cause keeps the edit.
    expect(outcome).toBe('read write');
    await expect(page.getByText('1 unsaved change')).toBeVisible();
  });

  test('CN-19 After a successful save, the status card reconnects without guarding against unsaved changes', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi, [
      oauthConn('conn_a', 'Conn A'),
    ]);
    await openConnection(page, 'conn_a');
    const saveButton = page.getByRole('button', {
      name: /Save changes|Save & Reconnect/,
    });

    // Control: on a freshly loaded page, Reconnect opens the popup directly.
    await cardButton(page, 'Reconnect').click();
    const popup = await popupOpened(ctl);
    await expect(guard(page)).toHaveCount(0);
    await popup.close();
    const wait = toast(page, 'Waiting for the sign-in to finish');
    await wait.getByRole('button', { name: 'Cancel' }).click();
    await expect(cardButton(page, 'Reconnect')).toBeEnabled();

    // Save a reauth field: the save bar goes, so nothing is left unsaved.
    await clientId(page).fill('cid-edited');
    await page.getByRole('button', { name: 'Save & Reconnect' }).click();
    await expect.poll(() => ctl.counts.put).toBe(1);
    await expect(saveButton).toHaveCount(0);
    await expect(page.getByText(/unsaved change/)).toHaveCount(0);
    await expect(clientId(page)).toHaveValue('cid-edited');

    // Nothing is unsaved, so Reconnect goes straight to the authorization, as
    // it does on a freshly loaded page.
    const before = ctl.counts.authorize.length;
    const reconnectsDirectly = async () => {
      await expect
        .poll(() => ctl.counts.authorize.length, { timeout: 1_000 })
        .toBeGreaterThan(before);
      await expect(guard(page)).toHaveCount(0, { timeout: 1_000 });
    };
    await cardButton(page, 'Reconnect').click();
    await knownDefect('CN-19', reconnectsDirectly);

    // Saving from the dialog settles nothing: Reconnect still does not go through.
    await guard(page).getByRole('button', { name: 'Save & Reconnect' }).click();
    await expect.poll(() => ctl.counts.put).toBe(2);
    await page.waitForTimeout(1_000);
    await cardButton(page, 'Reconnect').click();
    await knownDefect('CN-19', reconnectsDirectly);
  });
});
