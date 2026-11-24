import { describe, expect, it } from 'vitest';

import {
  enterPatchSecrets,
  enterSecrets,
  sealedFieldsOf,
  SecretEntryError,
  splitPostgresUrl,
} from './enter-secrets';

const ENTERED = { $entered: true };

describe('sealedFieldsOf', () => {
  it('is what the connection type says is sent sealed', () => {
    expect(sealedFieldsOf({ sealedFields: ['token'] })).toEqual(['token']);
    expect(sealedFieldsOf({ sealedFields: [] })).toEqual([]);
  });

  it('stops a save to a server that does not say', () => {
    expect(() => sealedFieldsOf({})).toThrow(SecretEntryError);
    expect(() => sealedFieldsOf(null)).toThrow(SecretEntryError);
  });
});

describe('enterSecrets', () => {
  it('puts a marker where each sealed field was and takes the value out', () => {
    expect(
      enterSecrets('http_bearer', ['token'], {
        base_url: 'https://api.example.com',
        token: 'synthetic-token',
      })
    ).toEqual({
      parameters: { base_url: 'https://api.example.com', token: ENTERED },
      secrets: { token: 'synthetic-token' },
      beside: {},
    });
  });

  it('leaves a blank secret as it is, unmarked', () => {
    expect(
      enterSecrets('http_bearer', ['token'], {
        base_url: 'https://x',
        token: '',
      })
    ).toEqual({
      parameters: { base_url: 'https://x', token: '' },
      secrets: {},
      beside: {},
    });
  });

  it('sends as it is what the type does not name: a certificate beside its key', () => {
    const entered = enterSecrets('http_mtls', ['client_private_key_pem'], {
      client_certificate_pem: 'CERT',
      server_ca_pem: 'CA',
      client_private_key_pem: 'KEY',
    });
    expect(entered.parameters).toEqual({
      client_certificate_pem: 'CERT',
      server_ca_pem: 'CA',
      client_private_key_pem: ENTERED,
    });
    expect(entered.secrets).toEqual({ client_private_key_pem: 'KEY' });
  });

  it('seals a Postgres URL’s password and sends the rest beside it, as typed', () => {
    expect(
      enterSecrets('postgres', ['database_url'], {
        database_url:
          'postgres://app:p%40ss@db.example.com/orders?sslmode=require',
      })
    ).toEqual({
      parameters: { database_url: ENTERED },
      secrets: { database_url: 'p@ss' },
      beside: {
        database_target: 'postgres://app@db.example.com/orders?sslmode=require',
      },
    });
  });

  it('stops a Postgres URL with no password to seal', () => {
    expect(() =>
      enterSecrets('postgres', ['database_url'], {
        database_url: 'postgres://app@db.example.com/orders',
      })
    ).toThrow(SecretEntryError);
  });

  it('marks each MCP extra header that has a value, and keeps a blank one', () => {
    expect(
      enterSecrets('mcp', ['bearer_token', 'api_key_value'], {
        url: 'https://mcp.example.com/jsonrpc',
        bearer_token: 'synthetic-token',
        extra_headers: { 'X-Team': 'synthetic-team', 'X-Held': '', 'X-N': 7 },
      })
    ).toEqual({
      parameters: {
        url: 'https://mcp.example.com/jsonrpc',
        bearer_token: ENTERED,
        extra_headers: { 'X-Team': ENTERED, 'X-Held': '', 'X-N': ENTERED },
      },
      secrets: {
        bearer_token: 'synthetic-token',
        'extra_headers.X-Team': 'synthetic-team',
        'extra_headers.X-N': '7',
      },
      beside: {},
    });
  });
});

describe('splitPostgresUrl', () => {
  it.each([
    [
      'postgresql://app:pw@db.example.com:5432/orders',
      'pw',
      'postgresql://app@db.example.com:5432/orders',
    ],
    [
      'postgres://app:a:b@c@db.example.com/orders?sslmode=verify-full',
      'a:b@c',
      'postgres://app@db.example.com/orders?sslmode=verify-full',
    ],
    [
      'postgres://app:100%@db.example.com/orders',
      '100%',
      'postgres://app@db.example.com/orders',
    ],
  ])('%s', (url, password, target) => {
    expect(splitPostgresUrl(url)).toEqual({ password, target });
  });

  it.each([
    'postgres://app@db.example.com/orders',
    'postgres://app:@db.example.com/orders',
    'postgres://db.example.com/orders',
    'not a url',
  ])('finds no password in %s', (url) => {
    expect(splitPostgresUrl(url)).toBeNull();
  });
});

describe('enterPatchSecrets', () => {
  it('marks secrets in write and in set, and adds a Postgres target to set', () => {
    expect(
      enterPatchSecrets('postgres', ['database_url'], {
        set: {},
        write: { database_url: 'postgres://app:pw@db.example.com/orders' },
        clear: [],
      })
    ).toEqual({
      patch: {
        set: { database_target: 'postgres://app@db.example.com/orders' },
        write: { database_url: ENTERED },
        clear: [],
      },
      secrets: { database_url: 'pw' },
    });
  });

  it('keeps a cleared secret a clear', () => {
    expect(
      enterPatchSecrets('http_bearer', ['token'], {
        set: { base_url: 'https://api.example.com/v2' },
        write: {},
        clear: ['token'],
      })
    ).toEqual({
      patch: {
        set: { base_url: 'https://api.example.com/v2' },
        write: {},
        clear: ['token'],
      },
      secrets: {},
    });
  });
});
