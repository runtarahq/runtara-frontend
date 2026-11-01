import { describe, expect, it } from 'vitest';
import type { ConnectionTypeDto } from '@/generated/RuntaraRuntimeApi';
import type { FormDefinition } from '@/shared/forms';
import {
  managedAppsOf,
  onPlatformApp,
  platformAppOf,
  withoutPlatformAppCredentials,
} from './platformApps';

const hubspotApp = {
  id: 'hubspot',
  integrationId: 'hubspot_private_app',
  displayName: 'HubSpot',
  scopes: 'oauth crm.objects.contacts.read',
  requiredScopes: 'oauth',
};

describe('platform OAuth apps', () => {
  it('reads the apps a connection type offers, none from an older server', () => {
    expect(
      managedAppsOf({
        integrationId: 'hubspot_private_app',
        managedApps: [hubspotApp],
      } as unknown as ConnectionTypeDto)
    ).toEqual([hubspotApp]);
    expect(
      managedAppsOf({
        integrationId: 'hubspot_private_app',
      } as unknown as ConnectionTypeDto)
    ).toEqual([]);
    expect(managedAppsOf(null)).toEqual([]);
  });

  it('names the app a connection uses', () => {
    expect(platformAppOf({ oauth_app: 'hubspot' })).toBe('hubspot');
    expect(platformAppOf({ client_id: 'own' })).toBeNull();
    expect(platformAppOf(undefined)).toBeNull();
  });

  it('drops the client credentials an app stands in for', () => {
    const definition: FormDefinition = {
      fields: {
        client_id: { type: 'string', required: true },
        client_secret: { type: 'string', required: true },
        scopes: { type: 'string' },
      },
    } as unknown as FormDefinition;
    expect(
      Object.keys(withoutPlatformAppCredentials(definition).fields)
    ).toEqual(['scopes']);
    expect(Object.keys(definition.fields)).toHaveLength(3);

    expect(
      onPlatformApp(
        { title: 'HubSpot', client_id: '', client_secret: '', scopes: 'oauth' },
        'hubspot'
      )
    ).toEqual({ title: 'HubSpot', scopes: 'oauth', oauth_app: 'hubspot' });
  });
});
