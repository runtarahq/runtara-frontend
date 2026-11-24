import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { FormDefinition } from '@/shared/forms';
import { stubSealWasmFetch, testOffer } from '@/test/seal-wasm';
import { buildConnectionCreateParameters } from '../components/Forms/DynamicConnectionForm/adapter';
import { buildConnectionUpdateInput } from '../pages/Connection/update-payload';
import { enterSecrets } from '../sealing/enter-secrets';
import { createConnection, updateConnection } from './index';

/**
 * Every connection type of a runtara server (its `/connections/types`, cut
 * down to what decides which fields are sealed), saved through the queries
 * the pages use against a recording backend, with seal's real WASM module.
 */
const connectionTypes = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      'src/features/connections/sealing/__fixtures__/connection-types.json'
    ),
    'utf8'
  )
) as {
  integrationId: string;
  sealedFields: string[];
  formDefinition: FormDefinition;
}[];

/** What each request held as it was sent: serialised then, not later. */
const sent = vi.hoisted(() => ({
  offers: [] as string[],
  saves: [] as string[],
}));

function markedSecrets(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([name, held]) => {
    const marker =
      held !== null &&
      typeof held === 'object' &&
      (held as { $entered?: unknown }).$entered === true;
    if (marker) return [`${prefix}${name}`];
    return name === 'extra_headers'
      ? markedSecrets(held, 'extra_headers.')
      : [];
  });
}

vi.mock('@/shared/queries', () => {
  const offer = (body: {
    connectionParameters?: unknown;
    connectionParameterPatch?: { set: unknown; write: unknown };
  }) => {
    sent.offers.push(JSON.stringify(body));
    const names = [
      ...markedSecrets(body.connectionParameters),
      ...markedSecrets(body.connectionParameterPatch?.set),
      ...markedSecrets(body.connectionParameterPatch?.write),
    ];
    // As the server does: an extra header is sealed under a name made for it.
    const fields = Object.fromEntries(
      names.map((name, index) => [
        name,
        name.startsWith('extra_headers.') ? `xh_${index}` : name,
      ])
    );
    return {
      data: {
        success: true,
        connectionId: 'offered-id',
        offer: testOffer(Object.values(fields)),
        fields,
      },
    };
  };
  return {
    RuntimeREST: {
      api: {
        offerForCreateHandler: vi.fn(async (body) => offer(body)),
        offerForUpdateHandler: vi.fn(async (_id, body) => offer(body)),
        createConnectionHandler: vi.fn(async (body) => {
          sent.saves.push(JSON.stringify(body));
          return { data: { connectionId: body.connectionId } };
        }),
        updateConnectionHandler: vi.fn(async (_id, body) => {
          sent.saves.push(JSON.stringify(body));
          return { data: {} };
        }),
      },
    },
  };
});
vi.mock('@/shared/queries/utils', () => ({
  createAuthHeaders: () => ({ headers: {} }),
}));

/** A value for each field that is found again in a body that holds it. */
function filledForm(
  integrationId: string,
  sealedFields: string[],
  definition: FormDefinition
) {
  const values: Record<string, unknown> = {};
  const sealed: string[] = [];
  for (const [name, field] of Object.entries(definition.fields)) {
    const secret = `SECRET-${integrationId}-${name}`;
    if (integrationId === 'postgres' && name === 'database_url') {
      values[name] =
        `postgres://app:${secret}@db.example.com/orders?sslmode=require`;
      sealed.push(secret);
    } else if (integrationId === 'mcp' && name === 'extra_headers') {
      values[name] = { 'X-Team': secret, 'X-Trace': `${secret}-2` };
      sealed.push(secret);
    } else if (field.type === 'boolean') {
      values[name] = true;
    } else if (field.type === 'array') {
      values[name] = ['one'];
    } else if (field.type === 'object') {
      values[name] = { key: 'value' };
    } else if (sealedFields.includes(name)) {
      values[name] = secret;
      sealed.push(secret);
    } else {
      values[name] = `plain ${name}`;
    }
  }
  return { values, sealed };
}

function withoutSealing(body: string) {
  const { sealedSecrets, connectionId, ...rest } = JSON.parse(body);
  return { rest, sealedSecrets, connectionId };
}

describe('what a connection save sends', () => {
  beforeAll(() => {
    stubSealWasmFetch();
  });
  beforeEach(() => {
    sent.offers.length = 0;
    sent.saves.length = 0;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('covers connection types with each kind of secret', () => {
    const ids = connectionTypes.map((type) => type.integrationId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'http_bearer',
        'http_mtls',
        'postgres',
        'mcp',
        'http_oauth2_authorization_code',
      ])
    );
  });

  describe.each(connectionTypes)(
    '$integrationId',
    ({ integrationId, sealedFields, formDefinition }) => {
      const { values, sealed } = filledForm(
        integrationId,
        sealedFields,
        formDefinition
      );

      it('creates with no secret readable in the offer or the save', async () => {
        const entered = enterSecrets(
          integrationId,
          sealedFields,
          buildConnectionCreateParameters(formDefinition, values)
        );
        await createConnection(
          'token',
          {
            title: 'Orders',
            integrationId,
            connectionParameters: { ...entered.parameters, ...entered.beside },
          },
          entered.secrets
        );

        expect(sealed.length).toBeGreaterThan(0);
        expect(sent.offers).toHaveLength(1);
        expect(sent.saves).toHaveLength(1);
        for (const secret of sealed) {
          expect(sent.offers[0]).not.toContain(secret);
          expect(sent.saves[0]).not.toContain(secret);
        }
        // The one request, but for what the save adds.
        const save = withoutSealing(sent.saves[0]);
        expect(save.rest).toEqual(JSON.parse(sent.offers[0]));
        expect(save.connectionId).toBe('offered-id');
        expect(Object.keys(save.sealedSecrets).sort()).toEqual([
          'ct',
          'enc',
          'keyset',
          'kid',
          'v',
        ]);
      });

      it('updates with no secret readable in the offer or the save', async () => {
        const built = buildConnectionUpdateInput({
          id: 'connection-1',
          integrationId,
          sealedFields,
          data: { title: 'Orders', ...values },
          dirtyFieldNames: Object.keys(formDefinition.fields),
          clearSecrets: [],
          definition: formDefinition,
          projection: { version: 'v1' },
        });
        await updateConnection('token', built.update, built.secrets);

        expect(sent.offers).toHaveLength(1);
        expect(sent.saves).toHaveLength(1);
        for (const secret of sealed) {
          expect(sent.offers[0]).not.toContain(secret);
          expect(sent.saves[0]).not.toContain(secret);
        }
        const save = withoutSealing(sent.saves[0]);
        expect(save.rest).toEqual(JSON.parse(sent.offers[0]));
        expect(save.connectionId).toBeUndefined();
        expect(save.sealedSecrets).toBeTruthy();
      });
    }
  );

  it('sends a Postgres URL as its password, sealed, and the rest as typed', async () => {
    const postgres = connectionTypes.find(
      (type) => type.integrationId === 'postgres'
    )!;
    const entered = enterSecrets('postgres', postgres.sealedFields, {
      database_url:
        'postgres://app:synthetic-pw@db.example.com/orders?sslmode=require',
    });
    await createConnection(
      'token',
      {
        title: 'Orders',
        integrationId: 'postgres',
        connectionParameters: { ...entered.parameters, ...entered.beside },
      },
      entered.secrets
    );
    expect(JSON.parse(sent.saves[0]).connectionParameters).toEqual({
      database_url: { $entered: true },
      database_target: 'postgres://app@db.example.com/orders?sslmode=require',
    });
    expect(sent.saves[0]).not.toContain('synthetic-pw');
  });

  it('saves a change that enters no secret with no offer and no envelope', async () => {
    await updateConnection('token', {
      id: 'connection-1',
      version: 'v1',
      title: 'Renamed',
    });
    expect(sent.offers).toHaveLength(0);
    expect(JSON.parse(sent.saves[0])).toEqual({
      version: 'v1',
      title: 'Renamed',
    });
  });
});
