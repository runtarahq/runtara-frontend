import { generateKeyPairSync } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test, buildConnectionType, type MockApi } from '../../../fixtures';
import { CreateConnectionPage } from '../../../pages/ConnectionsPage';

// A connection's secrets are sealed in the browser before they are sent
// (docs/sealed-secrets.md): the form asks for an offer with the request it
// will save, seals under it with seal's WASM module, and saves that request.

const SECRET = 'not-a-real-token-4f1c';

const bearer = buildConnectionType({
  integrationId: 'http_bearer',
  displayName: 'HTTP Bearer Token',
  fieldBehaviors: {},
  sealedFields: ['token'],
  formDefinition: {
    schemaVersion: 1,
    fields: {
      base_url: {
        type: 'string',
        label: 'Base URL',
        required: true,
        access: 'read_write',
      },
      token: {
        type: 'string',
        label: 'Token',
        required: true,
        access: 'write',
        secret: true,
        control: { kind: 'password' },
      },
    },
    sections: [],
    allowUnknownFields: false,
  },
} as never);

/** An offer as the server makes one, to a key nobody holds. */
function offered() {
  const publicKey = generateKeyPairSync('x25519')
    .publicKey.export({ type: 'spki', format: 'der' })
    .subarray(-32);
  return {
    success: true,
    connectionId: '0f78f802-7835-43ab-8b03-b32b1ae23981',
    offer: {
      public_key: publicKey.toString('base64url'),
      kid: 'k-1-test',
      keyset: 'local',
      item: '0f78f802-7835-43ab-8b03-b32b1ae23981',
      field: 'intake',
      policy: {
        intake: {
          not_after: 1795504709,
          outputs: { token: 'SvwW39l-7oda_5F43SMrl8EdUIU9iv3DA8vGCLyaneI' },
        },
      },
    },
    fields: { token: 'token' },
    notAfter: 1795504709,
  };
}

/** Records the offers and saves the form sends, answering each save with
 *  the next of `saves` (a status and a body). */
async function recordSaves(
  page: Page,
  mockApi: MockApi,
  saves: { status: number; body: unknown }[]
) {
  const sent = { offers: [] as string[], saves: [] as string[] };
  await mockApi.raw(
    page,
    /\/api\/runtime(?:\/[^/]+)?\/connections\/offer$/,
    async (route) => {
      sent.offers.push(route.request().postData() ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(offered()),
      });
    }
  );
  await mockApi.raw(
    page,
    /\/api\/runtime(?:\/[^/]+)?\/connections$/,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      sent.saves.push(route.request().postData() ?? '');
      const answer = saves[Math.min(sent.saves.length, saves.length) - 1];
      await route.fulfill({
        status: answer.status,
        contentType: 'application/json',
        body: JSON.stringify(answer.body),
      });
    }
  );
  return sent;
}

async function mockBackend(page: Page, mockApi: MockApi) {
  await mockApi.bootstrap(page);
  await mockApi.connections.list(page, []);
  await mockApi.connections.types(page, [bearer]);
  await mockApi.connections.typeById(page, 'http_bearer', bearer);
}

async function fillAndCreate(page: Page) {
  await new CreateConnectionPage(page, 'http_bearer').goto();
  await page.getByRole('textbox', { name: /^Title/ }).fill('Orders');
  await page
    .getByRole('textbox', { name: /^Base URL/ })
    .fill('https://api.example.com');
  await page.locator('[data-field="token"] input').fill(SECRET);
  await page.getByRole('button', { name: 'Create connection' }).click();
}

const created = {
  status: 201,
  body: { success: true, connectionId: '0f78f802-7835-43ab-8b03-b32b1ae23981' },
};
const stale = {
  status: 409,
  body: {
    success: false,
    error: 'OFFER_STALE',
    message:
      'the offer these secrets were sealed under no longer stands: ask for a new one',
  },
};

test.describe('Sealed connection secrets (mocked)', () => {
  test('a secret is sealed in the browser: the offer and the save hold a marker', async ({
    page,
    mockApi,
  }) => {
    await mockBackend(page, mockApi);
    const sent = await recordSaves(page, mockApi, [created]);
    await fillAndCreate(page);

    await expect(page.getByText('Connection created.')).toBeVisible();
    expect(sent.offers).toHaveLength(1);
    expect(sent.saves).toHaveLength(1);
    expect(sent.offers[0]).not.toContain(SECRET);
    expect(sent.saves[0]).not.toContain(SECRET);

    const offer = JSON.parse(sent.offers[0]);
    expect(offer.connectionParameters).toEqual({
      base_url: 'https://api.example.com',
      token: { $entered: true },
    });
    // The one request, but for what the save adds.
    const { sealedSecrets, connectionId, ...request } = JSON.parse(
      sent.saves[0]
    );
    expect(request).toEqual(offer);
    expect(connectionId).toBe('0f78f802-7835-43ab-8b03-b32b1ae23981');
    expect(Object.keys(sealedSecrets).sort()).toEqual([
      'ct',
      'enc',
      'keyset',
      'kid',
      'v',
    ]);
  });

  test('with the sealer failing to load, nothing is saved and the secret is not sent', async ({
    page,
    mockApi,
  }) => {
    await mockBackend(page, mockApi);
    const sent = await recordSaves(page, mockApi, [created]);
    await page.route(/seal_format_bg.*\.wasm/, (route) => route.abort());
    await fillAndCreate(page);

    await expect(
      page.getByText(/could not be sealed in this browser/)
    ).toBeVisible();
    expect(sent.offers).toHaveLength(1);
    expect(sent.offers[0]).not.toContain(SECRET);
    expect(sent.saves).toHaveLength(0);
    // The form is still there to try again.
    await expect(
      page.getByRole('button', { name: 'Create connection' })
    ).toBeEnabled();
  });

  test('a stale offer is replaced once without asking', async ({
    page,
    mockApi,
  }) => {
    await mockBackend(page, mockApi);
    const sent = await recordSaves(page, mockApi, [stale, created]);
    await fillAndCreate(page);

    await expect(page.getByText('Connection created.')).toBeVisible();
    expect(sent.offers).toHaveLength(2);
    expect(sent.saves).toHaveLength(2);
    expect(sent.saves.join()).not.toContain(SECRET);
  });

  test('a second stale offer is shown', async ({ page, mockApi }) => {
    await mockBackend(page, mockApi);
    const sent = await recordSaves(page, mockApi, [stale]);
    await fillAndCreate(page);

    await expect(
      page.getByText(/stopped taking them twice in a row/)
    ).toBeVisible();
    expect(sent.saves).toHaveLength(2);
  });
});
