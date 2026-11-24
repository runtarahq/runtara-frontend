import { describe, expect, it } from 'vitest';

import type { FormDefinition } from '@/shared/forms';
import { buildConnectionUpdateInput } from './update-payload';

const definition: FormDefinition = {
  fields: {
    environment: {
      type: 'string',
      default: 'sandbox',
      required: true,
    },
    client_secret: {
      type: 'string',
      access: 'write',
      secret: true,
    },
  },
};

describe('buildConnectionUpdateInput', () => {
  it('keeps displayed defaults and configured secrets out of a title-only update', () => {
    expect(
      buildConnectionUpdateInput({
        id: 'connection-1',
        integrationId: 'quickbooks_online',
        sealedFields: ['client_secret'],
        data: {
          title: 'Renamed',
          environment: 'sandbox',
          client_secret: '',
          rateLimitEnabled: false,
        },
        dirtyFieldNames: ['title'],
        clearSecrets: [],
        definition,
        projection: {
          values: {},
          secretState: {
            client_secret: { configured: true, clearable: false },
          },
          version: 'v7',
        },
      }).update
    ).toEqual({
      id: 'connection-1',
      version: 'v7',
      title: 'Renamed',
      parameterPatch: undefined,
      rateLimitConfig: undefined,
      isDefaultFileStorage: undefined,
      defaultFor: undefined,
    });
  });

  it('emits only explicitly changed parameter and clear operations', () => {
    expect(
      buildConnectionUpdateInput({
        id: 'connection-1',
        integrationId: 'quickbooks_online',
        sealedFields: ['client_secret'],
        data: {
          title: 'Original',
          environment: 'production',
          client_secret: '',
        },
        dirtyFieldNames: ['environment', 'client_secret'],
        clearSecrets: ['client_secret'],
        definition,
        projection: { version: 'v8' },
      }).update.parameterPatch
    ).toEqual({
      set: { environment: 'production' },
      write: {},
      clear: ['client_secret'],
    });
  });

  it('marks a replaced secret in the patch and hands its value over apart', () => {
    const built = buildConnectionUpdateInput({
      id: 'connection-1',
      integrationId: 'quickbooks_online',
      sealedFields: ['client_secret'],
      data: {
        title: 'Original',
        environment: 'production',
        client_secret: 'synthetic-secret',
      },
      dirtyFieldNames: ['environment', 'client_secret'],
      clearSecrets: [],
      definition,
      projection: { version: 'v9' },
    });
    expect(built.update.parameterPatch).toEqual({
      set: { environment: 'production' },
      write: { client_secret: { $entered: true } },
      clear: [],
    });
    expect(built.secrets).toEqual({ client_secret: 'synthetic-secret' });
    expect(JSON.stringify(built.update)).not.toContain('synthetic-secret');
  });
});
