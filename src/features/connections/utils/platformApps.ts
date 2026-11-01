import type { ConnectionTypeDto } from '@/generated/RuntaraRuntimeApi';
import type { FormDefinition } from '@/shared/forms';

/**
 * OAuth apps the platform registered with a provider, which a connection may
 * use in place of a client ID and secret of its own. The connection names one
 * in this reserved parameter; the server adds the app's credentials only to
 * what it sends the provider.
 */
export const PLATFORM_APP_PARAM = 'oauth_app';

/** The fields a platform app stands in for. */
export const PLATFORM_APP_CREDENTIAL_FIELDS = [
  'client_id',
  'client_secret',
] as const;

export interface ManagedApp {
  id: string;
  integrationId: string;
  displayName: string;
  scopes: string;
  requiredScopes: string;
}

/**
 * The platform apps a connection type offers the signed-in tenant
 * (`managedApps` on the connection-type listing; absent from servers that
 * predate platform apps).
 */
export function managedAppsOf(
  connectionType: ConnectionTypeDto | null | undefined
): ManagedApp[] {
  const apps = (connectionType as { managedApps?: unknown } | null | undefined)
    ?.managedApps;
  return Array.isArray(apps) ? (apps as ManagedApp[]) : [];
}

/** The platform app a connection's edit-projection values name, if any. */
export function platformAppOf(
  values: Record<string, unknown> | undefined
): string | null {
  const app = values?.[PLATFORM_APP_PARAM];
  return typeof app === 'string' && app ? app : null;
}

/** `definition` without the fields a platform app provides. */
export function withoutPlatformAppCredentials(
  definition: FormDefinition
): FormDefinition {
  const fields = { ...definition.fields };
  for (const name of PLATFORM_APP_CREDENTIAL_FIELDS) delete fields[name];
  return { ...definition, fields };
}

/**
 * A create submission on platform app `appId`: the app named, and none of the
 * client credentials it stands in for.
 */
export function onPlatformApp(
  submission: Record<string, unknown>,
  appId: string
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...submission,
    [PLATFORM_APP_PARAM]: appId,
  };
  for (const name of PLATFORM_APP_CREDENTIAL_FIELDS) delete next[name];
  return next;
}
