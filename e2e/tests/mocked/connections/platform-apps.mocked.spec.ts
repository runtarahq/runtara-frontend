import { expect } from '@playwright/test';
import { test, buildConnection, buildConnectionType } from '../../../fixtures';
import {
  ConnectionDetailPage,
  CreateConnectionPage,
} from '../../../pages/ConnectionsPage';

// HubSpot as the server describes it: its own client credentials in the form,
// and an OAuth app the platform registered, offered in their place.
const hubspot = buildConnectionType({
  integrationId: 'hubspot_private_app',
  displayName: 'HubSpot',
  category: 'crm',
  oauthConfig: {
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    defaultScopes: 'oauth',
  },
  fieldBehaviors: {},
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
        required: true,
        access: 'write',
        secret: true,
      },
      scopes: {
        type: 'string',
        label: 'Scopes',
        default: 'oauth',
        access: 'read_write',
      },
    },
    sections: [],
    allowUnknownFields: false,
  },
  managedApps: [
    {
      id: 'hubspot',
      integrationId: 'hubspot_private_app',
      displayName: 'HubSpot',
      scopes: 'oauth crm.objects.contacts.read',
      requiredScopes: 'oauth',
    },
  ],
} as never);

test.describe('Platform OAuth apps (mocked)', () => {
  test('a new connection uses the platform app, with no credentials of its own', async ({
    page,
    mockApi,
  }) => {
    await mockApi.bootstrap(page);
    await mockApi.connections.list(page, []);
    await mockApi.connections.types(page, [hubspot]);
    await mockApi.connections.typeById(page, 'hubspot_private_app', hubspot);
    let created: Record<string, unknown> | undefined;
    await mockApi.raw(
      page,
      /\/api\/runtime(?:\/[^/]+)?\/connections$/,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        created = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, connectionId: 'conn_new' }),
        });
      }
    );

    const view = new CreateConnectionPage(page, 'hubspot_private_app');
    await view.goto();

    const platform = page.getByRole('radio', { name: /Connect with HubSpot/ });
    const own = page.getByRole('radio', { name: /Use your own app/ });
    await expect(platform).toBeChecked();
    await expect(page.getByRole('textbox', { name: /^Client ID/ })).toHaveCount(
      0
    );
    // The tenant's own app brings the credential fields back.
    await own.check();
    await expect(
      page.getByRole('textbox', { name: /^Client ID/ })
    ).toBeVisible();
    await platform.check();
    await expect(page.getByRole('textbox', { name: /^Client ID/ })).toHaveCount(
      0
    );

    await page.getByRole('textbox', { name: /^Title/ }).fill('HubSpot');
    await page.getByRole('button', { name: /Create & Connect/ }).click();
    await expect.poll(() => created).toBeDefined();
    const parameters = created!.connectionParameters as Record<string, unknown>;
    expect(parameters.oauth_app).toBe('hubspot');
    expect(parameters).not.toHaveProperty('client_id');
    expect(parameters).not.toHaveProperty('client_secret');
  });

  test('a connection waiting for confirmation is confirmed by name', async ({
    page,
    mockApi,
  }) => {
    const conn = buildConnection({
      id: 'conn_pending',
      integrationId: 'hubspot_private_app',
      title: 'HubSpot (linked)',
      status: 'PENDING_CONFIRMATION' as never,
      editProjection: {
        values: { oauth_app: 'hubspot', scopes: 'oauth' },
        secretState: {},
        version: 'v1',
      },
    } as never);
    await mockApi.bootstrap(page);
    await mockApi.connections.list(page, [conn]);
    await mockApi.connections.get(page, conn.id, conn);
    await mockApi.connections.types(page, [hubspot]);
    await mockApi.raw(page, /\/connections\/conn_pending\/oauth\/pending$/, {
      success: true,
      pending: {
        id: 'pending-1',
        account: { id: '42', display: 'acme.hubspot.com (ops@acme.test)' },
        startedBy: 'api_key:user-1',
        authorizedAt: new Date().toISOString(),
        pendingUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    });
    let decision: { url: string; body: unknown } | undefined;
    await mockApi.raw(
      page,
      /\/connections\/conn_pending\/oauth\/(confirm|reject)$/,
      async (route) => {
        decision = {
          url: route.request().url(),
          body: route.request().postDataJSON(),
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
    );

    const view = new ConnectionDetailPage(page, conn.id);
    await view.goto();

    await expect(page.getByText('Waiting for your confirmation')).toBeVisible();
    await expect(
      page.getByText('acme.hubspot.com (ops@acme.test)')
    ).toBeVisible();
    await expect(page.getByText(/an API key of user-1/)).toBeVisible();
    await expect(page.getByText(/Managed by the platform/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect.poll(() => decision).toBeDefined();
    expect(decision!.url).toMatch(/\/oauth\/confirm$/);
    expect(decision!.body).toEqual({ pendingId: 'pending-1' });
  });
});
