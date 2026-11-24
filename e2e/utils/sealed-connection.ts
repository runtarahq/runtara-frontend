import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { initSync, seal } from 'seal-wasm/web';

import { enterSecrets } from '@/features/connections/sealing/enter-secrets';

/**
 * Creates a connection over the API the way a client must: with its secrets
 * sealed (docs/sealed-secrets.md). The server refuses a secret sent readable.
 *
 * `body` is a create request written with its secrets readable. Each field
 * its connection type says is sealed is marked as entered, the secrets are sealed
 * under an offer made for the request, and nothing readable is sent. A
 * request that enters no secret is posted as it is.
 *
 * Returns the answer to the save, or the refusal of the offer that stopped
 * it: an offer refuses what the save would.
 */
export async function createConnectionSealed(
  request: APIRequestContext,
  apiBase: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<APIResponse> {
  const url = `${apiBase}/connections`;
  const integrationId = body.integrationId;
  const parameters = body.connectionParameters;
  if (
    typeof integrationId !== 'string' ||
    parameters === null ||
    typeof parameters !== 'object'
  ) {
    return request.post(url, { data: body, headers });
  }
  const type = await request.get(
    `${url}/types/${encodeURIComponent(integrationId)}`,
    { headers }
  );
  if (!type.ok()) return request.post(url, { data: body, headers });
  const { sealedFields } = (
    (await type.json()) as { connectionType: { sealedFields: string[] } }
  ).connectionType;

  const entered = enterSecrets(
    integrationId,
    sealedFields,
    parameters as Record<string, unknown>
  );
  if (Object.keys(entered.secrets).length === 0) {
    return request.post(url, { data: body, headers });
  }
  const marked = {
    ...body,
    connectionParameters: { ...entered.parameters, ...entered.beside },
  };
  const offered = await request.post(`${url}/offer`, {
    data: marked,
    headers,
  });
  if (!offered.ok()) return offered;
  const { offer, fields, connectionId } = (await offered.json()) as {
    offer: {
      public_key: string;
      kid: string;
      keyset: string;
      item: string;
      field: string;
      policy: unknown;
    };
    fields: Record<string, string>;
    connectionId: string;
  };

  sealer();
  const named = Object.fromEntries(
    Object.entries(entered.secrets).map(([name, value]) => [
      fields[name],
      value,
    ])
  );
  const sealedSecrets = JSON.parse(
    seal(
      offer.public_key,
      offer.kid,
      offer.keyset,
      offer.item,
      offer.field,
      new TextEncoder().encode(JSON.stringify(named)),
      JSON.stringify(offer.policy)
    )
  );
  return request.post(url, {
    data: { ...marked, connectionId, sealedSecrets },
    headers,
  });
}

let loaded = false;

/** Loads seal's WASM module into this process, once. */
function sealer() {
  if (loaded) return;
  initSync({
    module: readFileSync(
      path.resolve(
        process.cwd(),
        'node_modules/seal-wasm/web/seal_format_bg.wasm'
      )
    ),
  });
  loaded = true;
}
