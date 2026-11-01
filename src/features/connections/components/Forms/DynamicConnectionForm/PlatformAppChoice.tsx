import { ShieldCheck } from 'lucide-react';

import type { ManagedApp } from '../../../utils/platformApps';

/**
 * How a new connection authorizes: with an OAuth app the platform registered
 * with the provider (no app of the tenant's own needed), or with the tenant's
 * own app's client ID and secret. `chosen` is the platform app's id, or null
 * for the tenant's own.
 */
export function PlatformAppChoice({
  provider,
  apps,
  chosen,
  onChoose,
}: {
  provider: string;
  apps: readonly ManagedApp[];
  chosen: string | null;
  onChoose: (app: string | null) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-4 text-sm">
      <legend className="px-1 font-medium">How to connect</legend>
      {apps.map((app) => (
        <label key={app.id} className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="platform-app"
            className="mt-1"
            checked={chosen === app.id}
            onChange={() => onChoose(app.id)}
          />
          <span>
            <span className="font-medium">Connect with {app.displayName}</span>
            <span className="block text-muted-foreground">
              Uses the app the platform registered with {provider}: you only
              sign in and approve. Nothing to register or paste.
            </span>
          </span>
        </label>
      ))}
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name="platform-app"
          className="mt-1"
          checked={chosen === null}
          onChange={() => onChoose(null)}
        />
        <span>
          <span className="font-medium">Use your own app</span>
          <span className="block text-muted-foreground">
            Enter the client ID and secret of an app you registered with{' '}
            {provider}, with this server&apos;s <code>/api/oauth/callback</code>{' '}
            as its redirect URI.
          </span>
        </span>
      </label>
    </fieldset>
  );
}

/** An existing connection on a platform app: its credentials are not the tenant's. */
export function PlatformAppNotice({
  provider,
  app,
}: {
  provider: string;
  app: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
      <ShieldCheck className="mt-0.5 size-5 shrink-0" />
      <p>
        Managed by the platform: this connection authorizes with {app}, the app
        the platform registered with {provider}. There is no client ID or secret
        of your own to keep.
      </p>
    </div>
  );
}
