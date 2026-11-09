import { expect, type Page, type Route } from '@playwright/test';
import { test, buildConnection, buildConnectionType } from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { api, json } from './helpers';

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
  test('CN-1 Opening a second OAuth popup never settles the first promise', async ({
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

    // A's own completion now reaches nobody: no toast and no list refresh.
    const listsBefore = ctl.counts.list;
    await landInOtherTab(page, 'result=ok&connection=conn_a');
    await page.waitForTimeout(1_000);
    await expect(toasts(page)).toHaveCount(0);
    expect(ctl.counts.list).toBe(listsBefore);

    // B still works, and is the only outcome the user ever hears about.
    await land(popup, 'result=ok&connection=conn_b');
    await expect(
      toast(page, 'Connection reconnected successfully')
    ).toHaveCount(1);
    await expect(toasts(page)).toHaveCount(1);

    // Past the 5-minute backstop: A's timer was cleared with its listeners,
    // so it does not reject either.
    await page.clock.fastForward(310_000);
    await page.waitForTimeout(500);
    await expect(toast(page, /Reconnect failed/)).toHaveCount(0);

    // Control: the same jump does time out a flow that is still listening.
    await expect(rowReconnect(page, 'Conn A')).toBeEnabled();
    await rowReconnect(page, 'Conn A').click();
    await popupOpened(ctl, 2);
    await page.clock.fastForward(301_000);
    await expect(toast(page, 'OAuth authorization timed out')).toHaveCount(1);
  });

  test('CN-2 A failure reported from another tab rejects this popup', async ({
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
    await expect(
      toast(page, 'Reconnect failed: access was denied')
    ).toHaveCount(1);
    expect(popup.isClosed()).toBe(false);

    // This popup's real result then arrives and is not heard.
    await expect(rowReconnect(page, 'Conn A')).toBeEnabled();
    await land(popup, 'result=ok&connection=conn_a');
    await page.waitForTimeout(1_000);
    await expect(toast(page, 'Connection reconnected')).toHaveCount(0);
  });

  test('CN-3 Reloading the OAuth landing page reports failure', async ({
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
      await expect(tab.locator('#title')).toHaveText('Authorization failed');
      await expect.poll(async () => (await received()).length).toBe(before + 2);
      expect((await received())[before + 1]).toMatchObject({
        type: 'oauth-complete',
        success: false,
        error: 'server_error',
        connectionId: '',
      });
      await tab.close();
    }

    // The consequence: a stale tab's reload fails a flow running elsewhere.
    await openList(page, 'Conn A');
    await rowReconnect(page, 'Conn A').click();
    await popupOpened(ctl);
    const stale = await context.newPage();
    await stale.goto(`${LANDING}?result=pending&connection=conn_x`);
    await expect(stale.locator('#title')).toHaveText('Authorization received');
    await page.waitForTimeout(300);
    await expect(toasts(page)).toHaveCount(0);
    await stale.reload();
    await expect(
      toast(page, 'Reconnect failed: OAuth authorization failed (server_error)')
    ).toHaveCount(1);
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
      page.getByText(/The latest version could not be loaded; try again\./)
    ).toBeVisible();
    // The failed read really happened, and the spinner has gone.
    expect(ctl.counts.put).toBe(1);
    expect(ctl.counts.get).toBeGreaterThan(getsBefore);
    await expect(page.getByText('Loading the latest version…')).toHaveCount(0);
    return ctl;
  }

  test('CN-4 After a failed latest-version load, the conflict notice makes a false statement', async ({
    page,
    mockApi,
  }) => {
    await conflictWithFailedLatest(page, mockApi);
    // Nothing was loaded, yet the notice describes what changed on the server.
    await expect(
      page.getByText(
        'The server version changed in fields that are not readable in this editor.'
      )
    ).toBeVisible();
  });

  test('CN-5 After a failed latest-version load, both recovery buttons are disabled', async ({
    page,
    mockApi,
  }) => {
    const ctl = await conflictWithFailedLatest(page, mockApi);
    const reload = page.getByRole('button', { name: 'Reload latest' });
    const apply = page.getByRole('button', {
      name: 'Apply my submitted changes',
    });
    await expect(reload).toBeVisible();
    await expect(reload).toBeDisabled();
    await expect(apply).toBeVisible();
    await expect(apply).toBeDisabled();

    // The only "try again" left is saving again with the stale version: it
    // draws another 409, and only then does the notice recover.
    ctl.failGet = false;
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => ctl.counts.put).toBe(2);
    await expect(reload).toBeEnabled();
    await expect(apply).toBeEnabled();
  });

  test('CN-6 The armed reconnect prompt does not disarm after a status-card reconnect', async ({
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

    // From the status card, it comes back claiming the old save is the reason.
    await flow(() => cardButton(page, 'Connect').click());
    await expect(prompt()).toBeVisible();
    await expect(
      page.getByText(/Because Client Secret changed, the stored authorization/)
    ).toBeVisible();
    expect(ctl.counts.put).toBe(2);
  });

  test('CN-7 The pending-confirmation expiry never updates while mounted', async ({
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
    // Five minutes past the deadline, the page is unchanged.
    await expect(
      page.getByText(/Confirm it within 1[45] minutes/)
    ).toBeVisible();
    await expect(page.getByText('The time to confirm it is over.')).toHaveCount(
      0
    );
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(
      toast(page, 'The time to confirm it is over; start the authorization')
    ).toHaveCount(1);
    expect(decisions).toBe(1);
    // A re-render counts the distance past the deadline as time still left.
    await expect(
      page.getByText(/Confirm it within [45] minutes/)
    ).toBeVisible();
    await expect(confirm).toBeEnabled();

    // Control: mounting afresh at the same moment does see the expiry.
    await openConnection(page, 'conn_a');
    await expect(
      page.getByText('The time to confirm it is over.')
    ).toBeVisible();
    await expect(confirm).toBeDisabled();
  });

  test('CN-8 A pending-confirmation query error renders nothing', async ({
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
    await expect(page.getByText('Waiting for your confirmation')).toHaveCount(
      0
    );
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(toasts(page)).toHaveCount(0);

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

  test('CN-9 A second click on Create while the popup is open creates a second connection', async ({
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

    await expect(create).toBeEnabled();
    await create.click();
    await expect.poll(() => ctl.counts.post).toBe(2);
    expect(ctl.counts.postTitles).toEqual(['New Acme', 'New Acme']);
    await expect
      .poll(() => ctl.counts.authorize)
      .toEqual(['conn_new_1', 'conn_new_2']);
    expect([...ctl.byId.keys()]).toEqual(['conn_new_1', 'conn_new_2']);
    // Both were created, and the first is now out of the popup's sight.
    await expect.poll(() => popup.url()).toContain('c=conn_new_2');
    expect(ctl.popups).toHaveLength(1);
  });

  test('CN-10 The unsaved-changes blocker stays off during the popup', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi);
    await openCreate(page);
    await fillCreate(page);
    const leave = page.getByRole('link', { name: /^Workflows/ }).first();

    // Control: the same click on the same dirty form is blocked beforehand.
    await leave.click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/\/connections\/acme_oauth\/create$/);

    await page.getByRole('button', { name: 'Create & Connect' }).click();
    const popup = await popupOpened(ctl);
    expect(popup.isClosed()).toBe(false);
    await expect(titleField(page)).toHaveValue('New Acme');

    await leave.click();
    await expect(page).toHaveURL(/\/workflows/);
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  });

  test('CN-11 Popup completion navigates the user even if they have moved elsewhere', async ({
    page,
    mockApi,
  }) => {
    const ctl = await mockBackend(page, mockApi);
    const cases = [
      {
        query: (id: string) => `result=ok&connection=${id}`,
        path: () => /\/connections$/,
        message: 'Connection authorized and ready.',
      },
      {
        query: (id: string) => `result=pending&connection=${id}`,
        path: (id: string) => new RegExp(`/connections/${id}$`),
        message: 'Authorized: confirm the connection to use it.',
      },
      {
        query: () => 'result=error&error=access_denied',
        path: (id: string) => new RegExp(`/connections/${id}$`),
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

      await land(popup, flow.query(id));
      await expect(page).toHaveURL(flow.path(id));
      await expect(toast(page, flow.message)).toHaveCount(1);
      if (!popup.isClosed()) await popup.close().catch(() => {});
      await expect.poll(() => popup.isClosed()).toBe(true);
    }
  });

  test('CN-12 Closing the popup on reconnect shows an error toast, unlike create', async ({
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
    };

    await openList(page, 'Conn A');
    await rowReconnect(page, 'Conn A').click();
    await closeAndCancel(1);
    await expect(
      page.locator('[data-sonner-toast][data-type="error"]', {
        hasText:
          'Reconnect failed: the authorization window was closed before it finished. You can try again.',
      })
    ).toHaveCount(1);

    await openCreate(page);
    await fillCreate(page);
    await page.getByRole('button', { name: 'Create & Connect' }).click();
    await closeAndCancel(2);
    await expect(
      page.locator('[data-sonner-toast][data-type="info"]', {
        hasText: 'Connection saved — authorization still needed.',
      })
    ).toHaveCount(1);
    await expect(
      page.locator('[data-sonner-toast][data-type="error"]')
    ).toHaveCount(0);
  });

  test('CN-13 Starting a second row OAuth overwrites the running spinner', async ({
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
    await expect(rowReconnect(page, 'Conn B')).toBeEnabled();

    await rowReconnect(page, 'Conn B').click();
    await expect.poll(() => ctl.counts.authorize).toEqual(['conn_a', 'conn_b']);
    await expect(rowReconnect(page, 'Conn B')).toBeDisabled();
    await expect(spinner('Conn B')).toHaveCount(1);
    // A's flow has had no outcome, yet it looks idle and clickable.
    await expect(spinner('Conn A')).toHaveCount(0);
    await expect(rowReconnect(page, 'Conn A')).toBeEnabled();
    await expect(toasts(page)).toHaveCount(0);

    // And the spinner hops back rather than showing two running flows.
    await rowReconnect(page, 'Conn A').click();
    await expect
      .poll(() => ctl.counts.authorize)
      .toEqual(['conn_a', 'conn_b', 'conn_a']);
    await expect(spinner('Conn A')).toHaveCount(1);
    await expect(spinner('Conn B')).toHaveCount(0);
  });

  test('CN-14 "Save & Reconnect" only saves', async ({ page, mockApi }) => {
    const conn = oauthConn('conn_a', 'Conn A');
    const ctl = await mockBackend(page, mockApi, [conn]);
    await openConnection(page, 'conn_a');

    // The guard dialog's button.
    await clientId(page).fill('cid-edited');
    await cardButton(page, 'Reconnect').click();
    await guard(page).getByRole('button', { name: 'Save & Reconnect' }).click();
    await expect.poll(() => ctl.counts.put).toBe(1);
    await expect(toast(page, 'Connection saved.')).toHaveCount(1);
    await page.waitForTimeout(1_500);
    expect(ctl.counts.authorize).toEqual([]);
    expect(ctl.popups).toHaveLength(0);

    // The save bar's button, under the same label.
    await clientId(page).fill('cid-edited-again');
    await page.getByRole('button', { name: 'Save & Reconnect' }).click();
    await expect.poll(() => ctl.counts.put).toBe(2);
    await page.waitForTimeout(1_500);
    expect(ctl.counts.authorize).toEqual([]);
    expect(ctl.popups).toHaveLength(0);
  });

  test('CN-15 "Save & Reconnect" on an invalid form gives no feedback', async ({
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

    // A title the frame schema rejects: silent.
    await openConnection(page, 'conn_a');
    await scopes(page).fill('read write');
    await titleField(page).fill('');
    const invalidBefore = await page.locator('[aria-invalid="true"]').count();
    await clickDialogSave();
    await page.waitForTimeout(1_500);
    expect(ctl.counts.put).toBe(0);
    await expect(toasts(page)).toHaveCount(0);
    await expect(page.getByText('Please enter a title')).toHaveCount(0);
    // The click changes nothing inline: whatever shows was there before it.
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(
      invalidBefore
    );
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

  test('CN-16 Reconnect is offered while a connection is pending confirmation', async ({
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
    await expect(cardButton(page, 'Reconnect')).toBeEnabled();

    await cardButton(page, 'Reconnect').click();
    await popupOpened(ctl);
    expect(ctl.counts.authorize).toEqual(['conn_a']);
    await expect(page.getByText('Waiting for your confirmation')).toBeVisible();
  });

  test('CN-17 Two clicks during form analysis send two submits', async ({
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
    expect(counts).toEqual([2, 2, 2]);
  });

  test('CN-18 Reconnect without saving loses edits if the server bumps the version', async ({
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

    // The mock bumps the version here; it cannot say whether the real server
    // does so when it stores a token.
    conn.editProjection = { ...conn.editProjection, version: 'v2' };
    await reconnectWithoutSaving(2);
    await expect(scopes(page)).toHaveValue('read');
    await expect(page.getByText('1 unsaved change')).toHaveCount(0);
    await expect(
      page.locator('[data-sonner-toast]', { hasText: /unsaved|discard|lost/i })
    ).toHaveCount(0);
    expect(ctl.counts.put).toBe(0);
  });

  test('CN-19 After a successful save, the status card still guards against unsaved changes that do not exist', async ({
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

    // Reconnect now claims unsaved credential changes, and offers only saving.
    const before = ctl.counts.authorize.length;
    await cardButton(page, 'Reconnect').click();
    await expect(guard(page)).toContainText('unsaved credential changes');
    await expect(
      guard(page).getByRole('button', { name: 'Reconnect without saving' })
    ).toHaveCount(0);

    // Which re-sends the saved value, and leads straight back here.
    await guard(page).getByRole('button', { name: 'Save & Reconnect' }).click();
    await expect.poll(() => ctl.counts.put).toBe(2);
    await page.waitForTimeout(1_000);
    expect(ctl.counts.authorize.length).toBe(before);
    await cardButton(page, 'Reconnect').click();
    await expect(guard(page)).toContainText('unsaved credential changes');
    expect(ctl.counts.authorize.length).toBe(before);
  });
});
