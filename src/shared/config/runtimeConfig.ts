// Runtime configuration.
//
// Values come from `window.__RUNTARA_CONFIG__`, which the deployment's
// `config.js` sets (the console image renders it at startup from RUNTARA_UI_*
// env vars) or staticConfig.ts fills from a `config.json`, so the same
// compiled bundle can be deployed with different OIDC/API/analytics settings
// without rebuilding. When a key is missing (e.g. running via `vite dev` or in
// tests), we fall back to the build-time `VITE_*` values.

import type { EntitlementsSnapshot } from '@/shared/entitlements';
import { normalizeMountPath } from '@/shared/config/staticConfig';

export type AuthMode = 'oidc' | 'local' | 'trust_proxy';

/**
 * Where the settings came from: a deployment's `config.js` or `config.json`,
 * with the console under its mount; or neither (vite dev, tests), where the
 * build-time values apply at the page root.
 */
export type Hosting = 'static' | 'build';

export type RuntimeConfig = {
  oidcAuthority?: string;
  oidcClientId?: string;
  oidcAudience?: string;
  /** "false" when the IdP has no Auth0 Organizations: the login then never
   *  sends an `organization` parameter. */
  oidcOrganizations?: string;
  apiBaseUrl?: string;
  /** Where providers and callers deliver events (webhooks, HTTP triggers),
   *  when that is another host than the console's: the trigger URLs shown
   *  are made from it. Set from RUNTARA_UI_EVENTS_BASE_URL. */
  eventsBaseUrl?: string;
  plausibleDomain?: string;
  plausibleHost?: string;
  version?: string;
  commit?: string;
  buildNumber?: string;
  /** Selected server-side auth provider. Defaults to "oidc" when unset. */
  authMode?: AuthMode;
  /** Configured tenant — set when the server runs without an IdP that
   * would otherwise supply `org_id` via JWT claims. */
  tenantId?: string;
  /** When "true", stop prefixing /api/runtime/ paths with org_id. Set from
   * RUNTARA_UI_STRIP_ORG_ID for single-tenant deployments. */
  stripOrgId?: string;
  /** Entitlement snapshot, set only by tests: a deployment's config never
   *  carries one (staticConfig.ts drops it), and consumers read
   *  `GET /api/runtime/entitlements`. */
  entitlements?: EntitlementsSnapshot;
  /** "static" in a deployment's settings: written into `config.js` by the
   *  console image, and set by staticConfig.ts for `config.json`. */
  hosting?: 'static';
  /** Static hosting only: the path the console is served under, its tenants
   *  at `{mountPath}{tenant}/`. Defaults to `/ui/`. */
  mountPath?: string;
};

declare global {
  interface Window {
    __RUNTARA_CONFIG__?: RuntimeConfig;
  }
}

const runtime: RuntimeConfig = window.__RUNTARA_CONFIG__ ?? {};

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const pick = (
  runtimeVal: string | undefined,
  envVal: string | undefined
): string | undefined => clean(runtimeVal) ?? clean(envVal);

const resolveAuthMode = (value: string | undefined): AuthMode => {
  switch (value) {
    case 'local':
      return 'local';
    case 'trust_proxy':
    case 'trust-proxy':
      return 'trust_proxy';
    default:
      return 'oidc';
  }
};

const resolveHosting = (value: RuntimeConfig): Hosting =>
  value.hosting === 'static' ? 'static' : 'build';

export const config = {
  hosting: resolveHosting(runtime),
  mountPath: normalizeMountPath(runtime.mountPath),
  authMode: resolveAuthMode(
    pick(runtime.authMode, import.meta.env.VITE_RUNTARA_AUTH_MODE)
  ),
  tenantId: pick(runtime.tenantId, import.meta.env.VITE_RUNTARA_TENANT_ID),
  stripOrgId:
    clean(runtime.stripOrgId) === 'true' ||
    import.meta.env.VITE_STRIP_ORG_ID === 'true',
  oidc: {
    authority: pick(runtime.oidcAuthority, import.meta.env.VITE_OIDC_AUTHORITY),
    clientId: pick(runtime.oidcClientId, import.meta.env.VITE_OIDC_CLIENT_ID),
    audience: pick(runtime.oidcAudience, import.meta.env.VITE_OIDC_AUDIENCE),
    organizations:
      pick(
        runtime.oidcOrganizations,
        import.meta.env.VITE_OIDC_ORGANIZATIONS
      ) !== 'false',
  },
  apiBaseUrl:
    pick(runtime.apiBaseUrl, import.meta.env.VITE_RUNTARA_API_BASE_URL) ?? '',
  eventsBaseUrl: clean(runtime.eventsBaseUrl),
  plausible: {
    domain: pick(
      runtime.plausibleDomain,
      import.meta.env.VITE_RUNTARA_PLAUSIBLE_DOMAIN
    ),
    host: pick(
      runtime.plausibleHost,
      import.meta.env.VITE_RUNTARA_PLAUSIBLE_HOST
    ),
  },
  build: {
    version:
      pick(runtime.version, import.meta.env.VITE_RUNTARA_VERSION) ?? 'dev',
    commit: pick(runtime.commit, import.meta.env.VITE_RUNTARA_COMMIT),
    buildNumber: pick(
      runtime.buildNumber,
      import.meta.env.VITE_RUNTARA_BUILD_NUMBER
    ),
  },
};

/** True when the server expects the SPA to perform OIDC auth itself. */
export const isOidcAuth = config.authMode === 'oidc';

// Diagnostic: make the resolved auth mode visible during boot so mismatches
// between the deployment's config and what the SPA observes are easy to spot.
// Safe to leave in — logs at most once per page load.
console.info(
  `[runtara] authMode=${config.authMode} tenantId=${config.tenantId ?? '<unset>'} version=${config.build.version} commit=${config.build.commit ?? '<unset>'}`,
  window.__RUNTARA_CONFIG__
);
